import assert from 'node:assert/strict';
import {
  analyzeChapterDraft,
  buildChapterGenerationMessages,
  normalizeGeneratedChapter,
  normalizeGenerationMetadata,
} from './chapter-generation.mjs';

const context = {
  project: { id: 'fixture-book', title: '《苟成仙帝》' },
  chapter: { number: 8, title: '第8章 低调过头了' },
  formalFacts: {
    contract: '## 本章目标\n林苟低调化解挑衅。\n## 禁止发生\n- 禁止展开后山禁地主线。\n## 字数与节奏\n- 目标字数：2200-2800字。',
    rules: '只使用正式事实。',
    characterState: '林苟隐藏实力。',
  },
  risks: [{ label: '侧车风险不应成为生成事实' }],
};

const fullMessages = buildChapterGenerationMessages(context, { mode: 'full' });
assert.equal(fullMessages.length, 2);
assert.equal(fullMessages[0].role, 'system');
for (const phrase of ['直给、高密度、诙谐、少描写', '前 300 字', '爽点或反转', '章末必须', '林苟式反差', '只使用 PAYLOAD.formalFacts']) {
  assert.match(fullMessages[0].content, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.equal(fullMessages[1].content.includes('侧车风险不应成为生成事实'), false, '非正式 risks 不应进入生成事实包');

const existingCandidate = { title: '旧标题', text: '旧开篇。\n\n中段保持。\n\n旧钩子。' };
for (const mode of ['opening', 'payoff', 'hook']) {
  const messages = buildChapterGenerationMessages(context, { mode, existingCandidate });
  assert.match(messages[0].content, /必须返回完整章节/u);
  assert.match(messages[1].content, /中段保持/u);
}
assert.throws(() => buildChapterGenerationMessages(context, { mode: 'hook' }), /existingCandidate/u);

const jsonFixture = {
  title: '第8章 一根手指就够了',
  beatPlan: ['当众施压', '林苟装怂', '对手加码', '反手镇压', '众人傻眼', '令牌异动'],
  draft: '```markdown\n执事把剑拍在桌上：“交出令牌，否则滚。”\n\n林苟叹气，反手一指，剑碎了。满堂鸦雀无声。\n\n就在这时，那枚令牌忽然发烫——门外有人问：谁动了它？\n```',
  selfCheck: { formalFactsOnly: true, openingConflict: true, payoff: true, hook: true },
};
const fencedJson = `\`\`\`json\n${JSON.stringify(jsonFixture)}\n\`\`\``;
const normalizedJson = normalizeGeneratedChapter(null, fencedJson, { chapter: 8, context, mode: 'full' });
assert.equal(normalizedJson.title, jsonFixture.title);
assert.equal(normalizedJson.text.includes('执事把剑拍在桌上'), true);
assert.equal(normalizedJson.text.includes('```'), false);
assert.equal(normalizedJson.generation.format, 'json');
assert.equal(normalizedJson.generation.beatPlan.length, 5, '六拍应安全归并为约五拍');
assert.equal(normalizedJson.generation.diagnostics, null);
assert.equal(normalizedJson.generation.generatedAt, null);

const plainFixture = '```text\n第一段正文不能被围栏清理吞掉。\n\n最后一段也必须保留。\n```';
const normalizedPlain = normalizeGeneratedChapter(null, plainFixture, { chapter: { number: 9 }, mode: 'full' });
assert.equal(normalizedPlain.title, '第9章');
assert.equal(normalizedPlain.text, '第一段正文不能被围栏清理吞掉。\n\n最后一段也必须保留。');
assert.equal(normalizedPlain.generation.format, 'plain-text');

assert.deepEqual(normalizeGenerationMetadata(null), {
  mode: 'manual', beatPlan: [], selfCheck: {}, diagnostics: null, generatedAt: null,
});
assert.deepEqual(normalizeGenerationMetadata({
  mode: 'hook',
  beats: ['旧开篇', '新钩子'],
  self_check: '已检查',
  analysis: { status: 'warning' },
  createdAt: '2026-07-13T08:00:00+08:00',
}), {
  mode: 'hook',
  beatPlan: ['旧开篇', '新钩子'],
  selfCheck: { summary: '已检查' },
  diagnostics: { status: 'warning' },
  generatedAt: '2026-07-13T00:00:00.000Z',
});

const defectiveContract = `## 禁止发生
- 禁止展开后山禁地主线。

## 字数与节奏
- 目标字数：2200—2800字。`;
const defective = analyzeChapterDraft({
  title: '短章',
  text: '```markdown\n林烬进入后山禁地，只看了一眼便离开。\n\n事情到此结束。\n```',
  contract: defectiveContract,
  risks: [{ severity: 'P0', label: '错误名风险' }],
  rules: '前300字必须冲突。',
});
assert.equal(defective.status, 'blocked');
assert.equal(defective.stats.targetCharacters.min, 2200);
assert.equal(defective.stats.targetCharacters.max, 2800);
assert.equal(defective.stats.riskCount, 1);
for (const id of ['markdown-fence', 'wrong-character-name', 'forbidden-rear-mountain-plot', 'target-length', 'opening-conflict', 'payoff-or-reversal', 'ending-hook']) {
  const check = defective.checks.find((item) => item.id === id);
  assert.ok(check, `缺少检查：${id}`);
  assert.equal(check.status, 'fail', `${id} 应失败`);
}

const empty = analyzeChapterDraft({ text: '', contract: '目标字数：1000-1200字。' });
assert.equal(empty.status, 'blocked');
assert.equal(empty.checks.find((item) => item.id === 'body-present').status, 'fail');

console.log('chapter generation smoke passed');
