import { useState } from 'react';
import {
  ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, Gauge,
  LoaderCircle, Route, Settings2, ShieldAlert, Sparkles,
} from 'lucide-react';
import { humanizeKey, tryParseJson } from './state.js';
import {
  ArtifactModeToolbar, RawDataDetails, StructureEditingPane, StructuredArtifactEditor,
} from './ArtifactReaderShared.jsx';

const FIELD_LABELS = {
  desire: '主角欲望',
  resistance: '故事阻力',
  cost: '选择代价',
  escalation: '冲突升级链',
  longMysteries: '长线悬念',
  logicRisks: '逻辑风险',
  openQuestions: '待作者裁决',
  confirmedFacts: '已经确认',
  chapter1Inference: '第一章落点',
  seriesInference: '长线动力',
  structuralResistance: '结构性阻力',
  chapter1SuggestedCosts: '第一章可见代价',
  recommendedCostPrinciple: '推荐的代价原则',
  longTermCost: '长期代价',
  chapter1Chain: '第一章因果链',
  firstThreeChapterChain: '前三章升级链',
  volumeEscalation: '分卷升级链',
  escalationConstraint: '升级约束',
  type: '阻力类型',
  content: '具体表现',
  choice: '主角选择',
  immediateCost: '眼前代价',
  downstreamCost: '后续代价',
  step: '步骤',
  cause: '起因',
  effect: '结果',
  level: '对手层级',
  misjudgment: '对手误判',
  exposure: '暴露信息',
  payoff: '本轮兑现',
  stage: '故事阶段',
  causalUpgrade: '为什么升级',
  mystery: '悬念',
  confirmedBasis: '已确认依据',
  suggestedRevealChain: '建议揭示顺序',
  neededAnswer: '还需明确',
  function: '承担作用',
  recommendedBoundary: '建议边界',
  candidateAnswers: '候选答案',
  recommendedDesign: '建议设计',
  risk: '风险',
  severity: '等级',
  repair: '修补建议',
  question: '待决定问题',
  whyItMatters: '为什么重要',
  recommendedOption: '建议选项',
  status: '当前状态',
  coreDesire: '核心欲望',
  femaleLead: '女主动力',
  maleLead: '男主动力',
  coupleGoal: '共同目标',
  externalGoal: '外部目标',
  internalNeed: '内在需要',
  romanticWant: '情感诉求',
  openingWant: '开篇诉求',
  whyItBreaks: '为什么会出问题',
  suggestion: '修补建议',
  impact: '会影响什么',
  knownClue: '当前线索',
  payoffDirection: '未来兑现方向',
};

const SECTION_DEFINITIONS = [
  {
    id: 'escalation',
    label: '冲突怎样一层层升级',
    description: '检查每次升级是否同时带来更强威胁、更大收益和更深真相。',
    icon: Gauge,
  },
  {
    id: 'longMysteries',
    label: '哪些问题支撑长线追读',
    description: '看悬念如何分阶段揭示，以及哪些答案仍需保留。',
    icon: Route,
  },
  {
    id: 'logicRisks',
    label: '目前有哪些逻辑风险',
    description: '先处理高风险矛盾，再进入小说蓝图。',
    icon: ShieldAlert,
    tone: 'risk',
  },
  {
    id: 'openQuestions',
    label: '现在需要作者裁决什么',
    description: '这些选择会改变后续逻辑、蓝图和前三章写法。',
    icon: CircleHelp,
    tone: 'decision',
  },
];

export default function StoryEngineWorkshop({
  artifact, onSuggestionChange, onFeedbackChange, onRefine, onConfirm,
  configured, onSettings, readOnly = false,
}) {
  const [viewMode, setViewMode] = useState('read');
  const [expandedSections, setExpandedSections] = useState(() => new Set(['escalation']));
  const suggestion = parseNestedJson(artifact.suggestion);
  const busy = artifact.status === 'generating';
  const feedback = String(artifact.refinementFeedback ?? '');
  const canRefine = configured && Boolean(feedback.trim()) && !busy;
  const sections = SECTION_DEFINITIONS
    .map((definition) => ({ ...definition, value: suggestion?.[definition.id] }))
    .filter((section) => hasContent(section.value));
  const allExpanded = sections.length > 0 && sections.every((section) => expandedSections.has(section.id));
  const summary = extractEngineSummary(suggestion);

  const toggleSection = (sectionId, open) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (open) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  };

  const toggleAll = () => {
    setExpandedSections(allExpanded ? new Set() : new Set(sections.map((section) => section.id)));
  };

  return (
    <section className="story-engine-workshop">
      <header className="story-engine-head">
        <div>
          <span className={`artifact-label ${readOnly ? 'green' : 'coral'}`}>{readOnly ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}{readOnly ? '作者确认的故事引擎' : 'AI 故事引擎建议稿'}</span>
          <h2>先看清故事如何运转，再决定是否采用</h2>
          <p>默认按创作问题阅读。结构字段和原始 JSON 只在需要编辑或核对时出现。</p>
        </div>
        <div className="story-engine-status">
          <Route size={16} />
          <span>{countItems(suggestion?.logicRisks)} 项风险</span>
          <span>{countItems(suggestion?.openQuestions)} 项待裁决</span>
        </div>
      </header>

      <ArtifactModeToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        expanded={allExpanded}
        onToggleExpanded={sections.length ? toggleAll : null}
        label="故事引擎呈现方式"
        editable={!readOnly}
      />

      {viewMode === 'read' ? (
        <div className="story-engine-reading">
          <section className="story-engine-summary">
            <div className="story-engine-summary-icon"><Route size={20} /></div>
            <div>
              <span>一句话看懂这台故事引擎</span>
              <p>{summary || '当前建议稿还没有可提取的长线动力，请切换到结构编辑查看完整内容。'}</p>
            </div>
          </section>

          <section className="story-engine-pillars">
            <div className="idea-section-heading">
              <span>故事运转的三根支柱</span>
              <small>欲望决定方向，阻力制造冲突，代价让选择有重量</small>
            </div>
            <div className="story-engine-pillar-grid">
              <EnginePillar
                index="01"
                title="主角到底想要什么"
                value={suggestion?.desire}
                preferredKeys={['coreDesire', 'femaleLead', 'maleLead', 'coupleGoal', 'externalGoal', 'internalNeed', 'romanticWant', 'openingWant', 'seriesInference', 'chapter1Inference', 'confirmedFacts']}
              />
              <EnginePillar
                index="02"
                title="什么持续挡住主角"
                value={suggestion?.resistance}
                preferredKeys={['structuralResistance', 'femaleLead', 'maleLead', 'coupleGoal', 'chapter1Inference', 'confirmedFacts']}
              />
              <EnginePillar
                index="03"
                title="每次选择要付出什么"
                value={suggestion?.cost}
                preferredKeys={['recommendedCostPrinciple', 'longTermCost', 'chapter1SuggestedCosts']}
              />
            </div>
          </section>

          <section className="story-engine-browser">
            <div className="idea-section-heading">
              <span>按创作问题继续检查</span>
              <small>{sections.length} 个分区 · 升级链默认展开</small>
            </div>
            <div className="story-engine-section-list">
              {sections.map((section, index) => {
                const Icon = section.icon;
                const open = expandedSections.has(section.id);
                return (
                  <details
                    className={`story-engine-section ${section.tone ? `tone-${section.tone}` : ''}`}
                    key={section.id}
                    open={open}
                    onToggle={(event) => toggleSection(section.id, event.currentTarget.open)}
                  >
                    <summary>
                      <div className="story-engine-section-number">{String(index + 4).padStart(2, '0')}</div>
                      <div className="story-engine-section-title">
                        <strong><Icon size={15} />{section.label}</strong>
                        <span>{section.description}</span>
                        <p>{valuePreview(section.value)}</p>
                      </div>
                      <div className="idea-section-toggle">
                        <span>{open ? '收起' : '展开'}</span>
                        <ChevronDown size={15} />
                      </div>
                    </summary>
                    <div className="story-engine-section-content">
                      <SectionContent sectionId={section.id} value={section.value} />
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <StructureEditingPane>
          <StructuredArtifactEditor value={suggestion} onChange={onSuggestionChange} disabled={busy || readOnly} />
        </StructureEditingPane>
      )}

      <RawDataDetails value={suggestion} label="高级：查看故事引擎原始结构" />

      <section className="idea-refinement-panel" id="logic-discussion">
        <div className="idea-section-heading">
          <span>讨论当前故事情节</span>
          <small>指出要保留、推翻或继续深化的部分；下一版仍是待确认建议稿</small>
        </div>
        <textarea
          className="idea-feedback-editor"
          rows={6}
          value={feedback}
          onChange={(event) => onFeedbackChange(event.target.value)}
          disabled={busy}
          placeholder="例如：保留主角主动离开宗门，但删除被逐出桥段；让第一次冲突来自主角经营势力时主动触碰旧秩序，并把代价改成失去一个关键盟友。"
        />
        <div className="idea-workshop-actions">
          <div className="idea-action-copy">
            <strong>{busy ? '正在生成下一版故事情节' : feedback.trim() ? '将按本轮意见生成完整替代稿' : '先写清楚这次想改什么'}</strong>
            <span>讨论不会自动确认情节，也不会直接修改蓝图、章节契约或正文。</span>
          </div>
          <div className="idea-action-buttons">
            <button type="button" className="secondary-button idea-confirm-button" onClick={onConfirm} disabled={busy || readOnly}>
              <Check size={16} />{readOnly ? '当前情节已确认' : '确认当前故事情节'}
            </button>
            <button type="button" className="primary-button idea-refine-button" onClick={configured ? onRefine : onSettings} disabled={configured ? !canRefine : busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : configured ? <Sparkles size={17} /> : <Settings2 size={17} />}
              {busy ? '正在讨论并调整' : configured ? '按讨论生成下一版' : '配置故事引擎模型'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

function EnginePillar({ index, title, value, preferredKeys }) {
  const highlights = extractHighlights(value, preferredKeys, 3);
  return (
    <article className="story-engine-pillar">
      <div className="story-engine-pillar-head">
        <span>{index}</span>
        <h3>{title}</h3>
      </div>
      {highlights.length ? (
        <ul>
          {highlights.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
        </ul>
      ) : (
        <p className="story-engine-empty">当前建议稿暂未提供。</p>
      )}
    </article>
  );
}

function SectionContent({ sectionId, value }) {
  if (sectionId === 'escalation') return <EscalationTimeline value={value} />;
  if (sectionId === 'longMysteries') return <MysteryCards value={value} />;
  if (sectionId === 'logicRisks' && Array.isArray(value)) return <RiskCards risks={value} />;
  if (sectionId === 'openQuestions' && Array.isArray(value)) return <DecisionCards questions={value} />;
  return <ReadableValue value={value} />;
}

function EscalationTimeline({ value }) {
  const steps = normalizeEscalationSteps(value);
  if (!steps.length) return <span className="story-engine-empty">暂未提供升级过程。</span>;
  return (
    <div className="story-engine-escalation-timeline">
      {steps.map((step, index) => (
        <article key={`${index}-${step.title}`}>
          <div className="story-engine-timeline-marker"><span>{String(index + 1).padStart(2, '0')}</span></div>
          <div className="story-engine-timeline-card">
            <header><span>{step.kicker}</span><h4>{step.title}</h4></header>
            <p>{step.detail}</p>
            {step.result && <div><strong>局面变化</strong><span>{step.result}</span></div>}
          </div>
        </article>
      ))}
    </div>
  );
}

function MysteryCards({ value }) {
  const items = normalizeMysteries(value);
  if (!items.length) return <span className="story-engine-empty">暂未提供长线悬念。</span>;
  return (
    <div className="story-engine-mystery-grid">
      {items.map((item, index) => (
        <article key={`${index}-${item.mystery}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <h4>{item.mystery}</h4>
          {item.clue && <div><strong>现在知道</strong><p>{item.clue}</p></div>}
          {item.payoff && <div className="payoff"><strong>未来怎么兑现</strong><p>{item.payoff}</p></div>}
        </article>
      ))}
    </div>
  );
}

function RiskCards({ risks }) {
  return (
    <div className="story-engine-card-list">
      {risks.map((item, index) => (
        <article className="story-engine-risk-card" key={index}>
          <div className="story-engine-card-meta">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <SeverityBadge severity={item?.severity} />
          </div>
          <h4>{item?.risk || '未命名风险'}</h4>
          {(item?.whyItBreaks || item?.impact) && <p className="story-engine-risk-impact">{item.whyItBreaks || item.impact}</p>}
          {(item?.repair || item?.suggestion) && <div className="story-engine-repair"><strong>怎么修</strong><p>{item.repair || item.suggestion}</p></div>}
        </article>
      ))}
    </div>
  );
}

function DecisionCards({ questions }) {
  return (
    <div className="story-engine-card-list">
      {questions.map((item, index) => (
        <article className="story-engine-decision-card" key={index}>
          <div className="story-engine-card-meta">
            <span>{String(index + 1).padStart(2, '0')}</span>
            {item?.status && <em>{item.status}</em>}
          </div>
          <h4>{item?.question || '未命名问题'}</h4>
          {(item?.whyItMatters || item?.impact) && <p className="story-engine-importance">{item.whyItMatters || item.impact}</p>}
          {item?.recommendedOption && (
            <div className="story-engine-recommendation">
              <strong>建议选项</strong>
              <p>{item.recommendedOption}</p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }) {
  const text = String(severity || '未分级');
  const tone = text.includes('高') ? 'high' : text.includes('中') ? 'medium' : 'low';
  return <em className={`story-engine-severity ${tone}`}>{text}风险</em>;
}

function ReadableValue({ value, depth = 0 }) {
  if (!hasContent(value)) return <span className="story-engine-empty">暂未提供</span>;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return <div className="story-engine-prose">{String(value).split(/\n{2,}/).map((text, index) => <p key={index}>{text}</p>)}</div>;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return (
        <ol className="story-engine-readable-list">
          {value.map((item, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{String(item)}</p></li>)}
        </ol>
      );
    }
    return (
      <div className="story-engine-readable-stack">
        {value.map((item, index) => (
          <article key={index}>
            <div className="story-engine-readable-index">{String(index + 1).padStart(2, '0')}</div>
            <ReadableValue value={item} depth={depth + 1} />
          </article>
        ))}
      </div>
    );
  }
  return (
    <div className={depth ? 'story-engine-readable-object nested' : 'story-engine-readable-object'}>
      {Object.entries(value).filter(([, item]) => hasContent(item)).map(([key, item]) => (
        <section key={key}>
          <h4>{fieldLabel(key)}</h4>
          <ReadableValue value={item} depth={depth + 1} />
        </section>
      ))}
    </div>
  );
}

function extractEngineSummary(value) {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : '';
  return firstText(value?.desire?.seriesInference)
    || firstText(value?.desire?.chapter1Inference)
    || firstText(value?.desire)
    || firstText(value);
}

function extractHighlights(value, preferredKeys, limit) {
  if (!hasContent(value)) return [];
  const preferred = value && typeof value === 'object' && !Array.isArray(value)
    ? preferredKeys.flatMap((key) => hasContent(value[key]) ? collectHighlightText(value[key]) : [])
    : [];
  const source = preferred.length ? preferred : collectHighlightText(value);
  return [...new Set(source.map((item) => truncateText(item, 150)).filter(Boolean))].slice(0, limit);
}

function normalizeEscalationSteps(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).flatMap(([group, item]) => Array.isArray(item)
        ? item.map((child) => ({ ...(child && typeof child === 'object' ? child : { content: child }), group }))
        : [{ ...(item && typeof item === 'object' ? item : { content: item }), group }])
      : value ? [value] : [];
  return source.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw : { content: raw };
    return {
      kicker: firstNonEmptyText(item.stage, item.group, item.level, `第 ${index + 1} 层`),
      title: firstNonEmptyText(item.title, item.step, item.cause, item.choice, `升级节点 ${index + 1}`),
      detail: firstNonEmptyText(item.causalUpgrade, item.content, item.description, item.effect, item.immediateCost, collectLeafText(item).join('；')),
      result: firstNonEmptyText(item.downstreamCost, item.payoff, item.exposure, item.effect),
    };
  }).filter((item) => item.detail || item.result);
}

function normalizeMysteries(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item])
      : value ? [value] : [];
  return source.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw : { mystery: raw };
    return {
      mystery: firstNonEmptyText(item.mystery, item.question, item.title, `悬念 ${index + 1}`),
      clue: firstNonEmptyText(item.knownClue, item.confirmedBasis, item.clue),
      payoff: firstNonEmptyText(item.payoffDirection, item.suggestedRevealChain, item.reveal, item.neededAnswer),
    };
  }).filter((item) => item.mystery);
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      const text = String(value).trim();
      if (text) return text;
    }
    if (Array.isArray(value)) {
      const text = value.flatMap(collectLeafText).join('；').trim();
      if (text) return text;
    }
  }
  return '';
}

function collectHighlightText(value) {
  if (!hasContent(value)) return [];
  if (['string', 'number', 'boolean'].includes(typeof value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectHighlightText);
  if (value.type && value.content) return [`${value.type}：${value.content}`];
  if (value.choice && value.immediateCost) {
    const immediate = String(value.immediateCost).replace(/[。；;，,\s]+$/u, '');
    return [`${value.choice}：${immediate}${value.downstreamCost ? `；后续：${value.downstreamCost}` : ''}`];
  }
  if (value.stage && value.causalUpgrade) return [`${value.stage}：${value.causalUpgrade}`];
  if (value.cause && value.effect) return [`${value.cause} ${value.effect}`];
  return Object.values(value).flatMap(collectHighlightText);
}

function collectLeafText(value) {
  if (!hasContent(value)) return [];
  if (['string', 'number', 'boolean'].includes(typeof value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectLeafText);
  return Object.values(value).flatMap(collectLeafText);
}

function firstText(value) {
  return collectLeafText(value)[0] || '';
}

function valuePreview(value) {
  const first = firstText(value);
  const count = countItems(value);
  if (!first) return '暂未提供内容';
  return `${count > 1 ? `${count} 项 · ` : ''}${truncateText(first, 96)}`;
}

function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return hasContent(value) ? 1 : 0;
}

function hasContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasContent);
  if (typeof value === 'object') return Object.values(value).some(hasContent);
  return true;
}

function fieldLabel(key) {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

function truncateText(value, limit) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function parseNestedJson(value) {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== 'string') break;
    const trimmed = current.trim();
    if (!trimmed) break;
    try {
      const next = JSON.parse(trimmed);
      if (next === current) break;
      current = next;
    } catch {
      const next = tryParseJson(current);
      if (next === current) break;
      current = next;
    }
  }
  if (typeof current === 'string') {
    const recovered = {};
    for (const key of ['desire', 'resistance', 'cost', 'escalation', 'longMysteries', 'logicRisks', 'openQuestions']) {
      const property = extractMalformedJsonProperty(current, key);
      if (property !== undefined) recovered[key] = property;
    }
    if (Object.keys(recovered).length) return recovered;
  }
  return current;
}

function extractMalformedJsonProperty(raw, key) {
  const source = String(raw ?? '');
  const marker = `"${key}"`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return undefined;
  let cursor = source.indexOf(':', markerIndex + marker.length);
  if (cursor < 0) return undefined;
  cursor += 1;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  const opener = source[cursor];
  if (!['{', '[', '"'].includes(opener)) return undefined;
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : '"';
  let depth = opener === '"' ? 0 : 1;
  let inString = opener === '"';
  let escaped = false;
  for (let index = cursor + 1; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        if (opener === '"') {
          try { return JSON.parse(source.slice(cursor, index + 1)); } catch { return undefined; }
        }
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opener) depth += 1;
    if (char === closer) depth -= 1;
    if (depth === 0) {
      try { return JSON.parse(source.slice(cursor, index + 1)); } catch { return undefined; }
    }
  }
  return undefined;
}
