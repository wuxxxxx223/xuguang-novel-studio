import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireInstanceLock,
  assertRuntimeFilesystem,
  inspectRuntimeFilesystem,
  loadRuntimeConfig,
  requestOriginAllowed,
} from './runtime-config.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-studio-runtime-'));
const projectDir = path.join(root, 'app');
const dataDir = path.join(root, 'data');
const libraryRoot = path.join(root, 'library');
await fs.mkdir(path.join(projectDir, 'dist'), { recursive: true });
await fs.mkdir(libraryRoot, { recursive: true });
await fs.writeFile(path.join(projectDir, 'dist', 'index.html'), '<!doctype html>', 'utf8');

try {
  const config = loadRuntimeConfig({
    projectDir,
    env: {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '8790',
      NOVEL_STUDIO_NETWORK_BOUNDARY: 'loopback-published',
      NOVEL_STUDIO_DATA_DIR: dataDir,
      NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
      NOVEL_STUDIO_LOG_FORMAT: 'json',
      NOVEL_STUDIO_TRUST_PROXY: 'loopback',
      NOVEL_STUDIO_TRUSTED_ORIGINS: 'https://novel.example.com',
      NOVEL_STUDIO_SHUTDOWN_TIMEOUT_MS: '30000',
    },
  });
  assert.equal(config.production, true);
  assert.equal(config.trustProxy, 'loopback');
  assert.deepEqual(config.trustedOrigins, ['https://novel.example.com']);
  await assertRuntimeFilesystem(config);
  assert.equal((await inspectRuntimeFilesystem(config)).ok, true);
  const lock = await acquireInstanceLock(config);
  await assert.rejects(() => acquireInstanceLock(config), /另一个 Novel Studio 实例/);
  await lock.release();
  const replacementLock = await acquireInstanceLock(config);
  await replacementLock.release();

  assert.throws(() => loadRuntimeConfig({
    projectDir,
    env: { NODE_ENV: 'production', HOST: '0.0.0.0', NOVEL_STUDIO_DATA_DIR: dataDir, NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot },
  }), /NETWORK_BOUNDARY/);
  assert.throws(() => loadRuntimeConfig({
    projectDir,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      NOVEL_STUDIO_DATA_DIR: './relative-data',
      NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
    },
  }), /绝对路径/);
  assert.throws(() => loadRuntimeConfig({
    projectDir,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      NOVEL_STUDIO_DATA_DIR: dataDir,
      NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
      NOVEL_STUDIO_TRUSTED_ORIGINS: 'http://novel.example.com',
    },
  }), /HTTPS/);
  assert.throws(() => loadRuntimeConfig({
    projectDir,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      NOVEL_STUDIO_DATA_DIR: path.join(libraryRoot, '.data'),
      NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
    },
  }), /互不嵌套/);

  const developmentConfig = loadRuntimeConfig({
    projectDir,
    env: {
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      NOVEL_STUDIO_DATA_DIR: dataDir,
      NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
    },
  });
  const request = ({ origin, host = '127.0.0.1:8790', fetchSite = 'same-site' }) => ({
    protocol: 'http',
    get(name) {
      return {
        origin,
        host,
        'sec-fetch-site': fetchSite,
      }[String(name).toLowerCase()];
    },
  });
  assert.equal(requestOriginAllowed(request({ origin: 'http://127.0.0.1:5178' }), developmentConfig), true);
  assert.equal(requestOriginAllowed(request({ origin: 'http://localhost:5178' }), developmentConfig), true);
  assert.equal(requestOriginAllowed(request({ origin: 'https://attacker.example' }), developmentConfig), false);
  assert.equal(requestOriginAllowed(request({
    origin: 'http://127.0.0.1:5178',
    fetchSite: 'cross-site',
  }), developmentConfig), false);
  assert.equal(requestOriginAllowed(request({ origin: 'http://127.0.0.1:5178' }), config), false);

  console.log('runtime-config smoke passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
