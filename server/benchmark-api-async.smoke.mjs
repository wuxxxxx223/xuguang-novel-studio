import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, '..');
const tempBase = path.join(appRoot, '.tmp-e2e');
await fs.mkdir(tempBase, { recursive: true });
const tempRoot = await fs.mkdtemp(path.join(tempBase, 'benchmark-async-'));
const isolatedApp = path.join(tempRoot, 'app');
const projectName = '异步盲测测试书';
const projectRoot = path.join(tempRoot, projectName);
const dataDir = path.join(isolatedApp, '.data');
const projectId = crypto.createHash('sha256').update(projectName, 'utf8').digest('base64url').slice(0, 18);
let child;
let mockServer;
let childOutput = '';
let mockCallCount = 0;

try {
  await fs.mkdir(isolatedApp, { recursive: true });
  await fs.cp(serverDir, path.join(isolatedApp, 'server'), { recursive: true });
  for (const directory of ['正文', '设定', '大纲/章节契约', '追踪']) await fs.mkdir(path.join(projectRoot, ...directory.split('/')), { recursive: true });
  await fs.writeFile(path.join(projectRoot, '追踪', 'progress.json'), JSON.stringify({
    book: projectName,
    status: 'active',
    current_phase: 'draft',
    current_chapter: 1,
    next_step: '进行模型盲测',
    updated_at: '2026-07-14T03:00:00.000Z',
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(projectRoot, '追踪', '今日工作台.md'), '# 今日工作台\n\n- 当前阶段：正文试写\n- 主任务：完成第1章盲测\n- 下一步：比较匿名候选\n', 'utf8');
  await fs.writeFile(path.join(projectRoot, '追踪', '规则.md'), '# 规则\n\n冲突前置，章末留钩子。\n', 'utf8');
  await fs.writeFile(path.join(projectRoot, '追踪', '上下文.md'), '# 上下文\n\n主角正准备出关。\n', 'utf8');
  await fs.writeFile(path.join(projectRoot, '设定', '核心设定.md'), '# 核心设定\n\n苟道签到流。\n', 'utf8');
  await fs.writeFile(path.join(projectRoot, '大纲', '章节契约', '第001章.md'), '# 第1章章节契约\n\n## 本章目标\n建立出关冲突。\n\n## 读者情绪\n期待。\n\n## 必须发生\n主角发现外界变化。\n\n## 禁止发生\n不得暴露全部实力。\n\n## 章末问题\n谁在宗门外叫阵？\n\n## 字数与节奏\n冲突前置。\n', 'utf8');

  const mockPort = await freePort();
  const appPort = await freePort();
  mockServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || '{}');
    mockCallCount += 1;
    await delay(1200);
    const model = String(parsed.model || 'mock-model');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `chatcmpl-${model}`,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ sample: `${model} 匿名试写片段`, hook: '宗门外忽然传来一声巨响。' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    }));
  });
  await listen(mockServer, mockPort);

  await fs.mkdir(dataDir, { recursive: true });
  const roleNames = ['idea', 'logic', 'blueprint', 'writer', 'review'];
  const settings = {
    version: 2,
    providers: [{ id: 'mock-provider', name: 'Mock Provider', type: 'openai-compatible', kind: 'relay', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: 'test-key-123456' }],
    routes: Object.fromEntries(roleNames.map((role) => [role, { providerId: 'mock-provider', model: role === 'writer' ? 'model-old' : 'model-a' }])),
    temperature: Object.fromEntries(roleNames.map((role) => [role, 0.2])),
    maxTokens: Object.fromEntries(roleNames.map((role) => [role, 2000])),
    timeoutMs: 10_000,
    jsonMode: false,
  };
  await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });

  const copiedHarnessUrl = pathToFileURL(path.join(isolatedApp, 'server', 'benchmark-harness.mjs')).href;
  const { createBenchmarkHarness } = await import(`${copiedHarnessUrl}?test=${Date.now()}`);
  const harness = createBenchmarkHarness({ dataDir });
  const storedCandidates = [
    { candidateId: 'candidate-a', provider: { id: 'mock-provider', name: 'Mock Provider', type: 'openai-compatible' }, model: 'model-a' },
    { candidateId: 'candidate-b', provider: { id: 'mock-provider', name: 'Mock Provider', type: 'openai-compatible' }, model: 'model-b' },
  ];
  let interrupted = await harness.createBenchmark({ projectId, chapter: 1, mode: 'writer', baseline: { inputHash: 'f'.repeat(64) }, candidates: storedCandidates });
  interrupted = await harness.startBenchmark(projectId, interrupted.benchmarkId, { expectedRevision: interrupted.revision });

  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: isolatedApp,
    env: { ...process.env, PORT: String(appPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });
  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitFor(async () => (await fetch(`${baseUrl}/api/health`)).ok, 8_000, 'server health');

  const recovered = await waitFor(async () => {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/benchmarks/${interrupted.benchmarkId}`);
    if (!response.ok) return false;
    const payload = await response.json();
    return payload.benchmark.status === 'stale' ? payload : false;
  }, 5_000, 'startup reconciliation');
  assert.equal(recovered.execution.active, false);
  assert.match(recovered.benchmark.staleReason, /未自动续跑/);

  const benchmarkRequestBody = {
    mode: 'writer',
    confirmModelSpend: true,
    candidates: [
      { providerId: 'mock-provider', model: 'model-a' },
      { providerId: 'mock-provider', model: 'model-b' },
    ],
  };
  const missingKeyResponse = await fetch(`${baseUrl}/api/projects/${projectId}/benchmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(benchmarkRequestBody),
  });
  const missingKey = await missingKeyResponse.json();
  assert.equal(missingKeyResponse.status, 400);
  assert.equal(missingKey.error.code, 'BENCHMARK_IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(mockCallCount, 0);

  const idempotencyKey = `benchmark-api-smoke-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const createResponse = await fetch(`${baseUrl}/api/projects/${projectId}/benchmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(benchmarkRequestBody),
  });
  const createElapsedMs = Date.now() - startedAt;
  const created = await createResponse.json();
  assert.equal(createResponse.status, 202);
  assert.ok(createElapsedMs < 900, `POST should return before mock calls complete; elapsed=${createElapsedMs}ms`);
  assert.equal(created.benchmark.status, 'running');
  assert.equal(created.execution.active, true);
  assert.equal(created.benchmark.identityRevealed, false);
  assert.equal(created.benchmark.candidates.every((candidate) => candidate.provider == null && candidate.model === '' && candidate.runId == null), true);
  assert.equal(createResponse.headers.get('location'), created.pollUrl);
  assert.equal(createResponse.headers.get('idempotency-replayed'), 'false');
  assert.equal(created.idempotentReplay, false);

  const replayResponse = await fetch(`${baseUrl}/api/projects/${projectId}/benchmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify(benchmarkRequestBody),
  });
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 202);
  assert.equal(replayResponse.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.benchmark.benchmarkId, created.benchmark.benchmarkId);
  assert.equal(replay.pollUrl, created.pollUrl);

  const conflictResponse = await fetch(`${baseUrl}/api/projects/${projectId}/benchmarks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ ...benchmarkRequestBody, mode: 'logic' }),
  });
  const conflict = await conflictResponse.json();
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflict.error.code, 'BENCHMARK_IDEMPOTENCY_CONFLICT');

  const activeDetailResponse = await fetch(`${baseUrl}${created.pollUrl}`);
  const activeDetail = await activeDetailResponse.json();
  assert.equal(activeDetail.benchmark.status, 'running');
  assert.equal(activeDetail.execution.active, true);

  const activeStaleResponse = await fetch(`${baseUrl}${created.pollUrl}/stale`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: activeDetail.benchmark.revision, reason: 'should be blocked' }),
  });
  const activeStale = await activeStaleResponse.json();
  assert.equal(activeStaleResponse.status, 409);
  assert.equal(activeStale.error.code, 'BENCHMARK_JOB_ACTIVE');

  const awaiting = await waitFor(async () => {
    const response = await fetch(`${baseUrl}${created.pollUrl}`);
    if (!response.ok) return false;
    const payload = await response.json();
    return payload.benchmark.status === 'awaiting_scores' && payload.execution.active === false ? payload : false;
  }, 10_000, 'benchmark completion');
  assert.equal(awaiting.execution.active, false);
  assert.equal(awaiting.benchmark.candidates.every((candidate) => candidate.status === 'succeeded'), true);
  assert.equal(awaiting.benchmark.candidates.every((candidate) => candidate.provider == null && candidate.model === '' && candidate.runId == null), true);

  const unconfirmedPurgeResponse = await fetch(`${baseUrl}${created.pollUrl}/outputs/purge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: awaiting.benchmark.revision }),
  });
  const unconfirmedPurge = await unconfirmedPurgeResponse.json();
  assert.equal(unconfirmedPurgeResponse.status, 400);
  assert.equal(unconfirmedPurge.error.code, 'BENCHMARK_OUTPUT_PURGE_CONFIRMATION_REQUIRED');

  const earlyPurgeResponse = await fetch(`${baseUrl}${created.pollUrl}/outputs/purge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: awaiting.benchmark.revision, confirmOutputPurge: true }),
  });
  const earlyPurge = await earlyPurgeResponse.json();
  assert.equal(earlyPurgeResponse.status, 409);
  assert.equal(earlyPurge.error.code, 'BENCHMARK_OUTPUT_PURGE_NOT_READY');

  const earlyRecommendationResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation`);
  const earlyRecommendation = await earlyRecommendationResponse.json();
  assert.equal(earlyRecommendationResponse.status, 409);
  assert.equal(earlyRecommendation.error.code, 'BENCHMARK_RECOMMENDATION_NOT_READY');

  const runsResponse = await fetch(`${baseUrl}/api/projects/${projectId}/runs?runType=benchmark.writer`);
  const runsPayload = await runsResponse.json();
  const benchmarkRuns = runsPayload.runs.filter((run) => run.metadata?.benchmarkId === created.benchmark.benchmarkId);
  assert.equal(benchmarkRuns.length, 2);
  assert.equal(benchmarkRuns.every((run) => run.provider == null && run.model === ''), true);

  const dimensions = ['contractAdherence', 'causality', 'characterConsistency', 'pacing', 'payoff', 'hook', 'styleNaturalness'];
  const evaluationResponse = await fetch(`${baseUrl}${created.pollUrl}/evaluation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: awaiting.benchmark.revision,
      reviewerId: 'api-smoke',
      scores: awaiting.benchmark.candidates.map((candidate, index) => ({
        candidateId: candidate.candidateId,
        dimensions: Object.fromEntries(dimensions.map((dimension) => [dimension, 9 - index])),
      })),
    }),
  });
  const evaluated = await evaluationResponse.json();
  assert.equal(evaluationResponse.status, 200);
  assert.equal(evaluated.benchmark.status, 'completed');
  assert.equal(evaluated.benchmark.identityRevealed, true);
  assert.equal(evaluated.benchmark.candidates.every((candidate) => candidate.provider?.id === 'mock-provider' && candidate.model && candidate.runId), true);
  assert.equal(evaluated.benchmark.recommendation.snapshotStatus, 'stored');
  assert.equal(evaluated.benchmark.recommendation.decision.candidateId, 'candidate-a');
  assert.equal(evaluated.benchmark.recommendation.decision.requiresManualApply, true);
  assert.equal(evaluated.benchmark.recommendation.decision.autoApplied, false);
  assert.equal(evaluated.benchmark.recommendation.quality.scoreGap, 1);
  assert.equal(evaluated.benchmark.recommendation.operations.totalTokens.leaderCandidateId, 'candidate-a');
  assert.equal(evaluated.benchmark.recommendation.operations.cost.coverage, 'none');

  const recommendationResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation`);
  const recommendation = await recommendationResponse.json();
  assert.equal(recommendationResponse.status, 200);
  assert.equal(recommendation.mode, 'writer');
  assert.equal(recommendation.recommendation.decision.candidateId, 'candidate-a');
  assert.equal(recommendation.candidates.length, 2);
  assert.equal(recommendation.candidates.every((candidate) => !Object.hasOwn(candidate, 'output') && !Object.hasOwn(candidate, 'runId')), true);

  const wrongRolePreviewResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'logic' }),
  });
  const wrongRolePreview = await wrongRolePreviewResponse.json();
  assert.equal(wrongRolePreviewResponse.status, 409);
  assert.equal(wrongRolePreview.error.code, 'BENCHMARK_RECOMMENDATION_ROLE_MISMATCH');

  const previewResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'writer' }),
  });
  const previewPayload = await previewResponse.json();
  assert.equal(previewResponse.status, 200);
  assert.equal(previewPayload.preview.candidateId, 'candidate-a');
  assert.equal(previewPayload.preview.settingsRevision, 0);
  assert.deepEqual(previewPayload.preview.currentRoute, { providerId: 'mock-provider', model: 'model-old' });
  assert.deepEqual(previewPayload.preview.proposedRoute, { providerId: 'mock-provider', model: 'model-a' });
  assert.equal(previewPayload.preview.changed, true);
  assert.equal(previewPayload.preview.requiresConfirmation, true);
  assert.equal(previewPayload.preview.autoApplied, false);

  const applyBody = {
    role: 'writer',
    candidateId: previewPayload.preview.candidateId,
    expectedSettingsRevision: previewPayload.preview.settingsRevision,
    recommendationFingerprint: previewPayload.preview.recommendationFingerprint,
  };
  const unconfirmedApplyResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(applyBody),
  });
  const unconfirmedApply = await unconfirmedApplyResponse.json();
  assert.equal(unconfirmedApplyResponse.status, 400);
  assert.equal(unconfirmedApply.error.code, 'BENCHMARK_RECOMMENDATION_APPLY_CONFIRMATION_REQUIRED');

  const mismatchedCandidateResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...applyBody, candidateId: 'candidate-b', confirmApply: true }),
  });
  const mismatchedCandidate = await mismatchedCandidateResponse.json();
  assert.equal(mismatchedCandidateResponse.status, 409);
  assert.equal(mismatchedCandidate.error.code, 'BENCHMARK_RECOMMENDATION_CANDIDATE_CHANGED');

  const applyResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...applyBody, confirmApply: true }),
  });
  const applied = await applyResponse.json();
  assert.equal(applyResponse.status, 200);
  assert.equal(applied.applied, true);
  assert.equal(applied.noChange, false);
  assert.equal(applied.settings.revision, 1);
  assert.deepEqual(applied.settings.routes.writer, { providerId: 'mock-provider', model: 'model-a' });
  assert.equal(applied.settings.routeApplications.length, 1);
  assert.equal(applied.application.candidateId, 'candidate-a');
  assert.equal(applied.application.settingsRevision, 1);
  assert.equal(JSON.stringify(applied.application).includes('test-key-123456'), false);
  const persistedSettings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'));
  const previousSettings = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.previous.json'), 'utf8'));
  assert.equal(persistedSettings.revision, 1);
  assert.deepEqual(persistedSettings.routes.writer, { providerId: 'mock-provider', model: 'model-a' });
  assert.equal(persistedSettings.routeApplications.length, 1);
  assert.equal(previousSettings.revision, 0);
  assert.deepEqual(previousSettings.routes.writer, { providerId: 'mock-provider', model: 'model-old' });
  assert.equal(previousSettings.routeApplications.length, 0);

  const staleApplyResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...applyBody, confirmApply: true }),
  });
  const staleApply = await staleApplyResponse.json();
  assert.equal(staleApplyResponse.status, 409);
  assert.equal(staleApply.error.code, 'SETTINGS_REVISION_CONFLICT');

  const noChangePreviewResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'writer' }),
  });
  const noChangePreview = await noChangePreviewResponse.json();
  assert.equal(noChangePreviewResponse.status, 200);
  assert.equal(noChangePreview.preview.changed, false);
  assert.equal(noChangePreview.preview.settingsRevision, 1);
  const noChangeApplyResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role: 'writer',
      candidateId: noChangePreview.preview.candidateId,
      expectedSettingsRevision: noChangePreview.preview.settingsRevision,
      recommendationFingerprint: noChangePreview.preview.recommendationFingerprint,
      confirmApply: true,
    }),
  });
  const noChangeApply = await noChangeApplyResponse.json();
  assert.equal(noChangeApplyResponse.status, 200);
  assert.equal(noChangeApply.applied, false);
  assert.equal(noChangeApply.noChange, true);
  assert.equal(noChangeApply.settings.revision, 1);
  assert.equal(noChangeApply.settings.routeApplications.length, 1);

  const revealedRunsResponse = await fetch(`${baseUrl}/api/projects/${projectId}/runs?runType=benchmark.writer`);
  const revealedRuns = (await revealedRunsResponse.json()).runs.filter((run) => run.metadata?.benchmarkId === created.benchmark.benchmarkId);
  assert.equal(revealedRuns.every((run) => run.provider?.id === 'mock-provider' && run.model), true);
  assert.equal(mockCallCount, 2);

  const outputHashes = evaluated.benchmark.candidates.map((candidate) => candidate.output.contentHash);
  const evaluationRanking = structuredClone(evaluated.benchmark.evaluation.ranking);
  const recommendationSnapshot = structuredClone(evaluated.benchmark.recommendation);
  const purgeResponse = await fetch(`${baseUrl}${created.pollUrl}/outputs/purge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: evaluated.benchmark.revision,
      confirmOutputPurge: true,
      purgedBy: 'api-smoke',
      reason: 'E2E retention verification',
    }),
  });
  const purged = await purgeResponse.json();
  assert.equal(purgeResponse.status, 200);
  assert.equal(purged.benchmark.status, 'completed');
  assert.equal(purged.benchmark.retention.outputs, 'purged');
  assert.equal(purged.benchmark.retention.purgedBy, 'api-smoke');
  assert.equal(purged.benchmark.candidates.every((candidate) => candidate.output.outputText === ''), true);
  assert.deepEqual(purged.benchmark.candidates.map((candidate) => candidate.output.contentHash), outputHashes);
  assert.deepEqual(purged.benchmark.evaluation.ranking, evaluationRanking);
  assert.deepEqual(purged.benchmark.recommendation, recommendationSnapshot);
  assert.equal(purged.benchmark.candidates.every((candidate) => candidate.provider?.id === 'mock-provider' && candidate.model && candidate.runId), true);

  const purgedRecommendationResponse = await fetch(`${baseUrl}${created.pollUrl}/recommendation`);
  const purgedRecommendation = await purgedRecommendationResponse.json();
  assert.equal(purgedRecommendationResponse.status, 200);
  assert.deepEqual(purgedRecommendation.recommendation, recommendationSnapshot);

  const repeatedPurgeResponse = await fetch(`${baseUrl}${created.pollUrl}/outputs/purge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: purged.benchmark.revision,
      confirmOutputPurge: true,
      purgedBy: 'api-smoke',
    }),
  });
  const repeatedPurge = await repeatedPurgeResponse.json();
  assert.equal(repeatedPurgeResponse.status, 200);
  assert.equal(repeatedPurge.benchmark.revision, purged.benchmark.revision);

  console.log(JSON.stringify({
    ok: true,
    projectId,
    benchmarkId: created.benchmark.benchmarkId,
    createStatus: createResponse.status,
    createElapsedMs,
    idempotentReplay: replay.idempotentReplay,
    idempotencyConflict: conflict.error.code,
    modelCalls: mockCallCount,
    recoveredInterruptedBenchmark: recovered.benchmark.status,
    finalStatus: evaluated.benchmark.status,
    outputRetention: purged.benchmark.retention.outputs,
    recommendedCandidate: recommendation.recommendation.decision.candidateId,
    routeApplicationRevision: applied.settings.revision,
    candidateRuns: revealedRuns.length,
    blindBeforeScore: true,
    identitiesRevealedAfterScore: true,
  }));
} finally {
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3_000)]);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  if (mockServer) await new Promise((resolve) => mockServer.close(() => resolve()));
  const resolved = path.resolve(tempRoot);
  const allowed = path.resolve(tempBase) + path.sep;
  if (!resolved.startsWith(allowed)) throw new Error(`unsafe cleanup path: ${resolved}`);
  await fs.rm(resolved, { recursive: true, force: true });
  if (childOutput && /INTERNAL_ERROR|SyntaxError|Unhandled/i.test(childOutput)) console.error(childOutput);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listen(server, port) {
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).once('error', reject));
}

async function waitFor(action, timeoutMs, label) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) { lastError = error; }
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}\n${childOutput}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
