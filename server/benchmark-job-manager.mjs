const DEFAULT_RECONCILE_REASON = '服务进程曾中断；为保证冻结输入一致性，本轮未自动续跑。请使用当前正式事实新建一轮 Benchmark。';

export function createBenchmarkJobManager({ benchmarkHarness, clock = () => new Date(), logger = console } = {}) {
  if (!benchmarkHarness) throw new TypeError('benchmarkHarness is required');
  const jobs = new Map();

  function describe(projectId, benchmarkId) {
    const job = jobs.get(jobKey(projectId, benchmarkId));
    if (!job) return { active: false, state: 'inactive' };
    return {
      active: true,
      state: job.state,
      scheduledAt: job.scheduledAt,
      startedAt: job.startedAt,
    };
  }

  function schedule({ projectId, benchmarkId, task }) {
    if (typeof task !== 'function') throw new TypeError('task is required');
    const key = jobKey(projectId, benchmarkId);
    const existing = jobs.get(key);
    if (existing) return { accepted: false, execution: describe(projectId, benchmarkId) };

    const job = {
      projectId,
      benchmarkId,
      state: 'scheduled',
      scheduledAt: toIso(clock()),
      startedAt: null,
      promise: null,
    };
    jobs.set(key, job);
    job.promise = Promise.resolve()
      .then(async () => {
        job.state = 'running';
        job.startedAt = toIso(clock());
        await task();
        await staleIfStillRunning(projectId, benchmarkId, '后台执行已经结束，但候选结果没有全部收口。请检查关联 Run Ledger 后新建一轮。');
      })
      .catch(async (error) => {
        safeLog(logger, `[benchmark-job:${key}] ${safeErrorCode(error)}: ${safeErrorMessage(error)}`);
        await staleIfStillRunning(projectId, benchmarkId, `后台执行异常中断（${safeErrorCode(error)}）。请检查关联 Run Ledger 后新建一轮。`);
      })
      .finally(() => {
        jobs.delete(key);
      });

    return { accepted: true, execution: describe(projectId, benchmarkId) };
  }

  async function staleIfStillRunning(projectId, benchmarkId, reason) {
    const current = await benchmarkHarness.getBenchmark(projectId, benchmarkId, { publicView: false });
    if (!current || current.status !== 'running') return current;
    return benchmarkHarness.markStale(projectId, benchmarkId, {
      expectedRevision: current.revision,
      reason,
    });
  }

  async function reconcileProject(projectId, { reason = DEFAULT_RECONCILE_REASON } = {}) {
    const running = await benchmarkHarness.listBenchmarks(projectId, {
      status: 'running',
      limit: 10_000,
      publicView: false,
    });
    let staleCount = 0;
    let activeCount = 0;
    const failures = [];
    for (const benchmark of running) {
      if (jobs.has(jobKey(projectId, benchmark.benchmarkId))) {
        activeCount += 1;
        continue;
      }
      try {
        await benchmarkHarness.markStale(projectId, benchmark.benchmarkId, {
          expectedRevision: benchmark.revision,
          reason,
        });
        staleCount += 1;
      } catch (error) {
        failures.push({ benchmarkId: benchmark.benchmarkId, code: safeErrorCode(error) });
        safeLog(logger, `[benchmark-reconcile:${projectId}:${benchmark.benchmarkId}] ${safeErrorCode(error)}: ${safeErrorMessage(error)}`);
      }
    }
    return { projectId, scanned: running.length, staleCount, activeCount, failures };
  }

  async function reconcileProjects(projectIds, options = {}) {
    const unique = [...new Set((Array.isArray(projectIds) ? projectIds : []).map((item) => String(item || '').trim()).filter(Boolean))];
    const results = [];
    for (const projectId of unique) results.push(await reconcileProject(projectId, options));
    return results;
  }

  async function waitForIdle({ timeoutMs = 30_000 } = {}) {
    const promises = [...jobs.values()].map((job) => job.promise).filter(Boolean);
    if (!promises.length) return true;
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), Math.max(1, Number(timeoutMs) || 30_000)); });
    const settled = Promise.allSettled(promises).then(() => true);
    const result = await Promise.race([settled, timeout]);
    clearTimeout(timer);
    return result;
  }

  return Object.freeze({ describe, schedule, reconcileProject, reconcileProjects, waitForIdle });
}

function jobKey(projectId, benchmarkId) {
  const project = String(projectId || '').trim();
  const benchmark = String(benchmarkId || '').trim();
  if (!project || !benchmark) throw new TypeError('projectId and benchmarkId are required');
  return `${project}:${benchmark}`;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('clock returned an invalid date');
  return date.toISOString();
}

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'BENCHMARK_JOB_FAILED').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120) || 'BENCHMARK_JOB_FAILED';
}

function safeErrorMessage(error) {
  return String(error?.message || 'Benchmark 后台任务失败。')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
}

function safeLog(logger, message) {
  if (typeof logger?.error === 'function') logger.error(message);
}