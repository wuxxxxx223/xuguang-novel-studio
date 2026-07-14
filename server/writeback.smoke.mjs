import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWriteBackPlan, checkWriteBackPlanSources, commitWriteBackPlan } from './writeback.mjs';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, '..');
const testRoot = path.join(appRoot, '.data', 'writeback-smoke');
await fs.mkdir(testRoot, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(testRoot, 'run-'));

function hashText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function write(relativePath, text) {
  const target = path.join(projectRoot, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text, 'utf8');
}

async function snapshotFormal() {
  const paths = [
    '追踪/progress.json', '追踪/今日工作台.md', '追踪/上下文.md', '追踪/角色状态.md',
    '追踪/伏笔.md', '追踪/时间线.md', '追踪/章节摘要.jsonl', '追踪/诊断.md', '追踪/checkpoints.jsonl',
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (relativePath) => [relativePath, await fs.readFile(path.join(projectRoot, ...relativePath.split('/')), 'utf8')])));
}

const libraryRoot = path.join(runRoot, 'library');
const dataDir = path.join(runRoot, 'data');
const directoryName = '测试仙书';
const projectRoot = path.join(libraryRoot, directoryName);
await Promise.all([
  fs.mkdir(path.join(projectRoot, '正文'), { recursive: true }),
  fs.mkdir(path.join(projectRoot, '追踪'), { recursive: true }),
  fs.mkdir(path.join(projectRoot, '设定'), { recursive: true }),
  fs.mkdir(path.join(projectRoot, '大纲', '章节契约'), { recursive: true }),
  fs.mkdir(dataDir, { recursive: true }),
]);

await write('追踪/progress.json', JSON.stringify({
  schema_version: 1,
  book: '测试仙书',
  status: 'active',
  current_phase: 'writing',
  current_chapter: 4,
  completed_chapters: [1, 2, 3],
  updated_at: '2026-07-12',
}, null, 2) + '\n');
await write('追踪/今日工作台.md', '# 今日工作台 ·《测试仙书》\n\n- 当前章：第4章\n');
await write('追踪/上下文.md', '# 上下文\n');
await write('追踪/角色状态.md', '# 角色状态\n');
await write('追踪/伏笔.md', '# 伏笔\n');
await write('追踪/时间线.md', '# 时间线\n');
await write('追踪/章节摘要.jsonl', '{"chapter":3,"summary":"前三章完成"}\n');
await write('追踪/诊断.md', '# 诊断\n');
await write('追踪/checkpoints.jsonl', '{"seq":3,"scope":"ch003"}\n');

const candidateText = '# 第4章 山门来客\n\n候选正文末尾的两个空格必须保留  ';
const candidateHash = hashText(candidateText);
const chapterWorkspace = {
  candidate: { title: '第4章 山门来客', text: candidateText, contentHash: candidateHash },
  review: {
    status: 'ready',
    candidateHash,
    result: { findings: [{ severity: 'P1', category: '节奏', impact: '中段仍可更紧，但不阻塞正式写回。' }] },
  },
  confirmation: { status: 'confirmed', candidateHash },
};
const dashboard = {
  project: { id: 'smoke-project', title: '测试仙书', directoryName },
  progress: { currentArc: '山门危机', currentVolume: '第一卷' },
  chapter: { number: 4, title: '第4章 山门来客' },
  risks: [{ severity: 'P1', label: '来客身份待裁决' }],
};
const sync = {
  chapterTitle: '山门来客',
  chapterSummary: '林渊继续藏拙，同时发现来客在试探山门底牌。',
  characterUpdates: [{ name: '林渊', state: '继续隐藏境界', change: '确认来客目的不纯' }],
  foreshadowingUpdates: [{ thread: '神秘来客', status: '新增', change: '留下与上界有关的令牌线索' }],
  timelineEvent: '来客抵达山门，林渊暗中完成第一次试探。',
  contextUpdate: '林渊仍未暴露真实修为，宗门警戒提升。',
  nextChapterTarget: '先建立第5章契约，明确来客试探与第一次反制。',
};

const before = await snapshotFormal();
const plan = await buildWriteBackPlan({ dataDir, libraryRoot, dashboard, chapterWorkspace, sync, modelMeta: { providerId: 'smoke', providerName: 'Smoke', model: 'fixture' } });
assert.equal(plan.status, 'ready');
assert.equal(plan.files.length, 10);
assert.equal(plan.formalWritePerformed, false);
assert.equal(plan.files.find((file) => file.layer === 'canon').afterText, candidateText, '正式正文必须逐字等于已确认候选');
assert.deepEqual(await snapshotFormal(), before, '生成预览不得修改任何正式文件');
assert.deepEqual(await fs.readdir(path.join(projectRoot, '正文')), [], '生成预览不得创建正式章节');
assert.deepEqual(await checkWriteBackPlanSources({ libraryRoot, dashboard, plan }), []);

await fs.appendFile(path.join(projectRoot, '追踪', '角色状态.md'), '\n外部编辑：预览后变更\n', 'utf8');
await assert.rejects(
  () => commitWriteBackPlan({ dataDir, libraryRoot, dashboard, chapterWorkspace, plan }),
  (error) => error?.code === 'FORMAL_SOURCE_CONFLICT' && error?.status === 409,
  '预览后的正式源文件变化必须阻塞写回',
);
assert.deepEqual(await fs.readdir(path.join(projectRoot, '正文')), [], '冲突阻塞不得创建正式章节');
assert.equal(JSON.parse(await fs.readFile(path.join(projectRoot, '追踪', 'progress.json'), 'utf8')).current_chapter, 4);
await fs.writeFile(path.join(projectRoot, '追踪', '角色状态.md'), before['追踪/角色状态.md'], 'utf8');
assert.deepEqual(await checkWriteBackPlanSources({ libraryRoot, dashboard, plan }), []);

const receipt = await commitWriteBackPlan({ dataDir, libraryRoot, dashboard, chapterWorkspace, plan });
assert.equal(receipt.formalWritePerformed, true);
assert.equal(receipt.writtenFiles.length, 10);
const chapterFile = plan.files.find((file) => file.layer === 'canon').relativePath;
assert.equal(await fs.readFile(path.join(projectRoot, ...chapterFile.split('/')), 'utf8'), candidateText, '落盘正文必须逐字保留候选内容');
const progress = JSON.parse(await fs.readFile(path.join(projectRoot, '追踪', 'progress.json'), 'utf8'));
assert.equal(progress.current_chapter, 5);
assert.deepEqual(progress.completed_chapters, [1, 2, 3, 4]);
const checkpointDir = path.join(dataDir, 'writeback-checkpoints', dashboard.project.id, receipt.checkpointId);
const manifest = JSON.parse(await fs.readFile(path.join(checkpointDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.status, 'committed');
assert.equal(manifest.files.length, 10);
const redactedPlan = JSON.parse(await fs.readFile(path.join(checkpointDir, 'plan.json'), 'utf8'));
assert.equal(redactedPlan.files.some((file) => Object.hasOwn(file, 'beforeText') || Object.hasOwn(file, 'afterText')), false);

const resolvedRun = path.resolve(runRoot);
const resolvedTest = path.resolve(testRoot);
assert.equal(path.relative(resolvedTest, resolvedRun).startsWith('..'), false, '烟测清理范围必须位于 .data/writeback-smoke');
await fs.rm(runRoot, { recursive: true, force: true });
console.log('writeback smoke passed');
