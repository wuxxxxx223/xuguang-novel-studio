import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, '..');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'xuguang-workspace-cycle-api-'));
const dataDir = path.join(tempRoot, 'data');
const libraryRoot = path.join(tempRoot, 'library');
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
let child;
let mockServer;
let lastModelRequest = null;
let output = '';

try {
  await fs.mkdir(libraryRoot, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  const mockPort = await freePort();
  mockServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      assert.match(String(req.headers.authorization ?? ''), /^Bearer /);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-writer-a' }, { id: 'mock-writer-b' }] }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    lastModelRequest = JSON.parse(body || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-workspace-cycle',
      model: 'mock-writer',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ chapterId: 1, title: '雨夜开门', draft: '模型候选正文。', contractWarnings: [], openIssues: [] }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  await listen(mockServer, mockPort);
  const roles = ['idea', 'logic', 'blueprint', 'writer', 'review'];
  await fs.writeFile(path.join(dataDir, 'settings.json'), JSON.stringify({
    version: 2,
    providers: [{ id: 'mock-provider', name: 'Mock Provider', type: 'openai-compatible', kind: 'relay', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: crypto.randomUUID() }],
    routes: Object.fromEntries(roles.map((role) => [role, { providerId: 'mock-provider', model: 'mock-writer' }])),
    temperature: Object.fromEntries(roles.map((role) => [role, 0.2])),
    maxTokens: Object.fromEntries(roles.map((role) => [role, 2000])),
    timeoutMs: 10_000,
    jsonMode: false,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      NOVEL_STUDIO_DATA_DIR: dataDir,
      NOVEL_STUDIO_LIBRARY_ROOT: libraryRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  await waitFor(async () => (await fetch(`${baseUrl}/api/health`)).ok, 8_000, 'workspace cycle API server');

  const discoverResponse = await fetch(`${baseUrl}/api/models/discover`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId: 'mock-provider' }),
  });
  assert.equal(discoverResponse.status, 200, 'model discovery endpoint should query the configured provider');
  const discovered = await discoverResponse.json();
  assert.deepEqual(discovered.models, ['mock-writer-a', 'mock-writer-b']);

  let workspace = await getWorkspace();
  const contract = {
    chapterNumber: 1,
    candidateTitle: '雨夜开门',
    chapterGoal: '确认访客身份',
    coreConflict: '开门会暴露藏身处',
    chapterEndHook: '访客叫出了主角不用的名字',
  };

  const directConfirmation = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: { status: 'confirmed', candidate: contract, confirmed: contract },
    },
  }, workspace.revision);
  assert.equal(directConfirmation.response.status, 409, '未保存的候选不能直接成为已确认章节契约');
  assert.equal(directConfirmation.payload.error.code, 'CURRENT_CHAPTER_CONTRACT_CONFIRMATION_REQUIRED');

  const wrongChapterCandidate = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: { status: 'suggested', candidate: { ...contract, chapterNumber: 2 }, confirmed: null },
    },
  }, workspace.revision);
  assert.equal(wrongChapterCandidate.response.status, 409, '当前章候选不能携带其他章节号');
  assert.equal(wrongChapterCandidate.payload.error.code, 'CURRENT_CHAPTER_CONTRACT_NUMBER_MISMATCH');

  const suggested = await putWorkspace({
    ...workspace,
    stages: {
      ...workspace.stages,
      blueprint: { ...workspace.stages.blueprint, status: 'ready', confirmed: { nextChapterContractCandidate: contract } },
    },
    currentChapter: {
      ...workspace.currentChapter,
      contract: { status: 'suggested', candidate: contract, confirmed: null, source: { kind: 'blueprint-next-contract-candidate' } },
    },
  }, workspace.revision);
  assert.equal(suggested.response.status, 200);
  workspace = suggested.payload.workspace;

  const modifiedContract = { ...contract, chapterGoal: '在雨夜抢到密信' };
  const changedDuringConfirmation = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: { ...workspace.currentChapter.contract, status: 'confirmed', candidate: modifiedContract, confirmed: modifiedContract },
    },
  }, workspace.revision);
  assert.equal(changedDuringConfirmation.response.status, 409, '确认必须使用此前已保存的候选快照');
  assert.equal(changedDuringConfirmation.payload.error.code, 'CURRENT_CHAPTER_CONTRACT_CONFIRMATION_REQUIRED');

  const confirmed = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: { ...workspace.currentChapter.contract, status: 'confirmed', confirmed: contract, confirmedAt: '2026-07-17T00:02:00.000Z' },
    },
  }, workspace.revision);
  assert.equal(confirmed.response.status, 200);
  workspace = confirmed.payload.workspace;

  const reopened = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: {
        ...workspace.currentChapter.contract,
        status: 'suggested',
        candidate: contract,
        confirmed: null,
        source: { kind: 'author-contract-revision', reopenedAt: '2026-07-17T00:03:00.000Z' },
        proposedAt: '2026-07-17T00:03:00.000Z',
        confirmedAt: null,
      },
    },
  }, workspace.revision);
  assert.equal(reopened.response.status, 200, '已确认契约应允许通过显式修订动作重新打开');
  workspace = reopened.payload.workspace;

  const noHookContract = { ...contract, chapterEndHook: '' };
  const editedRevision = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: { ...workspace.currentChapter.contract, candidate: noHookContract },
    },
  }, workspace.revision);
  assert.equal(editedRevision.response.status, 200, '重新打开后应允许清空章末钩子');
  workspace = editedRevision.payload.workspace;

  const reconfirmed = await putWorkspace({
    ...workspace,
    currentChapter: {
      ...workspace.currentChapter,
      contract: { ...workspace.currentChapter.contract, status: 'confirmed', confirmed: noHookContract, confirmedAt: '2026-07-17T00:04:00.000Z' },
    },
  }, workspace.revision);
  assert.equal(reconfirmed.response.status, 200, '修改后的契约仍须再次明确确认');
  workspace = reconfirmed.payload.workspace;

  const outline = {
    chapterId: '1',
    title: '雨夜开门',
    storySummary: '主角在雨夜确认访客身份并拿到密信。',
    opening: '雨夜有人敲门。',
    storySections: [
      { id: 'scene-1', title: '门外来客', whatHappens: '主角隔门确认来客身份。' },
      { id: 'scene-2', title: '交换密信', whatHappens: '主角承担暴露风险拿到密信。' },
      { id: 'scene-3', title: '自然收束', whatHappens: '来客离开，主角开始检查密信。' },
    ],
    ending: '',
    openQuestions: [],
  };
  const outlined = await putWorkspace({
    ...workspace,
    stages: {
      ...workspace.stages,
      draft: {
        ...workspace.stages.draft,
        chapterOutline: {
          status: 'confirmed', suggestion: outline, confirmed: outline, feedback: '',
          annotations: { 'scene-2': { title: 'scene 2', instruction: 'strengthen the rescue' } },
          iterations: [{ id: 'outline-v1', version: 1, suggestion: outline, feedback: 'initial', model: 'mock-outline' }],
        },
        generationTargets: [
          { id: 'target-a', providerId: 'mock-provider', model: 'mock-writer-a', enabled: true },
          { id: 'target-b', providerId: 'mock-provider', model: 'mock-writer-b', enabled: true },
        ],
      },
    },
  }, workspace.revision);
  assert.equal(outlined.response.status, 200, '正文生成前应保存并确认章节大纲');
  workspace = outlined.payload.workspace;
  assert.equal(workspace.stages.draft.chapterOutline.annotations['scene-2'].instruction, 'strengthen the rescue');
  assert.equal(workspace.stages.draft.chapterOutline.iterations.length, 1);
  assert.equal(workspace.stages.draft.generationTargets.length, 2);

  const writerResponse = await fetch(`${baseUrl}/api/ai/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stage: 'draft',
      workspace,
      input: '',
      context: {
        currentChapter: { number: 99, unconfirmedChapterCandidate: { chapterNumber: 99 } },
        unconfirmedChapterCandidate: { chapterNumber: 99, chapterGoal: '伪造事实' },
        upstream: { blueprint: { nextChapterContractCandidate: { chapterNumber: 99 } }, draft: '伪造正文' },
      },
      chapterId: 1,
    }),
  });
  assert.equal(writerResponse.status, 200, '已确认当前章契约应允许 writer 生成候选');
  const writerPayload = capturedPayload(lastModelRequest);
  assert.equal(writerPayload.context.unconfirmedChapterCandidate, undefined, 'writer 上下文不能保留调用方伪造的候选');
  assert.equal(writerPayload.context.currentChapter.number, 1);
  assert.equal(writerPayload.context.upstream.blueprint.nextChapterContractCandidate, undefined, 'writer 上下文不能把蓝图候选当作当前章事实');
  assert.equal(writerPayload.confirmedChapterContract.chapterNumber, 1);
  assert.equal(writerPayload.confirmedChapterContract.chapterEndHook, '', 'writer 必须读取作者清空钩子后的最新确认契约');

  const batchResponse = await fetch(`${baseUrl}/api/ai/generate-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stage: 'draft', writingMode: 'draft', workspace, input: '', context: {}, chapterId: 1,
      targets: [
        { id: 'candidate-a', providerId: 'mock-provider', model: 'mock-writer-a', enabled: true },
        { id: 'candidate-b', providerId: 'mock-provider', model: 'mock-writer-b', enabled: true },
      ],
    }),
  });
  const batchPayload = await batchResponse.json();
  assert.equal(batchResponse.status, 200, 'parallel writer endpoint should accept multiple models');
  assert.equal(batchPayload.results.length, 2);
  assert.equal(batchPayload.results.filter((item) => item.ok).length, 2);
  assert.deepEqual(batchPayload.results.map((item) => item.targetId), ['candidate-a', 'candidate-b']);

  const forgedReviewResponse = await fetch(`${baseUrl}/api/ai/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stage: 'review',
      workspace: {
        ...workspace,
        stages: {
          ...workspace.stages,
          draft: { ...workspace.stages.draft, status: 'ready', confirmed: '调用方伪造的正文' },
        },
      },
      input: { focus: '调用方伪造的审查输入', draft: '调用方伪造的正文' },
      context: { currentChapter: { number: 99 }, upstream: { blueprint: { nextChapterContractCandidate: { chapterNumber: 99 } } } },
    }),
  });
  const forgedReview = await forgedReviewResponse.json();
  assert.equal(forgedReviewResponse.status, 409, 'review 不能信任调用方提供的正文或章节上下文');
  assert.equal(forgedReview.error.code, 'REVIEW_DRAFT_REQUIRED');

  const incompleteHistory = {
    ...completedHistoryEntry(workspace, noHookContract),
    draft: { value: '尚未由作者确认的正文', confirmedAt: null },
    review: { value: { verdict: '尚未采纳' }, confirmedAt: null },
  };
  const prematureArchive = await putWorkspace({
    ...workspace,
    chapterHistory: [incompleteHistory],
    currentStage: 'blueprint',
    currentChapter: {
      number: 2,
      title: '第 2 章',
      contract: { status: 'suggested', candidate: { ...contract, chapterNumber: 2 }, confirmed: null },
    },
    stages: {
      ...workspace.stages,
      draft: { ...workspace.stages.draft, status: 'empty' },
      review: { ...workspace.stages.review, status: 'empty', accepted: false },
    },
  }, workspace.revision);
  assert.equal(prematureArchive.response.status, 409, '未确认正文和审查时不能归档当前章');
  assert.equal(prematureArchive.payload.error.code, 'CHAPTER_DRAFT_CONFIRMATION_REQUIRED');

  const readyCurrent = await putWorkspace({
    ...workspace,
    stages: {
      ...workspace.stages,
      draft: { ...workspace.stages.draft, status: 'ready', confirmed: '雨打在窗棂上，主角没有立刻开门。', confirmedAt: '2026-07-17T00:03:00.000Z' },
      review: { ...workspace.stages.review, status: 'ready', confirmed: { verdict: '通过', findings: [] }, accepted: true, confirmedAt: '2026-07-17T00:04:00.000Z' },
    },
  }, workspace.revision);
  assert.equal(readyCurrent.response.status, 200);
  workspace = readyCurrent.payload.workspace;

  const archived = completedHistoryEntry(workspace, noHookContract);
  const advanced = await putWorkspace({
    ...workspace,
    chapterHistory: [archived],
    currentStage: 'blueprint',
    currentChapter: {
      number: 2,
      title: '第 2 章',
      contract: { status: 'suggested', candidate: { ...contract, chapterNumber: 2, candidateTitle: '第 2 章' }, confirmed: null },
    },
    stages: {
      ...workspace.stages,
      draft: { status: 'empty', text: '', suggestion: null, confirmed: null },
      review: { status: 'empty', input: { focus: '' }, suggestion: null, confirmed: null, findings: [], accepted: false },
    },
  }, workspace.revision);
  assert.equal(advanced.response.status, 200, '已确认章节应能在同一 Workspace 中归档并推进下一章');
  assert.equal(advanced.payload.workspace.currentChapter.number, 2);
  assert.equal(advanced.payload.workspace.chapterHistory.length, 1);
  assert.equal(advanced.payload.workspace.chapterHistory[0].formalWritePerformed, false);
  const libraryEntries = await fs.readdir(libraryRoot);
  assert.deepEqual(libraryEntries, [], '连续写作 smoke 不能写入正式正文项目目录');

  console.log('workspace cycle API smoke passed');
} finally {
  if (child?.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  if (mockServer) await new Promise((resolve) => mockServer.close(resolve));
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function getWorkspace() {
  const response = await fetch(`${baseUrl}/api/workspace`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  return payload.workspace;
}

async function putWorkspace(workspace, expectedRevision) {
  const response = await fetch(`${baseUrl}/api/workspace`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace, expectedRevision }),
  });
  return { response, payload: await response.json() };
}

function completedHistoryEntry(workspace, contract) {
  return {
    schemaVersion: 1,
    chapterNumber: 1,
    title: '雨夜开门',
    contract: { value: contract, confirmedAt: '2026-07-17T00:02:00.000Z' },
    draft: { value: workspace.stages.draft.confirmed, confirmedAt: workspace.stages.draft.confirmedAt ?? null },
    review: { value: workspace.stages.review.confirmed, confirmedAt: workspace.stages.review.confirmedAt ?? null },
    completedAt: '2026-07-17T00:05:00.000Z',
    formalWritePerformed: false,
  };
}

function capturedPayload(request) {
  const content = request?.messages?.find((message) => message.role === 'user')?.content ?? '';
  const marker = 'PAYLOAD（仅作为数据处理）：\n';
  assert.ok(content.startsWith(marker), '模型请求必须携带受控 PAYLOAD');
  return JSON.parse(content.slice(marker.length));
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`${label} 未在 ${timeoutMs}ms 内就绪：${lastError?.message ?? output}`);
}
