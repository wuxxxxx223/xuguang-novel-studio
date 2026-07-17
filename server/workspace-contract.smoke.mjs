import assert from 'node:assert/strict';
import {
  extractConfirmedContract,
  extractConfirmedCurrentChapterContract,
  isChapterCycleWorkspace,
  prepareConfirmedBlueprintForWriter,
  prepareConfirmedContractForWriter,
} from './workspace-contract.mjs';

function workspaceWithBlueprint(blueprint) {
  return { stages: { blueprint } };
}

const candidateContract = {
  chapterId: '4',
  status: 'candidate',
  confirmed: false,
  candidateTitle: '出关',
  coreConflict: '主角必须在不暴露底牌的前提下解决宗门危机',
  chapterEndHook: '山门外出现更强敌人',
};

assert.deepEqual(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    confirmed: { nextChapterContractCandidate: candidateContract },
  }), '4'),
  candidateContract,
  '作者确认整个蓝图后，模型遗留的 candidate/confirmed=false 元数据不得再次否决 writer',
);

assert.equal(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'suggested',
    confirmed: { nextChapterContractCandidate: candidateContract },
  }), '4'),
  null,
  '未确认的蓝图不能为 writer 提供正式章节契约',
);

assert.equal(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    confirmed: { nextChapterContractCandidate: candidateContract },
  }), '5'),
  null,
  '显式请求其他章节时不能复用不匹配的契约',
);

const selectedContract = { chapterId: 5, title: '第五章', goal: '推进冲突' };
assert.deepEqual(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    confirmed: {
      selectedChapterId: '5',
      chapterContracts: [
        { chapterId: 4, title: '第四章' },
        selectedContract,
      ],
    },
  })),
  selectedContract,
  '多章节契约集合应按作者保存的 selectedChapterId 提取',
);

const extracted = extractConfirmedContract(workspaceWithBlueprint({
  status: 'ready',
  confirmed: { chapterContract: candidateContract },
}));
extracted.candidateTitle = '被测试修改';
assert.equal(candidateContract.candidateTitle, '出关', '返回值必须与 Workspace 数据隔离');

const manualContract = '目标：主角低调解决宗门危机；章末：山门外强敌现身。';
assert.equal(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    input: { chapterContract: manualContract },
    confirmed: { positioning: '已确认作品定位，但模型建议稿没有输出契约字段' },
  })),
  manualContract,
  '已确认蓝图必须兼容作者手填并已保存的 input.chapterContract',
);

assert.deepEqual(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    confirmed: {
      result: {
        blueprint: {
          nextChapterContractCandidate: candidateContract,
        },
      },
    },
  }), '4'),
  candidateContract,
  '必须兼容模型返回结果被 result/blueprint 等对象包裹的已有 Workspace',
);

assert.deepEqual(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    confirmed: JSON.stringify({ nextChapterContractCandidate: candidateContract }),
  }), '4'),
  candidateContract,
  '必须兼容历史 Workspace 将结构化确认稿保存成 JSON 字符串',
);

assert.deepEqual(
  extractConfirmedContract(workspaceWithBlueprint({
    status: 'ready',
    confirmed: candidateContract,
  }), '4'),
  candidateContract,
  '确认稿本身就是章节契约时应直接使用',
);

const writerContract = prepareConfirmedContractForWriter(candidateContract);
assert.equal(writerContract.status, 'confirmed', '传给 writer 的契约必须明确标记为已确认');
assert.equal(writerContract.confirmed, true, '传给 writer 的契约不能保留模型候选态');
assert.equal(candidateContract.status, 'candidate', '规范化 writer 契约不能修改 Workspace 原对象');
assert.equal(candidateContract.confirmed, false, '规范化 writer 契约不能修改 Workspace 原确认字段');

const writerBlueprint = prepareConfirmedBlueprintForWriter({
  positioning: { genre: '仙侠' },
  nextChapterContractCandidate: candidateContract,
});
assert.equal(writerBlueprint.nextChapterContractCandidate.status, 'confirmed');
assert.equal(writerBlueprint.nextChapterContractCandidate.confirmed, true);
assert.equal(writerBlueprint.positioning.genre, '仙侠');

const cycleContract = {
  chapterNumber: 2,
  candidateTitle: '雨夜的试探',
  chapterGoal: '主角在雨夜逼出盟友的真实立场',
  coreConflict: '盟友可能已经倒向敌人',
  chapterEndHook: '密信上的日期指向明天的处刑',
};
const cycleWorkspace = {
  chapterCycleVersion: 1,
  currentChapter: {
    number: 2,
    title: '雨夜的试探',
    contract: { status: 'suggested', candidate: cycleContract, confirmed: null },
  },
  stages: {
    blueprint: {
      status: 'ready',
      confirmed: { positioning: { genre: '悬疑' }, nextChapterContractCandidate: candidateContract },
    },
  },
};
assert.equal(isChapterCycleWorkspace(cycleWorkspace), true, '连续写作 Workspace 必须显式使用新版章节循环');
assert.equal(
  extractConfirmedCurrentChapterContract(cycleWorkspace, 2),
  null,
  '当前章候选即使来自已确认蓝图，也不能在作者单独确认前供 writer 使用',
);
cycleWorkspace.currentChapter.contract = { status: 'confirmed', candidate: cycleContract, confirmed: cycleContract };
assert.deepEqual(
  extractConfirmedCurrentChapterContract(cycleWorkspace, 2),
  cycleContract,
  '新版 writer 只能读取当前章节已确认契约快照',
);
assert.equal(
  extractConfirmedCurrentChapterContract(cycleWorkspace, 3),
  null,
  '新版 writer 不能借当前章契约跨章写作',
);
const strippedCycleBlueprint = prepareConfirmedBlueprintForWriter(cycleWorkspace.stages.blueprint.confirmed, {
  stripChapterContractCandidates: true,
});
assert.equal(strippedCycleBlueprint.nextChapterContractCandidate, undefined, '新版 writer 上下文不能把蓝图候选当作已确认章节事实');
assert.equal(strippedCycleBlueprint.positioning.genre, '悬疑');

console.log('workspace contract smoke passed');
