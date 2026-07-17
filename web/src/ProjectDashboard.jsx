import { useEffect, useMemo, useState } from 'react';
import { getProjectCalibrations, runProjectCalibration } from './api.js';
import ChapterLogicAlignment from './ChapterLogicAlignment.jsx';
import {
  AlertTriangle, ArrowRight, BookCheck, BookOpenText, Check, CheckCircle2,
  ChevronDown, ChevronUp, Circle, ClipboardCheck, DatabaseBackup, FileText, Flag,
  Gauge, GitCompare, Layers3, ListChecks, LoaderCircle, LockKeyhole, Plus,
  ScanSearch, Settings2, ShieldAlert, Sparkles, Trash2,
} from 'lucide-react';

export function ProjectTodayWorkspace({ dashboard }) {
  const { project, progress, today, chapter, counts, risks } = dashboard;
  return (
    <div className="content-column today-content project-today">
      <header className="content-header project-content-header">
        <div>
          <span className="eyebrow">今日工作台 · 正式项目</span>
          <h1>{today.mainTask || `推进第 ${chapter.number} 章`}</h1>
          <p>{today.nextStep}</p>
        </div>
        <span className="read-only-badge">正式事实受保护</span>
      </header>

      <section className="paper-card project-mission-card">
        <div className="mission-topline">
          <span className="mission-index">CH {String(chapter.number).padStart(3, '0')}</span>
          <span className="mission-stage">{today.stage}</span>
        </div>
        <div className="mission-grid">
          <div><small>当前作品</small><strong>{project.title}</strong></div>
          <div><small>当前卷</small><strong>{progress.currentVolume || '待补充'}</strong></div>
          <div><small>当前弧</small><strong>{progress.currentArc || '待补充'}</strong></div>
          <div><small>章节契约</small><strong className={chapter.contractReady ? 'ready-text' : 'warning-text'}>{chapter.contractReady ? '已就绪' : '缺失'}</strong></div>
        </div>
        <div className="project-stat-row">
          <span><BookCheck size={15} />已完成 {counts.completedChapters} 章</span>
          <span><FileText size={15} />正文 {counts.chapters} 章</span>
          <span><ClipboardCheck size={15} />契约 {counts.contracts} 份</span>
          <span className={counts.blockingRisks ? 'warning-text' : 'ready-text'}><ShieldAlert size={15} />P0/P1 {counts.blockingRisks} 项</span>
        </div>
      </section>

      <div className="project-dashboard-grid">
        <section className="paper-card project-requirements">
          <div className="card-heading-row">
            <div className="section-icon coral"><Flag size={18} /></div>
            <div><span className="section-kicker">本章契约</span><h2>必须达成</h2></div>
          </div>
          <div className="requirement-list">
            {today.mustAchieve.map((item, index) => (
              <div key={item}><span>{index + 1}</span><p>{item}</p></div>
            ))}
          </div>
        </section>

        <section className="paper-card project-risks-card">
          <div className="card-heading-row">
            <div className="section-icon amber"><ShieldAlert size={18} /></div>
            <div><span className="section-kicker">正式事实优先</span><h2>写作前风险</h2></div>
          </div>
          {risks.length ? <div className="project-risk-list">{risks.map((risk) => (
            <div key={`${risk.severity}-${risk.label}`}>
              <span>{risk.severity}</span>
              <p><strong>{risk.label}</strong><small>{risk.resolution || risk.source}</small></p>
            </div>
          ))}</div> : <div className="project-all-clear"><CheckCircle2 size={17} />当前没有阻塞风险</div>}
        </section>
      </div>

      <section className="paper-card project-checklist-card">
        <div className="card-heading-row">
          <div className="section-icon green"><ListChecks size={18} /></div>
          <div><span className="section-kicker">从预写到定稿</span><h2>今日任务清单</h2></div>
        </div>
        <div className="project-task-list">
          {today.tasks.map((task) => {
            const done = task.status === '完成';
            return <div className={done ? 'done' : ''} key={`${task.task}-${task.file}`}>
              <span className="task-check">{done ? <Check size={14} /> : <Circle size={13} />}</span>
              <strong>{task.task}</strong><small>{task.file}</small>
            </div>;
          })}
        </div>
      </section>

      <section className="project-reference-strip" aria-label="可用参考">
        <Layers3 size={16} /><strong>本章上下文</strong>
        {today.references.map((reference) => <span key={reference}>{reference}</span>)}
      </section>
    </div>
  );
}

export function ProjectContractWorkspace({
  dashboard, chapterWorkspace, formalContract, contractTemplate, contractText, dirty, busy, logicReady,
  onContractChange, onSave, onGenerate, onPrepare, onCommit, onCandidate, onSettings,
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const contractDraft = chapterWorkspace?.contractDraft ?? {};
  const plan = contractDraft.plan ?? {};
  const formalExists = formalContract?.exists === true;
  const validation = useMemo(() => validateProjectContractText(contractText), [contractText]);
  const savedMatches = !dirty && Boolean(String(contractDraft.text ?? '').trim()) && contractDraft.text === contractText;
  const planReady = plan.status === 'ready' && plan.draftHash === contractDraft.contentHash && Boolean(plan.planHash);
  const stale = plan.status === 'stale';
  const busyNow = Boolean(busy);
  const mustAchieve = Array.isArray(dashboard?.today?.mustAchieve) ? dashboard.today.mustAchieve : [];
  const risks = Array.isArray(dashboard?.risks) ? dashboard.risks : [];

  useEffect(() => setAcknowledged(false), [plan.planHash]);

  const primary = formalExists
    ? { label: '进入候选正文', action: onCandidate, icon: ArrowRight, disabled: false }
    : !savedMatches
      ? { label: '保存契约侧车', action: onSave, icon: Check, disabled: !String(contractText ?? '').trim() }
      : !validation.valid
        ? { label: '补齐契约结构后继续', action: null, icon: ListChecks, disabled: true }
        : !planReady || stale
          ? { label: stale ? '重新生成正式差异预览' : '生成正式差异预览', action: onPrepare, icon: GitCompare, disabled: false }
          : { label: '创建 checkpoint 并写入正式契约', action: onCommit, icon: DatabaseBackup, disabled: !acknowledged };
  const PrimaryIcon = primary.icon;
  const statusLabel = formalExists
    ? '正式契约已就绪'
    : planReady ? '等待作者核对'
      : stale ? '预览已过期'
        : dirty ? '侧车有未保存修改'
          : validation.valid ? '侧车结构已通过' : '契约结构待补齐';
  const busyLabel = busy === 'saving-contract' ? '正在保存侧车…'
    : busy === 'generating-contract' ? '逻辑模型正在生成…'
      : busy === 'preparing-contract' ? '正在生成差异预览…'
        : busy === 'committing-contract' ? '正在创建 checkpoint 并写入…' : '';

  return (
    <div className="content-column project-contract-workspace">
      <header className="content-header project-content-header">
        <div>
          <span className="eyebrow">第 {dashboard.chapter.number} 章 · 章节契约</span>
          <h1>{formalExists ? '正式契约已就绪，可以进入正文候选' : '先把本章写作任务固定下来'}</h1>
          <p>契约先进入独立侧车；只有完整结构、差异预览、作者确认和 checkpoint 全部通过后，才会创建正式大纲文件。</p>
        </div>
        <span className={`contract-state-badge ${formalExists ? 'committed' : planReady ? 'ready' : validation.valid ? 'valid' : 'draft'}`}>{statusLabel}</span>
      </header>

      <section className="contract-context-grid" aria-label="本章契约上下文">
        <article className="paper-card contract-context-card">
          <div className="card-heading-row">
            <div className="section-icon coral"><Flag size={18} /></div>
            <div><span className="section-kicker">正式事实提炼</span><h2>本章必须达成</h2></div>
          </div>
          {mustAchieve.length ? <ol>{mustAchieve.map((item) => <li key={item}>{item}</li>)}</ol> : <p className="contract-empty-copy">今日工作台没有提取到明确目标，请在契约中手动补齐。</p>}
        </article>
        <article className="paper-card contract-context-card risk">
          <div className="card-heading-row">
            <div className="section-icon amber"><ShieldAlert size={18} /></div>
            <div><span className="section-kicker">写作边界</span><h2>阻塞与风险</h2></div>
          </div>
          {risks.length ? <ul>{risks.slice(0, 4).map((risk) => <li key={`${risk.severity}-${risk.label}`}><strong>{risk.severity}</strong><span>{risk.label}</span></li>)}</ul> : <div className="project-all-clear"><CheckCircle2 size={17} />当前没有阻塞风险</div>}
        </article>
      </section>

      {formalExists ? (
        <section className="paper-card contract-formal-reader">
          <div className="contract-layer-head">
            <div><span className="section-kicker">正式事实 · 只读</span><h2>{formalContract.relativePath}</h2></div>
            <span><LockKeyhole size={14} />不可在侧车流程覆盖</span>
          </div>
          <pre>{formalContract.text || '正式契约文件存在，但当前没有可展示文本。'}</pre>
        </section>
      ) : (
        <>
          <section className="contract-editor-grid">
            <article className="paper-card contract-editor-card">
              <div className="chapter-editor-heading">
                <div><span className="section-kicker">侧车参考层</span><h2>第 {dashboard.chapter.number} 章契约草稿</h2></div>
                <div className="chapter-candidate-meta">
                  <span>{String(contractText ?? '').replace(/\s+/g, '').length} 字</span>
                  <small>账本 r{chapterWorkspace?.revision ?? 0}</small>
                  {contractDraft.model && <small>{contractDraft.providerName || '模型'} · {contractDraft.model}</small>}
                </div>
              </div>
              <textarea
                className="contract-markdown-editor"
                value={contractText ?? ''}
                onChange={(event) => onContractChange(event.target.value)}
                placeholder="填写本章目标、读者情绪、必须发生、禁止发生、章末问题与字数节奏。"
                disabled={busyNow}
                spellCheck="false"
              />
              <div className="contract-editor-tools">
                {!String(contractText ?? '').trim() && contractTemplate && <button type="button" className="secondary-button compact-button" onClick={() => onContractChange(contractTemplate)} disabled={busyNow}><FileText size={15} />载入结构模板</button>}
                {logicReady
                  ? <button type="button" className="secondary-button compact-button" onClick={onGenerate} disabled={busyNow || dirty}><Sparkles size={15} />{contractDraft.text ? '用逻辑模型重写侧车' : '用逻辑模型生成侧车'}</button>
                  : <button type="button" className="secondary-button compact-button" onClick={onSettings} disabled={busyNow}><Settings2 size={15} />配置逻辑模型</button>}
                <small>模型调用会产生对应厂商费用；生成结果仍只保存在侧车账本。</small>
              </div>
            </article>

            <aside className="paper-card contract-structure-card">
              <div><span className="section-kicker">提交前校验</span><h2>六项必需结构</h2><p>标题存在还不够，每个区块都必须包含可执行内容。</p></div>
              <div className="contract-structure-list">
                {validation.sections.map((section) => <div className={section.state} key={section.label}>
                  {section.state === 'ready' ? <CheckCircle2 size={16} /> : section.state === 'empty' ? <AlertTriangle size={16} /> : <Circle size={15} />}
                  <span><strong>{section.label}</strong><small>{section.state === 'ready' ? '结构与内容已就绪' : section.state === 'empty' ? '标题存在，但内容为空' : '缺少对应标题'}</small></span>
                </div>)}
              </div>
              <div className={`contract-validation-summary ${validation.valid ? 'ok' : 'blocked'}`}>
                {validation.valid ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}
                <span>{validation.valid ? '契约结构完整，可以生成正式预览。' : `还需处理 ${validation.missingSections.length + validation.emptySections.length} 项。`}</span>
              </div>
            </aside>
          </section>

          {(planReady || stale) && <section className={`paper-card contract-preview-card ${stale ? 'stale' : ''}`}>
            <div className="contract-layer-head">
              <div><span className="section-kicker">正式写入预览</span><h2>{plan.relativePath || dashboard.chapter.contractPath}</h2><p>{stale ? '侧车内容已变化，当前预览不能提交。' : '目标必须不存在；提交前服务端会再次验证 source hash 与 plan hash。'}</p></div>
              <span><GitCompare size={14} />{stale ? '预览过期' : 'before / after'}</span>
            </div>
            <div className="contract-preview-grid">
              <div><span>BEFORE · {plan.beforeExists ? shortHash(plan.beforeHash) : '__missing__'}</span><pre>{plan.beforeExists ? plan.beforeText : '（正式契约不存在）'}</pre></div>
              <div><span>AFTER · {shortHash(plan.afterHash)}</span><pre>{plan.afterText}</pre></div>
            </div>
          </section>}
        </>
      )}

      <section className="paper-card chapter-workspace-actionbar contract-actionbar" aria-label="章节契约主动作">
        <div className="chapter-action-copy">
          <span>{formalExists ? '契约已成为正式事实' : planReady ? '最终作者闸门' : savedMatches && validation.valid ? '下一步：生成正式差异预览' : '当前唯一下一步'}</span>
          <p>{formalExists ? '后续正文生成只读取这份正式契约；侧车不再拥有覆盖权限。' : planReady ? '核对完整 after 文本后再确认。系统会先创建 checkpoint，再以临时文件原子创建正式契约。' : '编辑和模型生成都只影响侧车；保存侧车不等于修改正式大纲。'}</p>
          <small><LockKeyhole size={13} />{formalExists ? 'formalWritePerformed = true · 正式事实受保护' : 'formalWritePerformed = false'}</small>
          {planReady && !formalExists && <label className="writeback-acknowledge"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busyNow} /><span>我已核对第 {dashboard.chapter.number} 章契约完整内容，确认创建 checkpoint 后写入正式大纲</span></label>}
        </div>
        <div className="chapter-action-buttons">
          {!formalExists && savedMatches && validation.valid && !planReady && <button type="button" className="secondary-button" onClick={onGenerate} disabled={busyNow || !logicReady}>{logicReady ? '让逻辑模型重新生成' : '逻辑模型未配置'}</button>}
          <button type="button" className="primary-button" onClick={primary.action || undefined} disabled={busyNow || primary.disabled || !primary.action}>
            {busyNow ? <LoaderCircle size={18} className="spin" /> : <PrimaryIcon size={18} />}
            {busyLabel || primary.label}
            {!busyNow && !formalExists && <ArrowRight size={17} />}
          </button>
        </div>
      </section>
    </div>
  );
}
export function ProjectChapterWorkspace({
  dashboard, chapterWorkspace, formalContract, draftText, dirty, busy, writerReady, writerRoute,
  onDraftChange, onSave, onGenerate, onReview, onOpenModelLab, onSettings,
}) {
  const { project, today, chapter } = dashboard;
  const [generationGateOpen, setGenerationGateOpen] = useState(false);
  const [spendAcknowledged, setSpendAcknowledged] = useState(false);
  const [generationMode, setGenerationMode] = useState('full');
  const candidate = chapterWorkspace?.candidate ?? {};
  const generation = candidate?.generation && typeof candidate.generation === 'object' ? candidate.generation : null;
  const review = chapterWorkspace?.review ?? {};
  const hasCandidate = Boolean(String(draftText ?? '').trim());
  const wordCount = String(draftText ?? '').replace(/\s+/g, '').length;
  const confirmation = chapterWorkspace?.confirmation ?? {};
  const confirmed = confirmation.status === 'confirmed' && confirmation.candidateHash === candidate.contentHash;
  const reviewIsCurrent = review.status === 'ready' && review.candidateHash === candidate.contentHash;
  const busyNow = Boolean(busy);
  const routeProvider = writerRoute?.provider ?? null;
  const routeSignature = `${writerRoute?.providerId ?? ''}:${writerRoute?.model ?? ''}`;
  const statusLabel = confirmed ? '作者已确认' : dirty ? '有未保存修改' : candidate.status === 'generated' ? '模型候选已保存' : hasCandidate ? '候选稿已保存' : '等待候选稿';
  const rewriteModes = [
    { id: 'full', label: '全文' }, { id: 'opening', label: '开场' },
    { id: 'payoff', label: '爽点' }, { id: 'hook', label: '章末钩子' },
  ];
  const selectedMode = rewriteModes.find((item) => item.id === generationMode) ?? rewriteModes[0];
  const beatPlan = Array.isArray(generation?.beatPlan)
    ? generation.beatPlan
    : generation?.beatPlan && typeof generation.beatPlan === 'object'
      ? Object.entries(generation.beatPlan).map(([key, value]) => (typeof value === 'object' ? { key, ...value } : { key, label: key, value }))
      : [];
  const diagnostics = generation?.diagnostics ?? null;
  const diagnosticChecksSource = Array.isArray(diagnostics) ? diagnostics : diagnostics?.checks ?? diagnostics?.items ?? diagnostics?.results;
  const diagnosticChecks = Array.isArray(diagnosticChecksSource)
    ? diagnosticChecksSource
    : diagnosticChecksSource && typeof diagnosticChecksSource === 'object'
      ? Object.entries(diagnosticChecksSource).map(([key, value]) => (typeof value === 'object' ? { key, ...value } : { key, label: key, value }))
      : [];
  const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const statusTone = (value) => {
    if (value === true || ['pass', 'passed', 'ok', 'success', 'ready'].includes(normalizeStatus(value))) return 'pass';
    if (value === false || ['fail', 'failed', 'hard_fail', 'blocked', 'error'].includes(normalizeStatus(value))) return 'fail';
    if (['warn', 'warning', 'soft_fail'].includes(normalizeStatus(value))) return 'warn';
    return 'neutral';
  };
  const diagnosticStatus = diagnostics?.status ?? diagnostics?.overallStatus ?? diagnostics?.overall;
  const hardCheckCount = diagnosticChecks.filter((item) => {
    const hard = item?.hard === true || item?.blocking === true || ['hard', 'p0', 'blocker'].includes(String(item?.severity ?? item?.level ?? item?.priority ?? '').toLowerCase());
    return hard && statusTone(item?.status ?? item?.passed ?? item?.ok ?? item?.result) === 'fail';
  }).length;
  const explicitHardCount = Array.isArray(diagnostics?.hardIssues) ? diagnostics.hardIssues.length : Number(diagnostics?.hardIssueCount ?? diagnostics?.blockingCount ?? 0) || 0;
  const hasHardIssues = Boolean(diagnostics && (diagnostics?.hasHardIssues === true || diagnostics?.blocking === true || hardCheckCount || explicitHardCount || ['hard_fail', 'blocked', 'failed', 'fail', 'error'].includes(normalizeStatus(diagnosticStatus))));
  const recordedWordCount = diagnostics?.wordCount && typeof diagnostics.wordCount === 'object'
    ? diagnostics.wordCount.actual ?? diagnostics.wordCount.value ?? diagnostics.wordCount.count
    : diagnostics?.wordCount ?? diagnostics?.words;
  const diagnosticWordCount = Number.isFinite(Number(recordedWordCount)) ? Number(recordedWordCount) : wordCount;

  useEffect(() => {
    setGenerationGateOpen(false);
    setSpendAcknowledged(false);
    setGenerationMode('full');
  }, [routeSignature, chapter.number, chapterWorkspace?.revision]);

  function openGenerationGate(mode) {
    setGenerationMode(mode);
    setSpendAcknowledged(false);
    setGenerationGateOpen(true);
  }

  function confirmGeneration() {
    if (!spendAcknowledged || busyNow) return;
    onGenerate(generationMode);
  }

  const primary = dirty
    ? { label: '保存当前候选版本', action: onSave, icon: Check, disabled: false }
    : generationGateOpen
      ? { label: hasCandidate ? `确认${selectedMode.label}定向重写` : '确认生成首轮候选正文', action: confirmGeneration, icon: Sparkles, disabled: !spendAcknowledged }
      : !hasCandidate
        ? writerReady
          ? { label: '生成首轮候选正文', action: () => openGenerationGate('full'), icon: Sparkles, disabled: false }
          : { label: '配置写作模型', action: onSettings, icon: Settings2, disabled: false }
        : hasHardIssues
          ? { label: `检查「${selectedMode.label}」定向重写任务包`, action: () => openGenerationGate(generationMode), icon: ShieldAlert, disabled: !writerReady }
          : { label: reviewIsCurrent || confirmed ? '查看审查与确认' : '进入只读审查', action: onReview, icon: ScanSearch, disabled: false };
  const PrimaryIcon = primary.icon;
  const busyLabel = busy === 'saving' ? '正在保存…' : busy === 'generating' ? '正在生成完整章节…' : busy === 'rewriting' ? `正在重写${selectedMode.label}…` : '';
  return (
    <div className="content-column project-chapter-workspace">
      <header className="content-header project-content-header">
        <div>
          <span className="eyebrow">第 {chapter.number} 章 · 候选正文</span>
          <h1>{today.mainTask}</h1>
          <p>正式章节契约只读展示；候选稿按版本独立保存，审查与确认都不会覆盖正式正文。</p>
        </div>
        <div className="chapter-header-actions">
          <span className={`candidate-badge ${confirmed ? 'confirmed' : ''}`}>{statusLabel}</span>
          <button type="button" className="secondary-button compact-button" onClick={onOpenModelLab}><Gauge size={15} />{writerReady ? '模型路由与校准' : '先配置写作模型'}</button>
        </div>
      </header>
      <ChapterLogicAlignment
        contract={formalContract?.text || chapter.contractPreview}
        draftText={draftText}
        draftTitle={candidate.title || chapter.title}
        contractLabel={chapter.contractPath || '当前章正式契约'}
        draftLabel="当前小说正文候选"
      />

      {generationGateOpen && <section className="paper-card generation-preflight-card" aria-label="候选正文生成任务包">
        <div className="generation-preflight-head">
          <div><span className="section-kicker">运行层 · 不写正式事实</span><h2>{hasCandidate ? `${selectedMode.label}定向重写任务包` : '本次候选生成任务包'}</h2><p>核对下列输入、重写范围与路由后，才允许发出真实模型请求。</p></div>
          <button type="button" className="secondary-button compact-button" onClick={() => { setGenerationGateOpen(false); setSpendAcknowledged(false); }} disabled={busyNow}>取消本次调用</button>
        </div>
        <div className="generation-preflight-grid">
          <div><small>写作厂商</small><strong>{routeProvider?.name || '未配置厂商'}</strong><span>{routeProvider?.kind === 'custom' ? '第三方 / 自定义渠道' : routeProvider?.kind || routeProvider?.type || '未知类型'}</span></div>
          <div><small>模型 ID</small><strong>{writerRoute?.model || '未配置模型'}</strong><span>API Key 仅保存在服务端</span></div>
          <div><small>生成范围</small><strong>{hasCandidate ? `${selectedMode.label}定向重写` : '全文首轮生成'}</strong><span>{hasCandidate ? '按所选范围返工候选' : '契约 + 规则 + 上下文 + 追踪'}</span></div>
          <div><small>输出目标</small><strong>候选侧车 r{chapterWorkspace?.revision ?? 0}</strong><span>不会创建或覆盖正文文件</span></div>
        </div>
        <div className="generation-brief-grid">
          <div>
            <span className="section-kicker">本章必须达成</span>
            <ol>{(today.mustAchieve || []).slice(0, 5).map((item) => <li key={item}>{item}</li>)}</ol>
          </div>
          <div>
            <span className="section-kicker">调用前边界</span>
            <ul>
              <li><CheckCircle2 size={14} />正式章节契约已存在并只读</li>
              <li><LockKeyhole size={14} />模型结果只写候选账本</li>
              <li><ShieldAlert size={14} />当前风险 {dashboard.risks?.length || 0} 项，仍需作者审查</li>
            </ul>
          </div>
        </div>
        <label className="generation-spend-acknowledge">
          <input type="checkbox" checked={spendAcknowledged} onChange={(event) => setSpendAcknowledged(event.target.checked)} disabled={busyNow} />
          <span><strong>我确认本次会调用 {routeProvider?.name || '所选厂商'} / {writerRoute?.model || '所选模型'} 并产生对应厂商费用。</strong><small>返回内容仅进入第 {chapter.number} 章候选侧车，后续仍需只读审查、作者确认、差异预览和 checkpoint。</small></span>
        </label>
      </section>}

      {generation && (beatPlan.length > 0 || diagnostics) && <section className={`candidate-generation-grid ${beatPlan.length && diagnostics ? '' : 'single'}`} aria-label="候选生成结果">
        {beatPlan.length > 0 && <article className="paper-card candidate-beat-plan-card">
          <div className="candidate-generation-card-head"><div><span className="section-kicker">模型执行轨迹</span><h2>章内节拍</h2></div><span>{beatPlan.length} 拍</span></div>
          <ol className="candidate-beat-list">{beatPlan.map((beat, index) => {
            const label = String(beat?.label ?? beat?.title ?? beat?.name ?? beat?.beat ?? beat?.stage ?? beat?.key ?? `节拍 ${index + 1}`);
            const detail = String(beat?.description ?? beat?.summary ?? beat?.content ?? beat?.purpose ?? beat?.goal ?? beat?.value ?? '');
            return <li key={beat?.id ?? beat?.key ?? index}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong>{detail && <p>{detail}</p>}</div></li>;
          })}</ol>
        </article>}
        {diagnostics && <article className={`paper-card candidate-diagnostics-card tone-${statusTone(diagnosticStatus)}` }>
          <div className="candidate-generation-card-head"><div><span className="section-kicker">生成后自动检查</span><h2>质量门禁</h2></div><span className={`diagnostic-overall-badge ${statusTone(diagnosticStatus)}`}>{hasHardIssues ? '存在硬问题' : statusTone(diagnosticStatus) === 'pass' ? '通过' : statusTone(diagnosticStatus) === 'warn' ? '需留意' : '已检查'}</span></div>
          <div className="diagnostic-summary-row"><div><small>总状态</small><strong>{hasHardIssues ? '未通过' : '可继续'}</strong></div><div><small>字数</small><strong>{diagnosticWordCount} 字</strong></div><div><small>检查项</small><strong>{diagnosticChecks.length}</strong><span>{hardCheckCount || explicitHardCount ? `硬问题 ${Math.max(hardCheckCount, explicitHardCount)} 项` : '无硬阻塞'}</span></div></div>
          <div className="diagnostic-check-list">{diagnosticChecks.map((check, index) => {
            const tone = statusTone(check?.status ?? check?.passed ?? check?.ok ?? check?.result);
            const label = String(check?.label ?? check?.title ?? check?.name ?? check?.check ?? check?.key ?? `检查 ${index + 1}`);
            const detail = String(check?.message ?? check?.detail ?? check?.description ?? check?.reason ?? check?.suggestion ?? check?.value ?? '');
            const hard = check?.hard === true || check?.blocking === true || ['hard', 'p0', 'blocker'].includes(String(check?.severity ?? check?.level ?? check?.priority ?? '').toLowerCase());
            return <div className={`diagnostic-check-item ${tone}`} key={check?.id ?? check?.key ?? index}><span>{tone === 'pass' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}</span><div><strong>{label}</strong>{detail && <p>{detail}</p>}</div><em>{hard && tone === 'fail' ? '硬问题' : tone === 'pass' ? '通过' : tone === 'warn' ? '留意' : '未通过'}</em></div>;
          })}</div>
        </article>}
      </section>}

      <section className="paper-card chapter-editor-card">
        <div className="chapter-editor-heading">
          <div><span className="section-kicker">{project.title}</span><h2>第 {chapter.number} 章候选草稿</h2></div>
          <div className="chapter-candidate-meta">
            <span>{wordCount} 字</span>
            <small>版本 r{chapterWorkspace?.revision ?? 0}</small>
            {candidate.model && <small>{candidate.providerName || '模型'} · {candidate.model}</small>}
          </div>
        </div>
        <textarea
          className="manuscript-textarea project-manuscript"
          value={draftText ?? ''}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="从宗门大比征召压力开场。你可以先手写；模型生成也只会进入这个候选区。"
          disabled={busyNow}
        />
      </section>
      <section className="paper-card chapter-workspace-actionbar" aria-label="候选稿主动作">
        <div className="chapter-action-copy">
          <span>{dirty ? '先固定当前版本' : generationGateOpen ? '费用与边界确认' : hasHardIssues ? '质量门禁存在硬问题' : hasCandidate ? '下一步：只读审查' : '下一步：生成首轮候选'}</span>
          <p>{dirty ? '保存后才允许审查或定向重写，避免结果与版本错位。' : generationGateOpen ? `当前范围：${selectedMode.label}。未勾选费用确认前不会调用模型。` : hasHardIssues ? `先选择返工范围，再执行${selectedMode.label}定向重写；硬问题清零后再审查。` : hasCandidate ? '质量门禁没有硬阻塞；下一步进入只读审查。' : '首轮固定使用全文模式；生成前检查本身不产生费用。'}</p>
          <small><LockKeyhole size={13} />正式文件保持只读 · 候选账本 r{chapterWorkspace?.revision ?? 0}</small>
        </div>
        <div className="chapter-action-buttons">
          {hasCandidate && !dirty && writerReady && !confirmed && !generationGateOpen && <div className="chapter-rewrite-control">
            <span>定向重写</span>
            <div className="chapter-rewrite-options" role="group" aria-label="选择定向重写范围">{rewriteModes.map((mode) => <button type="button" className={generationMode === mode.id ? 'active' : ''} onClick={() => setGenerationMode(mode.id)} disabled={busyNow} key={mode.id}>{mode.label}</button>)}</div>
            {!hasHardIssues && <button type="button" className="rewrite-preflight-button" onClick={() => openGenerationGate(generationMode)} disabled={busyNow}>准备重写</button>}
          </div>}
          <button type="button" className="primary-button" onClick={primary.action} disabled={busyNow || primary.disabled || (!chapter.contractReady && !hasCandidate)}>
            {busyNow ? <LoaderCircle size={18} className="spin" /> : <PrimaryIcon size={18} />}
            {busyLabel || primary.label}
            {!busyNow && <ArrowRight size={17} />}
          </button>
        </div>
      </section>
    </div>
  );
}
export function ProjectReviewWorkspace({
  dashboard, chapterWorkspace, formalContract, busy, reviewReady, onRunReview, onConfirm, onBackToDraft, onWriteBack, onSettings,
}) {
  const candidate = chapterWorkspace?.candidate ?? {};
  const review = chapterWorkspace?.review ?? {};
  const findings = Array.isArray(review.result?.findings) ? review.result.findings : [];
  const hasCandidate = Boolean(String(candidate.text ?? '').trim());
  const currentReview = review.status === 'ready' && review.candidateHash === candidate.contentHash;
  const confirmed = chapterWorkspace?.confirmation?.status === 'confirmed' && chapterWorkspace?.confirmation?.candidateHash === candidate.contentHash;
  const p0Count = findings.filter((item) => String(item?.severity ?? item?.priority ?? '').toUpperCase() === 'P0').length;
  const counts = ['P0', 'P1', 'P2'].reduce((acc, severity) => ({ ...acc, [severity]: findings.filter((item) => String(item?.severity ?? item?.priority ?? '').toUpperCase() === severity).length }), {});
  const primary = !reviewReady
    ? { label: '配置审查模型', action: onSettings, icon: Settings2 }
    : !currentReview
      ? { label: review.status === 'stale' ? '重新审查当前版本' : '运行只读审查', action: onRunReview, icon: ScanSearch }
      : p0Count > 0
        ? { label: `返回候选稿修复 ${p0Count} 项 P0`, action: onBackToDraft, icon: ArrowRight }
        : confirmed
          ? { label: '进入正式写回预览', action: onWriteBack, icon: ArrowRight }
          : { label: '确认当前候选版本', action: onConfirm, icon: Check };
  const PrimaryIcon = primary.icon;
  return (
    <div className="content-column project-review-workspace">
      <header className="content-header project-content-header">
        <div>
          <span className="eyebrow">第 {dashboard.chapter.number} 章 · 审查定稿</span>
          <h1>先看 Finding，再决定是否确认</h1>
          <p>审查模型严格只读；结果绑定当前候选哈希。候选一旦变化，旧审查自动过期。</p>
        </div>
        <span className={`review-state-badge ${confirmed ? 'confirmed' : currentReview ? 'ready' : review.status === 'stale' ? 'stale' : ''}`}>
          {confirmed ? '已确认候选版本' : currentReview ? '审查已完成' : review.status === 'stale' ? '需要重新审查' : '等待审查'}
        </span>
      </header>

      <ChapterLogicAlignment
        contract={formalContract?.text || dashboard.chapter.contractPreview}
        draftText={candidate.text}
        draftTitle={candidate.title || `第 ${dashboard.chapter.number} 章候选稿`}
        contractLabel={dashboard.chapter.contractPath || '当前章正式契约'}
        draftLabel={`当前审查正文 · r${chapterWorkspace?.revision ?? 0}`}
      />

      {currentReview ? (
        <>
          <section className="review-summary-grid" aria-label="审查摘要">
            <div className="paper-card review-verdict-card">
              <span className="section-kicker">审查结论</span>
              <h2>{review.result?.verdict || (p0Count ? '存在阻塞问题' : '可以进入作者确认')}</h2>
              <p>审查模型：{review.providerName || '未记录'} · {review.model || '未记录模型'}</p>
            </div>
            {['P0', 'P1', 'P2'].map((severity) => <div className={`paper-card review-count-card ${severity.toLowerCase()}`} key={severity}><span>{severity}</span><strong>{counts[severity]}</strong><small>{severity === 'P0' ? '阻塞确认' : severity === 'P1' ? '建议本章修复' : '可延后优化'}</small></div>)}
          </section>
          <section className="finding-list">
            <div className="finding-list-head"><div><span className="section-kicker">只读 Finding</span><h2>{findings.length ? `${findings.length} 项诊断` : '没有发现问题'}</h2></div><small>不包含替换稿，不自动改正文</small></div>
            {findings.length ? findings.map((finding, index) => {
              const severity = String(finding?.severity ?? finding?.priority ?? 'P2').toUpperCase();
              return <article className={`paper-card finding-card ${severity.toLowerCase()}`} key={`${severity}-${index}`}>
                <div className="finding-severity"><span>{severity}</span><strong>{finding.category || '未分类'}</strong></div>
                <dl>
                  <div><dt>证据</dt><dd>{finding.evidence || '未提供明确证据'}</dd></div>
                  <div><dt>影响</dt><dd>{finding.impact || '未说明影响'}</dd></div>
                  <div><dt>建议</dt><dd>{finding.suggestion || '未提供抽象修改建议'}</dd></div>
                </dl>
              </article>;
            }) : <div className="paper-card review-all-clear"><CheckCircle2 size={22} /><strong>当前候选没有阻塞 Finding</strong><p>你仍需亲自阅读并确认；系统不会替你定稿。</p></div>}
          </section>
        </>
      ) : (
        <section className="paper-card review-empty-state">
          <ScanSearch size={28} />
          <div><strong>{review.status === 'stale' ? '候选稿已变化，旧审查失效' : '当前候选还没有审查报告'}</strong><p>运行后只会保存诊断结果，并绑定当前候选版本。</p></div>
        </section>
      )}

      <section className="paper-card chapter-workspace-actionbar review-actionbar" aria-label="审查主动作">
        <div className="chapter-action-copy">
          <span>{confirmed ? '已进入作者确认态' : currentReview && !p0Count ? '作者确认闸门' : '当前唯一下一步'}</span>
          <p>{confirmed ? '下一阶段将提供正式写回前的差异预览与 checkpoint；本页不会写回。' : currentReview && !p0Count ? '确认只锁定当前候选哈希，不代表已经写入正式正文。' : '先完成当前版本审查；P0 未清零不能确认。'}</p>
          <small><LockKeyhole size={13} />formalWritePerformed = false</small>
        </div>
        <div className="chapter-action-buttons">
          <button type="button" className="secondary-button" onClick={onBackToDraft} disabled={Boolean(busy)}>返回候选稿</button>
          <button type="button" className="primary-button" onClick={primary.action || undefined} disabled={Boolean(busy) || !hasCandidate || !primary.action}>
            {busy ? <LoaderCircle size={18} className="spin" /> : <PrimaryIcon size={18} />}
            {busy === 'reviewing' ? '正在只读审查…' : busy === 'confirming' ? '正在确认版本…' : primary.label}
            {!busy && <ArrowRight size={17} />}
          </button>
        </div>
      </section>
    </div>
  );
}
export function ProjectWriteBackWorkspace({
  dashboard, chapterWorkspace, busy, reviewReady,
  onPrepare, onCommit, onBackToReview, onNextChapter, onSettings,
}) {
  const [expandedPath, setExpandedPath] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const candidate = chapterWorkspace?.candidate ?? {};
  const review = chapterWorkspace?.review ?? {};
  const confirmation = chapterWorkspace?.confirmation ?? {};
  const writeBack = chapterWorkspace?.writeBack ?? {};
  const files = Array.isArray(writeBack.files) ? writeBack.files : [];
  const findings = Array.isArray(review.result?.findings) ? review.result.findings : [];
  const p0Count = findings.filter((item) => String(item?.severity ?? item?.priority ?? '').toUpperCase() === 'P0').length;
  const reviewCurrent = review.status === 'ready' && review.candidateHash === candidate.contentHash;
  const confirmed = confirmation.status === 'confirmed' && confirmation.candidateHash === candidate.contentHash;
  const committed = writeBack.status === 'committed' && writeBack.commit?.formalWritePerformed === true;
  const planReady = writeBack.status === 'ready' && files.length > 0;
  const stale = writeBack.status === 'stale';
  const blocked = !confirmed || !reviewCurrent || p0Count > 0;
  const busyNow = Boolean(busy);

  useEffect(() => {
    setAcknowledged(false);
    setExpandedPath('');
  }, [writeBack.planHash]);

  const groups = [
    { key: 'canon', label: '正式正文', description: '最高权重正式事实；正文逐字来自作者确认候选' },
    { key: 'tracking', label: '正式追踪账本', description: '为下一章恢复上下文与长期一致性服务' },
    { key: 'runtime', label: '运行与恢复记录', description: '记录 checkpoint 序号与本次晋升事实' },
  ];
  const gateItems = [
    ['候选版本已由作者确认', confirmed],
    ['审查绑定当前候选哈希', reviewCurrent],
    ['P0 Finding 已清零', p0Count === 0],
    ['差异预览已生成', planReady || committed],
  ];
  const primary = committed
    ? { label: '进入下一章今日工作台', action: onNextChapter, icon: ArrowRight, disabled: false }
    : blocked
      ? { label: '返回审查定稿处理阻塞', action: onBackToReview, icon: ScanSearch, disabled: false }
      : !reviewReady
        ? { label: '配置追踪同步模型', action: onSettings, icon: Settings2, disabled: false }
        : !planReady || stale
          ? { label: stale ? '重新生成差异预览' : '生成追踪同步提案', action: onPrepare, icon: Sparkles, disabled: false }
          : { label: '创建 checkpoint 并正式写入', action: onCommit, icon: DatabaseBackup, disabled: !acknowledged };
  const PrimaryIcon = primary.icon;
  const statusLabel = committed ? '正式写入完成' : stale ? '预览已过期' : planReady ? '等待作者核对' : blocked ? '写回条件未满足' : '等待生成预览';
  const totalAdded = files.reduce((sum, file) => sum + Number(file.addedLines || 0), 0);
  const totalRemoved = files.reduce((sum, file) => sum + Number(file.removedLines || 0), 0);

  return (
    <div className="content-column project-writeback-workspace">
      <header className="content-header project-content-header">
        <div>
          <span className="eyebrow">第 {dashboard.chapter.number} 章 · 正式写回预览</span>
          <h1>先核对每个正式文件，再创建 checkpoint</h1>
          <p>追踪模型只提取元数据；正式正文始终来自已确认候选。预览阶段不会修改磁盘项目。</p>
        </div>
        <span className={`writeback-state-badge ${committed ? 'committed' : stale ? 'stale' : planReady ? 'ready' : ''}`}>{statusLabel}</span>
      </header>

      <section className="writeback-gate-grid" aria-label="正式写回安全闸门">
        {gateItems.map(([label, ok]) => <div className={`paper-card writeback-gate ${ok ? 'ok' : 'blocked'}`} key={label}>
          {ok ? <CheckCircle2 size={18} /> : <Circle size={17} />}<span>{label}</span>
        </div>)}
      </section>

      {(planReady || committed || stale) && <section className="paper-card writeback-summary-card">
        <div>
          <span className="section-kicker">变更范围</span>
          <h2>{files.length} 个正式文件</h2>
          <p>新增/变化约 +{totalAdded} / -{totalRemoved} 行 · 计划 {shortHash(writeBack.planHash)}</p>
        </div>
        <div className="writeback-summary-facts">
          <span><strong>{files.filter((file) => file.layer === 'canon').length}</strong> 正文</span>
          <span><strong>{files.filter((file) => file.layer === 'tracking').length}</strong> 追踪</span>
          <span><strong>{files.filter((file) => file.layer === 'runtime').length}</strong> 记录</span>
        </div>
      </section>}

      {!files.length && !committed ? <section className="paper-card writeback-empty-state">
        <GitCompare size={28} />
        <div><strong>{blocked ? '当前版本还不能进入正式写回' : '尚未生成任何正式文件差异'}</strong><p>{blocked ? '先完成当前候选审查、清零 P0 并由作者确认。' : '生成提案会调用审查路由模型，但只保存结构化追踪建议与文件预览。'}</p></div>
      </section> : <div className="writeback-file-groups">
        {groups.map((group) => {
          const groupFiles = files.filter((file) => file.layer === group.key);
          if (!groupFiles.length) return null;
          return <section className="writeback-file-group" key={group.key}>
            <div className="finding-list-head"><div><span className="section-kicker">{group.description}</span><h2>{group.label}</h2></div><small>{groupFiles.length} 个文件</small></div>
            {groupFiles.map((file) => {
              const expanded = expandedPath === file.relativePath;
              return <article className={`paper-card writeback-file-card ${file.layer}`} key={file.relativePath}>
                <button type="button" className="writeback-file-head" onClick={() => setExpandedPath(expanded ? '' : file.relativePath)} aria-expanded={expanded}>
                  <span className={`writeback-action ${file.action}`}>{writebackActionLabel(file.action)}</span>
                  <div><strong>{file.relativePath}</strong><p>{file.summary}</p></div>
                  <small>+{file.addedLines || 0} / -{file.removedLines || 0} 行</small>
                  {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                </button>
                {expanded && <div className="writeback-diff-grid">
                  <div><span>BEFORE · {file.beforeExists ? shortHash(file.beforeHash) : '文件不存在'}</span><pre>{file.beforeExists ? file.beforeText : '（新建文件，无旧内容）'}</pre></div>
                  <div><span>AFTER · {shortHash(file.afterHash)}</span><pre>{file.afterText}</pre></div>
                </div>}
              </article>;
            })}
          </section>;
        })}
      </div>}

      {committed && <section className="paper-card writeback-receipt-card">
        <DatabaseBackup size={24} />
        <div><span className="section-kicker">写回凭据</span><h2>Checkpoint {writeBack.commit?.checkpointId}</h2><p>{writeBack.commit?.writtenFiles?.length || files.length} 个文件已正式写入；失败回滚保护已完成。</p></div>
        <strong>formalWritePerformed = true</strong>
      </section>}

      <section className="paper-card chapter-workspace-actionbar writeback-actionbar" aria-label="正式写回主动作">
        <div className="chapter-action-copy">
          <span>{committed ? '当前章已晋升为正式事实' : planReady ? '最终作者闸门' : '当前唯一下一步'}</span>
          <p>{committed ? '进入下一章后，系统会从更新后的 progress.json 加载新的空侧车账本。' : planReady ? '展开并核对差异；服务端提交前还会再次验证五层哈希与全部 source hash。' : '先生成结构化同步提案与完整 before/after；此步骤不会写正式文件。'}</p>
          <small><LockKeyhole size={13} />{committed ? 'checkpoint 已创建 · 可审计' : 'formalWritePerformed = false'}</small>
          {planReady && !committed && <label className="writeback-acknowledge"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busyNow} /><span>我已核对全部 {files.length} 个正式文件，确认创建 checkpoint 后写入</span></label>}
        </div>
        <div className="chapter-action-buttons">
          {!committed && <button type="button" className="secondary-button" onClick={onBackToReview} disabled={busyNow}>返回审查定稿</button>}
          <button type="button" className="primary-button" onClick={primary.action} disabled={busyNow || primary.disabled}>
            {busyNow ? <LoaderCircle size={18} className="spin" /> : <PrimaryIcon size={18} />}
            {busy === 'preparing-writeback' ? '正在生成追踪提案…' : busy === 'committing-writeback' ? '正在创建 checkpoint 并写入…' : primary.label}
            {!busyNow && <ArrowRight size={17} />}
          </button>
        </div>
      </section>
    </div>
  );
}

const PROJECT_CONTRACT_SECTIONS = ['本章目标', '读者情绪', '必须发生', '禁止发生', '章末问题', '字数与节奏'];

function validateProjectContractText(value) {
  const text = String(value ?? '');
  const matches = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
  const parsed = matches.map((match, index) => ({
    heading: String(match[1] ?? '').replace(/[：:]+$/u, '').replace(/\s+/g, ' ').trim(),
    body: text.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length),
  }));
  const sections = PROJECT_CONTRACT_SECTIONS.map((label) => {
    const section = parsed.find(({ heading }) => heading === label || heading.startsWith(`${label} `));
    if (!section) return { label, state: 'missing' };
    return { label, state: hasMeaningfulContractContent(section.body) ? 'ready' : 'empty' };
  });
  const missingSections = sections.filter((section) => section.state === 'missing').map((section) => section.label);
  const emptySections = sections.filter((section) => section.state === 'empty').map((section) => section.label);
  return { valid: Boolean(text.trim()) && missingSections.length === 0 && emptySections.length === 0, sections, missingSections, emptySections };
}

function hasMeaningfulContractContent(value) {
  return String(value ?? '').split(/\r?\n/).some((line) => {
    const content = line
      .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/u, '')
      .replace(/[\s`*_~>#—–:：;；,.，。!！?？、()\[\]{}（）【】]/gu, '');
    return content.length > 0;
  });
}
function shortHash(value) { return value ? String(value).slice(0, 10) : '未生成'; }
function writebackActionLabel(action) { return action === 'create' ? '新增' : action === 'append' ? '追加' : '更新'; }

export function ProjectInspector({ dashboard, open, onClose }) {
  const { project, progress, chapter, readiness, risks } = dashboard;
  return (
    <>
      {open && <button type="button" className="inspector-backdrop" aria-label="关闭检查器" onClick={onClose} />}
      <aside className={`context-inspector ${open ? 'open' : ''}`} aria-label="真实项目检查器">
        <div className="inspector-mobile-head"><strong>项目检查器</strong><button type="button" onClick={onClose}>关闭</button></div>
        <section className="inspector-section project-canon-summary">
          <div className="inspector-title"><BookOpenText size={15} /><span>正式项目</span></div>
          <h3>{project.title}</h3>
          <p>第 {chapter.number} 章 · {progress.currentArc || progress.currentVolume}</p>
          <span className="canon-source-note">来源：设定 / 大纲 / 正文 / 追踪</span>
        </section>
        <section className="inspector-section">
          <div className="inspector-title"><ClipboardCheck size={15} /><span>章节就绪度</span></div>
          <div className="condition-list">
            {Object.entries({
              '进度账本可读取': readiness.progress,
              '今日工作台可读取': readiness.todayWorkbench,
              '上下文可读取': readiness.context,
              '硬规则可读取': readiness.rules,
              '当前章契约可读取': readiness.contract,
              '正式正文已存在': readiness.draft,
            }).map(([label, ok]) => <div className={ok ? 'ok' : 'missing'} key={label}>{ok ? <CheckCircle2 size={15} /> : <Circle size={14} />}<span>{label}</span></div>)}
          </div>
        </section>
        <section className="inspector-section">
          <div className="inspector-title"><AlertTriangle size={15} /><span>风险与边界</span><em>{risks.length}</em></div>
          <div className="risk-list">{risks.map((risk) => <div className="inspector-risk error" key={risk.label}><AlertTriangle size={15} /><span><strong>{risk.severity}</strong> {risk.label}</span></div>)}</div>
        </section>
        <section className="inspector-section">
          <div className="inspector-title"><ArrowRight size={15} /><span>唯一下一步</span></div>
          <p className="empty-inspector">{dashboard.today.nextStep}</p>
        </section>
      </aside>
    </>
  );
}

export function ProjectModelLab({ dashboard, settings, onSettings, notify }) {
  const providers = settings?.providers ?? [];
  const writerRoute = settings?.routes?.writer ?? {};
  const logicRoute = settings?.routes?.logic ?? {};
  const defaultProviderId = writerRoute.providerId || logicRoute.providerId || providers[0]?.id || '';
  const [mode, setMode] = useState('writer');
  const [candidates, setCandidates] = useState(() => [
    { providerId: defaultProviderId, model: writerRoute.model || '' },
    { providerId: defaultProviderId, model: '' },
    { providerId: defaultProviderId, model: '' },
  ]);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    let active = true;
    getProjectCalibrations(dashboard.project.id).then((response) => {
      if (active) setHistory(Array.isArray(response?.calibrations) ? response.calibrations : []);
    }).catch(() => {});
    return () => { active = false; };
  }, [dashboard.project.id]);

  const validCandidates = useMemo(() => candidates.filter((candidate) => candidate.providerId && candidate.model.trim()), [candidates]);
  const configuredProviders = providers.filter((provider) => provider.configured);
  const updateCandidate = (index, patch) => setCandidates((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...patch } : candidate));
  const addCandidate = () => setCandidates((current) => current.length >= 4 ? current : [...current, { providerId: defaultProviderId, model: '' }]);
  const removeCandidate = (index) => setCandidates((current) => current.length <= 2 ? current : current.filter((_, candidateIndex) => candidateIndex !== index));
  const apply56Preset = () => {
    const providerId = defaultProviderId || providers[0]?.id || '';
    setCandidates([
      { providerId, model: 'gpt-5.6-sol' },
      { providerId, model: 'gpt-5.6-luna' },
      { providerId, model: 'gpt-5.6-terra' },
    ]);
    notify?.('已填入 Sol / Luna / Terra，运行前请确认它们属于所选厂商', 'success');
  };
  const handleRun = async () => {
    if (validCandidates.length < 2) { notify?.('至少填写两个“厂商 + 模型”候选', 'warning'); return; }
    const incomplete = validCandidates.find((candidate) => !providers.find((provider) => provider.id === candidate.providerId)?.configured);
    if (incomplete) { notify?.('候选厂商尚未补全 Base URL 或 API Key', 'warning'); onSettings?.(); return; }
    const keys = new Set(validCandidates.map((candidate) => `${candidate.providerId}::${candidate.model.trim()}`));
    if (keys.size !== validCandidates.length) { notify?.('校准候选不能重复', 'warning'); return; }
    setRunning(true);
    try {
      const response = await runProjectCalibration(dashboard.project.id, { mode, candidates: validCandidates });
      const nextRun = response?.calibration ?? null;
      setRun(nextRun);
      if (nextRun) setHistory((current) => [nextRun, ...current.filter((item) => item.id !== nextRun.id)].slice(0, 10));
      notify?.(nextRun?.status === 'completed' ? '模型校准完成' : '校准完成，但部分候选调用失败', nextRun?.status === 'completed' ? 'success' : 'warning');
    } catch (error) {
      notify?.(error?.message || '模型校准失败', 'error');
    } finally { setRunning(false); }
  };

  const displayedRun = run ?? history[0] ?? null;
  return (
    <div className="content-column project-model-lab">
      <header className="content-header project-content-header">
        <div>
          <span className="eyebrow">第 {dashboard.chapter.number} 章 · 模型校准</span>
          <h1>用同一份章节契约比较模型</h1>
          <p>所有候选读取相同正式事实；结果只进入校准记录，不写入正文和追踪。</p>
        </div>
        <span className="candidate-badge"><Gauge size={14} />匿名对照</span>
      </header>

      <section className="model-lab-input-grid">
        <div className="paper-card calibration-context-card">
          <div className="card-heading-row compact"><div className="section-icon green"><ClipboardCheck size={18} /></div><div><span className="section-kicker">正式输入</span><h2>第 {dashboard.chapter.number} 章统一题面</h2></div></div>
          <p className="calibration-contract">{dashboard.chapter.contractPreview}</p>
          <div className="calibration-constraints">
            <strong>必须达成</strong>
            {dashboard.today.mustAchieve.slice(0, 6).map((item) => <span key={item}><Check size={13} />{item}</span>)}
          </div>
          {dashboard.risks.length > 0 && <div className="calibration-risk-note"><AlertTriangle size={15} /><span>{dashboard.risks.map((risk) => risk.label).join('；')}</span></div>}
        </div>

        <div className="paper-card calibration-setup-card">
          <div className="calibration-mode-tabs" role="tablist" aria-label="校准类型">
            <button type="button" className={mode === 'writer' ? 'active' : ''} onClick={() => setMode('writer')}>正文试写</button>
            <button type="button" className={mode === 'logic' ? 'active' : ''} onClick={() => setMode('logic')}>逻辑方案</button>
          </div>
          <div className="calibration-toolbar">
            <div><strong>候选模型</strong><small>2—4 个，厂商密钥彼此独立</small></div>
            <button type="button" className="text-button" onClick={apply56Preset}><Sparkles size={14} />填入 Sol / Luna / Terra</button>
          </div>
          <div className="calibration-candidate-list">
            {candidates.map((candidate, index) => {
              const provider = providers.find((item) => item.id === candidate.providerId);
              return <div className="calibration-candidate-row" key={index}>
                <span className="candidate-letter">{String.fromCharCode(65 + index)}</span>
                <select value={candidate.providerId} onChange={(event) => updateCandidate(index, { providerId: event.target.value })} aria-label={`候选 ${index + 1} 厂商`}>
                  {providers.map((item) => <option value={item.id} key={item.id}>{item.name}{item.configured ? '' : '（未完成）'}</option>)}
                </select>
                <input value={candidate.model} onChange={(event) => updateCandidate(index, { model: event.target.value })} placeholder="模型 ID" spellCheck="false" />
                <button type="button" onClick={() => removeCandidate(index)} disabled={candidates.length <= 2} aria-label={`删除候选 ${index + 1}`}><Trash2 size={14} /></button>
                <small className={provider?.configured ? 'ready-text' : 'warning-text'}>{provider?.configured ? '厂商已就绪' : '需要配置 Key'}</small>
              </div>;
            })}
          </div>
          <div className="calibration-actions">
            <button type="button" className="secondary-button compact-button" onClick={addCandidate} disabled={candidates.length >= 4}><Plus size={15} />增加候选</button>
            {!configuredProviders.length && <button type="button" className="secondary-button compact-button" onClick={onSettings}><Settings2 size={15} />配置厂商</button>}
          </div>
          <button type="button" className="primary-button calibration-run-button" onClick={handleRun} disabled={running || validCandidates.length < 2}>
            {running ? <LoaderCircle size={18} className="spin" /> : <Gauge size={18} />}
            {running ? '正在并行校准…' : `运行第 ${dashboard.chapter.number} 章校准`}
          </button>
          <p className="calibration-cost-note">运行会真实调用 {validCandidates.length} 个模型并产生对应厂商费用；不会自动选择赢家。</p>
        </div>
      </section>

      <section className="calibration-results-section">
        <div className="calibration-results-head"><div><span className="section-kicker">匿名结果</span><h2>{displayedRun ? `${displayedRun.mode === 'writer' ? '正文' : '逻辑'}校准 · ${formatCalibrationTime(displayedRun.createdAt)}` : '等待第一次校准'}</h2></div>{displayedRun && <span>{displayedRun.status === 'completed' ? '全部完成' : '部分失败'}</span>}</div>
        {displayedRun ? <div className="calibration-result-grid">{displayedRun.candidates.map((candidate, index) => (
          <article className={`paper-card calibration-result-card ${candidate.status}`} key={candidate.candidateId || index}>
            <div className="calibration-result-meta"><span>候选 {String.fromCharCode(65 + index)}</span><strong>{candidate.status === 'success' ? `${candidate.latencyMs} ms` : '调用失败'}</strong></div>
            <h3>{candidate.actualModel || candidate.requestedModel}</h3>
            <small>{candidate.providerName}</small>
            {candidate.status === 'success'
              ? <CalibrationOutput result={candidate.result} mode={displayedRun.mode} />
              : <div className="calibration-error"><AlertTriangle size={15} />{candidate.error?.message || '未知错误'}</div>}
          </article>
        ))}</div> : <div className="paper-card calibration-empty"><Gauge size={24} /><strong>还没有校准结果</strong><p>先选择至少两个候选。建议正文对比 Luna / Terra，逻辑对比 Sol / 推理模型。</p></div>}
      </section>
    </div>
  );
}

function CalibrationOutput({ result, mode }) {
  if (!result) return <p className="calibration-output">模型没有返回可展示结果。</p>;
  const primary = mode === 'writer' ? result.sample : result.beatChain;
  return <div className="calibration-output">
    {Array.isArray(primary) ? <ol>{primary.map((item, index) => <li key={index}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ol> : <p>{String(primary ?? result.raw ?? JSON.stringify(result, null, 2))}</p>}
    {result.hook && <div className="calibration-hook"><strong>章末钩子</strong><span>{String(result.hook)}</span></div>}
    {Array.isArray(result.boundaryWarnings) && result.boundaryWarnings.length > 0 && <div className="calibration-warning-list">{result.boundaryWarnings.map((item, index) => <span key={index}>{String(item)}</span>)}</div>}
  </div>;
}

function formatCalibrationTime(value) {
  try { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
  catch { return '最近一次'; }
}
