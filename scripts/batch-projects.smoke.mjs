import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { classifyProject, parseArgs, runBatch } from './batch-projects.mjs';

assert.deepEqual(classifyProject('generate', { chapter: { contractReady: false } }, {}), {
  eligible: false, reason: '缺少正式章节契约',
});
assert.equal(classifyProject('generate', { chapter: { contractReady: true } }, {
  candidate: { text: '已有正文' },
}).eligible, false);
assert.equal(classifyProject('review', { chapter: { contractReady: true } }, {
  candidate: { text: '正文', contentHash: 'same' },
  review: { status: 'ready', candidateHash: 'same' },
}).eligible, false);
assert.throws(() => parseArgs(['--operation', 'generate', '--all']), /confirm-spend/);

const projects = [
  { id: 'project-a', title: '甲' },
  { id: 'project-b', title: '乙' },
  { id: 'project-c', title: '丙' },
  { id: 'project-d', title: '丁' },
];
const workspaces = {
  'project-a': { revision: 1, candidate: { text: '', contentHash: 'empty' }, review: { status: 'empty' } },
  'project-b': { revision: 2, candidate: { text: '已有候选', contentHash: 'b' }, review: { status: 'empty' } },
  'project-c': { revision: 3, candidate: { text: '', contentHash: 'empty' }, review: { status: 'empty' } },
  'project-d': { revision: 4, candidate: { text: '', contentHash: 'empty' }, review: { status: 'empty' } },
};
const postOrder = [];

const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/projects') return res.end(JSON.stringify({ projects }));
  const match = req.url?.match(/^\/api\/projects\/([^/]+)\/(dashboard|chapter-workspace(?:\/generate)?)$/);
  if (!match) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ message: 'not found' }));
  }
  const id = decodeURIComponent(match[1]);
  const resource = match[2];
  if (resource === 'dashboard') {
    return res.end(JSON.stringify({ dashboard: { chapter: { number: 7, contractReady: true } } }));
  }
  if (resource === 'chapter-workspace' && req.method === 'GET') {
    return res.end(JSON.stringify({ chapterWorkspace: workspaces[id] }));
  }
  if (resource === 'chapter-workspace/generate' && req.method === 'POST') {
    postOrder.push(id);
    if (id === 'project-c') {
      res.statusCode = 502;
      return res.end(JSON.stringify({ message: '模拟模型失败' }));
    }
    return res.end(JSON.stringify({ ok: true }));
  }
  res.statusCode = 405;
  return res.end(JSON.stringify({ message: 'method not allowed' }));
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const logs = [];
const errors = [];

try {
  const result = await runBatch({
    operation: 'generate',
    all: true,
    projectIds: [],
    confirmSpend: true,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }, {
    log: (message) => logs.push(message),
    errorLog: (message) => errors.push(message),
  });
  assert.deepEqual(result.summary, { total: 4, success: 2, skipped: 1, error: 1 });
  assert.deepEqual(postOrder, ['project-a', 'project-c', 'project-d']);
  assert.match(errors[0], /模拟模型失败/);
  assert.match(logs.at(-1), /成功 2，跳过 1，失败 1/);
} finally {
  server.close();
  await once(server, 'close');
}

console.log('batch-projects smoke passed');
