import fs from 'node:fs/promises';
import path from 'node:path';

const CHECKPOINT_STORES = Object.freeze([
  { name: 'writeback', directory: 'writeback-checkpoints', terminal: new Set(['committed', 'rolled_back']) },
  { name: 'contract', directory: 'contract-checkpoints', terminal: new Set(['committed', 'rolled_back']) },
]);
const MAX_CHECKPOINTS = 20_000;

async function readdirOrEmpty(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}

export async function inspectCheckpointIntegrity(dataDir) {
  const issues = [];
  let checked = 0;
  for (const store of CHECKPOINT_STORES) {
    const root = path.join(path.resolve(dataDir), store.directory);
    const projects = await readdirOrEmpty(root);
    for (const project of projects) {
      if (!project.isDirectory() || project.name.startsWith('.')) continue;
      const projectRoot = path.join(root, project.name);
      const checkpoints = await readdirOrEmpty(projectRoot);
      for (const checkpoint of checkpoints) {
        if (!checkpoint.isDirectory() || checkpoint.name.startsWith('.')) continue;
        checked += 1;
        if (checked > MAX_CHECKPOINTS) {
          return {
            ok: false,
            checked,
            unresolved: issues.length + 1,
            issues: [...issues.slice(0, 99), { store: store.name, code: 'CHECKPOINT_LIMIT_EXCEEDED', checkpointId: '' }],
          };
        }
        const manifestFile = path.join(projectRoot, checkpoint.name, 'manifest.json');
        let manifest;
        try {
          const stat = await fs.lstat(manifestFile);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('unsafe manifest');
          manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        } catch {
          issues.push({ store: store.name, code: 'CHECKPOINT_MANIFEST_INVALID', checkpointId: checkpoint.name });
          continue;
        }
        const status = String(manifest?.status ?? '').trim();
        if (!store.terminal.has(status)) {
          issues.push({
            store: store.name,
            code: 'CHECKPOINT_NOT_TERMINAL',
            checkpointId: String(manifest?.checkpointId ?? checkpoint.name).slice(0, 180),
            status: status.slice(0, 80) || 'missing',
            createdAt: String(manifest?.createdAt ?? '').slice(0, 40),
          });
        }
      }
    }
  }
  return { ok: issues.length === 0, checked, unresolved: issues.length, issues: issues.slice(0, 100) };
}
