import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBenchmarkHarness } from './benchmark-harness.mjs';
import { createBenchmarkJobManager } from './benchmark-job-manager.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-jobs-'));
const harness = createBenchmarkHarness({ dataDir: path.join(tempRoot, 'data') });
const logs = [];
const manager = createBenchmarkJobManager({ benchmarkHarness: harness, logger: { error: (message) => logs.push(message) } });
const projectId = 'project_jobs_01';
const candidates = [
  { candidateId: 'candidate-a', provider: { id: 'provider-a', name: 'A', type: 'openai-compatible' }, model: 'model-a' },
  { candidateId: 'candidate-b', provider: { id: 'provider-b', name: 'B', type: 'openai-compatible' }, model: 'model-b' },
];

let completed = await runningBenchmark(1, 'a');
let release;
const gate = new Promise((resolve) => { release = resolve; });
const scheduled = manager.schedule({
  projectId,
  benchmarkId: completed.benchmarkId,
  task: async () => {
    await gate;
    let current = await harness.getBenchmark(projectId, completed.benchmarkId, { publicView: false });
    for (const [index, candidate] of current.candidates.entries()) {
      const runId = fakeRunId(`done${index}`);
      current = await harness.attachCandidateRun(projectId, current.benchmarkId, { expectedRevision: current.revision, candidateId: candidate.candidateId, runId });
      current = await harness.recordCandidateResult(projectId, current.benchmarkId, {
        expectedRevision: current.revision,
        candidateId: candidate.candidateId,
        runId,
        status: 'succeeded',
        output: { outputText: `candidate ${candidate.alias}` },
      });
    }
  },
});
assert.equal(scheduled.accepted, true);
assert.equal(scheduled.execution.active, true);
assert.equal(manager.schedule({ projectId, benchmarkId: completed.benchmarkId, task: async () => {} }).accepted, false);
release();
assert.equal(await manager.waitForIdle(), true);
completed = await harness.getBenchmark(projectId, completed.benchmarkId, { publicView: false });
assert.equal(completed.status, 'awaiting_scores');
assert.equal(manager.describe(projectId, completed.benchmarkId).active, false);

let thrown = await runningBenchmark(2, 'b');
const fakeCredential = ['sk', 'test', 'secretsecretsecret'].join('-');
manager.schedule({ projectId, benchmarkId: thrown.benchmarkId, task: async () => { throw Object.assign(new Error(`token ${fakeCredential}`), { code: 'UPSTREAM_FAIL' }); } });
assert.equal(await manager.waitForIdle(), true);
thrown = await harness.getBenchmark(projectId, thrown.benchmarkId, { publicView: false });
assert.equal(thrown.status, 'stale');
assert.match(thrown.staleReason, /UPSTREAM_FAIL/);
assert.equal(logs.some((line) => line.includes('secretsecretsecret')), false);

let interrupted = await runningBenchmark(3, 'c');
const reconcile = await manager.reconcileProject(projectId);
interrupted = await harness.getBenchmark(projectId, interrupted.benchmarkId, { publicView: false });
assert.equal(interrupted.status, 'stale');
assert.equal(reconcile.staleCount, 1);
assert.equal(reconcile.activeCount, 0);

let activeDuringReconcile = await runningBenchmark(4, 'd');
let releaseActive;
const activeGate = new Promise((resolve) => { releaseActive = resolve; });
manager.schedule({ projectId, benchmarkId: activeDuringReconcile.benchmarkId, task: async () => {
  await activeGate;
  const current = await harness.getBenchmark(projectId, activeDuringReconcile.benchmarkId, { publicView: false });
  await harness.markStale(projectId, current.benchmarkId, { expectedRevision: current.revision, reason: 'test cleanup' });
} });
const activeReconcile = await manager.reconcileProject(projectId);
assert.equal(activeReconcile.activeCount, 1);
assert.equal((await harness.getBenchmark(projectId, activeDuringReconcile.benchmarkId, { publicView: false })).status, 'running');
releaseActive();
await manager.waitForIdle();

await fs.rm(tempRoot, { recursive: true, force: true });
console.log('benchmark-job-manager smoke: ok');

async function runningBenchmark(chapter, suffix) {
  let benchmark = await harness.createBenchmark({
    projectId,
    chapter,
    mode: 'logic',
    baseline: { inputHash: suffix.repeat(64).slice(0, 64) },
    candidates,
  });
  benchmark = await harness.startBenchmark(projectId, benchmark.benchmarkId, { expectedRevision: benchmark.revision });
  return benchmark;
}

function fakeRunId(suffix) {
  return `run_20260714030000_${String(suffix).replace(/[^a-z0-9]/gi, '').padEnd(16, '0')}`;
}
