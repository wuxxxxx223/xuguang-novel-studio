import { useMemo, useState } from 'react';
import {
  ArrowRight, BarChart3, CheckCircle2, Quote, ScanSearch, ShieldAlert,
  Sparkles, ThumbsUp,
} from 'lucide-react';
import { getConfirmedCurrentChapterContract, tryParseJson } from './state.js';
import ChapterLogicAlignment from './ChapterLogicAlignment.jsx';
import {
  ArtifactModeToolbar, firstText, hasContent, RawDataDetails, ReadableValue,
  StructureEditingPane, StructuredArtifactEditor,
} from './ArtifactReaderShared.jsx';

export default function ReviewWorkshop({ artifact, workspace, onSuggestionChange, readOnly = false }) {
  const [viewMode, setViewMode] = useState('read');
  const suggestion = tryParseJson(artifact.suggestion);
  const findings = useMemo(() => {
    if (Array.isArray(suggestion?.findings)) return suggestion.findings;
    return Array.isArray(artifact.findings) ? artifact.findings : [];
  }, [artifact.findings, suggestion]);
  const scores = suggestion?.scores;
  const strengths = suggestion?.strengths;
  const actions = suggestion?.recommendedActions;
  const verdict = suggestion?.verdict;
  const counts = severityCounts(findings);
  const busy = artifact.status === 'generating';
  const contract = extractChapterContract(workspace);
  const draft = extractDraft(workspace?.stages?.draft?.confirmed ?? workspace?.stages?.draft?.suggestion ?? workspace?.stages?.draft?.text);

  return (
    <section className="review-workshop">
      <header className="artifact-reader-head review-reader-head">
        <div>
          <span className={`artifact-label ${readOnly ? 'green' : 'coral'}`}>{readOnly ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}{readOnly ? '作者采纳的审查结论' : 'AI 只读审查报告'}</span>
          <h2>先看结论和证据，再决定改不改</h2>
          <p>审查只诊断，不会替你改写正文。问题按阻塞程度排序，证据和建议分别呈现。</p>
        </div>
        <div className="artifact-reader-status">
          <ScanSearch size={16} />
          <span className={counts.P0 ? 'risk' : ''}>{counts.P0} 个 P0</span>
          <span className={counts.P1 ? 'warning' : ''}>{counts.P1} 个 P1</span>
          <span>{counts.P2} 个 P2</span>
        </div>
      </header>

      <ArtifactModeToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        label="审查报告呈现方式"
        editable={!readOnly}
      />

      <ChapterLogicAlignment
        contract={contract}
        draftText={draft.text}
        draftTitle={draft.title}
        contractLabel="本章已确认逻辑"
        draftLabel="本轮审查对应的小说正文"
      />

      {viewMode === 'read' ? (
        <div className="review-reading">
          <section className="review-verdict">
            <div className={`review-verdict-mark ${counts.P0 ? 'blocked' : counts.P1 ? 'warning' : 'clear'}`}>
              {counts.P0 || counts.P1 ? <ShieldAlert size={21} /> : <CheckCircle2 size={21} />}
            </div>
            <div>
              <span>本轮审查结论</span>
              <p>{firstText(verdict) || '当前报告没有提供明确总评，请继续检查下方问题清单。'}</p>
            </div>
          </section>

          {hasContent(scores) && <ScoreOverview scores={scores} />}

          <section className="review-findings-section">
            <div className="idea-section-heading">
              <span>问题清单</span>
              <small>{findings.length} 项发现 · P0/P1 优先处理</small>
            </div>
            {findings.length ? <FindingCards findings={findings} /> : (
              <div className="review-clear-state"><CheckCircle2 size={19} /><span>当前报告没有列出具体问题。</span></div>
            )}
          </section>

          {(hasContent(strengths) || hasContent(actions)) && (
            <div className="review-closing-grid">
              {hasContent(strengths) && (
                <section className="review-strengths">
                  <header><ThumbsUp size={16} /><div><strong>这一章已经做对什么</strong><span>修改时应尽量保留</span></div></header>
                  <ReadableValue value={strengths} />
                </section>
              )}
              {hasContent(actions) && (
                <section className="review-actions">
                  <header><ArrowRight size={16} /><div><strong>建议处理顺序</strong><span>先结构，后语言表面</span></div></header>
                  <ReadableValue value={actions} />
                </section>
              )}
            </div>
          )}
        </div>
      ) : (
        <StructureEditingPane>
          <StructuredArtifactEditor value={suggestion} onChange={onSuggestionChange} disabled={busy || readOnly} />
        </StructureEditingPane>
      )}

      <RawDataDetails value={suggestion} label="高级：查看审查报告原始结构" />
    </section>
  );
}

function ScoreOverview({ scores }) {
  const entries = normalizeScores(scores);
  if (!entries.length) return null;
  return (
    <section className="review-score-overview">
      <div className="idea-section-heading">
        <span>评分概览</span>
        <small>用于定位薄弱环节，不替代具体证据</small>
      </div>
      <div className="review-score-grid">
        {entries.map(([label, display, percent]) => (
          <article key={label}>
            <header><span>{label}</span><strong>{display}</strong></header>
            <div><i style={{ width: `${percent}%` }} /></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FindingCards({ findings }) {
  return (
    <div className="review-finding-list">
      {findings
        .map((finding, index) => ({ finding, index, severity: normalizeSeverity(finding) }))
        .sort((left, right) => severityOrder(left.severity) - severityOrder(right.severity))
        .map(({ finding, index, severity }) => (
          <article className={`review-finding severity-${severity.toLowerCase()}`} key={finding?.id ?? index}>
            <header>
              <span>{severity}</span>
              <div>
                <h3>{finding?.title ?? finding?.issue ?? finding?.category ?? `审查发现 ${index + 1}`}</h3>
                {finding?.category && <p>{finding.category}</p>}
              </div>
            </header>
            {hasContent(finding?.description ?? finding?.detail) && (
              <div className="review-finding-summary"><ReadableValue value={finding.description ?? finding.detail} /></div>
            )}
            <div className="review-finding-evidence">
              {hasContent(finding?.evidence) && (
                <section>
                  <h4><Quote size={14} />正文证据</h4>
                  <ReadableValue value={finding.evidence} />
                </section>
              )}
              {hasContent(finding?.impact) && (
                <section>
                  <h4><BarChart3 size={14} />造成的影响</h4>
                  <ReadableValue value={finding.impact} />
                </section>
              )}
            </div>
            {hasContent(finding?.suggestion) && (
              <div className="review-finding-action">
                <strong><ArrowRight size={14} />处理建议</strong>
                <ReadableValue value={finding.suggestion} />
              </div>
            )}
          </article>
        ))}
    </div>
  );
}

function normalizeScores(scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return [];
  return Object.entries(scores).map(([key, value]) => {
    const label = scoreLabel(key);
    const numeric = Number.parseFloat(String(value).match(/-?\d+(\.\d+)?/)?.[0]);
    if (!Number.isFinite(numeric)) return [label, String(value), 50];
    const percent = numeric <= 10 ? numeric * 10 : Math.min(numeric, 100);
    return [label, String(value), Math.max(0, Math.min(percent, 100))];
  });
}

function scoreLabel(key) {
  const labels = {
    logic: '逻辑',
    pacing: '节奏',
    character: '人物一致性',
    characterConsistency: '人物一致性',
    hook: '追读钩子',
    prose: '语言',
    aiTrace: 'AI 痕迹',
    overall: '综合',
  };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function severityCounts(findings) {
  return findings.reduce((counts, finding) => {
    counts[normalizeSeverity(finding)] += 1;
    return counts;
  }, { P0: 0, P1: 0, P2: 0 });
}

function normalizeSeverity(finding) {
  const value = String(finding?.severity ?? finding?.priority ?? finding?.level ?? 'P2').toUpperCase();
  return ['P0', 'P1', 'P2'].includes(value) ? value : 'P2';
}

function severityOrder(value) {
  return value === 'P0' ? 0 : value === 'P1' ? 1 : 2;
}

function extractChapterContract(workspace) {
  return getConfirmedCurrentChapterContract(workspace) ?? '';
}

function extractDraft(value) {
  const parsed = tryParseJson(value);
  if (typeof parsed === 'string') return { text: parsed, title: '' };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { text: '', title: '' };
  return {
    text: String(parsed.draft ?? parsed.content ?? parsed.text ?? parsed.manuscript ?? ''),
    title: String(parsed.title ?? ''),
  };
}
