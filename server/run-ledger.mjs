import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_VERSION = 1;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const RUN_ID_PATTERN = /^run_[A-Za-z0-9_-]{12,120}$/;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'stale']);
const DECISION_STATUSES = new Set(['accepted', 'rejected', 'blocked']);
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_RUNS_PER_PROJECT = 20_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const FORBIDDEN_KEYS = /^(?:api[_-]?key|authorization|cookie|set-cookie|password|passphrase|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|raw[_-]?(?:input|output)|messages|prompt|draft[_-]?text|content)$/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export class RunLedgerError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'RunLedgerError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createRunLedger({ dataDir, clock = () => new Date(), randomUUID = () => crypto.randomUUID() } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  const root = path.resolve(dataDir, 'runs');

  async function startRun(input = {}) {
    const projectId = assertProjectId(input.projectId);
    const dirs = await ensureProjectDir(root, projectId);
    const startedAt = toIso(clock());
    const runId = input.runId ? assertRunId(input.runId) : `run_${compactTime(startedAt)}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    assertRunId(runId);
    const record = normalizeNewRun(input, { projectId, runId, startedAt });
    assertSafeRecord(record);
    await writeJsonExclusive(path.join(dirs.projectDir, `${runId}.json`), record);
    return record;
  }

  async function getRun(projectId, runId) {
    const dirs = projectPaths(root, projectId);
    assertRunId(runId);
    const raw = await readJsonOrNull(path.join(dirs.projectDir, `${runId}.json`));
    if (!raw) return null;
    return validateStoredRun(raw, projectId, runId);
  }

  async function listRuns(projectId, { limit = 50, status, runType, chapter } = {}) {
    const dirs = projectPaths(root, projectId);
    let entries;
    try { entries = await fs.readdir(dirs.projectDir, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    if (entries.length > MAX_RUNS_PER_PROJECT) throw new RunLedgerError(500, 'RUN_LIMIT_EXCEEDED', '项目 Run 数量超过安全上限。');
    const bounded = clampInteger(limit, 1, 500, 50);
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const runId = entry.name.slice(0, -5);
      if (!RUN_ID_PATTERN.test(runId)) continue;
      const raw = await readJsonOrNull(path.join(dirs.projectDir, entry.name));
      const record = validateStoredRun(raw, projectId, runId);
      if (status && record.status !== status) continue;
      if (runType && record.runType !== runType) continue;
      if (chapter != null && record.chapter !== Number(chapter)) continue;
      records.push(record);
    }
    return records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, bounded);
  }

  async function completeRun(projectId, runId, patch = {}) {
    return mutateRun(projectId, runId, patch.expectedRevision, (current, now) => {
      assertRunning(current, 'complete');
      const completedAt = now;
      const latencyMs = normalizeLatency(patch.latencyMs, current.startedAt, completedAt);
      return {
        ...current,
        status: 'succeeded',
        revision: current.revision + 1,
        updatedAt: completedAt,
        completedAt,
        latencyMs,
        output: normalizeOutput(patch.output),
        usage: normalizeUsage(patch.usage),
        cost: normalizeCost(patch.cost),
        findings: normalizeFindings(patch.findings),
        error: null,
        events: appendEvent(current.events, { type: 'completed', at: completedAt, summary: cleanLine(patch.summary, 400) }),
      };
    });
  }

  async function failRun(projectId, runId, patch = {}) {
    return mutateRun(projectId, runId, patch.expectedRevision, (current, now) => {
      assertRunning(current, 'fail');
      const error = normalizeError(patch.error);
      if (!error.message) throw new RunLedgerError(400, 'RUN_ERROR_REQUIRED', '失败 Run 必须记录可读错误。');
      return {
        ...current,
        status: 'failed',
        revision: current.revision + 1,
        updatedAt: now,
        completedAt: now,
        latencyMs: normalizeLatency(patch.latencyMs, current.startedAt, now),
        error,
        events: appendEvent(current.events, { type: 'failed', at: now, summary: error.message }),
      };
    });
  }

  async function cancelRun(projectId, runId, patch = {}) {
    return mutateRun(projectId, runId, patch.expectedRevision, (current, now) => {
      assertRunning(current, 'cancel');
      return {
        ...current,
        status: 'cancelled',
        revision: current.revision + 1,
        updatedAt: now,
        completedAt: now,
        latencyMs: normalizeLatency(patch.latencyMs, current.startedAt, now),
        events: appendEvent(current.events, { type: 'cancelled', at: now, summary: cleanLine(patch.reason, 400) }),
      };
    });
  }

  async function markStale(projectId, runId, patch = {}) {
    return mutateRun(projectId, runId, patch.expectedRevision, (current, now) => {
      if (TERMINAL_STATUSES.has(current.status) && current.status !== 'succeeded') {
        throw new RunLedgerError(409, 'INVALID_RUN_TRANSITION', `Run 已处于 ${current.status}，不能标记 stale。`);
      }
      if (!['running', 'succeeded'].includes(current.status)) throw new RunLedgerError(409, 'INVALID_RUN_TRANSITION', '当前 Run 不能标记 stale。');
      return {
        ...current,
        status: 'stale',
        revision: current.revision + 1,
        updatedAt: now,
        completedAt: current.completedAt ?? now,
        events: appendEvent(current.events, { type: 'stale', at: now, summary: cleanLine(patch.reason, 400) }),
      };
    });
  }

  async function recordAuthorDecision(projectId, runId, patch = {}) {
    return mutateRun(projectId, runId, patch.expectedRevision, (current, now) => {
      if (!['succeeded', 'stale'].includes(current.status)) throw new RunLedgerError(409, 'RUN_DECISION_NOT_READY', '只有已有结果的 Run 才能记录作者裁决。');
      if (current.authorDecision.status !== 'pending') throw new RunLedgerError(409, 'RUN_DECISION_IMMUTABLE', '作者裁决已经记录，不能覆盖。');
      const status = String(patch.status ?? '').trim();
      if (!DECISION_STATUSES.has(status)) throw new RunLedgerError(400, 'INVALID_AUTHOR_DECISION', '作者裁决必须是 accepted、rejected 或 blocked。');
      const decision = { status, reason: cleanText(patch.reason, 1600), decidedAt: now };
      return {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        authorDecision: decision,
        events: appendEvent(current.events, { type: `author_${status}`, at: now, summary: decision.reason }),
      };
    });
  }

  async function linkCanonRevision(projectId, runId, patch = {}) {
    return mutateRun(projectId, runId, patch.expectedRevision, (current, now) => {
      if (current.status !== 'succeeded' || current.authorDecision.status !== 'accepted') {
        throw new RunLedgerError(409, 'RUN_CANON_LINK_NOT_READY', '只有已成功且被作者采纳的 Run 才能关联 Canon revision。');
      }
      if (current.writebackRevisionId) {
        if (current.writebackRevisionId === patch.revisionId) return current;
        throw new RunLedgerError(409, 'RUN_CANON_LINK_IMMUTABLE', 'Run 已关联另一 Canon revision，不能覆盖。');
      }
      const revisionId = cleanIdentifier(patch.revisionId, 160);
      if (!revisionId) throw new RunLedgerError(400, 'CANON_REVISION_ID_REQUIRED', '必须提供 Canon revision ID。');
      return {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        writebackRevisionId: revisionId,
        events: appendEvent(current.events, { type: 'canon_linked', at: now, summary: revisionId }),
      };
    });
  }

  async function mutateRun(projectId, runId, expectedRevision, transform) {
    const safeProjectId = assertProjectId(projectId);
    assertRunId(runId);
    const dirs = await ensureProjectDir(root, safeProjectId);
    const file = path.join(dirs.projectDir, `${runId}.json`);
    const lockFile = path.join(dirs.projectDir, `.${runId}.lock`);
    return withLock(lockFile, async () => {
      const raw = await readJsonOrNull(file);
      if (!raw) throw new RunLedgerError(404, 'RUN_NOT_FOUND', '未找到指定 Run。', { projectId: safeProjectId, runId });
      const current = validateStoredRun(raw, safeProjectId, runId);
      if (expectedRevision != null && Number(expectedRevision) !== current.revision) {
        throw new RunLedgerError(409, 'RUN_REVISION_CONFLICT', 'Run 已被另一操作更新，请重新加载。', {
          expectedRevision: Number(expectedRevision), currentRevision: current.revision,
        });
      }
      const next = transform(current, toIso(clock()));
      assertSafeRecord(next);
      await writeJsonAtomic(file, next);
      return next;
    });
  }

  return Object.freeze({
    root, startRun, getRun, listRuns, completeRun, failRun, cancelRun, markStale,
    recordAuthorDecision, linkCanonRevision,
  });
}

function normalizeNewRun(input, { projectId, runId, startedAt }) {
  const chapter = input.chapter == null ? null : Number(input.chapter);
  if (chapter !== null && (!Number.isInteger(chapter) || chapter < 1 || chapter > 1_000_000)) {
    throw new RunLedgerError(400, 'INVALID_RUN_CHAPTER', 'Run 章节号无效。');
  }
  const runType = cleanIdentifier(input.runType, 120);
  if (!runType) throw new RunLedgerError(400, 'RUN_TYPE_REQUIRED', 'Run 必须指定 runType。');
  const metadata = normalizeMetadata(input.metadata);
  return {
    version: STORE_VERSION,
    runId,
    projectId,
    chapter,
    runType,
    status: 'running',
    revision: 1,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    latencyMs: null,
    provider: normalizeProvider(input.provider),
    model: cleanLine(input.model, 200),
    versions: {
      promptVersion: cleanLine(input.promptVersion, 160),
      ruleVersion: cleanLine(input.ruleVersion, 160),
      canonRevisionId: cleanIdentifier(input.canonRevisionId, 160) || null,
    },
    input: normalizeInput(input.input),
    output: { contentHash: '', summary: '', artifactRefs: [] },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null },
    cost: { amount: null, currency: '' },
    findings: { counts: { P0: 0, P1: 0, P2: 0 }, summary: '' },
    error: null,
    authorDecision: { status: 'pending', reason: '', decidedAt: null },
    writebackRevisionId: null,
    metadata,
    events: [{ type: 'started', at: startedAt, summary: cleanLine(input.summary, 400) }],
  };
}

function normalizeProvider(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    id: cleanIdentifier(input.id ?? input.providerId, 160),
    name: cleanLine(input.name ?? input.providerName, 200),
    type: cleanIdentifier(input.type, 80),
  };
}

function normalizeInput(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    sourceHashes: normalizeSourceHashes(input.sourceHashes),
    promptHash: normalizeHash(input.promptHash),
    payloadHash: normalizeHash(input.payloadHash),
    candidateHash: normalizeHash(input.candidateHash),
    contractHash: normalizeHash(input.contractHash),
  };
}

function normalizeOutput(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    contentHash: normalizeHash(input.contentHash),
    summary: cleanText(input.summary, 1600),
    artifactRefs: normalizeStringArray(input.artifactRefs, 100, 400).map(normalizeRelativePath).filter(Boolean),
  };
}

function normalizeSourceHashes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 500).map((item) => {
    if (!isPlainObject(item)) return null;
    const relativePath = normalizeRelativePath(item.path ?? item.relativePath);
    const hash = normalizeHash(item.hash);
    if (!relativePath || !hash || seen.has(relativePath)) return null;
    seen.add(relativePath);
    return { path: relativePath, hash };
  }).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeUsage(value) {
  const input = isPlainObject(value) ? value : {};
  const inputTokens = optionalNonNegativeInteger(input.inputTokens ?? input.promptTokens ?? input.input_tokens ?? input.promptTokenCount);
  const outputTokens = optionalNonNegativeInteger(input.outputTokens ?? input.completionTokens ?? input.output_tokens ?? input.candidatesTokenCount);
  const totalTokens = optionalNonNegativeInteger(input.totalTokens ?? input.total_tokens ?? input.totalTokenCount) ?? (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens: optionalNonNegativeInteger(input.cachedTokens),
  };
}

function normalizeCost(value) {
  const input = isPlainObject(value) ? value : {};
  const amount = input.amount == null || input.amount === '' ? null : Number(input.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new RunLedgerError(400, 'INVALID_RUN_COST', 'Run cost.amount 必须是非负数字。');
  return { amount, currency: cleanIdentifier(input.currency, 16).toUpperCase() };
}

function normalizeFindings(value) {
  const input = isPlainObject(value) ? value : {};
  const countsInput = isPlainObject(input.counts) ? input.counts : input;
  return {
    counts: {
      P0: optionalNonNegativeInteger(countsInput.P0) ?? 0,
      P1: optionalNonNegativeInteger(countsInput.P1) ?? 0,
      P2: optionalNonNegativeInteger(countsInput.P2) ?? 0,
    },
    summary: cleanText(input.summary, 1600),
  };
}

function normalizeError(value) {
  const input = typeof value === 'string' ? { message: value } : (isPlainObject(value) ? value : {});
  return {
    code: cleanIdentifier(input.code, 160),
    message: cleanText(input.message, 1600),
    retryable: input.retryable === true,
    upstreamStatus: optionalNonNegativeInteger(input.upstreamStatus),
  };
}

function normalizeMetadata(value) {
  if (value == null) return {};
  if (!isPlainObject(value)) throw new RunLedgerError(400, 'INVALID_RUN_METADATA', 'Run metadata 必须是对象。');
  const cloned = JSON.parse(JSON.stringify(value));
  if (Buffer.byteLength(JSON.stringify(cloned), 'utf8') > MAX_METADATA_BYTES) throw new RunLedgerError(400, 'RUN_METADATA_TOO_LARGE', 'Run metadata 超过安全大小。');
  assertNoSecrets(cloned);
  return cloned;
}

function validateStoredRun(raw, projectId, runId) {
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || raw.projectId !== projectId || raw.runId !== runId) {
    throw new RunLedgerError(500, 'RUN_RECORD_CORRUPT', 'Run 账本文件损坏。', { projectId, runId });
  }
  if (!['running', ...TERMINAL_STATUSES].includes(raw.status) || !Number.isInteger(raw.revision) || raw.revision < 1) {
    throw new RunLedgerError(500, 'RUN_RECORD_CORRUPT', 'Run 状态或版本损坏。', { projectId, runId });
  }
  assertSafeRecord(raw);
  return raw;
}

function assertSafeRecord(record) {
  const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
  if (bytes > 512 * 1024) throw new RunLedgerError(400, 'RUN_RECORD_TOO_LARGE', 'Run 账本超过安全大小。');
  assertNoSecrets(record);
}

function assertNoSecrets(value, trail = '$') {
  if (typeof value === 'string') {
    for (const pattern of SECRET_TEXT_PATTERNS) {
      if (pattern.test(value)) throw new RunLedgerError(400, 'RUN_SECRET_REJECTED', 'Run 账本拒绝保存凭据或完整敏感内容。', { field: trail });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${trail}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new RunLedgerError(400, 'RUN_SENSITIVE_FIELD_REJECTED', 'Run 账本拒绝保存凭据、完整提示词或完整正文。', { field: `${trail}.${key}` });
    assertNoSecrets(item, `${trail}.${key}`);
  }
}

function assertRunning(current, action) {
  if (current.status !== 'running') throw new RunLedgerError(409, 'INVALID_RUN_TRANSITION', `Run 已处于 ${current.status}，不能执行 ${action}。`);
}

function appendEvent(events, event) {
  const current = Array.isArray(events) ? events.slice(-199) : [];
  return [...current, { type: cleanIdentifier(event.type, 80), at: event.at, summary: cleanLine(event.summary, 400) }];
}

function projectPaths(root, projectId) {
  const safeProjectId = assertProjectId(projectId);
  return { projectDir: path.join(root, safeProjectId) };
}

async function ensureProjectDir(root, projectId) {
  const dirs = projectPaths(root, projectId);
  await ensurePlainDirectory(root);
  await ensurePlainDirectory(dirs.projectDir);
  return dirs;
}

async function ensurePlainDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RunLedgerError(500, 'UNSAFE_RUN_DIRECTORY', 'Run 存储路径必须是普通目录。', { path: dir });
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
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new RunLedgerError(409, 'RUN_UPDATE_BUSY', 'Run 正在被另一进程更新，请稍后重试。');
      await delay(25);
    }
  }
}

async function writeJsonExclusive(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

async function writeJsonAtomic(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    const existing = await fs.lstat(file).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new RunLedgerError(500, 'UNSAFE_RUN_FILE', 'Run 账本必须是普通文件。', { path: file });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}

async function readJsonOrNull(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new RunLedgerError(500, 'UNSAFE_RUN_FILE', 'Run 账本必须是普通文件。', { path: file });
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new RunLedgerError(500, 'RUN_JSON_CORRUPT', 'Run JSON 无法解析。', { path: file });
    throw error;
  }
}

function normalizeRelativePath(value) {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanLine(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function assertProjectId(value) {
  const projectId = String(value ?? '').trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new RunLedgerError(400, 'INVALID_PROJECT_ID', '项目 ID 无效。');
  return projectId;
}

function assertRunId(value) {
  const runId = String(value ?? '').trim();
  if (!RUN_ID_PATTERN.test(runId)) throw new RunLedgerError(400, 'INVALID_RUN_ID', 'Run ID 无效。');
  return runId;
}

function cleanIdentifier(value, max) { return String(value ?? '').replace(/[^A-Za-z0-9._:@+-]/g, '_').slice(0, max); }
function cleanLine(value, max = 240) { return cleanText(value, max).replace(/\s+/g, ' ').trim(); }
function cleanText(value, max = 1200) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max); }
function normalizeHash(value) { const hash = String(value ?? '').trim().toLowerCase(); return /^[a-f0-9]{64}$/.test(hash) ? hash : ''; }
function optionalNonNegativeInteger(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function normalizeLatency(value, startedAt, completedAt) { const explicit = optionalNonNegativeInteger(value); if (explicit != null) return explicit; return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()); }
function toIso(value) { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) throw new TypeError('clock must return a valid date'); return date.toISOString(); }
function compactTime(iso) { return iso.replace(/[-:.TZ]/g, '').slice(0, 14); }
function clampInteger(value, min, max, fallback) { const number = Number(value); return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }