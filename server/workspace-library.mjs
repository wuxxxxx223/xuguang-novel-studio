import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RECORD_VERSION = 1;
const LEGACY_MIGRATION_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;
const ACTIVE_LIMIT = 16 * 1024;
const RECORD_LIMIT = 3 * 1024 * 1024;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureOrdinaryDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Workspace 作品库路径不安全：${directory}`);
  }
}

async function readJsonOrNull(file, maxBytes) {
  const stat = await lstatOrNull(file);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Workspace 作品库文件不安全：${path.basename(file)}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`Workspace 作品库文件过大：${path.basename(file)}`);
  }
  try {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`Workspace 作品库文件不是合法 JSON：${path.basename(file)}`);
  }
}

async function writeJsonAtomic(file, value) {
  const directory = path.dirname(file);
  await ensureOrdinaryDirectory(directory);
  const current = await lstatOrNull(file);
  if (current && (current.isSymbolicLink() || !current.isFile())) {
    throw new Error(`Workspace 作品库文件不安全：${path.basename(file)}`);
  }
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600).catch(() => {});
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
  }
}

function normalizeIsoDate(value, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function hasWorkspaceContent(workspace) {
  const idea = workspace?.stages?.idea ?? {};
  return Boolean(
    String(workspace?.project?.title ?? '').trim()
    || String(workspace?.project?.genre ?? '').trim()
    || String(idea.input ?? '').trim()
    || idea.suggestion != null
    || idea.confirmed != null
    || (Array.isArray(workspace?.runs) && workspace.runs.length)
  );
}

function summarizeRecord(record, activeWorkspaceId) {
  const workspace = record.workspace;
  const statuses = Object.values(workspace?.stages ?? {});
  return {
    id: record.id,
    title: String(workspace?.project?.title ?? '').trim() || '未命名作品',
    genre: String(workspace?.project?.genre ?? '').trim(),
    currentStage: String(workspace?.currentStage ?? 'idea'),
    readyStages: statuses.filter((stage) => stage?.status === 'ready').length,
    currentChapterNumber: Number(workspace?.currentChapter?.number ?? 1) || 1,
    chapterTitle: String(workspace?.currentChapter?.title ?? '').trim(),
    hasContent: hasWorkspaceContent(workspace),
    revision: Number(workspace?.revision ?? 0) || 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    active: record.id === activeWorkspaceId,
  };
}

export function createWorkspaceLibrary({
  dataDir,
  legacyWorkspaceFile = path.join(dataDir, 'workspace.json'),
  defaultWorkspace,
  normalizeWorkspace,
  notFound = (message) => Object.assign(new Error(message), { status: 404, code: 'WORKSPACE_NOT_FOUND' }),
}) {
  if (!dataDir || typeof defaultWorkspace !== 'function' || typeof normalizeWorkspace !== 'function') {
    throw new Error('createWorkspaceLibrary 缺少必要参数。');
  }

  const root = path.join(path.resolve(dataDir), 'workspaces');
  const activeFile = path.join(path.resolve(dataDir), 'workspace-active.json');
  let migrationPromise = null;

  function recordFile(id) {
    if (!WORKSPACE_FILE_PATTERN.test(`${id}.json`)) {
      throw notFound('未找到指定的创作 Workspace。');
    }
    return path.join(root, `${id}.json`);
  }

  function normalizeRecord(raw, expectedId = '') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Workspace 作品记录结构无效。');
    }
    const id = String(raw.id ?? '');
    if (!WORKSPACE_FILE_PATTERN.test(`${id}.json`) || (expectedId && id !== expectedId)) {
      throw new Error('Workspace 作品记录 ID 无效。');
    }
    const now = new Date().toISOString();
    const createdAt = normalizeIsoDate(raw.createdAt, now);
    const updatedAt = normalizeIsoDate(raw.updatedAt, createdAt);
    return {
      version: RECORD_VERSION,
      id,
      createdAt,
      updatedAt,
      workspace: normalizeWorkspace(raw.workspace),
    };
  }

  async function readRecord(id) {
    const raw = await readJsonOrNull(recordFile(id), RECORD_LIMIT);
    return raw ? normalizeRecord(raw, id) : null;
  }

  async function writeRecord(record) {
    const normalized = normalizeRecord(record, record.id);
    await writeJsonAtomic(recordFile(normalized.id), normalized);
    return normalized;
  }

  async function readActiveId() {
    const raw = await readJsonOrNull(activeFile, ACTIVE_LIMIT);
    const id = String(raw?.activeWorkspaceId ?? '');
    return WORKSPACE_FILE_PATTERN.test(`${id}.json`) ? id : '';
  }

  async function writeActiveId(id) {
    await writeJsonAtomic(activeFile, {
      version: RECORD_VERSION,
      activeWorkspaceId: id,
      updatedAt: new Date().toISOString(),
    });
  }

  async function readAllRecords() {
    await ensureOrdinaryDirectory(root);
    const entries = await fs.readdir(root, { withFileTypes: true });
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || !WORKSPACE_FILE_PATTERN.test(entry.name)) continue;
      const id = entry.name.slice(0, -5);
      const record = await readRecord(id);
      if (record) records.push(record);
    }
    return records.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  }

  async function migrateLegacyWorkspace() {
    await ensureOrdinaryDirectory(path.resolve(dataDir));
    await ensureOrdinaryDirectory(root);
    const activeId = await readActiveId();
    if (activeId && await readRecord(activeId)) return;

    const existing = await readAllRecords();
    if (existing.length) {
      await writeActiveId(existing[0].id);
      await writeJsonAtomic(legacyWorkspaceFile, existing[0].workspace);
      return;
    }

    const legacy = await readJsonOrNull(legacyWorkspaceFile, RECORD_LIMIT);
    if (!legacy) return;
    const normalized = normalizeWorkspace(legacy);
    let updatedAt = new Date().toISOString();
    try {
      updatedAt = (await fs.stat(legacyWorkspaceFile)).mtime.toISOString();
    } catch {}
    const record = await writeRecord({
      version: RECORD_VERSION,
      id: LEGACY_MIGRATION_ID,
      createdAt: updatedAt,
      updatedAt,
      workspace: normalized,
    });
    await writeActiveId(record.id);
  }

  async function ensureMigration() {
    if (!migrationPromise) {
      migrationPromise = migrateLegacyWorkspace().catch((error) => {
        migrationPromise = null;
        throw error;
      });
    }
    await migrationPromise;
  }

  async function activeRecord() {
    await ensureMigration();
    const activeId = await readActiveId();
    if (activeId) {
      const record = await readRecord(activeId);
      if (record) return record;
    }
    const records = await readAllRecords();
    if (!records.length) return null;
    await writeActiveId(records[0].id);
    await writeJsonAtomic(legacyWorkspaceFile, records[0].workspace);
    return records[0];
  }

  return Object.freeze({
    async listWorkspaces() {
      await ensureMigration();
      const [activeWorkspaceId, records] = await Promise.all([readActiveId(), readAllRecords()]);
      return {
        activeWorkspaceId,
        workspaces: records.map((record) => summarizeRecord(record, activeWorkspaceId)),
      };
    },

    async getActiveWorkspace() {
      const record = await activeRecord();
      return record ? cloneJson(record.workspace) : normalizeWorkspace(defaultWorkspace());
    },

    async createWorkspace(initialWorkspace) {
      await ensureMigration();
      const now = new Date().toISOString();
      const record = await writeRecord({
        version: RECORD_VERSION,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        workspace: normalizeWorkspace(initialWorkspace, 0),
      });
      await writeActiveId(record.id);
      await writeJsonAtomic(legacyWorkspaceFile, record.workspace);
      return {
        workspaceId: record.id,
        workspace: cloneJson(record.workspace),
        summary: summarizeRecord(record, record.id),
      };
    },

    async activateWorkspace(id) {
      await ensureMigration();
      const record = await readRecord(String(id ?? ''));
      if (!record) throw notFound('未找到指定的创作 Workspace。');
      await writeActiveId(record.id);
      await writeJsonAtomic(legacyWorkspaceFile, record.workspace);
      return {
        workspaceId: record.id,
        workspace: cloneJson(record.workspace),
        summary: summarizeRecord(record, record.id),
      };
    },

    async saveActiveWorkspace(workspace) {
      const current = await activeRecord();
      const now = new Date().toISOString();
      const record = await writeRecord({
        version: RECORD_VERSION,
        id: current?.id ?? crypto.randomUUID(),
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        workspace: normalizeWorkspace(workspace),
      });
      if (!current) await writeActiveId(record.id);
      await writeJsonAtomic(legacyWorkspaceFile, record.workspace);
      return cloneJson(record.workspace);
    },
  });
}

