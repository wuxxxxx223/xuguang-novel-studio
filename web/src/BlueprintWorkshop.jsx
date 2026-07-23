import { useMemo, useState } from 'react';
import {
  BookOpenText, Check, CheckCircle2, ChevronDown, CircleHelp, Flag, GitBranch, ListChecks,
  Network, PanelsTopLeft, PenLine, Sparkles, Target, Trash2, UsersRound,
} from 'lucide-react';
import { tryParseJson } from './state.js';
import {
  ArtifactModeToolbar, countItems, fieldLabel, firstText, hasContent, RawDataDetails,
  ReadableValue, StructureEditingPane, StructuredArtifactEditor, truncateText,
} from './ArtifactReaderShared.jsx';

const SECTION_DEFINITIONS = [
  { id: 'characters', label: '角色阵容', description: '谁承担推进、反制、兑现和长线威胁。', icon: UsersRound },
  { id: 'relationships', label: '人物关系', description: '检查角色之间的动力、边界和未来兑现。', icon: Network },
  { id: 'volumes', label: '分卷推进', description: '按卷核对目标、冲突、阶段节拍和收束钩子。', icon: GitBranch },
  { id: 'contract', label: '下一章写作契约', description: '把蓝图压缩成下一章可执行、可检查的任务。', icon: ListChecks, tone: 'contract' },
  { id: 'gaps', label: '待作者裁决', description: '这些候选决定会改变后续角色、卷纲或章节写法。', icon: CircleHelp, tone: 'decision' },
];

export default function BlueprintWorkshop({
  artifact, onSuggestionChange, readOnly = false,
  currentChapter = null, chapterHistory = [], chapterCycleEnabled = false,
  onCurrentChapterContractChange, onEditCurrentChapterContract, onConfirmCurrentChapterContract,
}) {
  const [viewMode, setViewMode] = useState('read');
  const [expandedSections, setExpandedSections] = useState(() => new Set(['contract']));
  const suggestion = tryParseJson(artifact.suggestion);
  const busy = artifact.status === 'generating';
  const positioning = suggestion?.positioning;
  const characters = arrayValue(suggestion?.characters);
  const relationships = arrayValue(suggestion?.relationships);
  const volumes = arrayValue(suggestion?.volumes);
  const contract = suggestion?.nextChapterContractCandidate;
  const currentContract = chapterCycleEnabled ? currentChapter?.contract ?? null : null;
  const currentContractValue = currentContract?.status === 'confirmed' ? currentContract.confirmed : currentContract?.candidate;
  const currentContractConfirmed = currentContract?.status === 'confirmed';
  const currentContractSource = currentContract?.source?.kind === 'blueprint-next-contract-candidate'
    ? '来自已确认蓝图的候选，仍需你单独确认。'
    : '这是当前章节的作者可编辑契约草稿，确认后才会解锁正文。';
  const completedChapters = Array.isArray(chapterHistory) ? chapterHistory : [];
  const gaps = arrayValue(suggestion?.gaps);
  const names = useMemo(() => buildCharacterNames(characters), [characters]);
  const sections = SECTION_DEFINITIONS.filter((section) => {
    if (section.id === 'contract') return hasContent(contract);
    return hasContent(suggestion?.[section.id]);
  });
  const allExpanded = sections.length > 0 && sections.every((section) => expandedSections.has(section.id));
  const sellingPoint = positioning?.candidateCoreSellingPoint || firstText(positioning) || firstText(suggestion);

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
    <section className="blueprint-workshop">
      <header className="artifact-reader-head blueprint-reader-head">
        <div>
          <span className={`artifact-label ${readOnly ? 'green' : 'coral'}`}>{readOnly ? <CheckCircle2 size={15} /> : <Sparkles size={15} />}{readOnly ? '作者确认的小说蓝图' : 'AI 小说蓝图建议稿'}</span>
          <h2>把长篇方向读成一张可以执行的路线图</h2>
          <p>定位、角色、关系、分卷和章节契约已经拆开呈现。默认阅读不再显示 JSON。</p>
        </div>
        <div className="artifact-reader-status">
          <PanelsTopLeft size={16} />
          <span>{characters.length} 个角色</span>
          <span>{volumes.length} 卷规划</span>
          <span>{gaps.length} 项待裁决</span>
        </div>
      </header>

      <ArtifactModeToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        expanded={allExpanded}
        onToggleExpanded={sections.length ? toggleAll : null}
        label="小说蓝图呈现方式"
        editable={!readOnly}
      />

      {viewMode === 'read' ? (
        <div className="blueprint-reading">
          <section className="blueprint-positioning">
            <div className="blueprint-positioning-mark"><Target size={21} /></div>
            <div className="blueprint-positioning-main">
              <span>这本书准备靠什么让读者追下去</span>
              <p>{sellingPoint || '当前蓝图还没有可提取的核心卖点，请切换到结构编辑核对内容。'}</p>
            </div>
            {positioning?.status && <em>{positioning.status}</em>}
          </section>

          {hasContent(positioning) && (
            <section className="blueprint-promise-band">
              <div className="idea-section-heading">
                <span>作品定位与读者承诺</span>
                <small>先确认卖点、追读循环和具体文风执行</small>
              </div>
              <div className="blueprint-promise-grid">
                <BlueprintPromise
                  index="01"
                  title="读者会持续得到什么"
                  value={positioning?.candidateReaderPromises}
                />
                <BlueprintPromise
                  index="02"
                  title="故事如何反复制造追读"
                  value={positioning?.candidateNarrativeLoop}
                />
                <BlueprintPromise
                  index="03"
                  title="正文应该怎样落地"
                  value={positioning?.candidateToneExecution}
                />
              </div>
              {hasContent(positioning?.confirmedFacts) && (
                <div className="blueprint-confirmed-facts">
                  <strong><Flag size={14} />已确认边界</strong>
                  <ReadableValue value={positioning.confirmedFacts} />
                </div>
              )}
            </section>
          )}

          <section className="artifact-section-browser">
            <div className="idea-section-heading">
              <span>继续检查蓝图细节</span>
              <small>{sections.length} 个分区 · 下一章契约默认展开</small>
            </div>
            <div className="artifact-section-list">
              {sections.map((section, index) => {
                const Icon = section.icon;
                const open = expandedSections.has(section.id);
                const value = section.id === 'contract' ? contract : suggestion?.[section.id];
                return (
                  <details
                    className={`artifact-reader-section ${section.tone ? `tone-${section.tone}` : ''}`}
                    key={section.id}
                    open={open}
                    onToggle={(event) => toggleSection(section.id, event.currentTarget.open)}
                  >
                    <summary>
                      <span className="artifact-section-number">{String(index + 4).padStart(2, '0')}</span>
                      <div className="artifact-section-title">
                        <strong><Icon size={15} />{section.label}</strong>
                        <span>{section.description}</span>
                        <p>{sectionPreview(section.id, value, names)}</p>
                      </div>
                      <div className="idea-section-toggle">
                        <span>{open ? '收起' : '展开'}</span>
                        <ChevronDown size={15} />
                      </div>
                    </summary>
                    <div className="artifact-section-content">
                      {section.id === 'characters' && <CharacterRoster characters={characters} />}
                      {section.id === 'relationships' && <RelationshipMap relationships={relationships} names={names} />}
                      {section.id === 'volumes' && <VolumePlan volumes={volumes} />}
                      {section.id === 'contract' && <ChapterContract contract={contract} />}
                      {section.id === 'gaps' && <DecisionGaps gaps={gaps} />}
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

      {chapterCycleEnabled && (
        <section className="paper-card workspace-chapter-contract-card">
          <div className="card-heading-row compact">
            <div className={`section-icon ${currentContractConfirmed ? 'green' : 'coral'}`}>
              {currentContractConfirmed ? <CheckCircle2 size={19} /> : <ListChecks size={19} />}
            </div>
            <div>
              <span className="section-kicker">当前章契约 · CH {String(currentChapter?.number ?? 1).padStart(2, '0')}</span>
              <h2>{currentContractConfirmed ? '作者已确认当前章写作契约' : '先确认本章契约，再进入正文写作'}</h2>
              <p>{currentContractConfirmed ? 'Writer 只会读取这份当前章确认稿；蓝图中的其他章节候选不会被直接当作事实。' : currentContractSource}</p>
            </div>
          </div>
          {currentContractValue != null ? (
            <div className="workspace-chapter-contract-body">
              {typeof currentContractValue === 'object' && !Array.isArray(currentContractValue)
                ? <ChapterContract contract={currentContractValue} />
                : <ReadableValue value={currentContractValue} />}
              {!currentContractConfirmed && (
                <details className="workspace-chapter-contract-editor" defaultOpen>
                  <summary>核对或编辑第 {currentChapter?.number ?? 1} 章契约<ChevronDown size={15} /></summary>
                  <p>这里的修改仍是待确认草稿，不会改写已确认蓝图，也不会进入正式正文项目。</p>
                  {typeof currentContractValue === 'object' && !Array.isArray(currentContractValue) && (
                    <ChapterContractHookEditor
                      contract={currentContractValue}
                      onChange={onCurrentChapterContractChange}
                      disabled={busy || !onCurrentChapterContractChange}
                    />
                  )}
                  <details className="workspace-chapter-contract-advanced">
                    <summary>高级：编辑完整章节契约<ChevronDown size={14} /></summary>
                    <StructuredArtifactEditor
                      value={currentContractValue}
                      onChange={(value) => onCurrentChapterContractChange?.(value)}
                      disabled={busy || !onCurrentChapterContractChange}
                    />
                  </details>
                </details>
              )}
            </div>
          ) : <p className="artifact-empty">当前章还没有可确认的契约。请在蓝图结构中补写下一章契约后再确认。</p>}
          {!currentContractConfirmed && (
            <div className="workspace-chapter-contract-actions">
              <div><Flag size={15} /><span>确认后，它才成为第 {currentChapter?.number ?? 1} 章的写作事实。</span></div>
              <button
                type="button"
                className="primary-button"
                onClick={onConfirmCurrentChapterContract}
                disabled={busy || !currentContractValue || !onConfirmCurrentChapterContract}
              >
                <Check size={17} />确认作为第 {currentChapter?.number ?? 1} 章契约
              </button>
            </div>
          )}
          {currentContractConfirmed && (
            <div className="workspace-chapter-contract-actions revision-action">
              <div><PenLine size={15} /><span>不满意章末钩子或其他约束时，可以重新打开当前章契约修改。</span></div>
              <button type="button" className="secondary-button" onClick={onEditCurrentChapterContract} disabled={busy || !onEditCurrentChapterContract}>
                <PenLine size={16} />修改当前章契约
              </button>
            </div>
          )}
        </section>
      )}

      {chapterCycleEnabled && completedChapters.length > 0 && (
        <section className="paper-card workspace-chapter-history-card">
          <div className="card-heading-row compact">
            <div className="section-icon green"><BookOpenText size={19} /></div>
            <div><span className="section-kicker">Workspace 章节历史</span><h2>已确认章节保持只读归档</h2><p>这些记录只留在创作 Workspace，不会自动生成或覆盖正式正文文件。</p></div>
          </div>
          <div className="workspace-chapter-history-list">
            {completedChapters.map((chapter) => (
              <details key={chapter.chapterNumber}>
                <summary><span>CH {String(chapter.chapterNumber).padStart(2, '0')}</span><strong>{chapter.title || `第 ${chapter.chapterNumber} 章`}</strong><small>{chapter.completedAt ? '已归档' : '历史记录'}</small><ChevronDown size={15} /></summary>
                <div className="workspace-chapter-history-detail">
                  <section><h3>确认契约</h3><ReadableValue value={chapter.contract?.value} /></section>
                  <section><h3>确认正文</h3><ReadableValue value={chapter.draft?.value} /></section>
                  <section><h3>审查结论</h3><ReadableValue value={chapter.review?.value} /></section>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      <RawDataDetails value={suggestion} label="高级：查看蓝图原始结构" />
    </section>
  );
}

function BlueprintPromise({ index, title, value }) {
  return (
    <article className="blueprint-promise">
      <span>{index}</span>
      <h3>{title}</h3>
      <ReadableValue value={value} />
    </article>
  );
}

function CharacterRoster({ characters }) {
  return (
    <div className="blueprint-character-grid">
      {characters.map((character, index) => (
        <article className="blueprint-character" key={character?.id ?? index}>
          <header>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{character?.candidateName || character?.name || `角色 ${index + 1}`}</h3>
              <p>{character?.role || '角色作用待补充'}</p>
            </div>
            {character?.status && <em>{character.status}</em>}
          </header>
          {hasContent(character?.confirmedCore) && (
            <div className="blueprint-character-core">
              <strong>已经确认</strong>
              <ReadableValue value={character.confirmedCore} />
            </div>
          )}
          {hasContent(character?.candidateProfile) && (
            <div className="blueprint-character-profile">
              <ReadableValue value={character.candidateProfile} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function RelationshipMap({ relationships, names }) {
  return (
    <div className="blueprint-relationship-list">
      {relationships.map((relationship, index) => (
        <article className="blueprint-relationship" key={index}>
          <div className="blueprint-relationship-line">
            <strong>{resolveName(relationship?.from, names)}</strong>
            <span><Network size={14} />{relationship?.type || '关系待定'}</span>
            <strong>{resolveName(relationship?.to, names)}</strong>
          </div>
          <div className="blueprint-relationship-body">
            {Object.entries(relationship ?? {})
              .filter(([key, value]) => !['from', 'to', 'type'].includes(key) && hasContent(value))
              .map(([key, value]) => (
                <section key={key}><h4>{fieldLabel(key)}</h4><ReadableValue value={value} /></section>
              ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function VolumePlan({ volumes }) {
  return (
    <div className="blueprint-volume-list">
      {volumes.map((volume, index) => (
        <article className="blueprint-volume" key={volume?.volume ?? index}>
          <header>
            <span>VOLUME {String(volume?.volume ?? index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{volume?.candidateTitle || `第 ${index + 1} 卷`}</h3>
              <p>{volume?.externalConflict || firstText(volume)}</p>
            </div>
            {volume?.status && <em>{volume.status}</em>}
          </header>
          <div className="blueprint-volume-goal">
            <Target size={16} />
            <div><strong>主角本卷目标</strong><p>{volume?.protagonistGoal || '待补充'}</p></div>
          </div>
          {hasContent(volume?.phaseBeats) && (
            <div className="blueprint-beat-timeline">
              {volume.phaseBeats.map((beat, beatIndex) => (
                <article key={beatIndex}>
                  <span>{String(beatIndex + 1).padStart(2, '0')}</span>
                  <ReadableValue value={beat} />
                </article>
              ))}
            </div>
          )}
          <div className="blueprint-volume-settlement">
            {hasContent(volume?.resourceSettlement) && <section><h4>资源结算</h4><ReadableValue value={volume.resourceSettlement} /></section>}
            {hasContent(volume?.closure) && <section><h4>本卷收束</h4><ReadableValue value={volume.closure} /></section>}
            {hasContent(volume?.nextVolumeHook ?? volume?.hook) && <section><h4>卷末钩子</h4><ReadableValue value={volume.nextVolumeHook ?? volume.hook} /></section>}
          </div>
        </article>
      ))}
    </div>
  );
}

function ChapterContract({ contract }) {
  const beats = arrayValue(contract?.candidateBeatSequence);
  return (
    <div className="blueprint-contract">
      <header>
        <div>
          <span>CHAPTER {String(contract?.chapterNumber ?? 1).padStart(2, '0')}</span>
          <h3>{contract?.candidateTitle || '下一章标题待定'}</h3>
          <p>{contract?.coreConflict || firstText(contract)}</p>
        </div>
        {contract?.status && <em>{contract.status}</em>}
      </header>
      <div className="blueprint-contract-facts">
        <section><span>章节功能</span><ReadableValue value={contract?.chapterFunction} /></section>
        <section><span>叙事视角</span><ReadableValue value={contract?.candidatePOV} /></section>
        <section><span>开场动作</span><ReadableValue value={contract?.openingBeat} /></section>
        <section><span>主角决定</span><ReadableValue value={contract?.protagonistDecision} /></section>
      </div>
      {beats.length > 0 && (
        <section className="blueprint-contract-beats">
          <div className="idea-section-heading">
            <span>本章节拍顺序</span>
            <small>{beats.length} 个动作节点</small>
          </div>
          <div className="blueprint-beat-timeline contract-timeline">
            {beats.map((beat, index) => (
              <article key={index}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h4>{beat?.beat || `节拍 ${index + 1}`}</h4>
                  <p>{beat?.content || firstText(beat)}</p>
                  {beat?.purpose && <small>{beat.purpose}</small>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="blueprint-contract-payoff">
        {hasContent(contract?.firstPayoff) && <section><h4>本章首次兑现</h4><ReadableValue value={contract.firstPayoff} /></section>}
        {hasContent(contract?.resourceAndClueSettlement) && <section><h4>资源与线索结算</h4><ReadableValue value={contract.resourceAndClueSettlement} /></section>}
        {hasContent(contract?.chapterEndHook) && <section className="hook"><h4>章末钩子</h4><ReadableValue value={contract.chapterEndHook} /></section>}
      </div>
      {hasContent(contract?.writingConstraints) && (
        <div className="blueprint-writing-constraints">
          <strong><ListChecks size={14} />写作约束</strong>
          <ReadableValue value={contract.writingConstraints} />
        </div>
      )}
    </div>
  );
}

function ChapterContractHookEditor({ contract, onChange, disabled }) {
  const hook = String(contract?.chapterEndHook ?? contract?.endHook ?? contract?.hook ?? '');
  const updateHook = (value) => {
    const next = { ...contract, chapterEndHook: value };
    delete next.endHook;
    delete next.hook;
    onChange?.(next);
  };
  return (
    <section className="chapter-contract-hook-editor">
      <div>
        <label htmlFor="current-chapter-end-hook">章末钩子（可留空）</label>
        <small>不想设置悬念或强钩子时，直接清空。正文会采用自然收束，不再强制制造悬念。</small>
      </div>
      <textarea
        id="current-chapter-end-hook"
        rows={3}
        value={hook}
        onChange={(event) => updateHook(event.target.value)}
        disabled={disabled}
        placeholder="留空表示本章不要求章末钩子"
      />
      {hook.trim() && (
        <button type="button" className="chapter-contract-clear-hook" onClick={() => updateHook('')} disabled={disabled}>
          <Trash2 size={14} />清空章末钩子
        </button>
      )}
    </section>
  );
}

function DecisionGaps({ gaps }) {
  return (
    <div className="blueprint-gap-grid">
      {gaps.map((gap, index) => (
        <article className="blueprint-gap" key={index}>
          <header>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <em>{gap?.category || gap?.status || '待裁决'}</em>
          </header>
          <h3>{gap?.question || `待决定问题 ${index + 1}`}</h3>
          {hasContent(gap?.recommendedCandidate) && (
            <div><strong>建议候选</strong><ReadableValue value={gap.recommendedCandidate} /></div>
          )}
        </article>
      ))}
    </div>
  );
}

function buildCharacterNames(characters) {
  return Object.fromEntries(characters.flatMap((character) => {
    const name = character?.candidateName || character?.name;
    return character?.id && name ? [[character.id, name]] : [];
  }));
}

function resolveName(value, names) {
  return names?.[value] || value || '未知角色';
}

function sectionPreview(sectionId, value, names) {
  if (sectionId === 'characters') {
    const namesText = arrayValue(value).slice(0, 4).map((item) => item?.candidateName || item?.name).filter(Boolean).join('、');
    return `${countItems(value)} 个角色${namesText ? ` · ${namesText}` : ''}`;
  }
  if (sectionId === 'relationships') {
    const first = arrayValue(value)[0];
    return first ? `${countItems(value)} 组关系 · ${resolveName(first.from, names)} 与 ${resolveName(first.to, names)}` : '暂未提供人物关系';
  }
  if (sectionId === 'volumes') {
    const first = arrayValue(value)[0];
    return `${countItems(value)} 卷规划${first?.candidateTitle ? ` · 从《${first.candidateTitle}》开始` : ''}`;
  }
  if (sectionId === 'contract') {
    return `${value?.candidateTitle || '下一章'} · ${truncateText(value?.coreConflict || firstText(value), 90)}`;
  }
  return `${countItems(value)} 项 · ${truncateText(firstText(value), 90)}`;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
