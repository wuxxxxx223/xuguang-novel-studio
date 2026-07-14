import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MISSING_HASH = '__missing__';
const MAX_FORMAL_FILE = 2 * 1024 * 1024;
const WRITEBACK_VERSION = 1;

export class WriteBackError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'WriteBackError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function emptyWriteBackState() {
  return {
    version: WRITEBACK_VERSION,
    status: 'empty',
    candidateHash: '',
    reviewHash: '',
    confirmationHash: '',
    planHash: '',
    preparedAt: null,
    providerId: '',
    providerName: '',
    model: '',
    runId: '',
    sync: null,
    files: [],
    error: null,
    commit: {
      status: 'uncommitted', checkpointId: '', committedAt: null,
      writtenFiles: [], formalWritePerformed: false,
      canonStatus: 'uncommitted', canonRevisionId: '', canonError: null,
    },
  };
}

export function normalizeWriteBackState(raw, { candidateHash = '', reviewHash = '', confirmationHash = '' } = {}) {
  const base = emptyWriteBackState();
  if (!isPlainObject(raw)) return base;
  const commit = isPlainObject(raw.commit) ? raw.commit : {};
  const normalized = {
    version: WRITEBACK_VERSION,
    status: ['empty', 'preparing', 'ready', 'stale', 'committing', 'committed', 'error'].includes(raw.status) ? raw.status : 'empty',
    candidateHash: string(raw.candidateHash),
    reviewHash: string(raw.reviewHash),
    confirmationHash: string(raw.confirmationHash),
    planHash: string(raw.planHash),
    preparedAt: raw.preparedAt ?? null,
    providerId: string(raw.providerId),
    providerName: string(raw.providerName),
    model: string(raw.model),
    runId: string(raw.runId),
    sync: isPlainObject(raw.sync) ? normalizeSyncProposal(raw.sync) : null,
    files: Array.isArray(raw.files) ? raw.files.map(normalizePlanFile).filter(Boolean) : [],
    error: raw.error ? string(raw.error).slice(0, 1000) : null,
    commit: {
      status: commit.status === 'committed' ? 'committed' : 'uncommitted',
      checkpointId: string(commit.checkpointId),
      committedAt: commit.committedAt ?? null,
      writtenFiles: Array.isArray(commit.writtenFiles) ? commit.writtenFiles.map(string).filter(Boolean).slice(0, 100) : [],
      formalWritePerformed: commit.formalWritePerformed === true,
      canonStatus: ['uncommitted', 'committed', 'pending'].includes(commit.canonStatus) ? commit.canonStatus : (commit.canonRevisionId ? 'committed' : 'uncommitted'),
      canonRevisionId: string(commit.canonRevisionId),
      canonError: commit.canonError ? cleanText(commit.canonError, 1000) : null,
    },
  };
  if (normalized.commit.status === 'committed') {
    normalized.status = 'committed';
    return normalized;
  }
  if (normalized.status === 'ready' && (
    !candidateHash || normalized.candidateHash !== candidateHash
    || !reviewHash || normalized.reviewHash !== reviewHash
    || !confirmationHash || normalized.confirmationHash !== confirmationHash
  )) normalized.status = 'stale';
  if (normalized.status === 'preparing' || normalized.status === 'committing') normalized.status = 'error';
  return normalized;
}

export function computeReviewHash(review) {
  return hashText(JSON.stringify({ candidateHash: review?.candidateHash ?? '', result: review?.result ?? null }));
}

export function normalizeSyncProposal(raw) {
  const input = isPlainObject(raw) ? raw : {};
  return {
    chapterTitle: cleanLine(input.chapterTitle, 120),
    chapterSummary: cleanText(input.chapterSummary, 1200),
    characterUpdates: normalizeUpdates(input.characterUpdates, ['name', 'state', 'change']),
    foreshadowingUpdates: normalizeUpdates(input.foreshadowingUpdates, ['thread', 'status', 'change']),
    timelineEvent: cleanText(input.timelineEvent, 1200),
    contextUpdate: cleanText(input.contextUpdate, 2400),
    nextChapterTarget: cleanText(input.nextChapterTarget, 1200),
  };
}

export async function buildWriteBackPlan({ dataDir, libraryRoot, dashboard, chapterWorkspace, sync, modelMeta = {} }) {
  assertWriteBackReady(chapterWorkspace);
  const projectRoot = await resolveProjectRoot(libraryRoot, dashboard?.project?.directoryName);
  const chapter = Number(dashboard?.chapter?.number);
  if (!Number.isInteger(chapter) || chapter < 1) throw new WriteBackError(400, 'INVALID_CHAPTER_NUMBER', '当前章节号无效。');
  const normalizedSync = normalizeSyncProposal(sync);
  if (!normalizedSync.chapterSummary) throw new WriteBackError(502, 'SYNC_PROPOSAL_INVALID', '同步模型没有返回章节摘要。');
  if (!normalizedSync.timelineEvent) normalizedSync.timelineEvent = normalizedSync.chapterSummary;
  if (!normalizedSync.contextUpdate) normalizedSync.contextUpdate = normalizedSync.chapterSummary;
  if (!normalizedSync.nextChapterTarget) normalizedSync.nextChapterTarget = `先补第 ${chapter + 1} 章章节契约，再开始下一章候选稿。`;

  const reviewHash = computeReviewHash(chapterWorkspace.review);
  const confirmationHash = chapterWorkspace.confirmation.candidateHash;
  const candidateHash = chapterWorkspace.candidate.contentHash;
  const preparedAt = new Date().toISOString();
  const date = formatShanghaiDate(new Date());
  const chapterTitle = normalizedSync.chapterTitle || stripChapterPrefix(chapterWorkspace.candidate.title) || `第${chapter}章`;
  const chapterFile = chapterFilename(chapter, chapterTitle);
  const targetChapterPath = `正文/${chapterFile}`;
  const existingChapter = await readFormalFile(projectRoot, targetChapterPath);
  if (existingChapter.exists) {
    throw new WriteBackError(409, 'FORMAL_CHAPTER_ALREADY_EXISTS', `${targetChapterPath} 已存在；为避免覆盖正式正文，当前写回被阻塞。`, { relativePath: targetChapterPath });
  }

  const source = {};
  for (const relativePath of [
    '追踪/progress.json', '追踪/今日工作台.md', '追踪/上下文.md', '追踪/角色状态.md',
    '追踪/伏笔.md', '追踪/时间线.md', '追踪/章节摘要.jsonl', '追踪/诊断.md', '追踪/checkpoints.jsonl',
  ]) source[relativePath] = await readFormalFile(projectRoot, relativePath);

  const progress = parseProgress(source['追踪/progress.json'].text);
  const nextChapter = chapter + 1;
  const completed = [...new Set([...(Array.isArray(progress.completed_chapters) ? progress.completed_chapters : []), chapter]
    .map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const nextContract = `大纲/章节契约/第${String(nextChapter).padStart(3, '0')}章.md`;
  const nextProgress = {
    ...progress,
    schema_version: Number(progress.schema_version) || 1,
    book: progress.book || dashboard.project.title,
    status: 'active',
    current_phase: 'planning',
    current_chapter: nextChapter,
    completed_chapters: completed,
    next_step: `先读追踪/今日工作台.md，并补齐 ${nextContract}；没有章节契约前不写正式正文。`,
    source_of_truth: {
      ...(isPlainObject(progress.source_of_truth) ? progress.source_of_truth : {}),
      chapter_contract: nextContract,
      workbench: '追踪/今日工作台.md',
    },
    updated_at: date,
  };

  const reviewFindings = Array.isArray(chapterWorkspace.review?.result?.findings) ? chapterWorkspace.review.result.findings : [];
  const checkpointSeq = nextCheckpointSeq(source['追踪/checkpoints.jsonl'].text);
  const checkpointDigest = `第${chapter}章《${chapterTitle}》由作者确认候选晋升为正式正文；同步 progress、今日工作台、上下文、角色、伏笔、时间线、章节摘要与诊断。`;
  const chapterText = String(chapterWorkspace.candidate.text);
  const todayText = buildTodayWorkbench({ dashboard, chapter, chapterTitle, nextChapter, nextContract, sync: normalizedSync, date });
  const contextText = appendSection(source['追踪/上下文.md'].text, `第${chapter}章完成同步 · ${date}`, [
    `- 正式章节：${targetChapterPath}`,
    `- 本章摘要：${normalizedSync.chapterSummary}`,
    `- 状态变化：${normalizedSync.contextUpdate}`,
    `- 下一章目标：${normalizedSync.nextChapterTarget}`,
  ]);
  const characterText = appendSection(source['追踪/角色状态.md'].text, `第${chapter}章角色状态更新 · ${date}`,
    normalizedSync.characterUpdates.length
      ? normalizedSync.characterUpdates.map((item) => `- **${item.name || '未命名角色'}**：${item.state || item.change}${item.state && item.change ? `；${item.change}` : ''}`)
      : ['- 本章未提取到需要写入长期账本的明确角色状态变化。']);
  const foreshadowingText = appendSection(source['追踪/伏笔.md'].text, `第${chapter}章伏笔同步 · ${date}`,
    normalizedSync.foreshadowingUpdates.length
      ? normalizedSync.foreshadowingUpdates.map((item) => `- **${item.thread || '未命名伏笔'}**（${item.status || '推进'}）：${item.change || '本章发生推进'}`)
      : ['- 本章未新增、推进或回收需要单独登记的长期伏笔。']);
  const timelineText = appendSection(source['追踪/时间线.md'].text, `第${chapter}章已发生 · ${date}`, [`- ${normalizedSync.timelineEvent}`]);
  const summaryRecord = JSON.stringify({ chapter, title: chapterTitle, summary: normalizedSync.chapterSummary }, null, 0);
  const summaryText = appendJsonLine(source['追踪/章节摘要.jsonl'].text, summaryRecord);
  const diagnosticsText = appendSection(source['追踪/诊断.md'].text, `第${chapter}章确认版本审查归档 · ${date}`,
    reviewFindings.length
      ? reviewFindings.map((finding) => `- **${severityOf(finding)} · ${cleanLine(finding?.category, 120) || '未分类'}**：${cleanText(finding?.impact || finding?.evidence || finding?.suggestion, 800) || '未提供说明'}`)
      : ['- 当前确认版本没有审查 Finding；P0 = 0。']);
  const checkpointRecord = JSON.stringify({
    seq: checkpointSeq, time: date, scope: `ch${String(chapter).padStart(3, '0')}`,
    step: 'formal_writeback', artifact: targetChapterPath,
    digest: checkpointDigest,
  });
  const checkpointsText = appendJsonLine(source['追踪/checkpoints.jsonl'].text, checkpointRecord);

  const desired = [
    [targetChapterPath, 'canon', 'create', chapterText, '创建作者已确认的正式章节；同步模型未改写正文'],
    ['追踪/progress.json', 'tracking', 'update', `${JSON.stringify(nextProgress, null, 2)}\n`, `完成第${chapter}章并把当前任务推进到第${nextChapter}章`],
    ['追踪/今日工作台.md', 'tracking', 'update', todayText, `切换为第${nextChapter}章准备任务`],
    ['追踪/上下文.md', 'tracking', 'append', contextText, '追加本章完成恢复包'],
    ['追踪/角色状态.md', 'tracking', 'append', characterText, `追加 ${normalizedSync.characterUpdates.length} 条角色状态变化`],
    ['追踪/伏笔.md', 'tracking', 'append', foreshadowingText, `追加 ${normalizedSync.foreshadowingUpdates.length} 条伏笔变化`],
    ['追踪/时间线.md', 'tracking', 'append', timelineText, '追加本章已发生事件'],
    ['追踪/章节摘要.jsonl', 'tracking', 'append', summaryText, '追加一条结构化章节摘要'],
    ['追踪/诊断.md', 'tracking', 'append', diagnosticsText, `归档 ${reviewFindings.length} 项只读 Finding`],
    ['追踪/checkpoints.jsonl', 'runtime', 'append', checkpointsText, `追加 seq=${checkpointSeq} 正式写回记录`],
  ];
  const files = desired.map(([relativePath, layer, action, afterText, summary]) => {
    const before = relativePath === targetChapterPath ? existingChapter : source[relativePath];
    return buildPlanFile({ relativePath, layer, action, before, afterText, summary });
  });
  const planBase = {
    version: WRITEBACK_VERSION,
    status: 'ready',
    candidateHash,
    reviewHash,
    confirmationHash,
    preparedAt,
    providerId: string(modelMeta.providerId),
    providerName: string(modelMeta.providerName),
    model: string(modelMeta.model),
    runId: string(modelMeta.runId),
    sync: normalizedSync,
    files,
  };
  const planHash = hashPlan(planBase);
  return {
    ...planBase,
    planHash,
    error: null,
    commit: emptyWriteBackState().commit,
    formalWritePerformed: false,
  };
}

export async function checkWriteBackPlanSources({ libraryRoot, dashboard, plan }) {
  const projectRoot = await resolveProjectRoot(libraryRoot, dashboard?.project?.directoryName);
  const conflicts = [];
  for (const file of plan.files ?? []) {
    const current = await readFormalFile(projectRoot, file.relativePath);
    const currentHash = current.exists ? hashText(current.text) : MISSING_HASH;
    if (currentHash !== file.beforeHash) conflicts.push({ relativePath: file.relativePath, expectedHash: file.beforeHash, currentHash });
  }
  return conflicts;
}

export async function commitWriteBackPlan({ dataDir, libraryRoot, dashboard, chapterWorkspace, plan }) {
  assertWriteBackReady(chapterWorkspace);
  if (!isPlainObject(plan) || plan.status !== 'ready') throw new WriteBackError(409, 'WRITEBACK_PLAN_NOT_READY', '请先生成并核对写回差异预览。');
  const candidateHash = chapterWorkspace.candidate.contentHash;
  const reviewHash = computeReviewHash(chapterWorkspace.review);
  const confirmationHash = chapterWorkspace.confirmation.candidateHash;
  if (plan.candidateHash !== candidateHash || plan.reviewHash !== reviewHash || plan.confirmationHash !== confirmationHash) {
    throw new WriteBackError(409, 'WRITEBACK_PLAN_STALE', '候选、审查或确认版本已经变化，请重新生成写回预览。');
  }
  if (hashPlan(plan) !== plan.planHash) throw new WriteBackError(409, 'WRITEBACK_PLAN_HASH_MISMATCH', '写回计划哈希不匹配，请重新生成预览。');
  const conflicts = await checkWriteBackPlanSources({ libraryRoot, dashboard, plan });
  if (conflicts.length) throw new WriteBackError(409, 'FORMAL_SOURCE_CONFLICT', '正式文件在预览后发生变化，已拒绝写入。', { conflicts });

  const projectRoot = await resolveProjectRoot(libraryRoot, dashboard?.project?.directoryName);
  const checkpointRoot = path.join(path.resolve(dataDir), 'writeback-checkpoints');
  await fs.mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  const checkpointId = `${formatCheckpointTime(new Date())}-${crypto.randomUUID().slice(0, 8)}`;
  const checkpointDir = path.join(checkpointRoot, safeSegment(dashboard.project.id), checkpointId);
  const backupDir = path.join(checkpointDir, 'before');
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const manifest = {
    version: 1, checkpointId, projectId: dashboard.project.id, projectTitle: dashboard.project.title,
    chapter: dashboard.chapter.number, planHash: plan.planHash, status: 'prepared',
    createdAt: new Date().toISOString(), committedAt: null, rolledBackAt: null,
    files: [],
  };
  for (let index = 0; index < plan.files.length; index += 1) {
    const file = plan.files[index];
    const before = await readFormalFile(projectRoot, file.relativePath);
    const snapshotName = before.exists ? `${String(index + 1).padStart(2, '0')}.bin` : null;
    if (snapshotName) await fs.writeFile(path.join(backupDir, snapshotName), before.text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    manifest.files.push({
      relativePath: file.relativePath, beforeExists: before.exists, beforeHash: file.beforeHash,
      afterHash: file.afterHash, snapshot: snapshotName,
    });
  }
  await writeJsonAtomic(path.join(checkpointDir, 'manifest.json'), manifest);
  await writeJsonAtomic(path.join(checkpointDir, 'plan.json'), { ...plan, files: plan.files.map(({ beforeText, afterText, ...rest }) => rest) });

  const staged = [];
  try {
    for (let index = 0; index < plan.files.length; index += 1) {
      const file = plan.files[index];
      const target = await resolveFormalTarget(projectRoot, file.relativePath);
      const targetStat = await lstatOrNull(target);
      const token = crypto.randomUUID();
      const temp = path.join(path.dirname(target), `.${path.basename(target)}.${token}.writeback.tmp`);
      const old = targetStat ? path.join(path.dirname(target), `.${path.basename(target)}.${token}.writeback.old`) : null;
      await fs.writeFile(temp, file.afterText, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const record = { target, temp, old, existed: Boolean(targetStat), applied: false, oldMoved: false };
      staged.push(record);
      if (targetStat) {
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new WriteBackError(409, 'UNSAFE_FORMAL_TARGET', `${file.relativePath} 不是可安全替换的普通文件。`);
        await fs.rename(target, old);
        record.oldMoved = true;
      }
      await fs.rename(temp, target);
      record.applied = true;
    }
    for (const record of staged) if (record.old) await fs.unlink(record.old).catch(() => {});
    manifest.status = 'committed';
    manifest.committedAt = new Date().toISOString();
    await writeJsonAtomic(path.join(checkpointDir, 'manifest.json'), manifest);
  } catch (error) {
    const rollbackErrors = [];
    for (const record of [...staged].reverse()) {
      try {
        if (record.applied) await fs.unlink(record.target).catch(() => {});
        if (record.oldMoved && record.old) await fs.rename(record.old, record.target);
        await fs.unlink(record.temp).catch(() => {});
      } catch (rollbackError) { rollbackErrors.push(String(rollbackError?.message || rollbackError)); }
    }
    manifest.status = rollbackErrors.length ? 'rollback_failed' : 'rolled_back';
    manifest.rolledBackAt = new Date().toISOString();
    manifest.error = String(error?.message || error).slice(0, 1000);
    manifest.rollbackErrors = rollbackErrors;
    await writeJsonAtomic(path.join(checkpointDir, 'manifest.json'), manifest).catch(() => {});
    if (rollbackErrors.length) throw new WriteBackError(500, 'FORMAL_WRITE_ROLLBACK_FAILED', '正式写入失败且自动回滚不完整，请立即检查 checkpoint。', { checkpointId, rollbackErrors });
    throw new WriteBackError(error?.status || 500, error?.code || 'FORMAL_WRITE_FAILED', `正式写入失败，已从 checkpoint 自动回滚：${error?.message || '未知错误'}`, { checkpointId });
  }
  return {
    checkpointId,
    checkpointDir,
    committedAt: manifest.committedAt,
    writtenFiles: plan.files.map((file) => file.relativePath),
    formalWritePerformed: true,
  };
}

export function assertWriteBackReady(workspace) {
  if (!workspace?.candidate?.text?.trim()) throw new WriteBackError(409, 'CANDIDATE_DRAFT_REQUIRED', '请先完成候选正文。');
  if (workspace.review?.status !== 'ready' || workspace.review?.candidateHash !== workspace.candidate.contentHash) {
    throw new WriteBackError(409, 'CURRENT_REVIEW_REQUIRED', '请先对当前候选版本完成只读审查。');
  }
  const p0 = (workspace.review?.result?.findings ?? []).filter((item) => severityOf(item) === 'P0').length;
  if (p0) throw new WriteBackError(409, 'P0_FINDINGS_BLOCK_WRITEBACK', `仍有 ${p0} 项 P0 Finding，不能准备正式写回。`);
  if (workspace.confirmation?.status !== 'confirmed' || workspace.confirmation?.candidateHash !== workspace.candidate.contentHash) {
    throw new WriteBackError(409, 'CANDIDATE_CONFIRMATION_REQUIRED', '请先由作者确认当前候选版本。');
  }
}

function normalizePlanFile(raw) {
  if (!isPlainObject(raw)) return null;
  const relativePath = normalizeRelativePath(raw.relativePath);
  if (!relativePath) return null;
  const beforeText = string(raw.beforeText);
  const afterText = string(raw.afterText);
  return {
    relativePath,
    layer: ['canon', 'tracking', 'runtime'].includes(raw.layer) ? raw.layer : 'tracking',
    action: ['create', 'update', 'append'].includes(raw.action) ? raw.action : 'update',
    beforeExists: raw.beforeExists === true,
    beforeHash: string(raw.beforeHash),
    afterHash: string(raw.afterHash),
    beforeText,
    afterText,
    beforeChars: Number.isInteger(raw.beforeChars) ? raw.beforeChars : beforeText.length,
    afterChars: Number.isInteger(raw.afterChars) ? raw.afterChars : afterText.length,
    addedLines: Number.isInteger(raw.addedLines) ? raw.addedLines : 0,
    removedLines: Number.isInteger(raw.removedLines) ? raw.removedLines : 0,
    summary: cleanText(raw.summary, 800),
  };
}

function buildPlanFile({ relativePath, layer, action, before, afterText, summary }) {
  const beforeText = before.exists ? before.text : '';
  const stats = lineStats(beforeText, afterText);
  return {
    relativePath, layer, action,
    beforeExists: before.exists,
    beforeHash: before.exists ? hashText(beforeText) : MISSING_HASH,
    afterHash: hashText(afterText),
    beforeText, afterText,
    beforeChars: beforeText.length,
    afterChars: afterText.length,
    ...stats,
    summary,
  };
}

function hashPlan(plan) {
  return hashText(JSON.stringify({
    version: plan.version,
    candidateHash: plan.candidateHash,
    reviewHash: plan.reviewHash,
    confirmationHash: plan.confirmationHash,
    runId: plan.runId,
    sync: plan.sync,
    files: (plan.files ?? []).map((file) => ({
      relativePath: file.relativePath, layer: file.layer, action: file.action,
      beforeHash: file.beforeHash, afterHash: file.afterHash,
    })),
  }));
}

async function resolveProjectRoot(libraryRoot, directoryName) {
  const root = await fs.realpath(path.resolve(libraryRoot));
  const segment = safeSegment(directoryName);
  const candidate = path.join(root, segment);
  const real = await fs.realpath(candidate).catch(() => null);
  if (!real || !isInside(root, real)) throw new WriteBackError(404, 'PROJECT_NOT_FOUND', '未找到可安全写入的小说项目。');
  const stat = await fs.lstat(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WriteBackError(409, 'UNSAFE_PROJECT_ROOT', '小说项目根目录不是安全的普通目录。');
  return real;
}

async function resolveFormalTarget(projectRoot, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || !/^(正文|追踪)\//.test(normalized)) throw new WriteBackError(400, 'INVALID_FORMAL_PATH', `不允许写入路径：${relativePath}`);
  const target = path.resolve(projectRoot, ...normalized.split('/'));
  if (!isInside(projectRoot, target)) throw new WriteBackError(400, 'INVALID_FORMAL_PATH', `路径越界：${relativePath}`);
  const parent = path.dirname(target);
  const parentReal = await fs.realpath(parent).catch(() => null);
  if (!parentReal || !isInside(projectRoot, parentReal)) throw new WriteBackError(409, 'UNSAFE_FORMAL_PARENT', `${relativePath} 的父目录不安全。`);
  const parentStat = await fs.lstat(parentReal);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new WriteBackError(409, 'UNSAFE_FORMAL_PARENT', `${relativePath} 的父目录不是普通目录。`);
  return target;
}

async function readFormalFile(projectRoot, relativePath) {
  const target = await resolveFormalTarget(projectRoot, relativePath);
  const stat = await lstatOrNull(target);
  if (!stat) return { exists: false, text: '' };
  if (!stat.isFile() || stat.isSymbolicLink()) throw new WriteBackError(409, 'UNSAFE_FORMAL_SOURCE', `${relativePath} 不是普通文件。`);
  if (stat.size > MAX_FORMAL_FILE) throw new WriteBackError(413, 'FORMAL_FILE_TOO_LARGE', `${relativePath} 超过写回预览读取上限。`);
  return { exists: true, text: await fs.readFile(target, 'utf8') };
}

function buildTodayWorkbench({ dashboard, chapter, chapterTitle, nextChapter, nextContract, sync, date }) {
  const risks = Array.isArray(dashboard.risks) ? dashboard.risks : [];
  const riskRows = risks.length
    ? risks.map((risk) => `| ${risk.severity || 'P2'} | ${String(risk.label || '').replace(/\|/g, '／')} | 进入下一章前重新裁决 |`).join('\n')
    : '| - | 当前没有继承风险 | 下一章契约阶段继续检查 |';
  return ensureTrailingNewline(`# 今日工作台 ·《${dashboard.project.title}》

> 本页由第${chapter}章正式写回同步生成。打开项目先读这里，再进入下一章契约。

## 顶部状态

- 当前书：${dashboard.project.title}
- 已完成：第${chapter}章《${chapterTitle}》
- 当前章：第${nextChapter}章
- 当前阶段：待建立章节契约
- 当前弧：${dashboard.progress.currentArc || dashboard.progress.currentVolume || '待补充'}
- 下一步：补齐 \`${nextContract}\`
- 同步日期：${date}

## 上一章结果

- ${sync.chapterSummary}
- 状态变化：${sync.contextUpdate}

## 当前主任务

${sync.nextChapterTarget}

必须先完成：

- 读取 \`追踪/上下文.md\`、\`追踪/角色状态.md\`、\`追踪/伏笔.md\`、\`追踪/时间线.md\`。
- 补齐并确认 \`${nextContract}\`。
- 没有章节契约前，不生成或写入第${nextChapter}章正式正文。
- 新章仍须遵守冲突前置、明确爽点/反转和章末钩子。

## 今日任务清单

| 状态 | 任务 | 文件 |
|---|---|---|
| 完成 | 第${chapter}章定稿并同步追踪 | \`正文/${chapterFilename(chapter, chapterTitle)}\` |
| 待办 | 恢复第${nextChapter}章上下文 | \`追踪/上下文.md\` |
| 待办 | 建立第${nextChapter}章契约 | \`${nextContract}\` |
| 待办 | 写第${nextChapter}章候选稿 | 网页侧车账本 |
| 待办 | 只读审查与作者确认 | 网页审查流 |

## 风险

| 优先级 | 风险 | 处理 |
|---|---|---|
${riskRows}

## 命令式下一步

先补第${nextChapter}章契约；不要在契约缺失时直接写正式正文。
`);
}

function appendSection(existing, heading, lines) {
  const base = String(existing ?? '').trimEnd();
  const body = Array.isArray(lines) ? lines.filter(Boolean).join('\n') : String(lines ?? '');
  return `${base}${base ? '\n\n' : ''}## ${heading}\n\n${body.trim()}\n`;
}

function appendJsonLine(existing, line) {
  const base = String(existing ?? '').trimEnd();
  return `${base}${base ? '\n' : ''}${line}\n`;
}

function parseProgress(text) {
  try {
    const value = JSON.parse(String(text || '{}'));
    if (!isPlainObject(value)) throw new Error('not object');
    return value;
  } catch {
    throw new WriteBackError(409, 'PROGRESS_JSON_INVALID', '追踪/progress.json 不是合法 JSON，不能安全生成写回计划。');
  }
}

function nextCheckpointSeq(text) {
  let max = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const value = JSON.parse(line); if (Number.isInteger(value?.seq)) max = Math.max(max, value.seq); } catch {}
  }
  return max + 1;
}

function normalizeUpdates(value, fields) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((item) => {
    if (typeof item === 'string') return { [fields[0]]: cleanLine(item, 160), [fields[1]]: '', [fields[2]]: '' };
    if (!isPlainObject(item)) return null;
    return Object.fromEntries(fields.map((field) => [field, cleanText(item[field], 600)]));
  }).filter((item) => item && Object.values(item).some(Boolean));
}

function chapterFilename(chapter, title) {
  const clean = sanitizeFilename(stripChapterPrefix(title));
  return clean ? `第${chapter}章 ${clean}.md` : `第${chapter}章.md`;
}

function stripChapterPrefix(value) {
  return cleanLine(value, 160).replace(/^第\s*\d+\s*章[：:\s·-]*/u, '').trim();
}

function sanitizeFilename(value) {
  return cleanLine(value, 120).replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
}

function severityOf(finding) {
  const value = String(finding?.severity ?? finding?.priority ?? 'P2').toUpperCase();
  return ['P0', 'P1', 'P2'].includes(value) ? value : 'P2';
}

function lineStats(beforeText, afterText) {
  const before = String(beforeText).split(/\r?\n/);
  const after = String(afterText).split(/\r?\n/);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return { removedLines: Math.max(0, before.length - prefix - suffix), addedLines: Math.max(0, after.length - prefix - suffix) };
}

function normalizeRelativePath(value) {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return normalized;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeSegment(value) {
  const segment = String(value ?? '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) throw new WriteBackError(400, 'INVALID_PATH_SEGMENT', '项目路径标识无效。');
  return segment;
}

async function lstatOrNull(file) {
  try { return await fs.lstat(file); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function writeJsonAtomic(file, value) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    const stat = await lstatOrNull(file);
    if (!stat) await fs.rename(temp, file);
    else {
      const old = `${file}.${crypto.randomUUID()}.old`;
      await fs.rename(file, old);
      try { await fs.rename(temp, file); await fs.unlink(old).catch(() => {}); }
      catch (error) { await fs.rename(old, file).catch(() => {}); throw error; }
    }
  } finally { await fs.unlink(temp).catch(() => {}); }
}

function cleanLine(value, max = 240) { return cleanText(value, max).replace(/\s+/g, ' ').trim(); }
function cleanText(value, max = 1200) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max); }
function ensureTrailingNewline(value) {
  const text = String(value ?? '');
  return text.endsWith('\n') ? text : `${text}\n`;
}
function string(value) { return String(value ?? ''); }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hashText(value) { return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex'); }
function formatShanghaiDate(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function formatCheckpointTime(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}
