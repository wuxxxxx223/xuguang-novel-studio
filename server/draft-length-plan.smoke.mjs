import assert from 'node:assert/strict';
import { attachWriterLengthGate, buildSectionWritingPlan, normalizeSectionLengthMode } from './draft-length-plan.mjs';

assert.equal(normalizeSectionLengthMode('focus'), 'focus');
assert.equal(normalizeSectionLengthMode('unexpected'), 'normal');

const outline = { storySections: [
  { id: 'opening', title: '开场' },
  { id: 'conflict', title: '冲突' },
  { id: 'ending', title: '收束' },
] };
const brief = { minChars: 2000, targetChars: 2500, maxChars: 3000, sectionInstructions: {
  opening: { lengthMode: 'short', instruction: '快速进入现场' },
  conflict: { lengthMode: 'focus', instruction: '重点写对话' },
  ending: { lengthMode: 'normal' },
} };
const plan = buildSectionWritingPlan(outline, brief);
assert.equal(plan.length, 3);
assert.equal(plan[1].lengthMode, 'focus');
assert.ok(plan[1].targetChars > plan[2].targetChars);
assert.ok(plan[2].targetChars > plan[0].targetChars);
assert.equal(plan.reduce((sum, item) => sum + item.minChars, 0), 2000);
assert.equal(plan.reduce((sum, item) => sum + item.targetChars, 0), 2500);
assert.equal(plan.reduce((sum, item) => sum + item.maxChars, 0), 3000);

const shortDraft = attachWriterLengthGate({ draft: '字'.repeat(1891), contractWarnings: [] }, brief);
assert.equal(shortDraft.lengthGate.passed, false);
assert.equal(shortDraft.lengthGate.blocking, true);
const validDraft = attachWriterLengthGate({ draft: '字'.repeat(2500), contractWarnings: [] }, brief);
assert.equal(validDraft.lengthGate.passed, true);
assert.equal(validDraft.lengthGate.blocking, false);

console.log('draft length plan smoke passed');
