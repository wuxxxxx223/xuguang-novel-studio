import { useEffect, useState } from 'react';
import {
  AlertTriangle, BookOpenText, ChevronDown, MoreHorizontal, PenLine,
} from 'lucide-react';
import { humanizeKey } from './state.js';

const FIELD_LABELS = {
  status: '当前状态',
  confirmedFacts: '已确认事实',
  candidateCoreSellingPoint: '候选核心卖点',
  candidateReaderPromises: '读者承诺',
  candidateNarrativeLoop: '叙事循环',
  candidateToneExecution: '文风执行',
  decisionAuthority: '裁决边界',
  id: '标识',
  candidateName: '候选姓名',
  role: '角色作用',
  confirmedCore: '已确认核心',
  candidateProfile: '候选角色画像',
  from: '关系起点',
  to: '关系终点',
  type: '关系类型',
  confirmedBasis: '已确认依据',
  candidateDynamic: '候选互动',
  boundary: '关系边界',
  payoff: '关系兑现',
  volume: '卷序',
  candidateTitle: '候选卷名',
  protagonistGoal: '主角目标',
  externalConflict: '外部冲突',
  phaseBeats: '阶段节拍',
  resourceSettlement: '资源结算',
  closure: '本卷收束',
  hook: '卷末钩子',
  nextVolumeHook: '下卷钩子',
  chapterNumber: '章节序号',
  chapterId: '章节标识',
  chapterFunction: '章节功能',
  confirmedStartingConditions: '已确认开局条件',
  candidateQuantifiedState: '量化状态',
  candidatePOV: '叙事视角',
  openingBeat: '开场节拍',
  coreConflict: '核心冲突',
  candidateBeatSequence: '节拍顺序',
  protagonistDecision: '主角决定',
  firstPayoff: '首次兑现',
  resourceAndClueSettlement: '资源与线索结算',
  emotionalBeat: '情绪落点',
  comicBeat: '诙谐节拍',
  chapterEndHook: '章末钩子',
  endState: '章节结束状态',
  writingConstraints: '写作约束',
  beat: '节拍',
  content: '内容',
  purpose: '作用',
  category: '类别',
  question: '待决定问题',
  recommendedCandidate: '建议候选',
  title: '标题',
  draft: '正文候选',
  contractWarnings: '契约警告',
  openIssues: '未决问题',
  verdict: '审查结论',
  scores: '评分',
  findings: '审查发现',
  strengths: '有效之处',
  recommendedActions: '建议处理顺序',
  severity: '优先级',
  evidence: '证据',
  impact: '影响',
  suggestion: '处理建议',
  issue: '问题',
  description: '说明',
  directness: '直给程度',
  humor: '诙谐方式',
  爽点: '爽点执行',
  hookRule: '钩子规则',
};

export function ArtifactModeToolbar({
  viewMode, onViewModeChange, expanded, onToggleExpanded, label = '产物呈现方式', editable = true,
}) {
  return (
    <div className="idea-view-toolbar artifact-view-toolbar" aria-label={label}>
      <div className="idea-view-switch" role="group" aria-label="呈现方式">
        <button
          type="button"
          aria-pressed={viewMode === 'read'}
          className={viewMode === 'read' ? 'active' : ''}
          onClick={() => onViewModeChange('read')}
        >
          <BookOpenText size={15} />阅读稿
        </button>
        {editable && (
          <button
            type="button"
            aria-pressed={viewMode === 'edit'}
            className={viewMode === 'edit' ? 'active' : ''}
            onClick={() => onViewModeChange('edit')}
          >
            <PenLine size={15} />结构编辑
          </button>
        )}
      </div>
      {viewMode === 'read' && onToggleExpanded && (
        <button type="button" className="idea-expand-all" onClick={onToggleExpanded}>
          {expanded ? '全部收起' : '全部展开'}
          <ChevronDown size={14} className={expanded ? 'rotated' : ''} />
        </button>
      )}
    </div>
  );
}

export function StructuredArtifactEditor({ value, onChange, disabled = false }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (Array.isArray(value)) {
      return <BufferedJsonTextarea value={value} onCommit={onChange} disabled={disabled} rows={18} className="suggestion-editor artifact-structure-textarea" />;
    }
    return (
      <textarea
        className="suggestion-editor artifact-structure-textarea"
        rows={18}
        value={value == null ? '' : String(value)}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    );
  }
  return (
    <div className="suggestion-fields artifact-structure-fields">
      {Object.entries(value).map(([key, item]) => (
        <label className="field" key={key}>
          <span className="field-label">{fieldLabel(key)}</span>
          {typeof item === 'string' ? (
            <textarea
              rows={editorRows(item)}
              value={item}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              disabled={disabled}
            />
          ) : (
            <BufferedJsonTextarea
              value={item}
              onCommit={(nextItem) => onChange({ ...value, [key]: nextItem })}
              disabled={disabled}
              rows={editorRows(item)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function BufferedJsonTextarea({ value, onCommit, disabled, rows, className = '' }) {
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setText(serialized);
  }, [dirty, serialized]);

  const validate = (nextText) => {
    try {
      JSON.parse(nextText);
      setError('');
      return true;
    } catch {
      setError('结构尚未完整，修正后再移出输入框。');
      return false;
    }
  };

  const commit = () => {
    if (!dirty || !validate(text)) return;
    onCommit(JSON.parse(text));
    setDirty(false);
  };

  return (
    <div className="json-buffer-editor">
      <textarea
        className={className}
        rows={rows}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
          validate(event.target.value);
        }}
        onBlur={commit}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      />
      {(error || dirty) && <small className={error ? 'json-buffer-error' : 'json-buffer-pending'}>{error || '修改已暂存，移出输入框后应用。'}</small>}
    </div>
  );
}

export function StructureEditingPane({ children }) {
  return (
    <div className="artifact-structure-editing">
      <div className="idea-section-heading">
        <span>结构编辑模式</span>
        <small>修改会保存到当前建议稿，但不会自动确认</small>
      </div>
      <div className="idea-editing-note">
        <AlertTriangle size={15} />
        <span>这里保留模型需要的结构字段。正常阅读和讨论请切回“阅读稿”。</span>
      </div>
      {children}
    </div>
  );
}

export function RawDataDetails({ value, label = '高级：查看结构化原始数据' }) {
  return (
    <details className="idea-raw-data artifact-raw-data">
      <summary>
        <span><MoreHorizontal size={16} />{label}</span>
        <small>仅用于排错和字段核对，不是默认阅读方式</small>
        <ChevronDown size={16} />
      </summary>
      <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function ReadableValue({ value, depth = 0, className = '' }) {
  if (!hasContent(value)) return <span className="artifact-empty">暂未提供</span>;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return <div className={`artifact-readable-prose ${className}`.trim()}>{String(value).split(/\n{2,}/).map((text, index) => <p key={index}>{text}</p>)}</div>;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
      return (
        <ol className="artifact-readable-list">
          {value.map((item, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{String(item)}</p></li>)}
        </ol>
      );
    }
    return (
      <div className="artifact-readable-stack">
        {value.map((item, index) => (
          <article key={index}>
            <span className="artifact-readable-index">{String(index + 1).padStart(2, '0')}</span>
            <ReadableValue value={item} depth={depth + 1} />
          </article>
        ))}
      </div>
    );
  }
  return (
    <div className={`artifact-readable-object ${depth ? 'nested' : ''}`.trim()}>
      {Object.entries(value).filter(([, item]) => hasContent(item)).map(([key, item]) => (
        <section key={key}>
          <h4>{fieldLabel(key)}</h4>
          <ReadableValue value={item} depth={depth + 1} />
        </section>
      ))}
    </div>
  );
}

export function fieldLabel(key) {
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

export function hasContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasContent);
  if (typeof value === 'object') return Object.values(value).some(hasContent);
  return true;
}

export function firstText(value) {
  return collectLeafText(value)[0] || '';
}

export function collectLeafText(value) {
  if (!hasContent(value)) return [];
  if (['string', 'number', 'boolean'].includes(typeof value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectLeafText);
  return Object.values(value).flatMap(collectLeafText);
}

export function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return hasContent(value) ? 1 : 0;
}

export function truncateText(value, limit = 110) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function editorRows(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return Math.max(6, Math.min(20, Math.ceil(text.length / 78)));
}
