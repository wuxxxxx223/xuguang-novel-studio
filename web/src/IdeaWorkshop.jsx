import { useState } from 'react';
import {
  AlertCircle, ArrowRight, BookOpenText, Check, ChevronDown, History,
  LoaderCircle, MoreHorizontal, PenLine, RefreshCw, Settings2, Sparkles,
} from 'lucide-react';
import { humanizeKey, tryParseJson } from './state.js';

const IDEA_REFINEMENT_FOCI = [
  { label: '核心卖点', instruction: '把这套创意最值得追读的独特体验讲透，并说明如何持续兑现而不是只够写一个开篇。' },
  { label: '主角动机', instruction: '让主角为什么必须行动、为什么不能退出更具体，避免只是被剧情推着走。' },
  { label: '核心机制', instruction: '补清故事核心机制的规则、代价、上限和可持续升级空间。' },
  { label: '开篇冲突', instruction: '把前三章冲突、情绪、首次兑现和章末钩子前置到可直接落地的程度。' },
  { label: '长线悬念', instruction: '建立能跨卷推进的问题、对手与真相，避免核心循环很快重复。' },
];

const IDEA_FIELD_LABELS = {
  projectBasis: '创作基准', confirmedFacts: '已经确认', candidateDirection: '候选方向', decisionAuthority: '作者裁决权',
  highConcept: '高概念', suggestion: '建议方案', centralQuestion: '核心追问', titlePayoff: '书名兑现',
  readerPromise: '读者承诺', readerPromises: '读者承诺', protagonistDrive: '主角动机', whyRetreat: '为什么必须苟',
  whyForcedOut: '为什么被迫出关', decisionPrinciple: '行动原则', comicContrast: '人物反差', growthMechanism: '成长机制',
  name: '名称', positioning: '定位', fourProgressBars: '四条成长线', stableGrowthRules: '稳定成长规则', costs: '代价',
  capsAndUnlocks: '上限与解锁', sustainableUpgradeSpace: '可持续升级空间', coreLoop: '核心循环',
  externalPayoffEngine: '出关爽点发动机', identityMismatch: '身份错位', continuousFaceSlapStructure: '连续打脸结构', benefitContrast: '收益反差',
  openingThreeChapters: '前三章落地', candidateRealmSetup: '候选境界配置', chapter1: '第一章', chapter2: '第二章', chapter3: '第三章',
  firstTenChapterDirection: '前十章方向', longArc: '长线主线', crossVolumeMystery: '跨卷悬念', enemyChain: '敌人升级链',
  protagonistTransformation: '主角变化', volumeCandidates: '分卷候选', volumeArchitecture: '分卷架构', differentiators: '差异化',
  assumptions: '待确认假设', assumption: '假设', basis: '依据', risk: '风险', gaps: '待作者裁决', question: '待决定问题',
  whyItMatters: '为什么重要', recommendedDecision: '建议裁决', status: '状态', phase: '阶段', goal: '目标', conflict: '冲突',
  payoff: '爽点', hook: '钩子', rule: '规则', cost: '代价', cap: '上限',
  source: '来源', function: '作用', effect: '效果', content: '具体内容', stage: '阶段', level: '层级', unlock: '解锁条件',
  implementation: '落地方式', delivery: '兑现方式', promise: '承诺', point: '差异点', volume: '分卷', titleCandidate: '卷名候选',
  openingConflict: '开篇冲突', mainConflict: '主要冲突', externalConflict: '外部冲突', activeDecision: '主角主动选择',
  emotionalBeat: '情绪落点', firstPayoff: '首个爽点', chapterEndHook: '章末钩子', ruleDemonstration: '规则展示',
  mainPlotGain: '主线增量', tangibleGain: '明确收益', resourceGain: '资源收益', strengthGain: '实力收益', safetyGain: '安全收益',
  publicPerception: '外界认知', actualState: '真实状态', actualOverreach: '实际越界点', faceSlapProgression: '打脸递进',
  multiLayerSettlement: '多层清算', protagonistCompetence: '主角能力感', revealedTruth: '揭示真相', reasonForChoice: '选择理由',
  closureGoal: '阶段收束目标', titleCandidates: '候选书名', genreDirection: '题材方向', protagonist: '主角',
  coreConflict: '核心冲突', noveltyCombination: '新鲜组合', openingPromise: '开篇承诺',
};

const IDEA_SECTION_DEFINITIONS = [
  { id: 'highConcept', label: '高概念与书名兑现', description: '这本书究竟讲什么，核心问题是什么，书名如何持续兑现。', paths: ['highConcept'] },
  { id: 'titleCandidates', label: '候选书名', description: '先看名字是否准确传达题材、冲突和阅读期待；不会自动采用。', paths: ['titleCandidates', 'titles'] },
  { id: 'genreDirection', label: '题材与受众方向', description: '判断它更接近哪类作品，以及应该向谁兑现承诺。', paths: ['genreDirection', 'positioning'] },
  { id: 'readerPromise', label: '读者会持续得到什么', description: '可重复兑现的爽点、情绪和追读承诺。', paths: ['readerPromise', 'readerPromises'] },
  { id: 'protagonistDrive', label: '主角为什么必须行动', description: '看人物身份、欲望与退路是否咬合，而不是被剧情拖着走。', paths: ['protagonist', 'protagonistDrive', 'motivation'] },
  { id: 'coreConflict', label: '核心冲突如何持续升级', description: '明确对手、阻力、失败代价，以及矛盾为什么不能轻易解决。', paths: ['coreConflict', 'mainConflict'] },
  { id: 'growthMechanism', label: '核心机制与成长规则', description: '能力或故事机制从哪里来、付出什么、上限在哪里、如何继续升级。', paths: ['growthMechanism', 'recommendedMechanism', 'mechanism'] },
  { id: 'noveltyCombination', label: '这次组合新鲜在哪里', description: '检查题材、人物身份和机制的组合是否形成真正差异，而不是流行元素堆叠。', paths: ['noveltyCombination'] },
  { id: 'coreLoop', label: '一轮故事怎么跑起来', description: '危机、选择、对抗、结果与新问题如何形成可重复但会升级的循环。', paths: ['coreLoop', 'storyLoop'] },
  { id: 'externalPayoffEngine', label: '冲突与兑现发动机', description: '读者期待的情绪、反转、成长或关系变化如何连续发生。', paths: ['externalPayoffEngine', 'payoffEngine', 'outOfSeclusionPayoff'] },
  { id: 'openingThreeChapters', label: '开篇如何落地', description: '开篇冲突、首次兑现、信息增量和章末钩子。', paths: ['openingPromise', 'openingThreeChapters', 'opening', 'goldenThreeChapters'] },
  { id: 'longArc', label: '长线主线与分卷升级', description: '跨卷问题、敌人链条、主角变化和终局方向。', paths: ['longArc', 'longTermArc', 'volumeArchitecture'] },
  { id: 'differentiators', label: '和同类书有什么不同', description: '判断这个方案是不是只换皮，以及差异能否写成长线。', paths: ['differentiators', 'differentiation'] },
  { id: 'assumptions', label: '模型做了哪些待确认假设', description: '这些不是正式设定，需要作者逐项保留、修改或推翻。', paths: ['assumptions'], tone: 'caution' },
  { id: 'gaps', label: '现在最需要作者裁决什么', description: '会直接影响后续逻辑、蓝图和前三章的关键缺口。', paths: ['gaps', 'questions', 'openQuestions'], tone: 'decision' },
  { id: 'projectBasis', label: '已确认边界与候选方向', description: '区分作者已经确认的事实与模型提出的候选内容。', paths: ['projectBasis'], tone: 'neutral' },
];

export default function IdeaWorkshop({ artifact, onSuggestionChange, onFeedbackChange, onRefine, onConfirm, onRestore, configured, onSettings }) {
  const [viewMode, setViewMode] = useState('read');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState(() => new Set());
  const storedIterations = Array.isArray(artifact.iterations) ? artifact.iterations : [];
  const displayIterations = storedIterations.length
    ? storedIterations
    : artifact.suggestion != null
      ? [{ id: 'idea-current-v1', version: 1, source: 'model', suggestion: cloneValue(artifact.suggestion), feedback: '初始建议稿', createdAt: artifact.suggestionAt ?? null }]
      : [];
  const lastStored = storedIterations.at(-1);
  const hasUnversionedEdit = Boolean(lastStored && !sameJsonValue(lastStored.suggestion, artifact.suggestion));
  const currentVersion = hasUnversionedEdit ? nextIdeaVersion(storedIterations) : Math.max(1, ...displayIterations.map((item) => Number(item.version) || 1));
  const feedback = String(artifact.refinementFeedback ?? '');
  const busy = artifact.status === 'generating';
  const canRefine = configured && Boolean(feedback.trim()) && !busy;
  const nextVersion = currentVersion + 1;
  const parsedSuggestion = tryParseJson(artifact.suggestion);
  const ideaSummary = extractIdeaSummary(parsedSuggestion);
  const promises = extractIdeaPromises(parsedSuggestion).slice(0, 3);
  const sections = IDEA_SECTION_DEFINITIONS
    .map((definition) => ({ ...definition, value: firstIdeaPath(parsedSuggestion, definition.paths) }))
    .filter((section) => hasIdeaContent(section.value));

  const addFocus = (focus) => {
    const prefix = feedback.trim() ? `${feedback.trim()}\n` : '';
    onFeedbackChange(`${prefix}- ${focus.instruction}`);
  };
  const toggleSection = (sectionId, open) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (open) next.add(sectionId); else next.delete(sectionId);
      return next;
    });
  };
  const allExpanded = sections.length > 0 && sections.every((section) => expandedSections.has(section.id));
  const toggleAllSections = () => setExpandedSections(allExpanded ? new Set() : new Set(sections.map((section) => section.id)));

  const refinementPanel = (
      <div className="idea-refinement-panel">
        <div className="idea-section-heading"><span>本轮只讨论一组问题</span><small>保留什么 / 推翻什么 / 继续深挖什么</small></div>
        <textarea
          className="idea-feedback-editor"
          rows={6}
          value={feedback}
          onChange={(event) => onFeedbackChange(event.target.value)}
          disabled={busy}
          placeholder="例如：保留普通人误入超自然调查的身份反差，但现在核心机制太像常规升级流。请重做代价、对手升级和连续三轮可兑现的故事循环。"
        />
        <div className="idea-focus-chips" aria-label="快速聚焦">
          {IDEA_REFINEMENT_FOCI.map((focus) => <button type="button" key={focus.label} onClick={() => addFocus(focus)} disabled={busy}>+ {focus.label}</button>)}
        </div>
        <div className="idea-workshop-actions">
          <div className="idea-action-copy">
            <strong>{busy ? `正在生成第 ${nextVersion} 版` : artifact.status === 'error' ? '上次失败，反馈与当前稿都已保留' : feedback.trim() ? `下一步生成第 ${nextVersion} 版完整替代稿` : '先写一条具体反馈，再继续打磨'}</strong>
            <span>模型只返回下一版候选；不会替你确认，也不会推进故事引擎。</span>
          </div>
          <div className="idea-action-buttons">
            <button type="button" className="secondary-button idea-confirm-button" onClick={onConfirm} disabled={busy}><Check size={16} />确认当前版本为 Idea 定稿</button>
            <button type="button" className="primary-button idea-refine-button" onClick={configured ? onRefine : onSettings} disabled={configured ? !canRefine : busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : configured ? <Sparkles size={17} /> : <Settings2 size={17} />}
              {busy ? '正在打磨下一版' : configured ? artifact.status === 'error' ? '重试本轮打磨' : '按反馈继续打磨一版' : '配置 Idea 模型后继续'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>
        </div>
      </div>
  );

  return (
    <section className="idea-workshop" id="idea-refinement">
      <div className="idea-workshop-head">
        <div>
          <span className="artifact-label coral"><Sparkles size={15} />Idea 打磨工作稿</span>
          <h2>第 {currentVersion} 版 · 先看懂，再继续讨论</h2>
          <p>默认把结构化结果翻译成可阅读的创作卡片。原始数据不会再占据首屏。</p>
        </div>
        <div className="idea-version-state">
          <span>{displayIterations.length} 个历史版本</span>
          {hasUnversionedEdit && <em>含作者修改</em>}
        </div>
      </div>

      <div className="idea-view-toolbar" aria-label="Idea 稿件呈现方式">
        <div className="idea-view-switch" role="tablist" aria-label="呈现方式">
          <button type="button" role="tab" aria-selected={viewMode === 'read'} className={viewMode === 'read' ? 'active' : ''} onClick={() => setViewMode('read')}><BookOpenText size={15} />阅读稿</button>
          <button type="button" role="tab" aria-selected={viewMode === 'edit'} className={viewMode === 'edit' ? 'active' : ''} onClick={() => setViewMode('edit')}><PenLine size={15} />结构编辑</button>
        </div>
        {viewMode === 'read' && sections.length > 0 && <button type="button" className="idea-expand-all" onClick={toggleAllSections}>{allExpanded ? '全部收起' : '全部展开'}<ChevronDown size={14} className={allExpanded ? 'rotated' : ''} /></button>}
      </div>

      {viewMode === 'read' ? (
        <div className="idea-reading-draft">
          <section className="idea-summary-hero">
            <div className="idea-summary-index">01</div>
            <div className="idea-summary-main">
              <span>一句话先看懂这本书</span>
              <p className={summaryExpanded ? 'expanded' : ''}>{ideaSummary || '当前建议稿还没有可提取的一句话方案，请切换到结构编辑查看并补充。'}</p>
              {ideaSummary.length > 260 && <button type="button" onClick={() => setSummaryExpanded((value) => !value)}>{summaryExpanded ? '收起完整方案' : '展开完整方案'}<ChevronDown size={13} className={summaryExpanded ? 'rotated' : ''} /></button>}
            </div>
          </section>

          {promises.length > 0 && (
            <section className="idea-promise-strip">
              <div className="idea-section-heading"><span>读者为什么会继续翻页</span><small>优先展示前三个承诺，其余在分区中查看</small></div>
              <div className="idea-promise-grid">
                {promises.map((promise, index) => <article key={index}><b>{String(index + 1).padStart(2, '0')}</b><p>{promise}</p></article>)}
              </div>
            </section>
          )}

          {refinementPanel}

          <section className="idea-section-browser">
            <div className="idea-section-heading"><span>按问题阅读，而不是按 JSON 字段阅读</span><small>{sections.length} 个创作问题 · 默认收起，按需展开</small></div>
            <div className="idea-section-list">
              {sections.map((section) => {
                const open = expandedSections.has(section.id);
                const displayIndex = IDEA_SECTION_DEFINITIONS.findIndex((item) => item.id === section.id) + 2;
                return (
                  <details className={`idea-readable-section ${section.tone ? `tone-${section.tone}` : ''}`} key={section.id} open={open} onToggle={(event) => toggleSection(section.id, event.currentTarget.open)}>
                    <summary>
                      <div className="idea-section-number">{String(displayIndex).padStart(2, '0')}</div>
                      <div className="idea-section-title"><strong>{section.label}</strong><span>{section.description}</span><p>{ideaValuePreview(section.value)}</p></div>
                      <div className="idea-section-toggle"><span>{open ? '收起' : '展开'}</span><ChevronDown size={15} /></div>
                    </summary>
                    <div className="idea-section-content"><IdeaReadableValue value={section.value} /></div>
                  </details>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <>
        <div className="idea-current-draft idea-editing-draft">
          <div className="idea-section-heading"><span>结构编辑模式</span><small>直接修改当前工作稿；修改自动保存，但不会自动定稿</small></div>
          <div className="idea-editing-note"><AlertCircle size={15} /><span>这里保留完整字段编辑能力。阅读和讨论时建议切回“阅读稿”，避免被数据结构干扰。</span></div>
          <EditableValue value={parsedSuggestion} onChange={onSuggestionChange} disabled={busy} />
        </div>
        {refinementPanel}
        </>
      )}



      <details className="idea-history">
        <summary><span><History size={16} />版本历史</span><small>{displayIterations.length} 版 · 只看摘要，可恢复完整版本</small><ChevronDown size={16} /></summary>
        <div className="idea-history-list">
          {[...displayIterations].reverse().map((iteration) => {
            const historySummary = extractIdeaSummary(tryParseJson(iteration.suggestion));
            return (
              <article className="idea-history-item" key={iteration.id ?? iteration.version}>
                <div className="idea-history-meta"><div><strong>第 {iteration.version} 版</strong><span>{formatIdeaSource(iteration.source)}{iteration.model ? ` · ${iteration.model}` : ''}</span></div><time>{iteration.createdAt ? formatDateTime(iteration.createdAt) : '现有工作稿'}</time></div>
                <p className="idea-history-feedback">{iteration.feedback || '未记录该版本的生成反馈'}</p>
                <p className="idea-history-preview">{historySummary ? truncateIdeaText(historySummary, 180) : '这一版没有可提取的摘要，可恢复后查看完整内容。'}</p>
                <button type="button" className="idea-restore-button" onClick={() => onRestore(iteration)} disabled={busy}><RefreshCw size={13} />恢复为当前工作稿</button>
              </article>
            );
          })}
        </div>
      </details>

      <details className="idea-raw-data">
        <summary><span><MoreHorizontal size={16} />高级：查看结构化原始数据</span><small>仅用于核对，不是默认阅读方式</small><ChevronDown size={16} /></summary>
        <pre>{typeof parsedSuggestion === 'string' ? parsedSuggestion : JSON.stringify(parsedSuggestion, null, 2)}</pre>
      </details>
    </section>
  );
}

function EditableValue({ value, onChange, disabled = false }) {
  if (typeof value === 'string' || value == null) return <textarea className="suggestion-editor" rows={12} value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled} />;
  if (Array.isArray(value)) return <textarea className="suggestion-editor" rows={14} value={JSON.stringify(value, null, 2)} onChange={(event) => onChange(tryParseJson(event.target.value))} disabled={disabled} />;
  return (
    <div className="suggestion-fields">
      {Object.entries(value).map(([key, item]) => (
        <label className="field" key={key}>
          <span className="field-label">{ideaFieldLabel(key)}</span>
          {typeof item === 'string'
            ? <textarea rows={Math.max(3, Math.min(8, Math.ceil(item.length / 60)))} value={item} onChange={(event) => onChange({ ...value, [key]: event.target.value })} disabled={disabled} />
            : <textarea rows={6} value={JSON.stringify(item, null, 2)} onChange={(event) => onChange({ ...value, [key]: tryParseJson(event.target.value) })} disabled={disabled} />}
        </label>
      ))}
    </div>
  );
}

function IdeaReadableValue({ value, depth = 0 }) {
  if (!hasIdeaContent(value)) return <span className="idea-empty-value">暂未提供</span>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <div className="idea-readable-prose">{String(value).split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return <ol className="idea-readable-list">{value.map((item, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{String(item)}</p></li>)}</ol>;
    }
    return <div className="idea-readable-stack">{value.map((item, index) => <article className="idea-readable-item" key={index}><div className="idea-readable-item-index">{String(index + 1).padStart(2, '0')}</div><IdeaReadableValue value={item} depth={depth + 1} /></article>)}</div>;
  }
  return <div className={depth > 0 ? 'idea-readable-object nested' : 'idea-readable-object'}>{Object.entries(value).filter(([, item]) => hasIdeaContent(item)).map(([key, item]) => <section className="idea-readable-field" key={key}><h4>{ideaFieldLabel(key)}</h4><IdeaReadableValue value={item} depth={depth + 1} /></section>)}</div>;
}

function ideaFieldLabel(key) { return IDEA_FIELD_LABELS[key] ?? humanizeKey(key); }

function firstIdeaPath(value, paths) {
  for (const path of paths) {
    const result = String(path).split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, value);
    if (hasIdeaContent(result)) return result;
  }
  return null;
}

function hasIdeaContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasIdeaContent);
  if (typeof value === 'object') return Object.values(value).some(hasIdeaContent);
  return true;
}

function extractIdeaSummary(value) {
  if (typeof value === 'string') return value.trim();
  const preferred = firstIdeaPath(value, ['highConcept.suggestion', 'highConcept.oneSentencePitch', 'highConcept', 'projectBasis.candidateDirection', 'candidateDirection', 'oneSentencePitch', 'positioning']);
  return ideaTextLeaves(preferred ?? value, 1).join(' ');
}

function extractIdeaPromises(value) {
  const promiseValue = firstIdeaPath(value, ['readerPromise', 'readerPromises', 'highConcept.readerPromise']);
  if (!hasIdeaContent(promiseValue)) return [];
  if (Array.isArray(promiseValue)) return promiseValue.map((item) => truncateIdeaText(ideaTextLeaves(item, 3).join(' · '), 150)).filter(Boolean);
  if (typeof promiseValue === 'object') return Object.values(promiseValue).map((item) => truncateIdeaText(ideaTextLeaves(item, 3).join(' · '), 150)).filter(Boolean);
  return [truncateIdeaText(String(promiseValue), 150)];
}

function ideaValuePreview(value) { return truncateIdeaText(ideaTextLeaves(value, 3).join(' · '), 150); }

function ideaTextLeaves(value, limit = 3, output = []) {
  if (output.length >= limit || value == null) return output;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    const text = String(value).trim();
    if (text) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) { ideaTextLeaves(item, limit, output); if (output.length >= limit) break; }
    return output;
  }
  for (const item of Object.values(value)) { ideaTextLeaves(item, limit, output); if (output.length >= limit) break; }
  return output;
}

function truncateIdeaText(value, length = 160) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function cloneValue(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function sameJsonValue(left, right) { try { return JSON.stringify(left) === JSON.stringify(right); } catch { return left === right; } }
function nextIdeaVersion(iterations) { return Math.max(0, ...iterations.map((item) => Number(item?.version) || 0)) + 1; }
function formatIdeaSource(source) {
  if (source === 'author-edit') return '作者修改';
  if (source === 'restored') return '恢复版本';
  if (source === 'draw') return '灵感抽卡';
  return '模型建议';
}
function formatDateTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
