import { ClipboardCheck, FileText, ListChecks } from 'lucide-react';
import { ReadableValue } from './ArtifactReaderShared.jsx';

export default function ChapterLogicAlignment({
  contract,
  draftText,
  contractLabel = '章节逻辑 / 已确认契约',
  draftLabel = '小说正文 / 当前候选',
  draftTitle = '',
}) {
  const text = String(draftText ?? '').trim();
  const reviewItems = extractReviewItems(contract);

  return (
    <section className="paper-card chapter-logic-alignment" aria-label="章节逻辑与小说正文对应审阅">
      <header className="chapter-alignment-head">
        <div>
          <span className="section-kicker">常驻 Review 视图</span>
          <h2>章节逻辑 ↔ 小说正文</h2>
          <p>契约与正文始终同屏。系统不自动宣称“已经兑现”，每个逻辑点都由作者逐项核对。</p>
        </div>
        <span className="chapter-alignment-count">{text.replace(/\s+/g, '').length} 字正文</span>
      </header>

      <div className="chapter-alignment-grid">
        <article className="chapter-alignment-pane logic">
          <header><ClipboardCheck size={16} /><span>{contractLabel}</span></header>
          <div className="chapter-alignment-scroll">
            {hasContent(contract)
              ? renderContract(contract)
              : <p className="chapter-alignment-empty">当前没有可读取的章节逻辑，不能进行正文对应审阅。</p>}
          </div>
        </article>

        <article className="chapter-alignment-pane draft">
          <header><FileText size={16} /><span>{draftLabel}</span>{draftTitle && <strong>{draftTitle}</strong>}</header>
          <div className="chapter-alignment-scroll manuscript">
            {text
              ? renderParagraphs(text)
              : <p className="chapter-alignment-empty">当前还没有正文候选。生成或手写后，正文会固定显示在这里。</p>}
          </div>
        </article>
      </div>

      <div className="chapter-alignment-checklist">
        <div className="chapter-alignment-checklist-head">
          <span><ListChecks size={16} />逐项对应核对</span>
          <small>{reviewItems.length ? `${reviewItems.length} 个逻辑点` : '未提取到结构化逻辑点'}</small>
        </div>
        {reviewItems.length ? (
          <ol>
            {reviewItems.map((item, index) => (
              <li key={`${index}-${item.label}`}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{item.label}</strong>{item.detail && <p>{item.detail}</p>}</div>
                <em>待作者核对</em>
              </li>
            ))}
          </ol>
        ) : (
          <p className="chapter-alignment-empty">可以直接对照左右两栏；建议在章节契约中补充“必须发生”或节拍列表，以获得逐项核对清单。</p>
        )}
      </div>
    </section>
  );
}

function renderContract(contract) {
  if (typeof contract === 'string') return <pre className="chapter-contract-markdown">{contract}</pre>;
  return <ReadableValue value={contract} />;
}

function renderParagraphs(value) {
  return String(value).replace(/\r\n/g, '\n').split(/\n+/).map((item) => item.trim()).filter(Boolean)
    .map((paragraph, index) => <p key={index}>{paragraph}</p>);
}

function extractReviewItems(contract) {
  if (!contract) return [];
  if (typeof contract === 'string') return extractMarkdownReviewItems(contract);
  if (typeof contract !== 'object' || Array.isArray(contract)) return [];

  const candidates = [
    ...normalizeItems(contract.chapterFunction, '章节功能'),
    ...normalizeItems(contract.requiredBeats ?? contract.candidateBeatSequence ?? contract.beatSequence, '情节节拍'),
    ...normalizeItems(contract.mustInclude ?? contract.mustAchieve, '必须发生'),
  ];
  if (contract.openingBeat) candidates.unshift(normalizeObjectItem(contract.openingBeat, '开场'));
  if (contract.coreConflict ?? contract.chapterGoal ?? contract.goal) {
    candidates.unshift({ label: '核心目标 / 冲突', detail: toText(contract.coreConflict ?? contract.chapterGoal ?? contract.goal) });
  }
  if (contract.firstPayoff ?? contract.payoff) candidates.push(normalizeObjectItem(contract.firstPayoff ?? contract.payoff, '本章兑现'));
  if (contract.chapterEndHook ?? contract.endHook ?? contract.hook) {
    candidates.push({ label: '章末钩子', detail: toText(contract.chapterEndHook ?? contract.endHook ?? contract.hook) });
  }
  return candidates.filter((item) => item?.label || item?.detail).slice(0, 24);
}

function extractMarkdownReviewItems(markdown) {
  const text = String(markdown);
  const sections = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$([\s\S]*?)(?=^#{1,6}\s+|\Z)/gm)];
  const preferred = sections.filter((match) => /本章目标|必须发生|章末问题|读者情绪|字数与节奏/.test(match[1]));
  const items = [];
  for (const match of preferred) {
    const heading = match[1].replace(/[：:]+$/u, '').trim();
    const bullets = match[2].split(/\r?\n/).map((line) => line.match(/^\s*(?:[-*+]|\d+[.)、])\s+(.+?)\s*$/)?.[1]).filter(Boolean);
    if (bullets.length) bullets.forEach((detail) => items.push({ label: heading, detail }));
    else {
      const detail = match[2].replace(/\s+/g, ' ').trim();
      if (detail) items.push({ label: heading, detail });
    }
  }
  return items.slice(0, 24);
}

function normalizeItems(value, fallbackLabel) {
  if (!Array.isArray(value)) return value ? [normalizeObjectItem(value, fallbackLabel)] : [];
  return value.map((item, index) => normalizeObjectItem(item, `${fallbackLabel} ${index + 1}`));
}

function normalizeObjectItem(value, fallbackLabel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { label: fallbackLabel, detail: toText(value) };
  return {
    label: toText(value.beat ?? value.label ?? value.title ?? value.name ?? value.event ?? fallbackLabel),
    detail: toText(value.content ?? value.description ?? value.purpose ?? value.goal ?? value.visibleResult ?? value),
  };
}

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('；');
  return Object.entries(value).map(([key, child]) => `${key}：${toText(child)}`).join('；');
}

function hasContent(value) {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}
