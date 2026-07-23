export const SECTION_LENGTH_MODES = Object.freeze({
  short: { weight: 0.65, label: '少写' },
  normal: { weight: 1, label: '正常' },
  long: { weight: 1.4, label: '多写' },
  focus: { weight: 1.8, label: '重点展开' },
});

export function normalizeSectionLengthMode(value) {
  const mode = String(value ?? 'normal').trim();
  return Object.hasOwn(SECTION_LENGTH_MODES, mode) ? mode : 'normal';
}

export function outlineSectionsForLengthPlan(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawSections = Array.isArray(source.storySections) ? source.storySections
    : Array.isArray(source.beats) ? source.beats
      : Array.isArray(source.sceneProgression) ? source.sceneProgression : [];
  return rawSections.map((rawItem, index) => {
    const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {};
    const explicitId = firstText(item.id, item.sectionId);
    const rawId = explicitId || firstText(item.beatNumber, item.beat, index + 1);
    const safeId = String(rawId || index + 1).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || String(index + 1);
    return {
      sectionId: explicitId ? safeId : `section-${safeId}`,
      title: firstText(item.title, item.heading, item.scene, item.name, `故事情节 ${index + 1}`),
    };
  });
}

export function buildSectionWritingPlan(outline, generationBrief) {
  const sections = outlineSectionsForLengthPlan(outline);
  if (!sections.length) return [];
  const instructions = generationBrief?.sectionInstructions && typeof generationBrief.sectionInstructions === 'object'
    ? generationBrief.sectionInstructions : {};
  const configured = sections.map((section) => {
    const item = instructions[section.sectionId] && typeof instructions[section.sectionId] === 'object'
      ? instructions[section.sectionId] : {};
    const lengthMode = normalizeSectionLengthMode(item.lengthMode);
    return {
      ...section,
      title: String(item.title || section.title),
      instruction: String(item.instruction ?? ''),
      lengthMode,
      lengthModeLabel: SECTION_LENGTH_MODES[lengthMode].label,
      weight: SECTION_LENGTH_MODES[lengthMode].weight,
    };
  });
  const mins = allocateExact(Number(generationBrief?.minChars), configured.map((item) => item.weight));
  const targets = allocateExact(Number(generationBrief?.targetChars), configured.map((item) => item.weight));
  const maxes = allocateExact(Number(generationBrief?.maxChars), configured.map((item) => item.weight));
  return configured.map(({ weight, ...item }, index) => ({
    ...item, minChars: mins[index], targetChars: targets[index], maxChars: maxes[index],
  }));
}

export function attachWriterLengthGate(suggestion, generationBrief) {
  if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion) || typeof suggestion.draft !== 'string') return suggestion;
  const minChars = Number(generationBrief?.minChars);
  const targetChars = Number(generationBrief?.targetChars);
  const maxChars = Number(generationBrief?.maxChars);
  const actualChars = suggestion.draft.replace(/\s+/g, '').length;
  const passed = actualChars >= minChars && actualChars <= maxChars;
  const warnings = Array.isArray(suggestion.contractWarnings) ? suggestion.contractWarnings.map(String) : [];
  if (!passed) warnings.push(`正文当前为 ${actualChars} 字，不在 ${minChars}–${maxChars} 字确认区间内，必须补写或压缩后才能确认。`);
  return {
    ...suggestion,
    contractWarnings: [...new Set(warnings)],
    lengthGate: { minChars, targetChars, maxChars, actualChars, passed, blocking: !passed },
  };
}

function allocateExact(totalValue, weights) {
  const total = Math.max(0, Math.round(Number.isFinite(totalValue) ? totalValue : 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  const raw = weights.map((weight) => (total * weight) / weightTotal);
  const allocated = raw.map(Math.floor);
  let remaining = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) allocated[order[cursor % order.length].index] += 1;
  return allocated;
}

function firstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}
