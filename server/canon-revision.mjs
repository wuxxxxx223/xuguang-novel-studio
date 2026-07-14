import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_VERSION = 1;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const REVISION_ID_PATTERN = /^cr_[A-Za-z0-9_-]{12,120}$/;
const MAX_REVISIONS = 10_000;
const MAX_METADATA_BYTES = 64 * 1024;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

export class CanonRevisionError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'CanonRevisionError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createCanonRevisionStore({ dataDir, clock = () => new Date(), randomUUID = () => crypto.randomUUID() } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  const root = path.resolve(dataDir, 'canon-revisions');

  async function getHead(projectId) {
    const dirs = projectPaths(root, projectId);
    const raw = await readJsonOrNull(dirs.headFile);
    if (!raw) return null;
    const head = normalizeHead(raw, projectId);
    if (!head) throw new CanonRevisionError(500, 'CANON_HEAD_CORRUPT', 'Canon head 文件损坏。', { projectId });
    return head;
  }

  async function getRevision(projectId, revisionId) {
    const dirs = projectPaths(root, projectId);
    assertRevisionId(revisionId);
    const raw = await readJsonOrNull(path.join(dirs.revisionsDir, `${revisionId}.json`));
    if (!raw) return null;
    const revision = normalizeStoredRevision(raw, projectId, revisionId);
    if (!revision) throw new CanonRevisionError(500, 'CANON_REVISION_CORRUPT', 'Canon revision 文件损坏。', { projectId, revisionId });
    return revision;
  }

  async function listRevisions(projectId, { limit = 50 } = {}) {
    const dirs = projectPaths(root, projectId);
    const boundedLimit = clampInteger(limit, 1, 500, 50);
    let entries;
    try { entries = await fs.readdir(dirs.revisionsDir, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    if (entries.length > MAX_REVISIONS) throw new CanonRevisionError(500, 'CANON_REVISION_LIMIT_EXCEEDED', 'Canon revision 数量超过安全上限。');
    const revisions = [];
    for (const entry of entries) {
      if (!entry.isFile() || !REVISION_ID_PATTERN.test(entry.name.replace(/\.json$/u, '')) || !entry.name.endsWith('.json')) continue;
      const revisionId = entry.name.slice(0, -5);
      const raw = await readJsonOrNull(path.join(dirs.revisionsDir, entry.name));
      const revision = normalizeStoredRevision(raw, projectId, revisionId);
      if (revision) revisions.push(revision);
    }
    return revisions.sort((a, b) => String(b.committedAt).localeCompare(String(a.committedAt))).slice(0, boundedLimit);
  }

  async function commitRevision(input = {}) {
    const projectId = assertProjectId(input.projectId);
    const dirs = await ensureProjectDirs(root, projectId);
    return withLock(dirs.lockFile, async () => {
      const currentHead = await getHeadUnlocked(dirs, projectId);
      const expectedParentRevisionId = normalizeNullableRevisionId(input.expectedParentRevisionId);
      const normalized = normalizeCommitInput(input, projectId);
      const commitKey = normalized.commitKey || computeCommitKey(normalized);

      if (currentHead?.commitKey === commitKey) {
        const revision = await readRequiredRevision(dirs, projectId, currentHead.revisionId);
        return { revision, head: currentHead, idempotent: true };
      }

      const orphan = await findRevisionByCommitKey(dirs, projectId, commitKey);
      if (orphan) {
        if (orphan.parentRevisionId !== (currentHead?.revisionId ?? null)) {
          throw new CanonRevisionError(409, 'CANON_COMMIT_KEY_CONFLICT', '相同幂等键已被用于另一条 Canon 修订链。', {
            commitKey, orphanRevisionId: orphan.revisionId, currentRevisionId: currentHead?.revisionId ?? null,
          });
        }
        assertExpectedParent(expectedParentRevisionId, currentHead);
        const head = buildHead(orphan);
        await writeJsonAtomic(dirs.headFile, head);
        return { revision: orphan, head, idempotent: true, recoveredOrphan: true };
      }

      assertExpectedParent(expectedParentRevisionId, currentHead);
      const committedAt = toIso(clock());
      const stablePayload = {
        version: STORE_VERSION,
        projectId,
        parentRevisionId: currentHead?.revisionId ?? null,
        chapter: normalized.chapter,
        checkpointId: normalized.checkpointId,
        runId: normalized.runId,
        commitKey,
        committedAt,
        committedBy: normalized.committedBy,
        sourceHashes: normalized.sourceHashes,
        acceptedFactDiffs: normalized.acceptedFactDiffs,
        rejectedFactDiffs: normalized.rejectedFactDiffs,
        affectedEntities: normalized.affectedEntities,
        metadata: normalized.metadata,
      };
      const digest = canonicalHash(stablePayload);
      const revisionId = `cr_${compactTime(committedAt)}_${digest.slice(0, 12)}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const revision = Object.freeze({ ...stablePayload, revisionId, digest });
      assertRevisionId(revisionId);
      await writeJsonExclusive(path.join(dirs.revisionsDir, `${revisionId}.json`), revision);
      const head = buildHead(revision);
      await writeJsonAtomic(dirs.headFile, head);
      return { revision, head, idempotent: false };
    });
  }

  return Object.freeze({ root, getHead, getRevision, listRevisions, commitRevision });
}

export function canonicalHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function normalizeCommitInput(input, projectId) {
  const chapter = Number(input.chapter);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 1_000_000) {
    throw new CanonRevisionError(400, 'INVALID_CANON_CHAPTER', 'Canon revision 的章节号无效。');
  }
  const checkpointId = cleanIdentifier(input.checkpointId, 160);
  if (!checkpointId) throw new CanonRevisionError(400, 'CANON_CHECKPOINT_REQUIRED', 'Canon revision 必须关联 checkpoint。');
  const runId = cleanOptionalIdentifier(input.runId, 180);
  const committedBy = cleanLine(input.committedBy || 'author', 120) || 'author';
  const sourceHashes = normalizeSourceHashes(input.sourceHashes);
  if (!sourceHashes.length) throw new CanonRevisionError(400, 'CANON_SOURCE_HASHES_REQUIRED', 'Canon revision 必须记录正式写入文件哈希。');
  const acceptedFactDiffs = normalizeFactDiffs(input.acceptedFactDiffs, 'acceptedFactDiffs');
  const rejectedFactDiffs = normalizeFactDiffs(input.rejectedFactDiffs, 'rejectedFactDiffs');
  const affectedEntities = normalizeStringArray(input.affectedEntities, 200, 240);
  const metadata = normalizeMetadata(input.metadata);
  const commitKey = cleanOptionalIdentifier(input.idempotencyKey, 200);
  return {
    projectId, chapter, checkpointId, runId, committedBy, sourceHashes,
    acceptedFactDiffs, rejectedFactDiffs, affectedEntities, metadata, commitKey,
  };
}

function normalizeSourceHashes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 500).map((item) => {
    if (!isPlainObject(item)) return null;
    const relativePath = normalizeRelativePath(item.path ?? item.relativePath);
    const hash = String(item.hash ?? item.afterHash ?? '').trim().toLowerCase();
    if (!relativePath || !/^[a-f0-9]{64}$/.test(hash) || seen.has(relativePath)) return null;
    seen.add(relativePath);
    return { path: relativePath, hash };
  }).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeFactDiffs(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new CanonRevisionError(400, 'INVALID_CANON_FACT_DIFFS', `${field} 必须是数组。`);
  return value.slice(0, 500).map((raw, index) => {
    if (!isPlainObject(raw)) throw new CanonRevisionError(400, 'INVALID_CANON_FACT_DIFF', `${field}[${index}] 必须是对象。`);
    const operation = String(raw.operation ?? 'confirm').trim().toLowerCase();
    if (!['add', 'update', 'remove', 'confirm', 'retcon'].includes(operation)) {
      throw new CanonRevisionError(400, 'INVALID_CANON_FACT_OPERATION', `${field}[${index}] 的 operation 无效。`);
    }
    const kind = cleanLine(raw.kind, 80);
    const subject = cleanLine(raw.subject, 240);
    const predicate = cleanLine(raw.predicate, 240);
    if (!kind && !subject && !predicate) throw new CanonRevisionError(400, 'CANON_FACT_IDENTITY_REQUIRED', `${field}[${index}] 缺少 kind/subject/predicate。`);
    return compactObject({
      operation,
      kind,
      subject,
      predicate,
      before: normalizeFactValue(raw.before),
      after: normalizeFactValue(raw.after),
      effectiveFrom: cleanLine(raw.effectiveFrom, 120),
      effectiveTo: cleanLine(raw.effectiveTo, 120),
      sourceChapter: normalizeOptionalPositiveInteger(raw.sourceChapter),
      reason: cleanText(raw.reason, 1200),
      confidence: normalizeConfidence(raw.confidence),
    });
  });
}

function normalizeFactValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return cleanText(value, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const cloned = JSON.parse(JSON.stringify(value));
  const bytes = Buffer.byteLength(JSON.stringify(cloned), 'utf8');
  if (bytes > 16 * 1024) throw new CanonRevisionError(400, 'CANON_FACT_VALUE_TOO_LARGE', '单个事实差异值超过安全大小。');
  return cloned;
}

function normalizeMetadata(value) {
  if (value == null) return {};
  if (!isPlainObject(value)) throw new CanonRevisionError(400, 'INVALID_CANON_METADATA', 'Canon metadata 必须是对象。');
  const cloned = JSON.parse(JSON.stringify(value));
  if (Buffer.byteLength(JSON.stringify(cloned), 'utf8') > MAX_METADATA_BYTES) {
    throw new CanonRevisionError(400, 'CANON_METADATA_TOO_LARGE', 'Canon metadata 超过安全大小。');
  }
  return cloned;
}

function buildHead(revision) {
  return {
    version: STORE_VERSION,
    projectId: revision.projectId,
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    commitKey: revision.commitKey,
    checkpointId: revision.checkpointId,
    chapter: revision.chapter,
    digest: revision.digest,
    updatedAt: revision.committedAt,
  };
}

function normalizeHead(raw, projectId) {
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || raw.projectId !== projectId) return null;
  try { assertRevisionId(raw.revisionId); } catch { return null; }
  return {
    version: STORE_VERSION,
    projectId,
    revisionId: raw.revisionId,
    parentRevisionId: normalizeNullableRevisionId(raw.parentRevisionId),
    commitKey: cleanIdentifier(raw.commitKey, 200),
    checkpointId: cleanIdentifier(raw.checkpointId, 160),
    chapter: normalizeOptionalPositiveInteger(raw.chapter),
    digest: /^[a-f0-9]{64}$/.test(String(raw.digest ?? '')) ? raw.digest : '',
    updatedAt: normalizeIso(raw.updatedAt),
  };
}

function normalizeStoredRevision(raw, projectId, revisionId) {
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || raw.projectId !== projectId || raw.revisionId !== revisionId) return null;
  const { digest, revisionId: storedRevisionId, ...unsigned } = raw;
  if (storedRevisionId !== revisionId || !/^[a-f0-9]{64}$/.test(String(digest ?? '')) || canonicalHash(unsigned) !== digest) return null;
  return raw;
}

async function readRequiredRevision(dirs, projectId, revisionId) {
  const raw = await readJsonOrNull(path.join(dirs.revisionsDir, `${revisionId}.json`));
  const revision = normalizeStoredRevision(raw, projectId, revisionId);
  if (!revision) throw new CanonRevisionError(500, 'CANON_REVISION_CORRUPT', 'Canon head 指向的 revision 不存在或已损坏。', { projectId, revisionId });
  return revision;
}

async function findRevisionByCommitKey(dirs, projectId, commitKey) {
  const entries = await fs.readdir(dirs.revisionsDir, { withFileTypes: true });
  if (entries.length > MAX_REVISIONS) throw new CanonRevisionError(500, 'CANON_REVISION_LIMIT_EXCEEDED', 'Canon revision 数量超过安全上限。');
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const revisionId = entry.name.slice(0, -5);
    if (!REVISION_ID_PATTERN.test(revisionId)) continue;
    const raw = await readJsonOrNull(path.join(dirs.revisionsDir, entry.name));
    const revision = normalizeStoredRevision(raw, projectId, revisionId);
    if (revision?.commitKey === commitKey) return revision;
  }
  return null;
}

function assertExpectedParent(expected, currentHead) {
  const current = currentHead?.revisionId ?? null;
  if (expected !== current) {
    throw new CanonRevisionError(409, 'CANON_HEAD_CONFLICT', 'Canon head 已变化，请基于最新版本重新提交。', {
      expectedParentRevisionId: expected, currentRevisionId: current,
    });
  }
}

function computeCommitKey(normalized) {
  return `ck_${canonicalHash({
    projectId: normalized.projectId,
    chapter: normalized.chapter,
    checkpointId: normalized.checkpointId,
    runId: normalized.runId,
    sourceHashes: normalized.sourceHashes,
    acceptedFactDiffs: normalized.acceptedFactDiffs,
    rejectedFactDiffs: normalized.rejectedFactDiffs,
    affectedEntities: normalized.affectedEntities,
  }).slice(0, 40)}`;
}

function projectPaths(root, projectId) {
  const safeProjectId = assertProjectId(projectId);
  const projectDir = path.join(root, safeProjectId);
  const revisionsDir = path.join(projectDir, 'revisions');
  return { projectDir, revisionsDir, headFile: path.join(projectDir, 'head.json'), lockFile: path.join(projectDir, '.commit.lock') };
}

async function ensureProjectDirs(root, projectId) {
  const dirs = projectPaths(root, projectId);
  await ensurePlainDirectory(root);
  await ensurePlainDirectory(dirs.projectDir);
  await ensurePlainDirectory(dirs.revisionsDir);
  return dirs;
}

async function ensurePlainDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CanonRevisionError(500, 'UNSAFE_CANON_DIRECTORY', 'Canon 存储路径必须是普通目录。', { path: dir });
}

async function withLock(lockFile, action) {
  const started = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockFile, 'wx', 0o600);
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
        return await action();
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(lockFile).catch(() => {});
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(lockFile).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.unlink(lockFile).catch(() => {});
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new CanonRevisionError(409, 'CANON_COMMIT_BUSY', 'Canon 修订正在被另一进程提交，请稍后重试。');
      await delay(25);
    }
  }
}

async function getHeadUnlocked(dirs, projectId) {
  const raw = await readJsonOrNull(dirs.headFile);
  if (!raw) return null;
  const head = normalizeHead(raw, projectId);
  if (!head) throw new CanonRevisionError(500, 'CANON_HEAD_CORRUPT', 'Canon head 文件损坏。', { projectId });
  await readRequiredRevision(dirs, projectId, head.revisionId);
  return head;
}

async function writeJsonExclusive(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

async function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    const existing = await fs.lstat(file).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new CanonRevisionError(500, 'UNSAFE_CANON_FILE', 'Canon 指针必须是普通文件。', { path: file });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

async function readJsonOrNull(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new CanonRevisionError(500, 'UNSAFE_CANON_FILE', 'Canon 账本必须是普通文件。', { path: file });
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new CanonRevisionError(500, 'CANON_JSON_CORRUPT', 'Canon JSON 无法解析。', { path: file });
    throw error;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== null && item !== undefined));
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanLine(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeRelativePath(value) {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function assertProjectId(value) {
  const projectId = String(value ?? '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new CanonRevisionError(400, 'INVALID_PROJECT_ID', '项目 ID 无效。');
  return projectId;
}

function assertRevisionId(value) {
  if (!REVISION_ID_PATTERN.test(String(value ?? ''))) throw new CanonRevisionError(400, 'INVALID_CANON_REVISION_ID', 'Canon revision ID 无效。');
}

function normalizeNullableRevisionId(value) {
  if (value == null || value === '') return null;
  const revisionId = String(value).trim();
  assertRevisionId(revisionId);
  return revisionId;
}

function cleanIdentifier(value, max) {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._:@+-]/g, '_').slice(0, max);
  return cleaned || '';
}

function cleanOptionalIdentifier(value, max) {
  if (value == null || value === '') return null;
  return cleanIdentifier(value, max) || null;
}

function cleanLine(value, max = 240) { return cleanText(value, max).replace(/\s+/g, ' ').trim(); }
function cleanText(value, max = 1200) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max); }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function normalizeOptionalPositiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }
function normalizeConfidence(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null; }
function normalizeIso(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function toIso(value) { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) throw new TypeError('clock must return a valid date'); return date.toISOString(); }
function compactTime(iso) { return iso.replace(/[-:.TZ]/g, '').slice(0, 14); }
function clampInteger(value, min, max, fallback) { const number = Number(value); return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }