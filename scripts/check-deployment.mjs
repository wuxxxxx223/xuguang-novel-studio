import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const shellScripts = [
  'deploy/preflight.sh',
  'deploy/backup.sh',
  'deploy/restore.sh',
];
const nodeScripts = [
  'deploy/healthcheck.mjs',
  'deploy/smoke.mjs',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const script of nodeScripts) run(process.execPath, ['--check', script]);

if (process.platform === 'win32') {
  console.log('Windows deployment check complete; Ubuntu CI validates Linux shell scripts.');
} else {
  run('bash', ['-n', ...shellScripts]);
}
