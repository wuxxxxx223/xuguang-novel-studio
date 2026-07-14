#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = process.env.NOVEL_STUDIO_BASE_URL || 'http://127.0.0.1:8790';

function usage() {
  return `批量处理多个小说项目的当前章候选。

用法:
  npm run batch:projects -- --operation generate --all --confirm-spend
  npm run batch:projects -- --operation review --projects <项目ID,项目ID> --confirm-spend

参数:
  --operation <generate|review>  批量生成候选或批量审查
  --all                          处理发现的全部项目
  --projects <id1,id2>           只处理指定项目 ID
  --confirm-spend                确认本批次会产生模型厂商费用
  --base-url <url>               服务地址，默认 ${DEFAULT_BASE_URL}
  --help                         显示帮助

边界:
  串行执行；单项目失败不终止整批；不会确认候选，也不会正式写回。`;
}

export function parseArgs(argv) {
  const options = {
    operation: '',
    all: false,
    projectIds: [],
    confirmSpend: false,
    baseUrl: DEFAULT_BASE_URL,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--confirm-spend') options.confirmSpend = true;
    else if (arg === '--operation') options.operation = String(argv[++index] ?? '').trim();
    else if (arg === '--projects') {
      options.projectIds = String(argv[++index] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--base-url') options.baseUrl = String(argv[++index] ?? '').trim();
    else throw new Error(`未知参数：${arg}`);
  }

  if (options.help) return options;
  if (!['generate', 'review'].includes(options.operation)) throw new Error('--operation 必须是 generate 或 review。');
  if (options.all === (options.projectIds.length > 0)) throw new Error('--all 与 --projects 必须且只能选择一个。');
  if (!options.confirmSpend) throw new Error('模型调用前必须传入 --confirm-spend。');
  try {
    options.baseUrl = new URL(options.baseUrl).toString().replace(/\/+$/, '');
  } catch {
    throw new Error('--base-url 不是合法 URL。');
  }
  return options;
}

export function classifyProject(operation, dashboard, chapterWorkspace) {
  const chapter = dashboard?.chapter ?? {};
  const candidate = chapterWorkspace?.candidate ?? {};
  const review = chapterWorkspace?.review ?? {};
  const hasCandidate = Boolean(String(candidate.text ?? '').trim());
  const reviewCurrent = hasCandidate
    && review.status === 'ready'
    && Boolean(candidate.contentHash)
    && review.candidateHash === candidate.contentHash;

  if (!chapter.contractReady) return { eligible: false, reason: '缺少正式章节契约' };
  if (operation === 'generate' && hasCandidate) return { eligible: false, reason: '已有候选稿' };
  if (operation === 'review' && !hasCandidate) return { eligible: false, reason: '尚无候选稿' };
  if (operation === 'review' && reviewCurrent) return { eligible: false, reason: '当前候选已审查' };
  return { eligible: true, reason: '' };
}

async function requestJson(baseUrl, pathname, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${baseUrl}${pathname}`, {
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...options,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = { message: text }; }
  }
  if (!response.ok) {
    const message = payload?.message ?? payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return payload;
}

export async function runBatch(options, {
  fetchImpl = fetch,
  log = console.log,
  errorLog = console.error,
} = {}) {
  const projectsResponse = await requestJson(options.baseUrl, '/api/projects', {}, fetchImpl);
  const discovered = Array.isArray(projectsResponse.projects) ? projectsResponse.projects : [];
  const selectedIds = new Set(options.projectIds);
  const projects = options.all ? discovered : discovered.filter((project) => selectedIds.has(project.id));
  const missingIds = options.all ? [] : options.projectIds.filter((id) => !projects.some((project) => project.id === id));
  const results = [];

  for (const id of missingIds) {
    results.push({ id, title: id, status: 'error', message: '项目 ID 未找到' });
    errorLog(`失败  ${id}：项目 ID 未找到`);
  }

  log(`开始批量${options.operation === 'generate' ? '生成' : '审查'}：${projects.length} 个项目，串行执行。`);

  for (const project of projects) {
    const label = `${project.title || project.id} (${project.id})`;
    try {
      const encodedId = encodeURIComponent(project.id);
      const [dashboardResponse, workspaceResponse] = await Promise.all([
        requestJson(options.baseUrl, `/api/projects/${encodedId}/dashboard`, {}, fetchImpl),
        requestJson(options.baseUrl, `/api/projects/${encodedId}/chapter-workspace`, {}, fetchImpl),
      ]);
      const dashboard = dashboardResponse.dashboard;
      const chapterWorkspace = workspaceResponse.chapterWorkspace;
      const classification = classifyProject(options.operation, dashboard, chapterWorkspace);
      if (!classification.eligible) {
        results.push({ id: project.id, title: project.title, status: 'skipped', message: classification.reason });
        log(`跳过  ${label}：${classification.reason}`);
        continue;
      }

      const endpoint = options.operation === 'generate'
        ? `/api/projects/${encodedId}/chapter-workspace/generate`
        : `/api/projects/${encodedId}/chapter-workspace/review`;
      const body = options.operation === 'generate'
        ? { expectedRevision: chapterWorkspace.revision, confirmModelSpend: true, mode: 'full' }
        : { expectedRevision: chapterWorkspace.revision };
      await requestJson(options.baseUrl, endpoint, { method: 'POST', body: JSON.stringify(body) }, fetchImpl);
      results.push({ id: project.id, title: project.title, status: 'success', message: `第 ${dashboard.chapter.number} 章完成` });
      log(`成功  ${label}：第 ${dashboard.chapter.number} 章`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: project.id, title: project.title, status: 'error', message });
      errorLog(`失败  ${label}：${message}`);
    }
  }

  const summary = {
    total: results.length,
    success: results.filter((item) => item.status === 'success').length,
    skipped: results.filter((item) => item.status === 'skipped').length,
    error: results.filter((item) => item.status === 'error').length,
  };
  log(`汇总  总计 ${summary.total}，成功 ${summary.success}，跳过 ${summary.skipped}，失败 ${summary.error}`);
  return { results, summary };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const { summary } = await runBatch(options);
    if (summary.error) process.exitCode = 1;
  } catch (error) {
    console.error(`批处理未启动：${error instanceof Error ? error.message : String(error)}\n`);
    console.error(usage());
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
