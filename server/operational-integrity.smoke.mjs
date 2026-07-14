import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectCheckpointIntegrity } from './operational-integrity.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-studio-integrity-'));
try {
  assert.deepEqual(await inspectCheckpointIntegrity(root), { ok: true, checked: 0, unresolved: 0, issues: [] });
  const checkpoint = path.join(root, 'writeback-checkpoints', 'project-a', 'checkpoint-a');
  await fs.mkdir(checkpoint, { recursive: true });
  await fs.writeFile(path.join(checkpoint, 'manifest.json'), JSON.stringify({
    checkpointId: 'checkpoint-a',
    status: 'prepared',
    createdAt: new Date().toISOString(),
  }), 'utf8');
  const blocked = await inspectCheckpointIntegrity(root);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.unresolved, 1);
  await fs.writeFile(path.join(checkpoint, 'manifest.json'), JSON.stringify({
    checkpointId: 'checkpoint-a',
    status: 'rolled_back',
    createdAt: new Date().toISOString(),
  }), 'utf8');
  assert.equal((await inspectCheckpointIntegrity(root)).ok, true);
  console.log('operational-integrity smoke passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
