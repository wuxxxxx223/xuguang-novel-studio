#!/usr/bin/env node

import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');
const args = parseArgs(process.argv.slice(2));
const webPort = readPort(args.get('web-port') ?? process.env.NOVEL_STUDIO_LOCAL_REVIEW_WEB_PORT ?? '5178', '--web-port');
const apiPort = readPort(args.get('api-port') ?? process.env.NOVEL_STUDIO_LOCAL_REVIEW_API_PORT ?? '8790', '--api-port');
const checkOnly = args.has('check');

await assertNodeVersion();
await assertDependencies();

const [webPortState, apiPortState] = await Promise.all([inspectPort(webPort), inspectPort(apiPort)]);
if (checkOnly) {
  const existing = await existingStudioUrl(webPort, apiPort);
  await printDoctorReport(webPortState, apiPortState, existing);
  process.exitCode = (webPortState.available && apiPortState.available) || existing ? 0 : 1;
} else {
  await startIsolatedReview(webPortState, apiPortState);
}

async function startIsolatedReview(webState, apiState) {
  if (!webState.available || !apiState.available) {
    const existing = await existingStudioUrl(webPort, apiPort);
    if (existing) {
      console.log(`叙光本地服务已在运行：${existing}`);
      console.log('无需重复部署；直接用浏览器打开这个地址即可。');
      return;
    }
    const occupied = [webState, apiState].filter((item) => !item.available).map((item) => item.port).join('、');
    throw new Error(`端口 ${occupied} 已被其他程序占用。请关闭占用程序，或使用 --web-port / --api-port 选择一对空闲端口。`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xuguang-local-review-'));
  const dataDir = path.join(tempRoot, 'data');
  const libraryRoot = path.join(tempRoot, 'library');
  await fs.mkdir(libraryRoot, { recursive: true });

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(apiPort),
    NOVEL_STUDIO_DATA_DIR: dataDir,
    NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
    NOVEL_STUDIO_WEB_PORT: String(webPort),
    NOVEL_STUDIO_API_PROXY: `http://127.0.0.1:${apiPort}`,
  };
  const viteBin = path.join(PROJECT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, ['--watch', 'server/index.mjs'], {
    cwd: PROJECT_DIR,
    env,
    stdio: 'inherit',
  });
  const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(webPort)], {
    cwd: PROJECT_DIR,
    env,
    stdio: 'inherit',
  });
  let shuttingDown = false;

  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.kill('SIGTERM');
    vite.kill('SIGTERM');
    await Promise.all([waitForExit(server), waitForExit(vite)]);
    await fs.rm(tempRoot, { recursive: true, force: true });
    process.exitCode = exitCode;
  };

  process.once('SIGINT', () => { void shutdown(0); });
  process.once('SIGTERM', () => { void shutdown(0); });
  server.once('exit', (code) => { if (!shuttingDown) void shutdown(code === 0 ? 1 : code ?? 1); });
  vite.once('exit', (code) => { if (!shuttingDown) void shutdown(code === 0 ? 1 : code ?? 1); });

  try {
    await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/api/health`).then((response) => response.ok), 10_000, '本地 API');
    await waitFor(() => fetch(`http://127.0.0.1:${webPort}/`).then((response) => response.ok), 10_000, '本地前端');
    console.log('');
    console.log('叙光本地体验已启动（隔离临时数据，不读取或修改 .data/、作者正文或模型 Key）。');
    console.log(`打开：http://127.0.0.1:${webPort}/`);
    console.log('按 Ctrl+C 停止；本次体验数据会随临时目录清理。');
  } catch (error) {
    console.error(`本地体验启动失败：${error.message}`);
    await shutdown(1);
  }
}

async function printDoctorReport(webState, apiState, existing) {
  console.log(`Node.js ${process.versions.node}：可用`);
  console.log(`依赖：已安装`);
  console.log(`前端端口 ${webState.port}：${webState.available ? '可用' : '已占用'}`);
  console.log(`API 端口 ${apiState.port}：${apiState.available ? '可用' : '已占用'}`);
  if (existing) console.log(`检测到叙光已在运行：${existing}`);
  if (!webState.available || !apiState.available) {
    console.log('若这不是正在运行的叙光，请释放端口，或在 quickstart 时传入一对其他端口。');
  }
}

async function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major >= 25 || (major === 22 && minor < 12)) {
    throw new Error(`需要 Node.js >= 22.12 且 < 25，当前为 ${process.versions.node}。`);
  }
}

async function assertDependencies() {
  try {
    await fs.access(path.join(PROJECT_DIR, 'node_modules', 'vite', 'bin', 'vite.js'));
  } catch {
    throw new Error('尚未安装依赖。请先执行：npm ci');
  }
}

async function inspectPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve({ port, available: false }));
    tester.listen(port, '127.0.0.1', () => {
      tester.close(() => resolve({ port, available: true }));
    });
  });
}

async function existingStudioUrl(webPort, apiPort) {
  try {
    const [web, api] = await Promise.all([
      fetch(`http://127.0.0.1:${webPort}/`),
      fetch(`http://127.0.0.1:${apiPort}/api/health`),
    ]);
    if (!web.ok || !api.ok) return '';
    const health = await api.json();
    return health?.service === 'novel-studio-next' ? `http://127.0.0.1:${webPort}/` : '';
  } catch {
    return '';
  }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // 服务尚未准备好，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} 未在 ${timeoutMs}ms 内就绪。`);
}

function waitForExit(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

function parseArgs(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const [key, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) result.set(key, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) result.set(key, values[++index]);
    else result.set(key, true);
  }
  return result;
}

function readPort(value, flag) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${flag} 必须是 1-65535 的端口号。`);
  return port;
}
