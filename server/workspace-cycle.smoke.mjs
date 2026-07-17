import assert from 'node:assert/strict';
import {
  canCompleteCurrentChapter,
  confirmCurrentChapterContract,
  createWorkspace,
  getConfirmedCurrentChapterContract,
  hasConfirmedCurrentChapterContract,
  isChapterCycleWorkspace,
  normalizeWorkspace,
  prepareCurrentChapterContract,
  prepareNextWorkspaceChapter,
  updateCurrentChapterContractCandidate,
} from '../web/src/state.js';

const legacy = normalizeWorkspace({
  revision: 4,
  currentChapter: { number: 1, title: '历史第一章' },
  stages: {
    idea: { status: 'ready', confirmed: { highConcept: '历史作品' } },
    logic: { status: 'ready', confirmed: { desire: '活下去' } },
    blueprint: { status: 'ready', confirmed: { chapterContract: '目标：活下去；结尾：门外有人敲门。' } },
    draft: { status: 'empty' },
    review: { status: 'empty' },
  },
  runs: [],
});
assert.equal(legacy.chapterCycleVersion, 0, '缺少版本字段的历史 Workspace 必须保留旧写作兼容行为');

const initialContract = {
  chapterNumber: 1,
  candidateTitle: '雨夜开门',
  chapterGoal: '主角必须在雨夜确认门外访客的身份',
  coreConflict: '开门会暴露藏身处，不开门会失去唯一线索',
  chapterEndHook: '访客叫出了主角早已不用的名字',
};
let workspace = createWorkspace();
workspace = {
  ...workspace,
  currentStage: 'blueprint',
  stages: {
    ...workspace.stages,
    idea: { ...workspace.stages.idea, status: 'ready', confirmed: { highConcept: '雨夜悬疑' } },
    logic: { ...workspace.stages.logic, status: 'ready', confirmed: { desire: '找到失踪的姐姐' } },
    blueprint: {
      ...workspace.stages.blueprint,
      status: 'ready',
      confirmed: { positioning: { candidateCoreSellingPoint: '雨夜来信' }, nextChapterContractCandidate: initialContract },
    },
  },
};

workspace = prepareCurrentChapterContract(workspace, '2026-07-17T00:00:00.000Z');
assert.equal(isChapterCycleWorkspace(workspace), true);
assert.equal(workspace.currentChapter.contract.status, 'suggested', '蓝图中的章节候选必须先进入待确认槽位');
assert.equal(workspace.currentChapter.contract.confirmed, null, '蓝图确认不能自动确认当前章契约');
assert.deepEqual(workspace.currentChapter.contract.candidate, initialContract);
assert.equal(hasConfirmedCurrentChapterContract(workspace), false);

workspace = updateCurrentChapterContractCandidate(workspace, {
  ...workspace.currentChapter.contract.candidate,
  chapterGoal: '主角必须在雨夜确认访客身份，并抢到密信。',
}, '2026-07-17T00:01:00.000Z');
workspace = confirmCurrentChapterContract(workspace, '2026-07-17T00:02:00.000Z');
assert.ok(workspace, '作者补全候选后应能明确确认当前章契约');
assert.equal(workspace.currentChapter.contract.status, 'confirmed');
assert.deepEqual(getConfirmedCurrentChapterContract(workspace), workspace.currentChapter.contract.confirmed);

workspace = {
  ...workspace,
  currentStage: 'review',
  stages: {
    ...workspace.stages,
    draft: {
      ...workspace.stages.draft,
      status: 'ready',
      confirmed: '雨打在窗棂上。主角没有立刻开门。',
      confirmedAt: '2026-07-17T00:03:00.000Z',
    },
    review: {
      ...workspace.stages.review,
      status: 'ready',
      confirmed: { verdict: '通过', findings: [] },
      accepted: true,
      confirmedAt: '2026-07-17T00:04:00.000Z',
    },
  },
};
assert.equal(canCompleteCurrentChapter(workspace), true, '只有契约、正文和审查都由作者确认后才能推进章节');

const next = prepareNextWorkspaceChapter(workspace, '2026-07-17T00:05:00.000Z');
assert.ok(next, '完成当前章后应构造下一章 Workspace 状态');
assert.equal(next.chapterHistory.length, 1);
assert.equal(next.chapterHistory[0].chapterNumber, 1);
assert.equal(next.chapterHistory[0].formalWritePerformed, false, '连续写作不能隐式写入正式正文项目');
assert.equal(next.currentChapter.number, 2);
assert.equal(next.currentStage, 'blueprint');
assert.equal(next.currentChapter.contract.status, 'suggested');
assert.equal(next.currentChapter.contract.confirmed, null, '下一章候选不能被自动提升为作者确认事实');
assert.equal(next.stages.draft.status, 'empty');
assert.equal(next.stages.review.status, 'empty');

const archivedDraft = next.chapterHistory[0].draft.value;
const editedNext = updateCurrentChapterContractCandidate(next, {
  ...next.currentChapter.contract.candidate,
  chapterGoal: '第二章的独立目标',
});
assert.equal(editedNext.chapterHistory[0].draft.value, archivedDraft, '后续章节编辑不能修改已归档正文快照');

console.log('workspace cycle smoke passed');
