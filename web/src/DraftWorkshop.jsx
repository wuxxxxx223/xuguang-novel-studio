import { useEffect, useState } from 'react';
import {
  AlertTriangle, BookOpenText, Check, CheckCircle2, ChevronDown, CircleHelp,
  FileText, Flag, ListChecks, LoaderCircle, MessageSquareText, PenLine, Settings2,
  Plus, Sparkles, Trash2, WandSparkles, X,
} from 'lucide-react';
import { tryParseJson } from './state.js';
import {
  ArtifactModeToolbar, hasContent, RawDataDetails, ReadableValue,
  StructureEditingPane, StructuredArtifactEditor,
} from './ArtifactReaderShared.jsx';

const SECTION_STYLE_PRESETS = [
  '加强画面描写',
  '多一些人物对话',
  '加一点幽默',
  '放慢并细写',
  '节奏更快',
  '加强情绪拉扯',
];
const SECTION_LENGTH_OPTIONS = [
  { id: 'short', label: '少写', hint: '快速带过', weight: 0.65 },
  { id: 'normal', label: '正常', hint: '均衡展开', weight: 1 },
  { id: 'long', label: '多写', hint: '增加细节', weight: 1.4 },
  { id: 'focus', label: '重点展开', hint: '本章重点', weight: 1.8 },
];

export default function DraftWorkshop({
  artifact, workspace, settings, onSuggestionChange, onAnnotationsChange,
  onRewriteParagraph, onApplyRewrite, onDeleteParagraph, configured, onSettings, readOnly = false,
  onOutlineFeedbackChange, onOutlineAnnotationsChange, onOutlineRestore, onOutlineChange,
  onGenerationNotesChange, onGenerationTargetsChange, onGenerateComparison, onAdoptCandidate,
  onOutlineRefine, onOutlineGenerate, onOutlineConfirm, onConfirmDraft, outlineConfigured,
  onEditChapterContract,
}) {
  const [viewMode, setViewMode] = useState('read');
  const [workbenchMode, setWorkbenchMode] = useState(artifact.chapterOutline?.status === 'confirmed' ? 'draft' : 'outline');
  const suggestion = tryParseJson(artifact.suggestion);
  const draft = extractDraft(suggestion);
  const recoveredMalformedJson = typeof suggestion === 'string' && recoverDraftFromBrokenJson(suggestion) != null;
  const title = extractTitle(suggestion) || workspace.currentChapter?.title || '未命名章节';
  const chapterId = extractChapterId(suggestion) || `CHAPTER ${String(workspace.currentChapter?.number ?? 1).padStart(2, '0')}`;
  const warnings = suggestion && typeof suggestion === 'object'
    ? suggestion.contractWarnings
    : recoveredMalformedJson
      ? ['模型返回的 JSON 格式损坏，叙光已提取并还原可读正文。']
      : [];
  const issues = suggestion && typeof suggestion === 'object'
    ? suggestion.openIssues
    : recoveredMalformedJson
      ? ['当前响应结尾可能被截断，请检查最后一段；必要时使用“全部重新生成”。']
      : [];
  const busy = artifact.status === 'generating';
  const generationNotes = normalizeDraftGenerationNotes(artifact.generationNotes);
  const wordCount = String(draft).replace(/\s+/g, '').length;
  const lengthInRange = wordCount >= generationNotes.minChars && wordCount <= generationNotes.maxChars;
  const hasDraft = Boolean(String(draft).trim());
  const paragraphs = splitParagraphs(draft);
  const annotations = Array.isArray(artifact.paragraphAnnotations) ? artifact.paragraphAnnotations : [];
  const chapterOutline = artifact.chapterOutline ?? { status: 'empty', suggestion: null, confirmed: null, feedback: '' };
  const outlineValue = chapterOutline.status === 'confirmed' ? chapterOutline.confirmed : chapterOutline.suggestion;
  const confirmedContract = workspace.currentChapter?.contract?.status === 'confirmed'
    ? workspace.currentChapter.contract.confirmed
    : null;
  const contractHook = chapterContractHook(confirmedContract);

  const addAnnotation = (paragraphIndex, sourceText) => {
    const existing = annotations.find((item) => item.paragraphIndex === paragraphIndex && item.status !== 'applied');
    if (existing) return;
    const now = new Date().toISOString();
    onAnnotationsChange((items) => [...items, {
      id: globalThis.crypto?.randomUUID?.() ?? `paragraph-note-${Date.now()}-${paragraphIndex}`,
      paragraphIndex,
      sourceText,
      instruction: '',
      status: 'editing',
      candidate: '',
      changeSummary: '',
      continuityWarnings: [],
      error: null,
      createdAt: now,
      updatedAt: now,
    }]);
  };

  const updateAnnotation = (annotationId, patch) => {
    onAnnotationsChange((items) => items.map((item) => item.id === annotationId
      ? { ...item, ...patch, updatedAt: new Date().toISOString() }
      : item));
  };

  const removeAnnotation = (annotationId) => {
    onAnnotationsChange((items) => items.filter((item) => item.id !== annotationId));
  };

  const deleteParagraph = (paragraphIndex, paragraph) => {
    if (!globalThis.confirm(`确定删除正文第 ${paragraphIndex + 1} 段吗？\n\n删除后，其余段落会自动重新编号。`)) return;
    onDeleteParagraph(paragraphIndex, paragraph);
  };

  return (
    <section className="draft-workshop">
      {confirmedContract && (
        <section className="chapter-contract-location-card">
          <div className="chapter-contract-location-icon"><ListChecks size={18} /></div>
          <div>
            <strong>章节契约在“小说蓝图”阶段单独确认</strong>
            <p>{contractHook ? `当前章末钩子：${contractHook}` : '当前契约没有设置章末钩子，将按自然收束处理。'}</p>
          </div>
          {!readOnly && (
            <button type="button" className="secondary-button" onClick={onEditChapterContract} disabled={busy || !onEditChapterContract}>
              <PenLine size={15} />修改章节契约
            </button>
          )}
        </section>
      )}
      <nav className="draft-workbench-switch" aria-label="章节写作流程">
        <button type="button" className={workbenchMode === 'outline' ? 'active' : ''} onClick={() => setWorkbenchMode('outline')}>
          <MessageSquareText size={17} /><span><strong>情节大纲工作台</strong><small>批注、重生成、版本打磨</small></span>
        </button>
        <button type="button" className={workbenchMode === 'draft' ? 'active' : ''} onClick={() => setWorkbenchMode('draft')} disabled={chapterOutline.status !== 'confirmed'}>
          <FileText size={17} /><span><strong>正文横向对比</strong><small>{chapterOutline.status === 'confirmed' ? '多模型并行写作与选稿' : '确认大纲后解锁'}</small></span>
        </button>
      </nav>

      {workbenchMode === 'outline' && <ChapterOutlinePanel
        mode="outline"
        outline={chapterOutline}
        value={outlineValue}
        generationNotes={generationNotes}
        annotations={chapterOutline.annotations ?? {}}
        iterations={chapterOutline.iterations ?? []}
        readOnly={readOnly}
        configured={outlineConfigured}
        onSettings={onSettings}
        onFeedbackChange={onOutlineFeedbackChange}
        onAnnotationsChange={onOutlineAnnotationsChange}
        onRestore={onOutlineRestore}
        onOutlineChange={onOutlineChange}
        onGenerationNotesChange={onGenerationNotesChange}
        onRefine={onOutlineRefine}
        onGenerateInitial={onOutlineGenerate}
        onConfirm={onOutlineConfirm}
      />}

      {workbenchMode === 'draft' && <ChapterOutlinePanel
        mode="draft"
        outline={chapterOutline}
        value={chapterOutline.confirmed}
        generationNotes={generationNotes}
        readOnly={readOnly}
        configured={outlineConfigured}
        onSettings={onSettings}
        onOutlineChange={onOutlineChange}
        onGenerationNotesChange={onGenerationNotesChange}
      />}

      {workbenchMode === 'draft' && <MultiModelDraftPanel
        artifact={artifact}
        settings={settings}
        generationNotes={generationNotes}
        readOnly={readOnly}
        onTargetsChange={onGenerationTargetsChange}
        onGenerate={onGenerateComparison}
        onAdopt={onAdoptCandidate}
      />}

      {workbenchMode === 'draft' && !hasDraft && (
        <section className="paper-card draft-awaiting-outline">
          <FileText size={20} />
          <div>
            <strong>{chapterOutline.status === 'confirmed' ? '情节大纲已确认，等待生成正文' : '先完成章节情节大纲'}</strong>
            <p>{chapterOutline.status === 'confirmed' ? `使用页面底部“根据确认大纲生成正文”，目标约 ${generationNotes.targetChars} 字。` : '正文不会跳过大纲直接生成；先规划、讨论并确认本章情节。'}</p>
          </div>
        </section>
      )}

      {workbenchMode === 'draft' && hasDraft && <>
      <header className="artifact-reader-head draft-reader-head">
        <div>
          <span className={`artifact-label ${readOnly ? 'green' : 'coral'}`}>{readOnly ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}{readOnly ? '作者确认的章节正文' : 'AI 章节正文候选'}</span>
          <h2>像读小说一样检查这一章</h2>
          <p>正文、契约警告和未决问题已经分开。阅读稿不会混入结构字段。</p>
        </div>
        <div className="artifact-reader-status">
          <FileText size={16} />
          <span className={`draft-length-status ${lengthInRange ? 'is-valid' : 'is-invalid'}`}>
            {wordCount} / {generationNotes.minChars}–{generationNotes.maxChars} 字
          </span>
          <span>{countArray(warnings)} 项警告</span>
          <span>{countArray(issues)} 项未决</span>
        </div>
      </header>

      {!lengthInRange && (
        <div className="draft-length-warning" role="status">
          <AlertTriangle size={15} />
          当前正文为 {wordCount} 字，需调整到 {generationNotes.minChars}–{generationNotes.maxChars} 字后才能确认。
        </div>
      )}

      <ArtifactModeToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        label="章节候选呈现方式"
        editable={!readOnly}
      />

      {viewMode === 'read' ? (
        <div className="draft-reading">
          <article className="draft-manuscript paragraph-annotation-manuscript">
            <header>
              <span>{chapterId}</span>
              <h2>{title}</h2>
              <div>
                <strong>{paragraphs.length}</strong>
                <small>个正文段落</small>
              </div>
            </header>
            <div className="draft-manuscript-body annotated-draft-body">
              {paragraphs.length ? paragraphs.map((paragraph, paragraphIndex) => {
                const annotation = annotations.find((item) => item.paragraphIndex === paragraphIndex && item.status !== 'applied');
                const rewriting = annotation?.status === 'rewriting';
                const ready = annotation?.status === 'ready' && Boolean(annotation.candidate);
                return (
                  <section className={`annotated-paragraph ${annotation ? 'has-annotation' : ''}`} key={`${paragraphIndex}-${paragraph.slice(0, 24)}`}>
                    <div className="annotated-paragraph-copy">
                      <span className="paragraph-number">P{paragraphIndex + 1}</span>
                      <p>{paragraph}</p>
                      {!readOnly && (
                        <div className="paragraph-inline-actions">
                          {!annotation && (
                            <button type="button" className="paragraph-annotate-button" onClick={() => addAnnotation(paragraphIndex, paragraph)} disabled={busy}>
                              <MessageSquareText size={14} />批注此段
                            </button>
                          )}
                          <button type="button" className="paragraph-delete-button" onClick={() => deleteParagraph(paragraphIndex, paragraph)} disabled={busy}>
                            <Trash2 size={14} />删除此段
                          </button>
                        </div>
                      )}
                    </div>
                    {annotation && (
                      <aside className="paragraph-annotation-card">
                        <header>
                          <div><MessageSquareText size={15} /><strong>第 {paragraphIndex + 1} 段批注</strong></div>
                          <button type="button" className="icon-button" onClick={() => removeAnnotation(annotation.id)} disabled={rewriting} aria-label="删除这条批注"><Trash2 size={14} /></button>
                        </header>
                        <textarea
                          rows={4}
                          value={annotation.instruction}
                          onChange={(event) => updateAnnotation(annotation.id, { instruction: event.target.value, status: annotation.status === 'ready' ? 'editing' : annotation.status, candidate: annotation.status === 'ready' ? '' : annotation.candidate })}
                          disabled={rewriting}
                          placeholder="例如：压缩解释，突出她发现异常时的身体反应；保留最后一句，但让语气更克制。"
                        />
                        {annotation.error?.message && <div className="paragraph-rewrite-error"><AlertTriangle size={14} />{annotation.error.message}</div>}
                        {ready && (
                          <div className="paragraph-rewrite-candidate">
                            <div className="rewrite-candidate-heading"><WandSparkles size={15} /><strong>局部重写候选</strong><span>{annotation.provider}{annotation.model ? ` · ${annotation.model}` : ''}</span></div>
                            <p>{annotation.candidate}</p>
                            {annotation.changeSummary && <small>{annotation.changeSummary}</small>}
                            {annotation.continuityWarnings?.length > 0 && (
                              <ul>{annotation.continuityWarnings.map((warning, index) => <li key={index}>{String(warning)}</li>)}</ul>
                            )}
                          </div>
                        )}
                        <div className="paragraph-annotation-actions">
                          {ready && <button type="button" className="secondary-button" onClick={() => updateAnnotation(annotation.id, { status: 'editing', candidate: '' })}><X size={15} />保留原段</button>}
                          {ready && <button type="button" className="primary-button" onClick={() => onApplyRewrite(annotation.id)}><Check size={15} />采用并替换此段</button>}
                          {!ready && <button type="button" className="primary-button" onClick={configured ? () => onRewriteParagraph(annotation.id) : onSettings} disabled={configured ? rewriting || !annotation.instruction.trim() : rewriting}>
                            {rewriting ? <LoaderCircle size={16} className="spin" /> : configured ? <WandSparkles size={16} /> : <Settings2 size={16} />}
                            {rewriting ? '正在重写这一段' : configured ? '按批注重写此段' : '配置章节写作模型'}
                          </button>}
                        </div>
                      </aside>
                    )}
                  </section>
                );
              }) : <p className="artifact-empty">当前候选没有可批注的正文段落。</p>}
            </div>
          </article>

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
      </>}
      {workbenchMode === 'draft' && hasDraft && !readOnly && (
        <section className="draft-local-confirm-bar">
          <div><strong>{lengthInRange ? '当前正文可以进入审查' : '当前正文尚未通过字数门禁'}</strong><span>{lengthInRange ? '确认后才会成为作者采用稿，其他模型候选仍保留。' : `正文需在 ${generationNotes.minChars}–${generationNotes.maxChars} 字之间；可以采用其他模型版本或重新并行生成。`}</span></div>
          <button type="button" className="primary-button" onClick={onConfirmDraft} disabled={!lengthInRange}><Check size={16} />确认采用当前正文</button>
        </section>
      )}
    </section>
  );
}

function MultiModelDraftPanel({ artifact, settings, generationNotes, readOnly, onTargetsChange, onGenerate, onAdopt }) {
  const providers = (settings?.providers ?? []).filter((provider) => provider.configured);
  const targets = Array.isArray(artifact.generationTargets) ? artifact.generationTargets : [];
  const candidates = Array.isArray(artifact.candidates) ? artifact.candidates : [];
  const busy = artifact.status === 'generating';
  const enabledTargets = targets.filter((target) => target.enabled !== false && target.providerId && String(target.model ?? '').trim());

  const updateTarget = (id, patch) => onTargetsChange?.(targets.map((target) => target.id === id ? { ...target, ...patch } : target));
  const removeTarget = (id) => onTargetsChange?.(targets.filter((target) => target.id !== id));
  const addTarget = () => {
    if (targets.length >= 6) return;
    const route = settings?.routes?.writer ?? {};
    onTargetsChange?.([...targets, {
      id: globalThis.crypto?.randomUUID?.() ?? `target-${Date.now()}`,
      providerId: route.providerId || providers[0]?.id || '',
      model: targets.length ? '' : route.model || '',
      enabled: true,
    }]);
  };
  const loadConfiguredRoutes = () => {
    const routes = Object.values(settings?.routes ?? {});
    const unique = [...new Map(routes.filter((route) => route?.providerId && route?.model)
      .map((route) => [`${route.providerId}::${route.model}`, route])).values()].slice(0, 6);
    onTargetsChange?.(unique.map((route, index) => ({ id: `route-target-${index + 1}-${Date.now()}`, providerId: route.providerId, model: route.model, enabled: true })));
  };

  return (
    <section className="paper-card multi-model-draft-panel">
      <header>
        <div><span>多模型并行写作</span><h2>让不同模型同时写，再横向选稿</h2><p>每个模型读取同一份已确认大纲、字数计划和写作备注；结果互不覆盖。</p></div>
        <strong>{busy ? <><LoaderCircle size={15} className="spin" />生成中</> : `${candidates.filter((item) => item.status === 'ready').length} 个可读版本`}</strong>
      </header>
      {!readOnly && (
        <div className="parallel-model-config">
          <div className="parallel-model-toolbar">
            <div><strong>本轮参与模型</strong><span>最多 6 个；不同中转站可以填写各自支持的模型 ID</span></div>
            <div>
              <button type="button" className="secondary-button compact-button" onClick={loadConfiguredRoutes} disabled={busy}>载入已有路由</button>
              <button type="button" className="secondary-button compact-button" onClick={addTarget} disabled={busy || targets.length >= 6}><Plus size={14} />添加模型</button>
            </div>
          </div>
          <div className="parallel-model-targets">
            {targets.map((target, index) => (
              <div className="parallel-model-target" key={target.id}>
                <label className="parallel-model-enabled"><input type="checkbox" checked={target.enabled !== false} onChange={(event) => updateTarget(target.id, { enabled: event.target.checked })} disabled={busy} /><span>{index + 1}</span></label>
                <select value={target.providerId} onChange={(event) => updateTarget(target.id, { providerId: event.target.value })} disabled={busy} aria-label={`并行模型 ${index + 1} 厂商`}>
                  <option value="">选择厂商</option>
                  {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}
                </select>
                {(() => {
                  const targetProvider = providers.find((provider) => provider.id === target.providerId);
                  const availableModels = targetProvider?.models ?? [];
                  return availableModels.length ? (
                    <select className="parallel-model-picker" value={target.model} onChange={(event) => updateTarget(target.id, { model: event.target.value })} disabled={busy} aria-label={`并行模型 ${index + 1} 模型`}>
                      <option value="">选择模型</option>
                      {target.model && !availableModels.includes(target.model) && <option value={target.model}>{target.model}（原配置）</option>}
                      {availableModels.map((model) => <option value={model} key={model}>{model}</option>)}
                    </select>
                  ) : <input value={target.model} onChange={(event) => updateTarget(target.id, { model: event.target.value })} disabled={busy} placeholder="模型 ID（可在模型配置中自动获取）" spellCheck="false" />;
                })()}
                <button type="button" className="icon-button" onClick={() => removeTarget(target.id)} disabled={busy} aria-label={`删除并行模型 ${index + 1}`}><Trash2 size={14} /></button>
              </div>
            ))}
            {!targets.length && <div className="parallel-model-empty">还没有对比模型。可以载入已有路由，或手动添加厂商和模型 ID。</div>}
          </div>
          <div className="parallel-generate-action">
            <span>统一目标：{generationNotes.targetChars} 字，允许 {generationNotes.minChars}–{generationNotes.maxChars} 字</span>
            <button type="button" className="primary-button" onClick={onGenerate} disabled={busy || enabledTargets.length < 2}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{busy ? '多个模型正在同时写作' : `并行生成 ${enabledTargets.length} 个正文版本`}
            </button>
          </div>
        </div>
      )}
      {candidates.length > 0 && (
        <div className="draft-comparison-grid">
          {candidates.map((candidate) => {
            const body = extractDraft(candidate.suggestion);
            const chars = String(body).replace(/\s+/g, '').length;
            const selected = artifact.selectedCandidateId === candidate.id;
            return (
              <article className={`draft-comparison-card status-${candidate.status} ${selected ? 'selected' : ''}`} key={candidate.id}>
                <header><div><span>{candidate.providerName || '模型渠道'}</span><h3>{candidate.model || '未记录模型'}</h3></div><strong>{candidate.status === 'generating' ? '写作中' : candidate.status === 'error' ? '失败' : `${chars} 字`}</strong></header>
                {candidate.status === 'generating' && <div className="comparison-loading"><LoaderCircle size={22} className="spin" /><span>正在生成完整正文…</span></div>}
                {candidate.status === 'error' && <div className="comparison-error"><AlertTriangle size={18} /><p>{candidate.error?.message || '模型生成失败'}</p></div>}
                {candidate.status === 'ready' && <div className="comparison-manuscript">{splitParagraphs(body).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>)}</div>}
                {candidate.status === 'ready' && !readOnly && <footer><span>{selected ? '当前正文候选' : `${Math.round((candidate.latencyMs || 0) / 1000)} 秒`}</span><button type="button" className={selected ? 'secondary-button' : 'primary-button'} onClick={() => onAdopt(candidate.id)} disabled={selected}>{selected ? <Check size={14} /> : <BookOpenText size={14} />}{selected ? '已采用' : '采用这个版本'}</button></footer>}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ChapterOutlinePanel({ mode = 'outline', outline, value, generationNotes, annotations = {}, iterations = [], configured, onSettings, onFeedbackChange, onAnnotationsChange, onRestore, onOutlineChange, onGenerationNotesChange, onRefine, onGenerateInitial, onConfirm, readOnly }) {
  const busy = outline.status === 'generating';
  const confirmed = outline.status === 'confirmed';
  const feedback = String(outline.feedback ?? '');
  const [minChars, setMinChars] = useState(String(generationNotes.minChars));
  const [maxChars, setMaxChars] = useState(String(generationNotes.maxChars));
  const [style, setStyle] = useState(generationNotes.style);
  const [notesError, setNotesError] = useState('');

  useEffect(() => {
    setMinChars(String(generationNotes.minChars));
    setMaxChars(String(generationNotes.maxChars));
    setStyle(generationNotes.style);
    setNotesError('');
  }, [generationNotes.minChars, generationNotes.maxChars, generationNotes.style]);

  const notesChanged = minChars !== String(generationNotes.minChars)
    || maxChars !== String(generationNotes.maxChars)
    || style !== generationNotes.style;

  const saveGenerationNotes = () => {
    const minimum = Number.parseInt(minChars, 10);
    const maximum = Number.parseInt(maxChars, 10);
    if (!Number.isInteger(minimum) || minimum < 500 || minimum > 10000) {
      setNotesError('最少字数请填写 500–10000 之间的整数。');
      return;
    }
    if (!Number.isInteger(maximum) || maximum < minimum + 200 || maximum > 12000) {
      setNotesError('最多字数需比最少字数多至少 200，且不能超过 12000。');
      return;
    }
    onGenerationNotesChange({
      minChars: minimum,
      targetChars: Math.round((minimum + maximum) / 2),
      maxChars: maximum,
      style,
      sectionInstructions: generationNotes.sectionInstructions,
    });
    setNotesError('');
  };
  const readableOutline = normalizeChapterOutlineForReading(value);
  const outlineSectionCount = readableOutline.sections.length;
  return (
    <section className={`paper-card chapter-outline-workshop outline-${outline.status}`} id="chapter-outline-discussion">
      <header className="chapter-outline-head">
        <div>
          <span>{mode === 'draft' ? '正文写作 · 生成设置' : '正文前置 · 情节规划'}</span>
          <h2>{mode === 'draft' ? '正文写作设置' : '章节情节大纲'}</h2>
          <p>{mode === 'draft'
            ? '已确认大纲保持锁定；这里只设置各情节篇幅、正文长度和写作风格。'
            : '用一两分钟看懂这一章会发生什么；这里只讨论故事，不堆写作分析。'}</p>
        </div>
        <strong>{busy ? <><LoaderCircle size={15} className="spin" />生成中</> : confirmed ? <><CheckCircle2 size={15} />已确认</> : value ? <><MessageSquareText size={15} />待讨论</> : <><CircleHelp size={15} />未生成</>}</strong>
      </header>

      {value && mode === 'outline' ? <ChapterOutlineReadable
          value={value}
          generationNotes={generationNotes}
          onOutlineChange={onOutlineChange}
          onGenerationNotesChange={onGenerationNotesChange}
          editingMode={mode}
          annotations={annotations}
          onAnnotationsChange={onAnnotationsChange}
          busy={busy}
          readOnly={readOnly}
        /> : value && mode === 'draft' ? (
        <details className="draft-outline-reference">
          <summary>
            <span>
              <strong>按情节设置篇幅与写法</strong>
              <small>{readableOutline.title || `第 ${readableOutline.chapterNumber || 1} 章`} · {outlineSectionCount} 个情节，默认收起</small>
            </span>
            <span className="draft-outline-reference-action">展开设置 <ChevronDown size={16} /></span>
          </summary>
          <ChapterOutlineReadable
            value={value}
            generationNotes={generationNotes}
            onOutlineChange={onOutlineChange}
            onGenerationNotesChange={onGenerationNotesChange}
            editingMode={mode}
            annotations={annotations}
            onAnnotationsChange={onAnnotationsChange}
            busy={busy}
            readOnly={readOnly}
          />
        </details>
      ) : (
        <div className="chapter-outline-empty">
          <p>先生成一份只讲“本章会发生什么”的情节大纲，不会直接写正文。</p>
          {!readOnly && <button type="button" className="primary-button" onClick={configured ? onGenerateInitial : onSettings} disabled={busy}>{configured ? <Sparkles size={16} /> : <Settings2 size={16} />}{configured ? '生成章节情节大纲' : '配置章节大纲模型'}</button>}
        </div>
      )}

      {value && mode === 'outline' && <RawDataDetails value={value} label="高级：查看章节大纲原始结构" />}

      {mode === 'draft' && <section className="draft-generation-notes">
        <header>
          <div>
            <strong>正文生成备注</strong>
            <span>生成正文和全部重新生成时都会执行；不会修改已经确认的情节大纲。</span>
          </div>
          <small>{notesChanged ? '有未保存修改' : '已保存'}</small>
        </header>
        <div className="draft-length-fields">
          <label>
            <span>最少字数</span>
            <input type="number" min="500" max="10000" step="100" value={minChars} onChange={(event) => setMinChars(event.target.value)} disabled={busy || readOnly} />
          </label>
          <label>
            <span>最多字数</span>
            <input type="number" min="700" max="12000" step="100" value={maxChars} onChange={(event) => setMaxChars(event.target.value)} disabled={busy || readOnly} />
          </label>
          <div className="draft-target-length">
            <span>预计目标</span>
            <strong>{Number.isFinite(Number.parseInt(minChars, 10)) && Number.isFinite(Number.parseInt(maxChars, 10)) ? Math.round((Number.parseInt(minChars, 10) + Number.parseInt(maxChars, 10)) / 2) : '—'} 字</strong>
          </div>
        </div>
        <label className="draft-style-notes">
          <span>风格、节奏和其他要求</span>
          <textarea
            rows={4}
            maxLength={6000}
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            disabled={busy || readOnly}
            placeholder="例如：语言克制自然，减少比喻和破折号；对白占比高一些；开头快速进入冲突，中段加强暧昧拉扯，结尾保留强钩子。"
          />
        </label>
        {notesError && <div className="paragraph-rewrite-error"><AlertTriangle size={14} />{notesError}</div>}
        {!readOnly && (
          <div className="draft-generation-notes-actions">
            <button type="button" className="secondary-button" onClick={saveGenerationNotes} disabled={busy || !notesChanged}>
              <Check size={15} />保存正文生成备注
            </button>
          </div>
        )}
      </section>}

      {mode === 'outline' && value && !readOnly && (
        <div className="chapter-outline-discussion">
          <label>
            <span>讨论这一版情节</span>
            <small>指出要保留、删改、交换顺序或加强的场景；下一版仍是待确认大纲。</small>
            <textarea
              rows={5}
              value={feedback}
              onChange={(event) => onFeedbackChange(event.target.value)}
              disabled={busy}
              placeholder="例如：保留婚礼双双迟到，但把媒体采访提前到中段；减少家长群像，增加男女主第一次替对方圆谎的具体动作，结尾钩子改成两人被迫同住。"
            />
          </label>
          {outline.error?.message && <div className="paragraph-rewrite-error"><AlertTriangle size={14} />{outline.error.message}</div>}
          <div className="chapter-outline-actions">
            <button type="button" className="secondary-button" onClick={onConfirm} disabled={busy}><Check size={16} />确认当前大纲</button>
            <button type="button" className="primary-button" onClick={configured ? onRefine : onSettings} disabled={configured ? busy || (!feedback.trim() && !hasOutlineAnnotations(annotations)) : busy}>
              {busy ? <LoaderCircle size={16} className="spin" /> : configured ? <WandSparkles size={16} /> : <Settings2 size={16} />}
              {busy ? '正在生成下一版' : configured ? '按讨论生成下一版' : '配置章节写作模型'}
            </button>
          </div>
        </div>
      )}
      {mode === 'outline' && iterations.length > 0 && (
        <section className="outline-version-history">
          <header><div><strong>历史大纲版本</strong><span>恢复旧版不会删除其他版本</span></div><small>{iterations.length} 版</small></header>
          <div>{[...iterations].reverse().map((iteration) => (
            <button type="button" onClick={() => onRestore?.(iteration)} disabled={busy || readOnly} key={iteration.id}>
              <span><strong>第 {iteration.version} 版</strong><small>{iteration.providerName || '模型'}{iteration.model ? ` · ${iteration.model}` : ''}</small></span>
              <em>{iteration.feedback ? iteration.feedback.slice(0, 80) : '初始版本'}</em>
            </button>
          ))}</div>
        </section>
      )}
    </section>
  );
}

function ChapterOutlineReadable({ value, generationNotes, editingMode = 'outline', annotations = {}, onAnnotationsChange, onOutlineChange, onGenerationNotesChange, busy, readOnly }) {
  const outline = normalizeChapterOutlineForReading(value);
  const sectionInstructions = generationNotes.sectionInstructions ?? {};
  const sectionWritingPlan = buildSectionWritingPlan(outline.sections, generationNotes);
  const instructionCount = Object.values(sectionInstructions).filter((item) => String(item?.instruction ?? item ?? '').trim()).length;

  const updateSectionInstruction = (section, patch) => {
    const current = sectionInstructions[section.id] ?? {};
    onGenerationNotesChange({
      ...generationNotes,
      sectionInstructions: {
        ...sectionInstructions,
        [section.id]: {
          title: section.title,
          instruction: String(patch.instruction ?? current.instruction ?? '').slice(0, 2000),
          lengthMode: normalizeSectionLengthMode(patch.lengthMode ?? current.lengthMode),
        },
      },
    });
  };

  const updateOutlineAnnotation = (section, instruction) => {
    onAnnotationsChange?.({
      ...annotations,
      [section.id]: { title: section.title, instruction: String(instruction ?? '').slice(0, 4000) },
    });
  };

  const deleteSection = (section, index) => {
    if (outline.sections.length <= 1) return;
    if (!globalThis.confirm(`确定删除情节 ${index + 1}「${section.title}」吗？\n\n删除后会成为新的待讨论大纲，已有正文不会被清空。`)) return;
    const nextValue = removeChapterOutlineSection(value, section.sourceIndex);
    if (nextValue) onOutlineChange(nextValue, section.id);
  };

  return (
    <div className="chapter-outline-readable">
      <section className="outline-story-hero">
        <div className="outline-story-chapter"><BookOpenText size={18} /><span>{outline.chapterLabel}</span></div>
        <h3>{outline.title}</h3>
        {outline.summary && <p>{outline.summary}</p>}
        <div className="outline-story-meta">
          <span className={outline.sections.length > 5 ? 'is-warning' : ''}>{outline.sections.length > 5 ? `当前 ${outline.sections.length} 个情节，建议精简到 3–5 个` : `${outline.sections.length} 个故事情节`}</span>
          <span>正文约 {generationNotes.targetChars} 字</span>
          <span>{instructionCount ? `${instructionCount} 段已有写法要求` : '可逐段添加写法要求'}</span>
        </div>
      </section>

      {outline.opening && (
        <section className="outline-opening-card">
          <div className="outline-card-icon"><Flag size={17} /></div>
          <div>
            <span>故事从这里开始</span>
            <p>{outline.opening}</p>
          </div>
        </section>
      )}

      <section className="outline-story-flow">
        <header>
          <div><span>本章会发生什么</span><small>按阅读顺序快速看完整章故事，通常保留 3–5 个情节</small></div>
          <strong className={outline.sections.length > 5 ? 'is-warning' : ''}>{outline.sections.length} 个情节</strong>
        </header>
        <div className="outline-story-section-list">
          {outline.sections.map((section, index) => {
            const savedInstruction = String(sectionInstructions[section.id]?.instruction ?? '');
            const lengthMode = normalizeSectionLengthMode(sectionInstructions[section.id]?.lengthMode);
            const sectionBudget = sectionWritingPlan[index];
            return (
              <article className={`outline-story-section ${savedInstruction.trim() || lengthMode !== 'normal' ? 'has-instruction' : ''}`} key={section.id}>
                <div className="outline-story-section-number">{String(index + 1).padStart(2, '0')}</div>
                <div className="outline-story-section-body">
                  <header>
                    <div>
                      <span>{section.kicker}</span>
                      <h4>{section.title}</h4>
                    </div>
                    <div className="outline-section-heading-actions">
                      {savedInstruction.trim() && <em><PenLine size={13} />已有要求</em>}
                      {!readOnly && editingMode === 'outline' && (
                        <button
                          type="button"
                          className="outline-section-delete"
                          onClick={() => deleteSection(section, index)}
                          disabled={busy || outline.sections.length <= 1}
                          aria-label={`删除情节 ${index + 1}：${section.title}`}
                          title={outline.sections.length <= 1 ? '大纲至少保留一个情节' : '删除这个情节'}
                        >
                          <Trash2 size={14} />删除
                        </button>
                      )}
                    </div>
                  </header>
                  <p>{section.whatHappens}</p>
                  {editingMode === 'outline' && !readOnly && (
                    <label className={`outline-section-annotation ${String(annotations[section.id]?.instruction ?? '').trim() ? 'has-note' : ''}`}>
                      <span><MessageSquareText size={14} />批注这个情节</span>
                      <textarea
                        rows={3}
                        maxLength={4000}
                        value={String(annotations[section.id]?.instruction ?? '')}
                        onChange={(event) => updateOutlineAnnotation(section, event.target.value)}
                        disabled={busy}
                        placeholder="例如：删掉这一段；把人物冲突提前；这里增加一次误会，但不要直接写正文。"
                      />
                    </label>
                  )}
                  {editingMode === 'draft' && <div className="outline-section-length-control">
                    <div className="outline-section-length-heading">
                      <span>这一段写多少</span>
                      <strong>预计 {sectionBudget.minChars}–{sectionBudget.maxChars} 字，目标 {sectionBudget.targetChars} 字</strong>
                    </div>
                    <div className="outline-section-length-options" role="group" aria-label={`${section.title}篇幅分配`}>
                      {SECTION_LENGTH_OPTIONS.map((option) => (
                        <button
                          type="button"
                          className={lengthMode === option.id ? 'active' : ''}
                          onClick={() => updateSectionInstruction(section, { lengthMode: option.id })}
                          disabled={busy || readOnly}
                          title={option.hint}
                          key={option.id}
                        >
                          <strong>{option.label}</strong><small>{option.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>}
                  {editingMode === 'draft' && <details className="outline-section-instructions" open={Boolean(savedInstruction.trim())}>
                    <summary><span><PenLine size={14} />这段怎么写</span><small>{savedInstruction.trim() || '可选，不填写就按全章风格处理'}</small><ChevronDown size={15} /></summary>
                    <div className="outline-instruction-editor">
                      <div className="outline-instruction-presets" aria-label={`${section.title}快捷写法要求`}>
                        {SECTION_STYLE_PRESETS.map((preset) => {
                          const active = hasInstructionPreset(savedInstruction, preset);
                          return <button type="button" className={active ? 'active' : ''} onClick={() => updateSectionInstruction(section, { instruction: toggleInstructionPreset(savedInstruction, preset) })} disabled={busy || readOnly} key={preset}>{preset}</button>;
                        })}
                      </div>
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={savedInstruction}
                        onChange={(event) => updateSectionInstruction(section, { instruction: event.target.value })}
                        disabled={busy || readOnly}
                        placeholder="例如：这一段重点写两个人互相替对方圆谎，多用对话和临场反应；环境只点到为止。"
                      />
                      <small>{readOnly ? '这是生成本版正文时使用的分段要求。' : '自动保存；生成正文或全部重新生成时会单独执行这一段的要求。'}</small>
                    </div>
                  </details>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {outline.ending && (
        <section className="outline-ending-card">
          <div><span>这一章会停在这里</span><strong>本章收束</strong></div>
          <p>{outline.ending}</p>
        </section>
      )}

      {outline.questions.length > 0 && (
        <section className="outline-question-card">
          <header><CircleHelp size={16} /><div><strong>还需要你决定</strong><span>这些问题可以直接写进下方讨论，再生成下一版</span></div></header>
          <ol>{outline.questions.map((question, index) => <li key={`${index}-${question.slice(0, 30)}`}><span>{index + 1}</span><p>{question}</p></li>)}</ol>
        </section>
      )}
    </div>
  );
}

function normalizeChapterOutlineForReading(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rawSections = Array.isArray(source.storySections)
    ? source.storySections
    : Array.isArray(source.beats)
      ? source.beats
      : Array.isArray(source.sceneProgression)
        ? source.sceneProgression
        : [];
  const sections = rawSections.map((item, index) => normalizeOutlineSection(item, index)).filter((item) => item.whatHappens);
  const chapterNumber = source.chapterNumber ?? source.chapterId;
  return {
    chapterLabel: formatChapterLabel(chapterNumber),
    title: firstOutlineText(source.title, source.chapterTitle, source.chapterTitleCandidate) || '未命名章节',
    summary: firstOutlineText(source.storySummary, source.chapterSummary, source.summary),
    opening: normalizeOpeningText(source.opening ?? source.openingSummary ?? source.openingEnvironment),
    sections,
    ending: firstOutlineText(source.ending, source.endingHook, source.chapterEndHook, source.endHook),
    questions: normalizeOutlineQuestions(source.openQuestions ?? source.questions),
  };
}

function normalizeOutlineSection(value, index) {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value : { whatHappens: value };
  const explicitId = firstOutlineText(item.id, item.sectionId);
  const rawId = explicitId || firstOutlineText(item.beatNumber, item.beat, index + 1);
  const whatHappens = firstOutlineText(
    item.whatHappens,
    item.story,
    item.content,
    item.conflictOrTurn,
    item.event,
    item.summary,
    item.description,
  );
  const title = firstOutlineText(item.title, item.heading, item.scene, item.name)
    || deriveOutlineStoryTitle(whatHappens, item.location, index);
  const safeId = String(rawId || index + 1).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || String(index + 1);
  return {
    id: explicitId ? safeId : `section-${safeId}`,
    sourceIndex: index,
    kicker: firstOutlineText(item.kicker, item.phase, item.location, `故事第 ${index + 1} 段`),
    title,
    whatHappens,
  };
}

function removeChapterOutlineSection(value, sourceIndex) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const field = Array.isArray(value.storySections)
    ? 'storySections'
    : Array.isArray(value.beats)
      ? 'beats'
      : Array.isArray(value.sceneProgression)
        ? 'sceneProgression'
        : null;
  if (!field || sourceIndex < 0 || sourceIndex >= value[field].length) return null;
  return { ...value, [field]: value[field].filter((_, index) => index !== sourceIndex) };
}

function deriveOutlineStoryTitle(whatHappens, location, index) {
  const normalized = String(whatHappens ?? '')
    .replace(/^镜头(?:转入|切到|来到)[^：:]{0,18}[：:]\s*/, '')
    .replace(/^这一段(?:主要)?(?:讲|写|发生的事情是)[：:]?\s*/, '')
    .trim();
  const firstSentence = normalized.split(/[。！？；\n]/).find((part) => part.trim())?.trim() ?? '';
  if (firstSentence) return firstSentence.length > 34 ? `${firstSentence.slice(0, 34)}…` : firstSentence;
  return firstOutlineText(location, `故事第 ${index + 1} 段`);
}

function normalizeOpeningText(value) {
  if (!value) return '';
  if (typeof value !== 'object' || Array.isArray(value)) return firstOutlineText(value);
  return [
    firstOutlineText(value.environment, value.venue, value.setting),
    firstOutlineText(value.immediateConflict, value.whatHappens, value.content, value.openingAction),
  ].filter(Boolean).join(' ');
}

function normalizeOutlineQuestions(value) {
  if (!Array.isArray(value)) return value ? [firstOutlineText(value)].filter(Boolean) : [];
  return value.map((item) => item && typeof item === 'object'
    ? firstOutlineText(item.question, item.issue, item.content, item.description)
    : firstOutlineText(item)).filter(Boolean);
}

function firstOutlineText(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function formatChapterLabel(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? `第 ${Number(match[0])} 章` : '当前章节';
}

function hasInstructionPreset(value, preset) {
  return String(value ?? '').split(/[；;\n]/).map((item) => item.trim()).includes(preset);
}

function toggleInstructionPreset(value, preset) {
  const parts = String(value ?? '').split(/[；;\n]/).map((item) => item.trim()).filter(Boolean);
  const next = parts.includes(preset) ? parts.filter((item) => item !== preset) : [...parts, preset];
  return next.join('；');
}

function normalizeDraftGenerationNotes(value) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const minChars = Math.min(10000, Math.max(500, Number.parseInt(incoming.minChars, 10) || 2000));
  const maxChars = Math.min(12000, Math.max(minChars + 200, Number.parseInt(incoming.maxChars, 10) || 3000));
  const requestedTarget = Number.parseInt(incoming.targetChars, 10);
  return {
    minChars,
    targetChars: Number.isFinite(requestedTarget) ? Math.min(maxChars, Math.max(minChars, requestedTarget)) : Math.round((minChars + maxChars) / 2),
    maxChars,
    style: String(incoming.style ?? ''),
    sectionInstructions: normalizeSectionInstructions(incoming.sectionInstructions),
  };
}

function normalizeSectionInstructions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => {
    const incoming = item && typeof item === 'object' && !Array.isArray(item) ? item : { instruction: item };
    return [String(key).slice(0, 120), {
      title: String(incoming.title ?? '').slice(0, 200),
      instruction: String(incoming.instruction ?? '').slice(0, 2000),
      lengthMode: normalizeSectionLengthMode(incoming.lengthMode),
    }];
  }));
}

function normalizeSectionLengthMode(value) {
  return SECTION_LENGTH_OPTIONS.some((option) => option.id === value) ? value : 'normal';
}

function hasOutlineAnnotations(value) {
  return Object.values(value ?? {}).some((item) => String(item?.instruction ?? '').trim());
}

function buildSectionWritingPlan(sections, generationNotes) {
  if (!sections.length) return [];
  const weights = sections.map((section) => {
    const mode = normalizeSectionLengthMode(generationNotes.sectionInstructions?.[section.id]?.lengthMode);
    return SECTION_LENGTH_OPTIONS.find((option) => option.id === mode)?.weight ?? 1;
  });
  const allocate = (total) => {
    const sum = weights.reduce((current, value) => current + value, 0) || 1;
    const raw = weights.map((weight) => (total * weight) / sum);
    const values = raw.map(Math.floor);
    let remaining = total - values.reduce((current, value) => current + value, 0);
    const order = raw.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let cursor = 0; remaining > 0; cursor += 1, remaining -= 1) values[order[cursor % order.length].index] += 1;
    return values;
  };
  const mins = allocate(generationNotes.minChars);
  const targets = allocate(generationNotes.targetChars);
  const maxes = allocate(generationNotes.maxChars);
  return sections.map((section, index) => ({
    ...section, minChars: mins[index], targetChars: targets[index], maxChars: maxes[index],
  }));
}

function extractDraft(value) {
  if (typeof value === 'string') return recoverDraftFromBrokenJson(value) ?? value;
  return value?.draft ?? value?.content ?? value?.text ?? value?.manuscript ?? '';
}

function extractTitle(value) {
  if (value && typeof value === 'object') return value.title;
  if (typeof value === 'string') return extractJsonLikeStringField(value, 'title');
  return '';
}

function extractChapterId(value) {
  if (value && typeof value === 'object') return value.chapterId;
  if (typeof value === 'string') return extractJsonLikeStringField(value, 'chapterId');
  return '';
}

function chapterContractHook(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return '';
  return String(contract.chapterEndHook ?? contract.endHook ?? contract.hook ?? '').trim();
}

function countArray(value) {
  return Array.isArray(value) ? value.length : hasContent(value) ? 1 : 0;
}

function splitParagraphs(value) {
  return String(value ?? '').trim().split(/\r?\n\s*\r?\n+/).map((item) => item.trim()).filter(Boolean);
}

function recoverDraftFromBrokenJson(value) {
  const raw = String(value ?? '').trim();
  const marker = /"draft"\s*:\s*"/i.exec(raw);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  const structuralMarkers = ['","contractWarnings"', '","openIssues"', '","warnings"'];
  const endings = structuralMarkers.map((candidate) => raw.lastIndexOf(candidate)).filter((index) => index >= start);
  let end = endings.length ? Math.min(...endings) : raw.length;
  let draft = raw.slice(start, end).replace(/\s*```\s*$/i, '').replace(/"\s*}\s*$/, '');
  draft = draft
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .replace(/"([^"\n]+)"/g, '“$1”')
    .trim();
  return draft || null;
}

function extractJsonLikeStringField(value, field) {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"\\r\\n]*)"`, 'i').exec(String(value ?? ''));
  return match?.[1]?.trim() ?? '';
}
