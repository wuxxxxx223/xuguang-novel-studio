import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const NODE_ENVS = new Set(['development', 'test', 'production']);
const LOG_FORMATS = new Set(['pretty', 'json']);
const NETWORK_BOUNDARIES = new Set(['local', 'loopback-published', 'trusted-proxy']);

function parseInteger(raw, { name, min, max }) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的整数，当前值为 ${JSON.stringify(raw)}。`);
  }
  return value;
}

function parsePath(raw, { name, fallback, production }) {
  const value = String(raw ?? fallback).trim();
  if (!value) throw new Error(`${name} 不能为空。`);
  if (production && !path.isAbsolute(value)) throw new Error(`生产环境的 ${name} 必须是绝对路径。`);
  return path.resolve(value);
}

function isLoopbackHost(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(host.toLowerCase());
}

function pathsOverlap(first, second) {
  const relative = path.relative(path.resolve(first), path.resolve(second));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseTrustProxy(raw) {
  const value = String(raw ?? '').trim();
  if (!value || ['false', '0', 'off', 'none'].includes(value.toLowerCase())) return false;
  if (['loopback', 'linklocal', 'uniquelocal'].includes(value.toLowerCase())) return value.toLowerCase();
  if (/^[1-9]\d?$/.test(value)) return parseInteger(value, { name: 'NOVEL_STUDIO_TRUST_PROXY', min: 1, max: 10 });
  throw new Error('NOVEL_STUDIO_TRUST_PROXY 只能是 false、loopback、linklocal、uniquelocal 或 1-10 的代理跳数。');
}

function parseTrustedOrigins(raw, production) {
  const values = String(raw ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return values.map((value) => {
    let url;
    try { url = new URL(value); } catch { throw new Error(`NOVEL_STUDIO_TRUSTED_ORIGINS 包含无效 URL：${value}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error(`NOVEL_STUDIO_TRUSTED_ORIGINS 必须只包含 http(s) origin：${value}`);
    }
    const localhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (production && url.protocol !== 'https:' && !localhost) {
      throw new Error(`生产环境的受信任非本机 origin 必须使用 HTTPS：${value}`);
    }
    return url.origin;
  });
}

export function loadRuntimeConfig({ env = process.env, projectDir }) {
  if (!projectDir) throw new Error('projectDir 是必填参数。');
  const nodeEnv = String(env.NODE_ENV ?? 'development').trim().toLowerCase();
  if (!NODE_ENVS.has(nodeEnv)) throw new Error(`NODE_ENV 必须是 development、test 或 production，当前值为 ${JSON.stringify(env.NODE_ENV)}。`);
  const production = nodeEnv === 'production';
  const host = String(env.HOST ?? '127.0.0.1').trim();
  if (!host || /\s|\//.test(host)) throw new Error(`HOST 不是合法监听地址：${JSON.stringify(env.HOST)}`);
  const networkBoundary = String(env.NOVEL_STUDIO_NETWORK_BOUNDARY ?? (isLoopbackHost(host) ? 'local' : '')).trim();
  if (!NETWORK_BOUNDARIES.has(networkBoundary)) {
    throw new Error('NOVEL_STUDIO_NETWORK_BOUNDARY 必须是 local、loopback-published 或 trusted-proxy。');
  }
  if (production && !isLoopbackHost(host) && !['loopback-published', 'trusted-proxy'].includes(networkBoundary)) {
    throw new Error('生产环境监听非回环地址时，必须明确设置 NOVEL_STUDIO_NETWORK_BOUNDARY=loopback-published 或 trusted-proxy。');
  }
  if (networkBoundary === 'local' && !isLoopbackHost(host)) {
    throw new Error('NOVEL_STUDIO_NETWORK_BOUNDARY=local 只能配合回环监听地址。');
  }

  const dataDir = parsePath(env.NOVEL_STUDIO_DATA_DIR, {
    name: 'NOVEL_STUDIO_DATA_DIR',
    fallback: path.join(projectDir, '.data'),
    production,
  });
  const libraryRoot = parsePath(env.NOVEL_STUDIO_LIBRARY_ROOT, {
    name: 'NOVEL_STUDIO_LIBRARY_ROOT',
    fallback: path.resolve(projectDir, '..'),
    production,
  });
  if (dataDir === libraryRoot) throw new Error('NOVEL_STUDIO_DATA_DIR 与 NOVEL_STUDIO_LIBRARY_ROOT 不能是同一目录。');
  if (production && (pathsOverlap(dataDir, libraryRoot) || pathsOverlap(libraryRoot, dataDir))) {
    throw new Error('生产环境的 NOVEL_STUDIO_DATA_DIR 与 NOVEL_STUDIO_LIBRARY_ROOT 必须是互不嵌套的独立目录。');
  }

  const logFormat = String(env.NOVEL_STUDIO_LOG_FORMAT ?? (production ? 'json' : 'pretty')).trim().toLowerCase();
  if (!LOG_FORMATS.has(logFormat)) throw new Error('NOVEL_STUDIO_LOG_FORMAT 必须是 pretty 或 json。');

  return Object.freeze({
    nodeEnv,
    production,
    host,
    port: parseInteger(env.PORT ?? '8790', { name: 'PORT', min: 1, max: 65535 }),
    dataDir,
    libraryRoot,
    distDir: path.join(projectDir, 'dist'),
    logFormat,
    networkBoundary,
    trustProxy: parseTrustProxy(env.NOVEL_STUDIO_TRUST_PROXY),
    trustedOrigins: Object.freeze(parseTrustedOrigins(env.NOVEL_STUDIO_TRUSTED_ORIGINS, production)),
    shutdownTimeoutMs: parseInteger(env.NOVEL_STUDIO_SHUTDOWN_TIMEOUT_MS ?? '30000', {
      name: 'NOVEL_STUDIO_SHUTDOWN_TIMEOUT_MS',
      min: 1000,
      max: 120000,
    }),
  });
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function inspectDirectory(target, { name, writable, create = false }) {
  if (create) await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const stat = await lstatOrNull(target);
  if (!stat) return { ok: false, code: 'MISSING', message: `${name} 不存在。` };
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return { ok: false, code: 'UNSAFE_PATH', message: `${name} 必须是普通目录且不能是符号链接。` };
  }
  try {
    await fs.access(target, writable ? fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK : fsConstants.R_OK | fsConstants.X_OK);
    return { ok: true, code: 'OK' };
  } catch {
    return { ok: false, code: writable ? 'NOT_WRITABLE' : 'NOT_READABLE', message: `${name} 权限不足。` };
  }
}

async function inspectFile(target, { name, required }) {
  const stat = await lstatOrNull(target);
  if (!stat) return required
    ? { ok: false, code: 'MISSING', message: `${name} 不存在。` }
    : { ok: true, code: 'OPTIONAL_MISSING' };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ok: false, code: 'UNSAFE_PATH', message: `${name} 必须是普通文件且不能是符号链接。` };
  }
  try {
    await fs.access(target, fsConstants.R_OK);
    return { ok: true, code: 'OK' };
  } catch {
    return { ok: false, code: 'NOT_READABLE', message: `${name} 不可读。` };
  }
}

export async function inspectRuntimeFilesystem(config) {
  const [data, library, dist] = await Promise.all([
    inspectDirectory(config.dataDir, { name: '应用数据目录', writable: true, create: true }),
    inspectDirectory(config.libraryRoot, { name: '小说库根目录', writable: false }),
    inspectFile(path.join(config.distDir, 'index.html'), { name: 'dist/index.html', required: config.production }),
  ]);
  return {
    ok: data.ok && library.ok && dist.ok,
    data,
    library,
    dist,
  };
}

export async function assertRuntimeFilesystem(config) {
  const status = await inspectRuntimeFilesystem(config);
  if (status.ok) return status;
  const messages = Object.values(status).filter((item) => item && item.ok === false).map((item) => item.message);
  throw new Error(`生产运行目录校验失败：${messages.join('；')}`);
}

async function processStartToken(pid) {
  if (process.platform !== 'linux') return '';
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const closing = stat.lastIndexOf(')');
    if (closing < 0) return '';
    const fieldsAfterCommand = stat.slice(closing + 2).trim().split(/\s+/);
    return fieldsAfterCommand[19] ?? '';
  } catch {
    return '';
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function existingLockActive(lock) {
  const pid = Number(lock?.pid);
  if (!Number.isInteger(pid) || pid < 1 || lock?.hostname !== os.hostname()) return false;
  const startedAt = new Date(lock.startedAt).getTime();
  if (!Number.isFinite(startedAt) || startedAt < Date.now() - (os.uptime() * 1000) - 60_000) return false;
  if (!processExists(pid)) return false;
  if (process.platform !== 'linux') return true;
  const currentToken = await processStartToken(pid);
  return Boolean(currentToken && currentToken === lock.processStartToken);
}

export async function acquireInstanceLock(config) {
  const lockFile = path.join(config.dataDir, '.novel-studio.instance.lock');
  const token = crypto.randomUUID();
  const payload = {
    version: 1,
    token,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    processStartToken: await processStartToken(process.pid),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      return Object.freeze({
        file: lockFile,
        async release() {
          try {
            const current = JSON.parse(await fs.readFile(lockFile, 'utf8'));
            if (current?.token === token) await fs.unlink(lockFile);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        },
      });
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
      const stat = await lstatOrNull(lockFile);
      if (!stat?.isFile() || stat.isSymbolicLink()) {
        throw new Error('实例锁路径不安全，必须是普通文件。');
      }
      let existing = null;
      try { existing = JSON.parse(await fs.readFile(lockFile, 'utf8')); } catch {}
      if (await existingLockActive(existing)) {
        throw new Error(`检测到另一个 Novel Studio 实例正在使用同一数据目录（PID ${existing.pid}）。`);
      }
      await fs.unlink(lockFile).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  throw new Error('无法取得 Novel Studio 单实例锁。');
}

export function requestOriginAllowed(req, config) {
  const fetchSite = String(req.get('sec-fetch-site') ?? '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  const rawOrigin = String(req.get('origin') ?? '').trim();
  if (!rawOrigin) return true;
  let origin;
  try { origin = new URL(rawOrigin).origin; } catch { return false; }
  if (config.trustedOrigins.includes(origin)) return true;
  const host = String(req.get('host') ?? '').trim();
  if (!host) return false;
  return origin === `${req.protocol}://${host}`;
}
