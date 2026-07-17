import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleHelp, FileText, Sparkles,
} from 'lucide-react';
import { getConfirmedCurrentChapterContract, tryParseJson } from './state.js';
import ChapterLogicAlignment from './ChapterLogicAlignment.jsx';
import {
  ArtifactModeToolbar, hasContent, RawDataDetails, ReadableValue,
  StructureEditingPane, StructuredArtifactEditor,
} from './ArtifactReaderShared.jsx';

export default function DraftWorkshop({ artifact, workspace, onSuggestionChange, readOnly = false }) {
  const [viewMode, setViewMode] = useState('read');
  const suggestion = tryParseJson(artifact.suggestion);
  const draft = extractDraft(suggestion);
  const title = extractTitle(suggestion) || workspace.currentChapter?.title || '未命名章节';
  const chapterId = extractChapterId(suggestion) || `CHAPTER ${String(workspace.currentChapter?.number ?? 1).padStart(2, '0')}`;
  const warnings = suggestion && typeof suggestion === 'object' ? suggestion.contractWarnings : [];
  const issues = suggestion && typeof suggestion === 'object' ? suggestion.openIssues : [];
  const contract = extractChapterContract(workspace);
  const busy = artifact.status === 'generating';
  const wordCount = String(draft).replace(/\s+/g, '').length;

  return (
    <section className="draft-workshop">
      <header className="artifact-reader-head draft-reader-head">
        <div>
          <span className={`artifact-label ${readOnly ? 'green' : 'coral'}`}>{readOnly ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}{readOnly ? '作者确认的章节正文' : 'AI 章节正文候选'}</span>
          <h2>像读小说一样检查这一章</h2>
          <p>正文、契约警告和未决问题已经分开。阅读稿不会混入结构字段。</p>
        </div>
        <div className="artifact-reader-status">
          <FileText size={16} />
          <span>{wordCount} 字</span>
          <span>{countArray(warnings)} 项警告</span>
          <span>{countArray(issues)} 项未决</span>
        </div>
      </header>

      <ArtifactModeToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        label="章节候选呈现方式"
        editable={!readOnly}
      />

      <ChapterLogicAlignment
        contract={contract}
        draftText={draft}
        draftTitle={title}
        contractLabel="当前章已确认写作契约"
        draftLabel={readOnly ? '作者确认的小说正文' : 'AI 小说正文候选'}
      />

      {viewMode === 'read' ? (
        <div className="draft-reading">
          {(hasContent(warnings) || hasContent(issues)) && (
            <aside className="draft-notes">
              {hasContent(warnings) && (
                <section className="draft-note warning">
                  <header><AlertTriangle size={16} /><div><strong>契约警告</strong><span>正文与已确认章节契约之间需要作者核对</span></div></header>
                  <ReadableValue value={warnings} />
                </section>
              )}
              {hasContent(issues) && (
                <section className="draft-note issue">
                  <header><CircleHelp size={16} /><div><strong>未决问题</strong><span>模型没有擅自补成正式事实的内容</span></div></header>
                  <ReadableValue value={issues} />
                </section>
              )}
            </aside>
          )}
        </div>
      ) : (
        <StructureEditingPane>
          <StructuredArtifactEditor value={suggestion} onChange={onSuggestionChange} disabled={busy || readOnly} />
        </StructureEditingPane>
      )}

      {suggestion && typeof suggestion === 'object' && (
        <RawDataDetails value={suggestion} label="高级：查看章节候选原始结构" />
      )}
    </section>
  );
}

function extractDraft(value) {
  if (typeof value === 'string') return value;
  return value?.draft ?? value?.content ?? value?.text ?? value?.manuscript ?? '';
}

function extractTitle(value) {
  return value && typeof value === 'object' ? value.title : '';
}

function extractChapterId(value) {
  return value && typeof value === 'object' ? value.chapterId : '';
}

function countArray(value) {
  return Array.isArray(value) ? value.length : hasContent(value) ? 1 : 0;
}

function extractChapterContract(workspace) {
  return getConfirmedCurrentChapterContract(workspace) ?? '';
}
