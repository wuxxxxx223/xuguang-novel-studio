import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContractPlan,
  checkContractPlanSource,
  commitContractPlan,
  contractTemplate,
  normalizeContractDraft,
  validateContractText,
} from './contract-writeback.mjs';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(serverDir, '..');
const testRoot = path.join(appRoot, '.data', 'contract-writeback-smoke');
await fs.mkdir(testRoot, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(testRoot, 'run-'));
const libraryRoot = path.join(runRoot, 'library');
const dataDir = path.join(runRoot, 'data');
const directoryName = '契约测试书';
const projectRoot = path.join(libraryRoot, directoryName);
const contractDir = path.join(projectRoot, '大纲', '章节契约');
await Promise.all([
  fs.mkdir(contractDir, { recursive: true }),
  fs.mkdir(dataDir, { recursive: true }),
]);

const dashboard = {
  project: { id: 'contract-smoke-project', title: '契约测试书', directoryName },
  chapter: { number: 5, contractReady: false, contractPath: '大纲/章节契约/第005章.md' },
};
const draftText = `# 章节契约 · 第005章

## 本章目标
林渊在不暴露真实境界的前提下确认来客目的。

## 读者情绪
- 先压迫，再因主角暗中反制获得爽感。

## 必须发生
1. 来客公开试探山门底牌。
2. 林渊借阵法制造一次信息差反杀。

## 禁止发生
- 林渊不得公开仙帝修为。
- 不得直接解释来客背后势力全貌。

## 章末问题
来客留下的令牌为何会让签到面板主动预警？

## 字数与节奏
- 目标字数：2400 字。
- 前 300 字出现来客施压。
- 中段完成一次反制，章末留下令牌钩子。
`;

const templateValidation = validateContractText(contractTemplate(5));
assert.equal(templateValidation.valid, false, '只有标题和占位符的模板不能进入正式预览');
assert.deepEqual(templateValidation.emptySections.sort(), ['必须发生', '本章目标', '章末问题', '禁止发生', '读者情绪'].sort());
const validation = validateContractText(draftText);
assert.equal(validation.valid, true);
assert.deepEqual(validation.missingSections, []);
assert.deepEqual(validation.emptySections, []);

const contractDraft = normalizeContractDraft({ title: '第5章章节契约', text: draftText, source: 'manual' });
const plan = await buildContractPlan({ libraryRoot, dashboard, contractDraft });
assert.equal(plan.status, 'ready');
assert.equal(plan.relativePath, '大纲/章节契约/第005章.md');
assert.equal(plan.afterText, draftText, '预览必须逐字保留侧车契约');
assert.deepEqual(await fs.readdir(contractDir), [], '生成预览不得创建正式契约');
assert.deepEqual(await checkContractPlanSource({ libraryRoot, dashboard, plan }), []);

const target = path.join(contractDir, '第005章.md');
await fs.writeFile(target, draftText, 'utf8');
await assert.rejects(
  () => commitContractPlan({ dataDir, libraryRoot, dashboard, contractDraft, plan }),
  (error) => error?.code === 'CONTRACT_SOURCE_CONFLICT' && error?.status === 409,
  '预览后出现正式契约必须阻塞提交',
);
assert.equal(await fs.readFile(target, 'utf8'), draftText, '冲突时不得删除外部创建的同内容文件');
await fs.unlink(target);
assert.deepEqual(await checkContractPlanSource({ libraryRoot, dashboard, plan }), []);

const receipt = await commitContractPlan({ dataDir, libraryRoot, dashboard, contractDraft, plan });
assert.equal(receipt.formalWritePerformed, true);
assert.equal(await fs.readFile(target, 'utf8'), draftText, '正式契约必须逐字等于侧车草稿');
const checkpointDir = path.join(dataDir, 'contract-checkpoints', dashboard.project.id, receipt.checkpointId);
const manifest = JSON.parse(await fs.readFile(path.join(checkpointDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.status, 'committed');
assert.equal(manifest.relativePath, plan.relativePath);
const redactedPlan = JSON.parse(await fs.readFile(path.join(checkpointDir, 'plan.json'), 'utf8'));
assert.equal(Object.hasOwn(redactedPlan, 'beforeText'), false);
assert.equal(Object.hasOwn(redactedPlan, 'afterText'), false);

const resolvedRun = path.resolve(runRoot);
const resolvedTest = path.resolve(testRoot);
assert.equal(path.relative(resolvedTest, resolvedRun).startsWith('..'), false, '烟测清理范围必须位于隔离目录');
await fs.rm(runRoot, { recursive: true, force: true });
console.log('contract writeback smoke passed');
