import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCheckpointIntegrity } from './operational-integrity.mjs';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, '..');
const dataDir = path.resolve(process.env.NOVEL_STUDIO_DATA_DIR || path.join(projectDir, '.data'));
const result = await inspectCheckpointIntegrity(dataDir);

console.log(JSON.stringify({
  ok: result.ok,
  checked: result.checked,
  unresolved: result.unresolved,
  issues: result.issues,
}, null, 2));
if (!result.ok) process.exitCode = 1;
