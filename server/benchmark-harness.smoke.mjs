import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BenchmarkHarnessError, BENCHMARK_SCORE_DIMENSIONS, createBenchmarkHarness } from './benchmark-harness.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-harness-'));
const dataDir = path.join(tempRoot, 'data');
let tick = Date.parse('2026-07-14T01:00:00.000Z');
let uuidCounter = 0;
const harness = createBenchmarkHarness({
  dataDir,
  clock: () => new Date(tick += 1000),
  randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
});
const projectId = 'project_demo_01';
const hash = 'a'.repeat(64);
const candidates = [
  { candidateId: 'candidate-a', provider: { id: 'provider-a', name: 'Provider A', type: 'openai-compatible' }, model: 'model-a' },
  { candidateId: 'candidate-b', provider: { id: 'provider-b', name: 'Provider B', type: 'anthropic-messages' }, model: 'model-b' },
  { candidateId: 'candidate-c', provider: { id: 'provider-c', name: 'Provider C', type: 'gemini-generate-content' }, model: 'model-c' },
];

assert.equal(await harness.getBenchmark(projectId, 'bench_20260714010000_0000000000000001'), null);
assert.deepEqual(await harness.listBenchmarks(projectId), []);
await assert.rejects(fs.stat(path.join(dataDir, 'benchmarks')), { code: 'ENOENT' });

await expectCode(() => harness.createBenchmark({ projectId, chapter: 8, mode: 'writer', baseline: { inputHash: hash }, candidates: [candidates[0], { ...candidates[0], candidateId: 'candidate-z' }] }), 'BENCHMARK_CANDIDATE_DUPLICATE');
await expectCode(() => harness.createBenchmark({ projectId, chapter: 8, mode: 'writer', baseline: { inputHash: hash }, candidates, metadata: { apiKey: 'not-allowed' } }), 'BENCHMARK_SENSITIVE_FIELD');
await expectCode(() => harness.createBenchmark({ projectId, chapter: 8, mode: 'writer', baseline: { inputHash: hash }, candidates, metadata: { nested: { apiKey: 'hidden' } } }), 'BENCHMARK_METADATA_SCALAR_ONLY');

let benchmark = await harness.createBenchmark({
  projectId,
  projectTitle: '测试小说',
  chapter: 8,
  mode: 'writer',
  baseline: {
    inputHash: hash,
    canonRevisionId: 'canon_demo_01',
    promptVersion: 'benchmark-writer-v1',
    ruleVersion: 'novel-studio-server-v1',
    sourceLabels: ['大纲/章节契约/第008章.md', '追踪/规则.md'],
  },
  candidates,
  metadata: { confirmedSpend: true },
});
assert.equal(benchmark.status, 'draft');
assert.equal(benchmark.revision, 1);
assert.deepEqual(benchmark.candidates.map((item) => item.alias), ['A', 'B', 'C']);

const blindDraft = await harness.getBenchmark(projectId, benchmark.benchmarkId);
assert.equal(blindDraft.identityRevealed, false);
assert.equal(blindDraft.candidates[0].provider, null);
assert.equal(blindDraft.candidates[0].model, '');

await expectCode(() => harness.startBenchmark(projectId, benchmark.benchmarkId, {}), 'BENCHMARK_EXPECTED_REVISION_REQUIRED');
benchmark = await harness.startBenchmark(projectId, benchmark.benchmarkId, { expectedRevision: benchmark.revision });
assert.equal(benchmark.status, 'running');
await expectCode(() => harness.startBenchmark(projectId, benchmark.benchmarkId, { expectedRevision: benchmark.revision }), 'INVALID_BENCHMARK_TRANSITION');
await expectCode(() => harness.recordCandidateResult(projectId, benchmark.benchmarkId, {
  expectedRevision: 1, candidateId: 'candidate-a', runId: runId('a'), status: 'succeeded', output: { outputText: 'x' },
}), 'BENCHMARK_REVISION_CONFLICT');

benchmark = await harness.attachCandidateRun(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision, candidateId: 'candidate-a', runId: runId('a'),
});
assert.equal(benchmark.candidates[0].status, 'running');
const sameAttach = await harness.attachCandidateRun(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision, candidateId: 'candidate-a', runId: runId('a'),
});
assert.equal(sameAttach.revision, benchmark.revision);

benchmark = await harness.recordCandidateResult(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  candidateId: 'candidate-a',
  runId: runId('a'),
  status: 'succeeded',
  output: { outputText: '{"sample":"A 的试写"}', summary: '完成' },
  metrics: { latencyMs: 900, usage: { prompt_tokens: 100, completion_tokens: 300, total_tokens: 400 }, cost: { amount: 0.03, currency: 'usd' } },
});
assert.equal(benchmark.status, 'running');
assert.equal(benchmark.candidates[0].metrics.usage.totalTokens, 400);

benchmark = await harness.recordCandidateResult(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  candidateId: 'candidate-b',
  runId: runId('b'),
  status: 'failed',
  error: { code: 'MODEL_TIMEOUT', message: 'Provider B timeout', retryable: true, upstreamStatus: 504 },
});
assert.equal(benchmark.status, 'running');

benchmark = await harness.recordCandidateResult(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  candidateId: 'candidate-c',
  runId: runId('c'),
  status: 'succeeded',
  output: { outputText: '{"sample":"C 的试写"}' },
  metrics: { latencyMs: 700, usage: { input_tokens: 120, output_tokens: 280 } },
});
assert.equal(benchmark.status, 'awaiting_scores');
assert.equal(benchmark.candidates.filter((item) => item.status === 'succeeded').length, 2);

const blindScoring = await harness.getBenchmark(projectId, benchmark.benchmarkId);
assert.equal(blindScoring.identityRevealed, false);
assert.equal(blindScoring.candidates[1].error.message, '匿名候选调用失败。');
assert.equal(blindScoring.candidates[2].provider, null);
assert.equal(blindScoring.candidates[0].runId, null);
await expectCode(() => harness.purgeOutputs(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  purgedBy: 'author',
}), 'BENCHMARK_OUTPUT_PURGE_NOT_READY');
await expectCode(() => harness.getRecommendation(projectId, benchmark.benchmarkId), 'BENCHMARK_RECOMMENDATION_NOT_READY');

await expectCode(() => harness.submitEvaluation(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  scores: [score('candidate-a', 8)],
}), 'BENCHMARK_SCORE_INCOMPLETE');

benchmark = await harness.submitEvaluation(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  reviewerId: 'author',
  scores: [score('candidate-a', 9, '最符合当前书'), score('candidate-c', 7)],
  overallNote: 'A 更适合正文，C 延迟更低。',
});
assert.equal(benchmark.status, 'completed');
assert.equal(benchmark.revealIdentities, true);
assert.equal(benchmark.evaluation.ranking[0].candidateId, 'candidate-a');
assert.equal(benchmark.evaluation.ranking[0].rank, 1);
assert.equal(benchmark.recommendation.snapshotStatus, 'stored');
assert.equal(benchmark.recommendation.sourceRevision, benchmark.revision);
assert.equal(benchmark.recommendation.decision.candidateId, 'candidate-a');
assert.equal(benchmark.recommendation.decision.requiresManualApply, true);
assert.equal(benchmark.recommendation.decision.autoApplied, false);
assert.equal(benchmark.recommendation.quality.scoreGap, 2);
assert.equal(benchmark.recommendation.operations.latency.leaderCandidateId, 'candidate-c');
assert.equal(benchmark.recommendation.operations.totalTokens.leaderCandidateId, 'candidate-a');
assert.equal(benchmark.recommendation.operations.cost.coverage, 'partial');

const recommendationResult = await harness.getRecommendation(projectId, benchmark.benchmarkId);
assert.equal(recommendationResult.mode, 'writer');
assert.equal(recommendationResult.recommendation.decision.candidateId, 'candidate-a');
assert.equal(recommendationResult.candidates.length, 2);
assert.equal(recommendationResult.candidates.every((candidate) => !Object.hasOwn(candidate, 'output') && !Object.hasOwn(candidate, 'runId')), true);

const revealed = await harness.getBenchmark(projectId, benchmark.benchmarkId);
assert.equal(revealed.identityRevealed, true);
assert.equal(revealed.candidates[0].provider.name, 'Provider A');
assert.equal(revealed.candidates[0].model, 'model-a');
assert.equal(revealed.candidates[0].runId, runId('a'));
const originalOutputHash = revealed.candidates[0].output.contentHash;
const originalRanking = structuredClone(revealed.evaluation.ranking);
const originalRecommendation = structuredClone(revealed.recommendation);
await expectCode(() => harness.submitEvaluation(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  scores: [score('candidate-a', 5), score('candidate-c', 5)],
}), 'BENCHMARK_NOT_AWAITING_SCORES');

benchmark = await harness.purgeOutputs(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  purgedBy: 'author',
  reason: '已完成评分，清理候选正文。',
});
assert.equal(benchmark.retention.outputs, 'purged');
assert.equal(benchmark.retention.purgedBy, 'author');
assert.equal(benchmark.candidates.filter((item) => item.status === 'succeeded').every((item) => item.output.outputText === ''), true);
assert.equal(benchmark.candidates[0].output.contentHash, originalOutputHash);
assert.deepEqual(benchmark.evaluation.ranking, originalRanking);
assert.deepEqual(benchmark.recommendation, originalRecommendation);
const purgedRevision = benchmark.revision;
benchmark = await harness.purgeOutputs(projectId, benchmark.benchmarkId, {
  expectedRevision: benchmark.revision,
  purgedBy: 'author',
});
assert.equal(benchmark.revision, purgedRevision);
const purgedPublic = await harness.getBenchmark(projectId, benchmark.benchmarkId);
assert.equal(purgedPublic.retention.outputs, 'purged');
assert.equal(purgedPublic.candidates[0].output.outputText, '');

const listed = await harness.listBenchmarks(projectId);
assert.equal(listed.length, 1);
assert.equal(listed[0].status, 'completed');
assert.equal(listed[0].identityRevealed, true);
assert.equal(listed[0].retention.outputs, 'purged');
assert.deepEqual(listed[0].recommendation, originalRecommendation);

const completedFile = path.join(harness.root, projectId, `${benchmark.benchmarkId}.json`);
const legacyCompletedRecord = JSON.parse(await fs.readFile(completedFile, 'utf8'));
delete legacyCompletedRecord.recommendation;
await fs.writeFile(completedFile, `${JSON.stringify(legacyCompletedRecord, null, 2)}\n`, 'utf8');
const derivedRecommendation = await harness.getRecommendation(projectId, benchmark.benchmarkId);
assert.equal(derivedRecommendation.recommendation.snapshotStatus, 'derived_legacy');
assert.equal(derivedRecommendation.recommendation.sourceRevision, null);
assert.equal(derivedRecommendation.recommendation.decision.candidateId, 'candidate-a');

let stale = await harness.createBenchmark({ projectId, chapter: 9, mode: 'logic', baseline: { inputHash: 'b'.repeat(64) }, candidates: candidates.slice(0, 2) });
stale = await harness.markStale(projectId, stale.benchmarkId, { expectedRevision: stale.revision, reason: 'Canon head changed' });
assert.equal(stale.status, 'stale');
assert.equal((await harness.getBenchmark(projectId, stale.benchmarkId)).identityRevealed, false);

let failed = await harness.createBenchmark({ projectId, chapter: 10, mode: 'logic', baseline: { inputHash: 'c'.repeat(64) }, candidates: candidates.slice(0, 2) });
failed = await harness.startBenchmark(projectId, failed.benchmarkId, { expectedRevision: failed.revision });
for (const candidate of failed.candidates) {
  failed = await harness.recordCandidateResult(projectId, failed.benchmarkId, {
    expectedRevision: failed.revision, candidateId: candidate.candidateId, runId: runId(candidate.alias.toLowerCase() + '2'), status: 'failed', error: { code: 'MODEL_ERROR' },
  });
}
assert.equal(failed.status, 'failed');
await expectCode(() => harness.submitEvaluation(projectId, failed.benchmarkId, { expectedRevision: failed.revision, scores: [] }), 'BENCHMARK_NOT_AWAITING_SCORES');

const idempotentProjectId = 'project_idempotency_01';
const idempotencyKey = 'benchmark-request-0001';
const requestFingerprint = 'd'.repeat(64);
const idempotentInput = {
  projectId: idempotentProjectId,
  idempotencyKey,
  requestFingerprint,
  chapter: 11,
  mode: 'writer',
  baseline: { inputHash: 'e'.repeat(64) },
  candidates: candidates.slice(0, 2),
};
const [idempotentA, idempotentB] = await Promise.all([
  harness.createRunningBenchmarkIdempotent(idempotentInput),
  harness.createRunningBenchmarkIdempotent(idempotentInput),
]);
assert.equal([idempotentA.idempotent, idempotentB.idempotent].filter(Boolean).length, 1);
assert.equal(idempotentA.benchmark.benchmarkId, idempotentB.benchmark.benchmarkId);
assert.equal(idempotentA.benchmark.status, 'running');
assert.equal(idempotentA.benchmark.revision, 2);
assert.equal(idempotentA.benchmark.creation.idempotencyKeyHash.length, 64);
assert.equal(idempotentA.benchmark.creation.requestFingerprint, requestFingerprint);
const idempotentLookup = await harness.findBenchmarkByIdempotencyKey(idempotentProjectId, idempotencyKey, requestFingerprint);
assert.equal(idempotentLookup.benchmarkId, idempotentA.benchmark.benchmarkId);
const idempotentPublic = await harness.getBenchmark(idempotentProjectId, idempotentA.benchmark.benchmarkId);
assert.equal(Object.hasOwn(idempotentPublic, 'creation'), false);
await expectCode(
  () => harness.findBenchmarkByIdempotencyKey(idempotentProjectId, idempotencyKey, 'f'.repeat(64)),
  'BENCHMARK_IDEMPOTENCY_CONFLICT',
);
await expectCode(
  () => harness.createRunningBenchmarkIdempotent({ ...idempotentInput, idempotencyKey: 'short' }),
  'INVALID_BENCHMARK_IDEMPOTENCY_KEY',
);

const legacyProjectId = 'project_legacy_retention';
const legacy = await harness.createBenchmark({
  projectId: legacyProjectId,
  chapter: 12,
  mode: 'logic',
  baseline: { inputHash: '1'.repeat(64) },
  candidates: candidates.slice(0, 2),
});
const legacyFile = path.join(harness.root, legacyProjectId, `${legacy.benchmarkId}.json`);
const legacyRecord = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
delete legacyRecord.retention;
await fs.writeFile(legacyFile, `${JSON.stringify(legacyRecord, null, 2)}\n`, 'utf8');
const legacyPublic = await harness.getBenchmark(legacyProjectId, legacy.benchmarkId);
assert.equal(legacyPublic.retention.outputs, 'available');

assert.deepEqual(BENCHMARK_SCORE_DIMENSIONS, [
  'contractAdherence', 'causality', 'characterConsistency', 'pacing', 'payoff', 'hook', 'styleNaturalness',
]);

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('benchmark-harness smoke: ok');

function runId(suffix) { return `run_20260714010000_${String(suffix).replace(/[^a-z0-9]/gi, '').padEnd(16, '0')}`; }
function score(candidateId, value, note = '') {
  return { candidateId, dimensions: Object.fromEntries(BENCHMARK_SCORE_DIMENSIONS.map((key) => [key, value])), note };
}
async function expectCode(action, code) {
  await assert.rejects(action, (error) => error instanceof BenchmarkHarnessError && error.code === code);
}
