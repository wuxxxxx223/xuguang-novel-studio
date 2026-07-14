import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRunLedger } from './run-ledger.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-ledger-smoke-'));
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 6, 14, 1, 0, tick++));
const ledger = createRunLedger({ dataDir: root, clock, randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
const projectId = 'fixture-book';
const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
assert.deepEqual(await ledger.listRuns(projectId), []);
await assert.rejects(() => fs.access(path.join(root, 'runs')), (error) => error?.code === 'ENOENT', '只读查询不得创建 Run 目录');

const started = await ledger.startRun({
  projectId,
  chapter: 4,
  runType: 'chapter.generate.full',
  provider: { id: 'provider-a', name: 'Provider A', type: 'openai-compatible' },
  model: 'model-x',
  promptVersion: 'writer-v3',
  ruleVersion: 'rules-20260714',
  canonRevisionId: 'cr_previous',
  input: {
    sourceHashes: [{ path: '大纲/章节契约/第004章.md', hash: hash('contract') }],
    promptHash: hash('prompt-template'),
    payloadHash: hash('formal-facts-payload'),
    contractHash: hash('contract'),
  },
  metadata: { mode: 'full', requestedBy: 'author' },
  summary: '生成第4章完整候选稿',
});
assert.equal(started.status, 'running');
assert.equal(started.revision, 1);
assert.equal(started.authorDecision.status, 'pending');
assert.equal(started.input.sourceHashes.length, 1);
assert.equal((await ledger.getRun(projectId, started.runId)).runId, started.runId);

const completed = await ledger.completeRun(projectId, started.runId, {
  expectedRevision: 1,
  latencyMs: 1234,
  output: { contentHash: hash('candidate'), summary: '完成候选稿，末尾保留钩子。', artifactRefs: ['project-chapters/ch004.json'] },
  usage: { promptTokens: 1200, completionTokens: 2600 },
  cost: { amount: 0.42, currency: 'usd' },
  findings: { P0: 0, P1: 1, P2: 2, summary: '一项节奏风险。' },
});
assert.equal(completed.status, 'succeeded');
assert.equal(completed.revision, 2);
assert.deepEqual(completed.usage, { inputTokens: 1200, outputTokens: 2600, totalTokens: 3800, cachedTokens: null });
assert.deepEqual(completed.cost, { amount: 0.42, currency: 'USD' });

await assert.rejects(
  () => ledger.failRun(projectId, started.runId, { expectedRevision: 2, error: 'too late' }),
  (error) => error?.code === 'INVALID_RUN_TRANSITION',
  '终态 Run 不允许改写为另一个终态',
);
await assert.rejects(
  () => ledger.recordAuthorDecision(projectId, started.runId, { expectedRevision: 1, status: 'accepted' }),
  (error) => error?.code === 'RUN_REVISION_CONFLICT',
  '过期 revision 必须被阻塞',
);

const accepted = await ledger.recordAuthorDecision(projectId, started.runId, { expectedRevision: 2, status: 'accepted', reason: '作者确认采用此候选。' });
assert.equal(accepted.revision, 3);
assert.equal(accepted.authorDecision.status, 'accepted');
const linked = await ledger.linkCanonRevision(projectId, started.runId, { expectedRevision: 3, revisionId: 'cr_20260714010000_abcdef123456_12345678' });
assert.equal(linked.revision, 4);
assert.equal(linked.writebackRevisionId, 'cr_20260714010000_abcdef123456_12345678');
const linkedAgain = await ledger.linkCanonRevision(projectId, started.runId, { expectedRevision: 4, revisionId: linked.writebackRevisionId });
assert.equal(linkedAgain.revision, 4, '重复关联同一 revision 必须幂等');

const failedStart = await ledger.startRun({ projectId, chapter: 4, runType: 'chapter.review', model: 'reviewer-y' });
const failed = await ledger.failRun(projectId, failedStart.runId, { expectedRevision: 1, error: { code: 'UPSTREAM_TIMEOUT', message: '上游超时', retryable: true } });
assert.equal(failed.status, 'failed');
assert.equal(failed.error.retryable, true);

const staleStart = await ledger.startRun({ projectId, chapter: 5, runType: 'chapter.generate.hook', model: 'model-z' });
const stale = await ledger.markStale(projectId, staleStart.runId, { expectedRevision: 1, reason: '章节契约已变化' });
assert.equal(stale.status, 'stale');

const runs = await ledger.listRuns(projectId, { limit: 10 });
assert.equal(runs.length, 3);
assert.equal((await ledger.listRuns(projectId, { status: 'failed' })).length, 1);
assert.equal((await ledger.listRuns(projectId, { chapter: 5 })).length, 1);

await assert.rejects(
  () => ledger.startRun({ projectId, runType: 'unsafe', metadata: { apiKey: 'secret-value' } }),
  (error) => error?.code === 'RUN_SENSITIVE_FIELD_REJECTED',
  'API Key 字段不得写入 Run',
);
await assert.rejects(
  () => ledger.startRun({ projectId, runType: 'unsafe', metadata: { note: 'Bearer abcdefghijklmnopqrstuvwxyz' } }),
  (error) => error?.code === 'RUN_SECRET_REJECTED',
  'Bearer 凭据不得写入 Run',
);
await assert.rejects(
  () => ledger.startRun({ projectId, runType: 'unsafe', metadata: { prompt: '完整提示词' } }),
  (error) => error?.code === 'RUN_SENSITIVE_FIELD_REJECTED',
  '完整 prompt 字段不得写入 Run',
);
await assert.rejects(() => ledger.getRun('../escape', started.runId), (error) => error?.code === 'INVALID_PROJECT_ID');

const storedText = await fs.readFile(path.join(root, 'runs', projectId, `${started.runId}.json`), 'utf8');
assert.equal(storedText.includes('apiKey'), false);
assert.equal(storedText.includes('Bearer '), false);
assert.equal(storedText.includes('完整提示词'), false);

await fs.rm(root, { recursive: true, force: true });
console.log('run ledger smoke passed');