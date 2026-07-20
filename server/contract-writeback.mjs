import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const MISSING_HASH = '__missing__';
const MAX_CONTRACT_SIZE = 256 * 1024;
export const CONTRACT_REQUIRED_SECTIONS = Object.freeze(['本章目标', '读者情绪', '必须发生', '禁止发生', '章末问题', '字数与节奏']);

export class ContractWriteError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ContractWriteError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function emptyContractDraft() {
  return {
    version: VERSION,
    status: 'empty',
    title: '',
    text: '',
    contentHash: hashText(''),
    source: 'manual',
    providerId: '',
    providerName: '',
    model: '',
    updatedAt: null,
    validation: validateContractText(''),
    plan: emptyContractPlan(),
  };
}

export function emptyContractPlan() {
  return {
    version: VERSION,
    status: 'empty',
    relativePath: '',
    draftHash: '',
    beforeExists: false,
    beforeHash: '',
    afterHash: '',
    beforeText: '',
    afterText: '',
    planHash: '',
    preparedAt: null,
    error: null,
    commit: { checkpointId: '', committedAt: null, formalWritePerformed: false },
  };
}

export function validateContractText(value) {
  const text = String(value ?? '');
  const matches = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
  const sections = matches.map((match, index) => ({
    heading: normalizeHeading(match[1]),
    body: text.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length),
  }));
  const missingSections = [];
  const emptySections = [];
  for (const required of CONTRACT_REQUIRED_SECTIONS) {
    const section = sections.find(({ heading }) => heading === required || heading.startsWith(required + ' '));
    if (!section) missingSections.push(required);
    else if (!hasMeaningfulSectionContent(section.body)) emptySections.push(required);
  }
  return {
    valid: Boolean(text.trim()) && missingSections.length === 0 && emptySections.length === 0,
    requiredSections: [...CONTRACT_REQUIRED_SECTIONS],
    missingSections,
    emptySections,
  };
}

export function normalizeContractDraft(raw) {
  const base = emptyContractDraft();
  if (!isPlainObject(raw)) return base;
  const text = String(raw.text ?? '');
  if (text.length > MAX_CONTRACT_SIZE) throw new ContractWriteError(500, 'CONTRACT_DRAFT_TOO_LARGE', '章节契约侧车草稿超过安全长度。');
  const contentHash = hashText(text);
  const validation = validateContractText(text);
  const plan = normalizeContractPlan(raw.plan, contentHash);
  const committed = plan.status === 'committed' && plan.commit.formalWritePerformed;
  return {
    version: VERSION,
    status: committed ? 'committed' : text ? 'saved' : 'empty',
    title: String(raw.title ?? '').trim().slice(0, 200),
    text,
    contentHash,
    source: raw.source === 'model' ? 'model' : 'manual',
    providerId: String(raw.providerId ?? ''),
    providerName: String(raw.providerName ?? ''),
    model: String(raw.model ?? ''),
    updatedAt: raw.updatedAt ?? null,
    validation,
    plan,
  };
}

export function normalizeContractPlan(raw, contentHash = '') {
  const base = emptyContractPlan();
  if (!isPlainObject(raw)) return base;
  const commit = isPlainObject(raw.commit) ? raw.commit : {};
  const plan = {
    version: VERSION,
    status: ['empty', 'ready', 'stale', 'committed', 'error'].includes(raw.status) ? raw.status : 'empty',
    relativePath: normalizeRelativePath(raw.relativePath),
    draftHash: String(raw.draftHash ?? ''),
    beforeExists: raw.beforeExists === true,
    beforeHash: String(raw.beforeHash ?? ''),
    afterHash: String(raw.afterHash ?? ''),
    beforeText: String(raw.beforeText ?? ''),
    afterText: String(raw.afterText ?? ''),
    planHash: String(raw.planHash ?? ''),
    preparedAt: raw.preparedAt ?? null,
    error: raw.error ? String(raw.error).slice(0, 1000) : null,
    commit: {
      checkpointId: String(commit.checkpointId ?? ''),
      committedAt: commit.committedAt ?? null,
      formalWritePerformed: commit.formalWritePerformed === true,
    },
  };
  if (plan.commit.formalWritePerformed) {
    plan.status = 'committed';
    return plan;
  }
  if (plan.status === 'ready' && (!contentHash || plan.draftHash !== contentHash)) plan.status = 'stale';
  return plan;
}

export function contractTemplate(chapter) {
  const n = Number(chapter);
  return `# 章节契约 · 第${String(n).padStart(3, '0')}章

## 本章目标


## 读者情绪

- 

## 必须发生

1. 

## 禁止发生

- 

## 章末问题


## 字数与节奏

- 目标字数：2200-2800。
- 前 300 字内出现明确冲突或压力。
- 本章至少一个爽点或反转，章末必须留钩子。
`;
}

export async function buildContractPlan({ libraryRoot, dashboard, contractDraft }) {
  assertContractDraftReady(contractDraft);
  const projectRoot = await resolveProjectRoot(libraryRoot, dashboard?.project?.directoryName);
  const chapter = normalizeChapter(dashboard?.chapter?.number);
  const relativePath = contractRelativePath(chapter);
  const target = await readContractFile(projectRoot, relativePath);
  if (target.exists) throw new ContractWriteError(409, 'FORMAL_CONTRACT_ALREADY_EXISTS', `${relativePath} 已存在；当前流程禁止覆盖正式章节契约。`);
  const afterText = String(contractDraft.text);
  const planBase = {
    version: VERSION,
    status: 'ready',
    relativePath,
    draftHash: contractDraft.contentHash,
    beforeExists: false,
    beforeHash: MISSING_HASH,
    afterHash: hashText(afterText),
    beforeText: '',
    afterText,
    preparedAt: new Date().toISOString(),
    error: null,
  };
  return {
    ...planBase,
    planHash: hashPlan(planBase),
    commit: emptyContractPlan().commit,
  };
}

export async function checkContractPlanSource({ libraryRoot, dashboard, plan }) {
  if (!isPlainObject(plan) || !plan.relativePath) return [];
  const projectRoot = await resolveProjectRoot(libraryRoot, dashboard?.project?.directoryName);
  const current = await readContractFile(projectRoot, plan.relativePath);
  const currentHash = current.exists ? hashText(current.text) : MISSING_HASH;
  return currentHash === plan.beforeHash ? [] : [{ relativePath: plan.relativePath, expectedHash: plan.beforeHash, currentHash }];
}

export async function commitContractPlan({ dataDir, libraryRoot, dashboard, contractDraft, plan }) {
  assertContractDraftReady(contractDraft);
  if (!isPlainObject(plan) || plan.status !== 'ready') throw new ContractWriteError(409, 'CONTRACT_PLAN_NOT_READY', '请先生成并核对正式契约差异预览。');
  const chapter = normalizeChapter(dashboard?.chapter?.number);
  const expectedPath = contractRelativePath(chapter);
  if (plan.relativePath !== expectedPath) throw new ContractWriteError(409, 'CONTRACT_TARGET_MISMATCH', '章节契约目标路径已经变化，请重新生成预览。');
  if (plan.draftHash !== contractDraft.contentHash || plan.afterHash !== hashText(contractDraft.text)) throw new ContractWriteError(409, 'CONTRACT_DRAFT_CHANGED', '章节契约草稿已经变化，请重新生成预览。');
  if (hashPlan(plan) !== plan.planHash) throw new ContractWriteError(409, 'CONTRACT_PLAN_HASH_MISMATCH', '章节契约写入计划哈希不匹配。');
  const conflicts = await checkContractPlanSource({ libraryRoot, dashboard, plan });
  if (conflicts.length) throw new ContractWriteError(409, 'CONTRACT_SOURCE_CONFLICT', '正式契约目标在预览后发生变化，已拒绝写入。', { conflicts });

  const projectRoot = await resolveProjectRoot(libraryRoot, dashboard?.project?.directoryName);
  const checkpointRoot = path.join(path.resolve(dataDir), 'contract-checkpoints');
  await fs.mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  const checkpointId = `${formatCheckpointTime(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const checkpointDir = path.join(checkpointRoot, safeSegment(dashboard.project.id), checkpointId);
  await fs.mkdir(checkpointDir, { recursive: true, mode: 0o700 });
  const manifest = {
    version: VERSION,
    checkpointId,
    projectId: dashboard.project.id,
    projectTitle: dashboard.project.title,
    projectDirectoryName: dashboard.project.directoryName,
    chapter,
    relativePath: plan.relativePath,
    planHash: plan.planHash,
    beforeExists: false,
    beforeHash: MISSING_HASH,
    afterHash: plan.afterHash,
    status: 'prepared',
    createdAt: new Date().toISOString(),
    committedAt: null,
    rolledBackAt: null,
  };
  await writeJsonAtomic(path.join(checkpointDir, 'manifest.json'), manifest);
  await writeJsonAtomic(path.join(checkpointDir, 'plan.json'), {
    version: plan.version,
    relativePath: plan.relativePath,
    draftHash: plan.draftHash,
    beforeHash: plan.beforeHash,
    afterHash: plan.afterHash,
    planHash: plan.planHash,
    preparedAt: plan.preparedAt,
  });

  const target = await resolveContractTarget(projectRoot, plan.relativePath);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.contract.tmp`);
  let applied = false;
  try {
    await writeFileDurable(temp, plan.afterText);
    const targetStat = await lstatOrNull(target);
    if (targetStat) throw new ContractWriteError(409, 'CONTRACT_SOURCE_CONFLICT', '正式契约目标已存在，已拒绝覆盖。');
    try {
      await fs.link(temp, target);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new ContractWriteError(409, 'CONTRACT_SOURCE_CONFLICT', '正式契约目标已存在，已拒绝覆盖。');
      throw error;
    }
    await fs.unlink(temp);
    await syncDirectory(path.dirname(target));
    applied = true;
    manifest.status = 'files_applied';
    manifest.filesAppliedAt = new Date().toISOString();
    await writeJsonAtomic(path.join(checkpointDir, 'manifest.json'), manifest);
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    if (applied) await fs.unlink(target).catch(() => {});
    manifest.status = 'rolled_back';
    manifest.rolledBackAt = new Date().toISOString();
    manifest.error = String(error?.message || error).slice(0, 1000);
    await writeJsonAtomic(path.join(checkpointDir, 'manifest.json'), manifest).catch(() => {});
    throw new ContractWriteError(error?.status || 500, error?.code || 'CONTRACT_WRITE_FAILED', `正式契约创建失败，已回滚：${error?.message || '未知错误'}`, { checkpointId });
  }
  return {
    checkpointId,
    checkpointDir,
    filesAppliedAt: manifest.filesAppliedAt,
    relativePath: plan.relativePath,
    formalWritePerformed: true,
  };
}

export async function finalizeContractCheckpoint({ checkpointDir, committedAt }) {
  const manifestFile = path.join(path.resolve(checkpointDir), 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.status === 'committed') return manifest;
  if (manifest.status !== 'files_applied') {
    throw new ContractWriteError(409, 'CONTRACT_CHECKPOINT_NOT_APPLIED', '章节契约 checkpoint 尚未完成正式文件写入。');
  }
  manifest.status = 'committed';
  manifest.committedAt = new Date(committedAt || manifest.filesAppliedAt || Date.now()).toISOString();
  await writeJsonAtomic(manifestFile, manifest);
  return manifest;
}

function assertContractDraftReady(contractDraft) {
  if (!contractDraft?.text?.trim()) throw new ContractWriteError(409, 'CONTRACT_DRAFT_REQUIRED', '请先完成章节契约侧车草稿。');
  const validation = validateContractText(contractDraft.text);
  if (!validation.valid) throw new ContractWriteError(409, 'CONTRACT_STRUCTURE_INCOMPLETE', '章节契约缺少必需结构，不能生成正式预览。', validation);
  if (contractDraft.contentHash !== hashText(contractDraft.text)) throw new ContractWriteError(409, 'CONTRACT_DRAFT_HASH_MISMATCH', '章节契约草稿哈希不匹配，请重新保存。');
}

function normalizeChapter(value) {
  const chapter = Number(value);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 100000) throw new ContractWriteError(400, 'INVALID_CHAPTER_NUMBER', '当前章节号无效。');
  return chapter;
}

function contractRelativePath(chapter) {
  return `大纲/章节契约/第${String(chapter).padStart(3, '0')}章.md`;
}

function hashPlan(plan) {
  return hashText(JSON.stringify({
    version: plan.version,
    relativePath: plan.relativePath,
    draftHash: plan.draftHash,
    beforeHash: plan.beforeHash,
    afterHash: plan.afterHash,
  }));
}

async function resolveProjectRoot(libraryRoot, directoryName) {
  const root = await fs.realpath(path.resolve(libraryRoot));
  const segment = safeSegment(directoryName);
  const candidate = path.join(root, segment);
  const candidateStat = await fs.lstat(candidate).catch(() => null);
  if (!candidateStat || !candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new ContractWriteError(409, 'UNSAFE_PROJECT_ROOT', '小说项目根目录不是安全的普通目录。');
  const real = await fs.realpath(candidate);
  if (!isInside(root, real)) throw new ContractWriteError(404, 'PROJECT_NOT_FOUND', '未找到可安全写入的小说项目。');
  return real;
}

async function resolveContractTarget(projectRoot, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split('/');
  if (segments.length !== 3 || segments[0] !== '大纲' || segments[1] !== '章节契约' || !/^第\d{3,6}章\.md$/u.test(segments[2])) throw new ContractWriteError(400, 'INVALID_CONTRACT_PATH', '正式契约路径不合法。');
  const target = path.resolve(projectRoot, ...normalized.split('/'));
  if (!isInside(projectRoot, target)) throw new ContractWriteError(400, 'INVALID_CONTRACT_PATH', '正式契约路径越界。');
  const parent = path.dirname(target);
  const parentStat = await fs.lstat(parent).catch(() => null);
  if (!parentStat || !parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new ContractWriteError(409, 'UNSAFE_CONTRACT_PARENT', '章节契约目录不是安全的普通目录。');
  const parentReal = await fs.realpath(parent);
  if (!isInside(projectRoot, parentReal)) throw new ContractWriteError(409, 'UNSAFE_CONTRACT_PARENT', '章节契约目录越界。');
  return target;
}

async function readContractFile(projectRoot, relativePath) {
  const target = await resolveContractTarget(projectRoot, relativePath);
  const stat = await lstatOrNull(target);
  if (!stat) return { exists: false, text: '' };
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ContractWriteError(409, 'UNSAFE_CONTRACT_SOURCE', '正式契约目标不是普通文件。');
  if (stat.size > MAX_CONTRACT_SIZE) throw new ContractWriteError(413, 'FORMAL_CONTRACT_TOO_LARGE', '正式契约超过安全读取上限。');
  return { exists: true, text: await fs.readFile(target, 'utf8') };
}

function hasMeaningfulSectionContent(value) {
  return String(value ?? '').split(/\r?\n/).some((line) => {
    const content = line
      .replace(/^\s*(?:[-*+]\s+|\d+[.)\u3001]\s*)/u, '')
      .replace(/[\s`*_~>#\u2014\u2013:\uFF1A;\uFF1B,.\uFF0C\u3002!\uFF01?\uFF1F\u3001()\[\]{}\uFF08\uFF09\u3010\u3011]/gu, '');
    return content.length > 0;
  });
}

function normalizeHeading(value) {
  return String(value ?? '').replace(/[：:]+$/u, '').replace(/\s+/g, ' ').trim();
}
function normalizeRelativePath(value) {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}
function safeSegment(value) {
  const segment = String(value ?? '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) throw new ContractWriteError(400, 'INVALID_PATH_SEGMENT', '项目路径标识无效。');
  return segment;
}
function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
async function lstatOrNull(file) {
  try { return await fs.lstat(file); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
async function writeJsonAtomic(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  await writeFileDurable(temp, JSON.stringify(value, null, 2) + '\n');
  try {
    const stat = await lstatOrNull(file);
    if (!stat) await fs.rename(temp, file);
    else {
      const old = file + '.' + crypto.randomUUID() + '.old';
      await fs.rename(file, old);
      try { await fs.rename(temp, file); await fs.unlink(old).catch(() => {}); }
      catch (error) { await fs.rename(old, file).catch(() => {}); throw error; }
    }
    await syncDirectory(path.dirname(file));
  } finally { await fs.unlink(temp).catch(() => {}); }
}
async function writeFileDurable(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(directory) {
  // Windows does not support fsync on directory handles.
  if (process.platform === 'win32') return;
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}
function hashText(value) { return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex'); }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function formatCheckpointTime(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}
