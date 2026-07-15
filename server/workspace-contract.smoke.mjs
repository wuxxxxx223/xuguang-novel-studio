import assert from 'node:assert/strict';
import { extractConfirmedContract } from './workspace-contract.mjs';

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

console.log('workspace contract smoke passed');
