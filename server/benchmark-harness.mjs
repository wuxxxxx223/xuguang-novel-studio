import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_VERSION = 1;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const BENCHMARK_ID_PATTERN = /^bench_[A-Za-z0-9_-]{12,120}$/;
const RUN_ID_PATTERN = /^run_[A-Za-z0-9_-]{12,120}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:-]{16,200}$/;
const MODES = new Set(['logic', 'writer']);
const BENCHMARK_STATUSES = new Set(['draft', 'running', 'awaiting_scores', 'completed', 'failed', 'stale']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stale']);
const CANDIDATE_STATUSES = new Set(['pending', 'running', 'succeeded', 'failed']);
const CANDIDATE_TERMINAL_STATUSES = new Set(['succeeded', 'failed']);
const OUTPUT_RETENTION_STATUSES = new Set(['available', 'purged']);
const SCORE_DIMENSIONS = Object.freeze([
  'contractAdherence', 'causality', 'characterConsistency', 'pacing', 'payoff', 'hook', 'styleNaturalness',
]);
const DEFAULT_WEIGHTS = Object.freeze(Object.fromEntries(SCORE_DIMENSIONS.map((key) => [key, 1])));
const MAX_BENCHMARKS_PER_PROJECT = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const FORBIDDEN_KEYS = /^(?:api[_-]?key|authorization|cookie|set-cookie|password|passphrase|client[_-]?secret|access[_-]?token|refresh[_-]?token|private[_-]?key|messages|prompt|system[_-]?prompt|full[_-]?(?:context|input))$/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export const BENCHMARK_SCORE_DIMENSIONS = SCORE_DIMENSIONS;

export class BenchmarkHarnessError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'BenchmarkHarnessError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createBenchmarkHarness({ dataDir, clock = () => new Date(), randomUUID = () => crypto.randomUUID() } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  const root = path.resolve(dataDir, 'benchmarks');

  async function createBenchmark(input = {}) {
    const projectId = assertProjectId(input.projectId);
    const dirs = await ensureProjectDir(root, projectId);
    const createdAt = toIso(clock());
    const benchmarkId = input.benchmarkId
      ? assertBenchmarkId(input.benchmarkId)
      : `bench_${compactTime(createdAt)}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    assertBenchmarkId(benchmarkId);
    const record = normalizeNewBenchmark(input, { projectId, benchmarkId, createdAt });
    assertSafeRecord(record);
    await writeJsonExclusive(path.join(dirs.projectDir, `${benchmarkId}.json`), record);
    return record;
  }

  async function findBenchmarkByIdempotencyKey(projectId, idempotencyKey, requestFingerprint) {
    const safeProjectId = assertProjectId(projectId);
    const keyHash = sha256(assertIdempotencyKey(idempotencyKey));
    const fingerprint = assertRequestFingerprint(requestFingerprint);
    const dirs = projectPaths(root, safeProjectId);
    const record = await findIdempotentBenchmark(dirs.projectDir, safeProjectId, keyHash);
    if (!record) return null;
    assertIdempotencyFingerprint(record, fingerprint);
    return record;
  }

  async function createRunningBenchmarkIdempotent(input = {}) {
    const projectId = assertProjectId(input.projectId);
    const idempotencyKeyHash = sha256(assertIdempotencyKey(input.idempotencyKey));
    const requestFingerprint = assertRequestFingerprint(input.requestFingerprint);
    const dirs = await ensureProjectDir(root, projectId);
    return withLock(path.join(dirs.projectDir, '.create.lock'), async () => {
      const existing = await findIdempotentBenchmark(dirs.projectDir, projectId, idempotencyKeyHash);
      if (existing) {
        assertIdempotencyFingerprint(existing, requestFingerprint);
        return { benchmark: existing, idempotent: true };
      }
      const createdAt = toIso(clock());
      const benchmarkId = input.benchmarkId
        ? assertBenchmarkId(input.benchmarkId)
        : `bench_${compactTime(createdAt)}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      assertBenchmarkId(benchmarkId);
      const draft = normalizeNewBenchmark(input, {
        projectId,
        benchmarkId,
        createdAt,
        creation: { idempotencyKeyHash, requestFingerprint },
      });
      const record = {
        ...draft,
        status: 'running',
        revision: draft.revision + 1,
        startedAt: createdAt,
        events: appendEvent(draft.events, { type: 'started', at: createdAt, summary: '匿名候选开始运行。' }),
      };
      assertSafeRecord(record);
      await writeJsonExclusive(path.join(dirs.projectDir, `${benchmarkId}.json`), record);
      return { benchmark: record, idempotent: false };
    });
  }

  async function getBenchmark(projectId, benchmarkId, options = {}) {
    const dirs = projectPaths(root, projectId);
    assertBenchmarkId(benchmarkId);
    const raw = await readJsonOrNull(path.join(dirs.projectDir, `${benchmarkId}.json`));
    if (!raw) return null;
    const record = validateStoredBenchmark(raw, projectId, benchmarkId);
    return options.publicView === false ? record : publicBenchmarkView(record, options);
  }

  async function listBenchmarks(projectId, { limit = 30, status, mode, publicView = true, revealIdentities = false } = {}) {
    const dirs = projectPaths(root, projectId);
    let entries;
    try { entries = await fs.readdir(dirs.projectDir, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    if (entries.length > MAX_BENCHMARKS_PER_PROJECT) throw new BenchmarkHarnessError(500, 'BENCHMARK_LIMIT_EXCEEDED', '项目 Benchmark 数量超过安全上限。');
    const bounded = clampInteger(limit, 1, MAX_BENCHMARKS_PER_PROJECT, 30);
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const benchmarkId = entry.name.slice(0, -5);
      if (!BENCHMARK_ID_PATTERN.test(benchmarkId)) continue;
      const raw = await readJsonOrNull(path.join(dirs.projectDir, entry.name));
      const record = validateStoredBenchmark(raw, projectId, benchmarkId);
      if (status && record.status !== status) continue;
      if (mode && record.mode !== mode) continue;
      records.push(record);
    }
    records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.benchmarkId.localeCompare(a.benchmarkId));
    return records.slice(0, bounded).map((record) => publicView ? publicBenchmarkView(record, { revealIdentities }) : record);
  }

  async function startBenchmark(projectId, benchmarkId, patch = {}) {
    return mutateBenchmark(projectId, benchmarkId, patch.expectedRevision, (current, now) => {
      if (current.status !== 'draft') throw new BenchmarkHarnessError(409, 'INVALID_BENCHMARK_TRANSITION', '只有 draft Benchmark 可以开始运行。');
      return {
        ...current,
        status: 'running',
        revision: current.revision + 1,
        updatedAt: now,
        startedAt: now,
        events: appendEvent(current.events, { type: 'started', at: now, summary: '匿名候选开始运行。' }),
      };
    });
  }

  async function attachCandidateRun(projectId, benchmarkId, patch = {}) {
    return mutateBenchmark(projectId, benchmarkId, patch.expectedRevision, (current, now) => {
      if (current.status !== 'running') throw new BenchmarkHarnessError(409, 'BENCHMARK_NOT_RUNNING', '只有 running Benchmark 可以关联候选 Run。');
      const candidateId = assertCandidateId(patch.candidateId);
      const runId = assertRunId(patch.runId);
      const index = current.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
      if (index < 0) throw new BenchmarkHarnessError(404, 'BENCHMARK_CANDIDATE_NOT_FOUND', '未找到指定候选。');
      const candidate = current.candidates[index];
      if (candidate.runId) {
        if (candidate.runId === runId) return current;
        throw new BenchmarkHarnessError(409, 'CANDIDATE_RUN_IMMUTABLE', '候选已经关联另一 Run，不能覆盖。');
      }
      if (CANDIDATE_TERMINAL_STATUSES.has(candidate.status)) throw new BenchmarkHarnessError(409, 'CANDIDATE_ALREADY_TERMINAL', '候选已经进入终态。');
      const candidates = replaceAt(current.candidates, index, { ...candidate, status: 'running', runId, startedAt: candidate.startedAt ?? now });
      return {
        ...current, candidates, revision: current.revision + 1, updatedAt: now,
        events: appendEvent(current.events, { type: 'candidate_run_attached', at: now, candidateId, summary: runId }),
      };
    });
  }

  async function recordCandidateResult(projectId, benchmarkId, patch = {}) {
    return mutateBenchmark(projectId, benchmarkId, patch.expectedRevision, (current, now) => {
      if (current.status !== 'running') throw new BenchmarkHarnessError(409, 'BENCHMARK_NOT_RUNNING', '只有 running Benchmark 可以记录候选结果。');
      const candidateId = assertCandidateId(patch.candidateId);
      const runId = assertRunId(patch.runId);
      const outcome = String(patch.status ?? '').trim();
      if (!CANDIDATE_TERMINAL_STATUSES.has(outcome)) throw new BenchmarkHarnessError(400, 'INVALID_CANDIDATE_RESULT', '候选结果必须是 succeeded 或 failed。');
      const index = current.candidates.findIndex((candidate) => candidate.candidateId === candidateId);
      if (index < 0) throw new BenchmarkHarnessError(404, 'BENCHMARK_CANDIDATE_NOT_FOUND', '未找到指定候选。');
      const candidate = current.candidates[index];
      if (CANDIDATE_TERMINAL_STATUSES.has(candidate.status)) {
        if (candidate.status === outcome && candidate.runId === runId) return current;
        throw new BenchmarkHarnessError(409, 'CANDIDATE_RESULT_IMMUTABLE', '候选结果已经记录，不能覆盖。');
      }
      if (candidate.runId && candidate.runId !== runId) throw new BenchmarkHarnessError(409, 'CANDIDATE_RUN_MISMATCH', '候选结果与已关联 Run 不一致。');
      const nextCandidate = {
        ...candidate,
        status: outcome,
        runId,
        startedAt: candidate.startedAt ?? cleanIso(patch.startedAt) ?? now,
        completedAt: now,
        output: outcome === 'succeeded' ? normalizeOutput(patch.output) : emptyOutput(),
        metrics: normalizeMetrics(patch.metrics),
        error: outcome === 'failed' ? normalizeError(patch.error) : null,
      };
      const candidates = replaceAt(current.candidates, index, nextCandidate);
      const allTerminal = candidates.every((item) => CANDIDATE_TERMINAL_STATUSES.has(item.status));
      const successCount = candidates.filter((item) => item.status === 'succeeded').length;
      const status = allTerminal ? (successCount ? 'awaiting_scores' : 'failed') : 'running';
      return {
        ...current,
        candidates,
        status,
        revision: current.revision + 1,
        updatedAt: now,
        completedAt: status === 'failed' ? now : current.completedAt,
        events: appendEvent(current.events, {
          type: `candidate_${outcome}`,
          at: now,
          candidateId,
          summary: status === 'failed' ? '全部候选失败。' : `${candidate.alias} ${outcome}`,
        }),
      };
    });
  }

  async function submitEvaluation(projectId, benchmarkId, patch = {}) {
    return mutateBenchmark(projectId, benchmarkId, patch.expectedRevision, (current, now) => {
      if (current.status !== 'awaiting_scores') throw new BenchmarkHarnessError(409, 'BENCHMARK_NOT_AWAITING_SCORES', '只有 awaiting_scores Benchmark 可以提交评分。');
      if (current.evaluation) throw new BenchmarkHarnessError(409, 'BENCHMARK_EVALUATION_IMMUTABLE', 'Benchmark 评分已经锁定，不能覆盖。');
      const successful = current.candidates.filter((candidate) => candidate.status === 'succeeded');
      const scores = normalizeEvaluationScores(patch.scores, successful);
      const ranking = rankCandidates(successful, scores, current.weights);
      const evaluation = {
        reviewerId: cleanIdentifier(patch.reviewerId || 'author', 120) || 'author',
        submittedAt: now,
        algorithmVersion: 'quality-weighted-v1',
        scores,
        ranking,
        overallNote: cleanText(patch.overallNote, 4000),
      };
      return {
        ...current,
        status: 'completed',
        revision: current.revision + 1,
        updatedAt: now,
        completedAt: now,
        revealIdentities: true,
        evaluation,
        events: appendEvent(current.events, { type: 'evaluation_locked', at: now, summary: `已锁定 ${scores.length} 个候选评分。` }),
      };
    });
  }

  async function purgeOutputs(projectId, benchmarkId, patch = {}) {
    return mutateBenchmark(projectId, benchmarkId, patch.expectedRevision, (current, now) => {
      if (current.status !== 'completed') {
        throw new BenchmarkHarnessError(409, 'BENCHMARK_OUTPUT_PURGE_NOT_READY', '只有已经完成盲评的 Benchmark 可以清理候选正文。');
      }
      const retention = effectiveOutputRetention(current.retention);
      if (retention.outputs === 'purged') return current;
      const purgedBy = cleanIdentifier(patch.purgedBy || 'author', 120) || 'author';
      const reason = cleanText(patch.reason, 1600) || '评分已经完成，候选正文不再长期保留。';
      const candidates = current.candidates.map((candidate) => candidate.status === 'succeeded'
        ? { ...candidate, output: { ...candidate.output, outputText: '' } }
        : candidate);
      return {
        ...current,
        candidates,
        retention: { outputs: 'purged', purgedAt: now, purgedBy, reason },
        revision: current.revision + 1,
        updatedAt: now,
        events: appendEvent(current.events, {
          type: 'outputs_purged',
          at: now,
          summary: `${purgedBy}：${reason}`,
        }),
      };
    });
  }

  async function markStale(projectId, benchmarkId, patch = {}) {
    return mutateBenchmark(projectId, benchmarkId, patch.expectedRevision, (current, now) => {
      if (TERMINAL_STATUSES.has(current.status)) {
        if (current.status === 'stale') return current;
        throw new BenchmarkHarnessError(409, 'INVALID_BENCHMARK_TRANSITION', `Benchmark 已处于 ${current.status}，不能标记 stale。`);
      }
      const reason = cleanText(patch.reason, 1600) || 'Benchmark 基线已不再适用于当前正式事实。';
      return {
        ...current,
        status: 'stale',
        revision: current.revision + 1,
        updatedAt: now,
        completedAt: now,
        staleReason: reason,
        events: appendEvent(current.events, { type: 'stale', at: now, summary: reason }),
      };
    });
  }

  async function mutateBenchmark(projectId, benchmarkId, expectedRevision, transform) {
    if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) < 1) {
      throw new BenchmarkHarnessError(400, 'BENCHMARK_EXPECTED_REVISION_REQUIRED', '变更 Benchmark 时必须提供有效的 expectedRevision。');
    }
    const safeProjectId = assertProjectId(projectId);
    assertBenchmarkId(benchmarkId);
    const dirs = await ensureProjectDir(root, safeProjectId);
    const file = path.join(dirs.projectDir, `${benchmarkId}.json`);
    const lockFile = path.join(dirs.projectDir, `.${benchmarkId}.lock`);
    return withLock(lockFile, async () => {
      const raw = await readJsonOrNull(file);
      if (!raw) throw new BenchmarkHarnessError(404, 'BENCHMARK_NOT_FOUND', '未找到指定 Benchmark。');
      const current = validateStoredBenchmark(raw, safeProjectId, benchmarkId);
      if (expectedRevision != null && Number(expectedRevision) !== current.revision) {
        throw new BenchmarkHarnessError(409, 'BENCHMARK_REVISION_CONFLICT', 'Benchmark 已被另一操作更新，请重新加载。', {
          expectedRevision: Number(expectedRevision), currentRevision: current.revision,
        });
      }
      const next = transform(current, toIso(clock()));
      assertSafeRecord(next);
      await writeJsonAtomic(file, next);
      return next;
    });
  }

  return Object.freeze({
    root,
    createBenchmark,
    findBenchmarkByIdempotencyKey,
    createRunningBenchmarkIdempotent,
    getBenchmark,
    listBenchmarks,
    startBenchmark,
    attachCandidateRun,
    recordCandidateResult,
    submitEvaluation,
    purgeOutputs,
    markStale,
    publicBenchmarkView,
  });
}

export function publicBenchmarkView(record, { revealIdentities = false } = {}) {
  const reveal = revealIdentities || record.status === 'completed' || record.revealIdentities === true;
  const view = structuredClone(record);
  delete view.creation;
  view.retention = effectiveOutputRetention(view.retention);
  view.identityRevealed = reveal;
  view.candidates = view.candidates.map((candidate) => {
    if (reveal) return candidate;
    return {
      ...candidate,
      provider: null,
      model: '',
      runId: null,
      error: candidate.error ? { code: candidate.error.code, message: '匿名候选调用失败。', retryable: candidate.error.retryable } : null,
    };
  });
  if (!reveal) {
    view.events = view.events.map((event) => event.type === 'candidate_run_attached' ? { ...event, summary: '' } : event);
  }
  return view;
}

function normalizeNewBenchmark(input, { projectId, benchmarkId, createdAt, creation = null }) {
  const chapter = Number(input.chapter);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 1_000_000) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_CHAPTER', 'Benchmark 章节号无效。');
  const mode = String(input.mode ?? '').trim();
  if (!MODES.has(mode)) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_MODE', 'Benchmark mode 必须是 logic 或 writer。');
  const candidates = normalizeCandidates(input.candidates);
  const baseline = normalizeBaseline(input.baseline);
  if (!baseline.inputHash) throw new BenchmarkHarnessError(400, 'BENCHMARK_INPUT_HASH_REQUIRED', 'Benchmark 必须冻结 inputHash。');
  return {
    version: STORE_VERSION,
    benchmarkId,
    projectId,
    projectTitle: cleanLine(input.projectTitle, 240),
    chapter,
    mode,
    status: 'draft',
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    completedAt: null,
    revealIdentities: false,
    baseline,
    weights: normalizeWeights(input.weights),
    candidates,
    evaluation: null,
    staleReason: '',
    retention: defaultOutputRetention(),
    ...(creation ? { creation: normalizeCreation(creation) } : {}),
    metadata: normalizeMetadata(input.metadata),
    events: [{ type: 'created', at: createdAt, summary: `${mode}；${candidates.length} 个匿名候选。` }],
  };
}

function normalizeCreation(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    idempotencyKeyHash: assertRequestFingerprint(input.idempotencyKeyHash),
    requestFingerprint: assertRequestFingerprint(input.requestFingerprint),
  };
}

function normalizeCandidates(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 4) throw new BenchmarkHarnessError(400, 'BENCHMARK_CANDIDATES_REQUIRED', 'Benchmark 需要 2–4 个候选模型。');
  const identities = new Set();
  const ids = new Set();
  return input.map((value, index) => {
    if (!isPlainObject(value)) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_CANDIDATE', `候选 ${index + 1} 无效。`);
    const candidateId = value.candidateId ? assertCandidateId(value.candidateId) : `candidate-${String.fromCharCode(97 + index)}`;
    if (ids.has(candidateId)) throw new BenchmarkHarnessError(400, 'BENCHMARK_CANDIDATE_ID_DUPLICATE', 'Benchmark 候选 ID 不能重复。');
    ids.add(candidateId);
    const provider = normalizeProvider(value.provider ?? value);
    const model = cleanLine(value.model, 200);
    if (!provider.id || !model) throw new BenchmarkHarnessError(400, 'BENCHMARK_CANDIDATE_IDENTITY_REQUIRED', `候选 ${index + 1} 缺少 provider/model。`);
    const identity = `${provider.id}::${model}`;
    if (identities.has(identity)) throw new BenchmarkHarnessError(400, 'BENCHMARK_CANDIDATE_DUPLICATE', 'Benchmark 候选不能重复。');
    identities.add(identity);
    return {
      candidateId,
      alias: String.fromCharCode(65 + index),
      provider,
      model,
      status: 'pending',
      runId: null,
      startedAt: null,
      completedAt: null,
      output: emptyOutput(),
      metrics: emptyMetrics(),
      error: null,
    };
  });
}

function normalizeProvider(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    id: cleanIdentifier(input.id ?? input.providerId, 160),
    name: cleanLine(input.name ?? input.providerName, 200),
    type: cleanIdentifier(input.type ?? input.providerType, 80),
  };
}

function normalizeBaseline(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    inputHash: normalizeHash(input.inputHash),
    canonRevisionId: cleanIdentifier(input.canonRevisionId, 160) || null,
    promptVersion: cleanLine(input.promptVersion, 160),
    ruleVersion: cleanLine(input.ruleVersion, 160),
    sourceLabels: normalizeStringArray(input.sourceLabels, 100, 500),
  };
}

function normalizeWeights(value) {
  const input = isPlainObject(value) ? value : {};
  const weights = {};
  let total = 0;
  for (const key of SCORE_DIMENSIONS) {
    const number = input[key] == null ? DEFAULT_WEIGHTS[key] : Number(input[key]);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_WEIGHT', `评分权重 ${key} 必须是 0–100 的数字。`);
    weights[key] = number;
    total += number;
  }
  if (total <= 0) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_WEIGHTS', '至少一个评分维度的权重必须大于 0。');
  return weights;
}

function normalizeOutput(value) {
  const input = isPlainObject(value) ? value : {};
  const outputText = cleanText(input.outputText ?? input.text, MAX_OUTPUT_BYTES);
  if (!outputText) throw new BenchmarkHarnessError(400, 'BENCHMARK_OUTPUT_REQUIRED', '成功候选必须提供 outputText。');
  if (Buffer.byteLength(outputText, 'utf8') > MAX_OUTPUT_BYTES) throw new BenchmarkHarnessError(400, 'BENCHMARK_OUTPUT_TOO_LARGE', '候选输出超过安全大小限制。');
  return {
    contentHash: normalizeHash(input.contentHash) || sha256(outputText),
    outputText,
    summary: cleanText(input.summary, 1600),
  };
}

function emptyOutput() { return { contentHash: '', outputText: '', summary: '' }; }
function emptyMetrics() { return { latencyMs: null, usage: { inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null }, cost: { amount: null, currency: '' } }; }
function defaultOutputRetention() { return { outputs: 'available', purgedAt: null, purgedBy: '', reason: '' }; }

function effectiveOutputRetention(value) {
  if (!isPlainObject(value)) return defaultOutputRetention();
  return {
    outputs: OUTPUT_RETENTION_STATUSES.has(value.outputs) ? value.outputs : 'available',
    purgedAt: cleanIso(value.purgedAt),
    purgedBy: cleanIdentifier(value.purgedBy, 120),
    reason: cleanText(value.reason, 1600),
  };
}

function normalizeMetrics(value) {
  const input = isPlainObject(value) ? value : {};
  const latencyMs = optionalNonNegativeInteger(input.latencyMs);
  return { latencyMs, usage: normalizeUsage(input.usage), cost: normalizeCost(input.cost) };
}

function normalizeUsage(value) {
  const input = isPlainObject(value) ? value : {};
  const inputTokens = optionalNonNegativeInteger(input.inputTokens ?? input.promptTokens ?? input.input_tokens ?? input.promptTokenCount);
  const outputTokens = optionalNonNegativeInteger(input.outputTokens ?? input.completionTokens ?? input.output_tokens ?? input.candidatesTokenCount);
  const totalTokens = optionalNonNegativeInteger(input.totalTokens ?? input.total_tokens ?? input.totalTokenCount) ?? (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);
  return { inputTokens, outputTokens, totalTokens, cachedTokens: optionalNonNegativeInteger(input.cachedTokens) };
}

function normalizeCost(value) {
  const input = isPlainObject(value) ? value : {};
  const amount = input.amount == null || input.amount === '' ? null : Number(input.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_COST', 'Benchmark cost.amount 必须是非负数字。');
  return { amount, currency: cleanIdentifier(input.currency, 16).toUpperCase() };
}

function normalizeError(value) {
  const input = isPlainObject(value) ? value : {};
  return {
    code: cleanIdentifier(input.code || 'MODEL_CALL_FAILED', 160) || 'MODEL_CALL_FAILED',
    message: cleanText(input.message || '候选模型调用失败。', 1000),
    retryable: input.retryable === true,
    upstreamStatus: optionalNonNegativeInteger(input.upstreamStatus),
  };
}

function normalizeEvaluationScores(input, successfulCandidates) {
  if (!Array.isArray(input)) throw new BenchmarkHarnessError(400, 'BENCHMARK_SCORES_REQUIRED', '必须一次性提交全部成功候选的评分。');
  const expected = new Set(successfulCandidates.map((candidate) => candidate.candidateId));
  const seen = new Set();
  const normalized = input.map((value, index) => {
    if (!isPlainObject(value)) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_SCORE', `scores[${index}] 无效。`);
    const candidateId = assertCandidateId(value.candidateId);
    if (!expected.has(candidateId)) throw new BenchmarkHarnessError(400, 'BENCHMARK_SCORE_CANDIDATE_INVALID', '只能为成功候选评分。');
    if (seen.has(candidateId)) throw new BenchmarkHarnessError(400, 'BENCHMARK_SCORE_DUPLICATE', '同一候选不能重复评分。');
    seen.add(candidateId);
    const dimensions = {};
    for (const key of SCORE_DIMENSIONS) {
      const score = Number(value.dimensions?.[key] ?? value[key]);
      if (!Number.isInteger(score) || score < 1 || score > 10) throw new BenchmarkHarnessError(400, 'BENCHMARK_SCORE_INCOMPLETE', `${candidateId}.${key} 必须是 1–10 的整数。`);
      dimensions[key] = score;
    }
    return { candidateId, dimensions, note: cleanText(value.note, 2400) };
  });
  if (seen.size !== expected.size) throw new BenchmarkHarnessError(400, 'BENCHMARK_SCORE_INCOMPLETE', '必须一次性为全部成功候选完成评分。');
  return normalized.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

function rankCandidates(candidates, scores, weights) {
  const byCandidate = new Map(scores.map((score) => [score.candidateId, score]));
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return candidates.map((candidate) => {
    const score = byCandidate.get(candidate.candidateId);
    const weightedScore = SCORE_DIMENSIONS.reduce((sum, key) => sum + score.dimensions[key] * weights[key], 0) / weightTotal;
    return {
      candidateId: candidate.candidateId,
      weightedScore: Math.round(weightedScore * 10_000) / 10_000,
      latencyMs: candidate.metrics.latencyMs,
    };
  }).sort((a, b) => b.weightedScore - a.weightedScore
    || compareNullableNumber(a.latencyMs, b.latencyMs)
    || a.candidateId.localeCompare(b.candidateId))
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

function normalizeMetadata(value) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (FORBIDDEN_KEYS.test(key)) throw new BenchmarkHarnessError(400, 'BENCHMARK_SENSITIVE_FIELD', `Benchmark metadata 不允许字段 ${key}。`);
    const safeKey = cleanIdentifier(key, 120);
    if (!safeKey) continue;
    if (item == null || typeof item === 'boolean' || typeof item === 'number') output[safeKey] = item;
    else if (typeof item === 'string') output[safeKey] = cleanText(item, 2000);
    else throw new BenchmarkHarnessError(400, 'BENCHMARK_METADATA_SCALAR_ONLY', `Benchmark metadata.${key} 只允许字符串、数字、布尔值或 null。`);
  }
  return output;
}

function validateStoredBenchmark(raw, projectId, benchmarkId) {
  const corrupt = (message) => { throw new BenchmarkHarnessError(500, 'BENCHMARK_RECORD_CORRUPT', message); };
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION || raw.projectId !== assertProjectId(projectId) || raw.benchmarkId !== assertBenchmarkId(benchmarkId)) {
    corrupt('Benchmark 记录结构或身份无效。');
  }
  if (!BENCHMARK_STATUSES.has(raw.status) || !Number.isInteger(raw.revision) || raw.revision < 1 || !Array.isArray(raw.candidates) || raw.candidates.length < 2 || raw.candidates.length > 4) {
    corrupt('Benchmark 记录状态无效。');
  }
  if (!isPlainObject(raw.baseline) || !normalizeHash(raw.baseline.inputHash) || !isPlainObject(raw.weights) || !Array.isArray(raw.events)) {
    corrupt('Benchmark 基线或事件结构无效。');
  }
  if (raw.creation != null && (
    !isPlainObject(raw.creation)
    || !normalizeHash(raw.creation.idempotencyKeyHash)
    || !normalizeHash(raw.creation.requestFingerprint)
  )) {
    corrupt('Benchmark 创建幂等信息无效。');
  }
  const retention = raw.retention == null ? defaultOutputRetention() : raw.retention;
  if (
    !isPlainObject(retention)
    || !OUTPUT_RETENTION_STATUSES.has(retention.outputs)
    || (retention.outputs === 'available' && (retention.purgedAt != null || retention.purgedBy || retention.reason))
    || (retention.outputs === 'purged' && (!cleanIso(retention.purgedAt) || !cleanIdentifier(retention.purgedBy, 120)))
  ) {
    corrupt('Benchmark 输出保留状态无效。');
  }
  if (retention.outputs === 'purged' && raw.status !== 'completed') corrupt('只有 completed Benchmark 可以处于输出已清理状态。');
  const ids = new Set();
  for (const candidate of raw.candidates) {
    if (!isPlainObject(candidate) || !/^candidate-[a-z0-9_-]{1,40}$/.test(String(candidate.candidateId ?? '')) || ids.has(candidate.candidateId)) corrupt('Benchmark 候选身份无效。');
    ids.add(candidate.candidateId);
    if (!CANDIDATE_STATUSES.has(candidate.status) || !isPlainObject(candidate.provider) || !candidate.provider.id || !candidate.model || !isPlainObject(candidate.output) || !isPlainObject(candidate.metrics)) corrupt('Benchmark 候选结构无效。');
    if (candidate.runId != null && !RUN_ID_PATTERN.test(String(candidate.runId))) corrupt('Benchmark 候选 Run ID 无效。');
    if (CANDIDATE_TERMINAL_STATUSES.has(candidate.status) && !candidate.runId) corrupt('Benchmark 终态候选缺少 Run ID。');
    if (candidate.status === 'succeeded' && (
      !normalizeHash(candidate.output.contentHash)
      || (retention.outputs === 'available' && !candidate.output.outputText)
      || (retention.outputs === 'purged' && candidate.output.outputText)
    )) corrupt('Benchmark 成功候选缺少有效输出，或输出保留状态不一致。');
    if (candidate.status === 'failed' && !isPlainObject(candidate.error)) corrupt('Benchmark 失败候选缺少错误记录。');
  }
  const allTerminal = raw.candidates.every((candidate) => CANDIDATE_TERMINAL_STATUSES.has(candidate.status));
  const successCount = raw.candidates.filter((candidate) => candidate.status === 'succeeded').length;
  if (raw.status === 'draft' && raw.candidates.some((candidate) => candidate.status !== 'pending')) corrupt('draft Benchmark 候选状态无效。');
  if (raw.status === 'running' && allTerminal) corrupt('running Benchmark 不应全部进入终态。');
  if (raw.status === 'awaiting_scores' && (!allTerminal || successCount < 1 || raw.evaluation != null)) corrupt('awaiting_scores Benchmark 状态不一致。');
  if (raw.status === 'failed' && (!allTerminal || successCount !== 0)) corrupt('failed Benchmark 状态不一致。');
  if (raw.status === 'completed' && (!allTerminal || successCount < 1 || !isPlainObject(raw.evaluation) || raw.revealIdentities !== true)) corrupt('completed Benchmark 状态不一致。');
  assertSafeRecord(raw);
  return raw;
}

function assertSafeRecord(record) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(record), 'utf8'); }
  catch { throw new BenchmarkHarnessError(400, 'BENCHMARK_NOT_SERIALIZABLE', 'Benchmark 记录无法序列化。'); }
  if (bytes > MAX_RECORD_BYTES) throw new BenchmarkHarnessError(400, 'BENCHMARK_RECORD_TOO_LARGE', 'Benchmark 记录超过安全大小限制。');
  walkSafe(record, '$');
}

function walkSafe(value, location) {
  if (typeof value === 'string') {
    for (const pattern of SECRET_TEXT_PATTERNS) {
      if (pattern.test(value)) throw new BenchmarkHarnessError(400, 'BENCHMARK_SECRET_DETECTED', `Benchmark 记录疑似包含凭据（${location}）。`);
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => walkSafe(item, `${location}[${index}]`)); return; }
  if (!isPlainObject(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new BenchmarkHarnessError(400, 'BENCHMARK_SENSITIVE_FIELD', `Benchmark 记录不允许字段 ${key}。`);
    walkSafe(item, `${location}.${key}`);
  }
}

async function ensureProjectDir(root, projectId) {
  const dirs = projectPaths(root, projectId);
  await ensureOrdinaryDirectory(path.dirname(root));
  await ensureOrdinaryDirectory(root);
  await ensureOrdinaryDirectory(dirs.projectDir);
  return dirs;
}

async function findIdempotentBenchmark(projectDir, projectId, idempotencyKeyHash) {
  let entries;
  try { entries = await fs.readdir(projectDir, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  if (entries.length > MAX_BENCHMARKS_PER_PROJECT + 10) {
    throw new BenchmarkHarnessError(500, 'BENCHMARK_LIMIT_EXCEEDED', '项目 Benchmark 数量超过安全上限。');
  }
  let match = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const benchmarkId = entry.name.slice(0, -5);
    if (!BENCHMARK_ID_PATTERN.test(benchmarkId)) continue;
    const raw = await readJsonOrNull(path.join(projectDir, entry.name));
    const record = validateStoredBenchmark(raw, projectId, benchmarkId);
    if (record.creation?.idempotencyKeyHash !== idempotencyKeyHash) continue;
    if (match) {
      throw new BenchmarkHarnessError(500, 'BENCHMARK_IDEMPOTENCY_DUPLICATE', '同一幂等键关联了多个 Benchmark，存储不变量已损坏。');
    }
    match = record;
  }
  return match;
}

function assertIdempotencyFingerprint(record, requestFingerprint) {
  if (record.creation?.requestFingerprint === requestFingerprint) return;
  throw new BenchmarkHarnessError(
    409,
    'BENCHMARK_IDEMPOTENCY_CONFLICT',
    '该幂等键已经用于另一组 Benchmark 参数。请重新确认后使用新键。',
    { benchmarkId: record.benchmarkId },
  );
}

function projectPaths(root, projectId) {
  const safeProjectId = assertProjectId(projectId);
  const projectDir = path.resolve(root, safeProjectId);
  assertInside(root, projectDir);
  return { projectDir };
}

async function ensureOrdinaryDirectory(directory) {
  let stat = await fs.lstat(directory).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat) {
    await fs.mkdir(directory, { recursive: false, mode: 0o700 }).catch(async (error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    stat = await fs.lstat(directory);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BenchmarkHarnessError(500, 'UNSAFE_BENCHMARK_PATH', 'Benchmark 存储路径必须是普通目录。', { path: directory });
}

async function withLock(lockFile, callback) {
  const started = Date.now();
  while (true) {
    let handle;
    try {
      handle = await fs.open(lockFile, 'wx', 0o600);
      try { return await callback(); }
      finally { await handle.close().catch(() => {}); await fs.unlink(lockFile).catch(() => {}); }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = await fs.lstat(lockFile).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink() && Date.now() - stat.mtimeMs > LOCK_STALE_MS) { await fs.unlink(lockFile).catch(() => {}); continue; }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new BenchmarkHarnessError(409, 'BENCHMARK_UPDATE_BUSY', 'Benchmark 正在被另一进程更新，请稍后重试。');
      await delay(25);
    }
  }
}

async function writeJsonExclusive(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

async function writeJsonAtomic(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    const existing = await fs.lstat(file).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new BenchmarkHarnessError(500, 'UNSAFE_BENCHMARK_FILE', 'Benchmark 记录必须是普通文件。');
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
}

async function readJsonOrNull(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new BenchmarkHarnessError(500, 'UNSAFE_BENCHMARK_FILE', 'Benchmark 记录必须是普通文件。');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new BenchmarkHarnessError(500, 'BENCHMARK_JSON_CORRUPT', 'Benchmark JSON 无法解析。');
    throw error;
  }
}

function appendEvent(events, event) { return [...(Array.isArray(events) ? events : []), event].slice(-500); }
function replaceAt(array, index, value) { const copy = [...array]; copy[index] = value; return copy; }
function assertInside(parent, child) { const relative = path.relative(parent, child); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new BenchmarkHarnessError(400, 'UNSAFE_BENCHMARK_PATH', 'Benchmark 路径越界。'); }
function assertProjectId(value) { const id = String(value ?? '').trim(); if (!PROJECT_ID_PATTERN.test(id)) throw new BenchmarkHarnessError(400, 'INVALID_PROJECT_ID', '项目 ID 无效。'); return id; }
function assertBenchmarkId(value) { const id = String(value ?? '').trim(); if (!BENCHMARK_ID_PATTERN.test(id)) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_ID', 'Benchmark ID 无效。'); return id; }
function assertRunId(value) { const id = String(value ?? '').trim(); if (!RUN_ID_PATTERN.test(id)) throw new BenchmarkHarnessError(400, 'INVALID_RUN_ID', 'Run ID 无效。'); return id; }
function assertCandidateId(value) { const id = String(value ?? '').trim(); if (!/^candidate-[a-z0-9_-]{1,40}$/.test(id)) throw new BenchmarkHarnessError(400, 'INVALID_CANDIDATE_ID', '候选 ID 无效。'); return id; }
function assertIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (!key) throw new BenchmarkHarnessError(400, 'BENCHMARK_IDEMPOTENCY_KEY_REQUIRED', '创建 Benchmark 必须提供 Idempotency-Key。');
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_IDEMPOTENCY_KEY', 'Idempotency-Key 必须是 16–200 个安全字符。');
  }
  return key;
}
function assertRequestFingerprint(value) {
  const fingerprint = normalizeHash(value);
  if (!fingerprint) throw new BenchmarkHarnessError(400, 'INVALID_BENCHMARK_REQUEST_FINGERPRINT', 'Benchmark 请求指纹无效。');
  return fingerprint;
}
function cleanIdentifier(value, max) { return String(value ?? '').replace(/[^A-Za-z0-9._:@+-]/g, '_').slice(0, max); }
function cleanLine(value, max = 240) { return cleanText(value, max).replace(/\s+/g, ' ').trim(); }
function cleanText(value, max = 1200) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max); }
function normalizeHash(value) { const hash = String(value ?? '').trim().toLowerCase(); return /^[a-f0-9]{64}$/.test(hash) ? hash : ''; }
function normalizeStringArray(value, maxItems, maxLength) { if (!Array.isArray(value)) return []; return [...new Set(value.map((item) => cleanLine(item, maxLength)).filter(Boolean))].slice(0, maxItems); }
function optionalNonNegativeInteger(value) { const number = Number(value); return Number.isInteger(number) && number >= 0 ? number : null; }
function cleanIso(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function compareNullableNumber(a, b) { if (a == null && b == null) return 0; if (a == null) return 1; if (b == null) return -1; return a - b; }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function toIso(value) { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) throw new TypeError('clock must return a valid date'); return date.toISOString(); }
function compactTime(iso) { return iso.replace(/[-:.TZ]/g, '').slice(0, 14); }
function clampInteger(value, min, max, fallback) { const number = Number(value); return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function sha256(value) { return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex'); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
