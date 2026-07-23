export const STAGES = [
  { id: 'idea', label: 'Idea', shortLabel: 'Idea', navLabel: 'Idea', modelKey: 'idea' },
  { id: 'logic', label: '故事引擎', shortLabel: '逻辑', navLabel: '故事引擎', modelKey: 'logic' },
  { id: 'blueprint', label: '小说蓝图', shortLabel: '蓝图', navLabel: '小说蓝图', modelKey: 'blueprint' },
  { id: 'draft', label: '章节写作', shortLabel: '章节', navLabel: '章节写作', modelKey: 'writer' },
  { id: 'review', label: '审查定稿', shortLabel: '审查', navLabel: '审查定稿', modelKey: 'review' },
];

export const STATUS_META = {
  empty: { label: '未开始', tone: 'neutral' },
  editing: { label: '正在编辑', tone: 'ink' },
  generating: { label: '模型处理中', tone: 'progress' },
  suggested: { label: '建议待确认', tone: 'coral' },
  ready: { label: '已确认', tone: 'green' },
  stale: { label: '需重新确认', tone: 'amber' },
  error: { label: '调用失败', tone: 'red' },
};

const allowedStatuses = new Set(Object.keys(STATUS_META));

const stageDefaults = {
  idea: {
    status: 'editing',
    input: '',
    draw: { mode: 'random', constraints: '' },
    suggestion: null,
    refinementFeedback: '',
    iterations: [],
    confirmed: null,
  },
  logic: {
    status: 'empty',
    input: { desire: '', resistance: '', stakes: '', escalation: '', mystery: '' },
    suggestion: null,
    refinementFeedback: '',
    confirmed: null,
  },
  blueprint: {
    status: 'empty',
    input: { positioning: '', characters: '', volumes: '', chapterContract: '' },
    suggestion: null,
    confirmed: null,
  },
  draft: {
    status: 'empty',
    text: '',
    suggestion: null,
    chapterOutline: { status: 'empty', suggestion: null, confirmed: null, feedback: '', annotations: {}, iterations: [], error: null, updatedAt: null },
    generationNotes: { minChars: 2000, targetChars: 2500, maxChars: 3000, style: '', sectionInstructions: {} },
    generationTargets: [],
    candidates: [],
    selectedCandidateId: '',
    paragraphAnnotations: [],
    confirmed: null,
  },
  review: { status: 'empty', input: { focus: '' }, suggestion: null, confirmed: null, findings: [], accepted: false },
};

const CHAPTER_CYCLE_VERSION = 1;
const chapterContractStatuses = new Set(['unconfirmed', 'suggested', 'confirmed']);
const chapterContractDefaults = Object.freeze({
  status: 'unconfirmed',
  candidate: null,
  confirmed: null,
  source: null,
  proposedAt: null,
  confirmedAt: null,
});
const contractMetadataKeys = new Set(['id', 'chapterId', 'chapterNumber', 'number', 'status', 'confirmed', 'source', 'candidateTitle', 'title']);
const contractCandidateKeys = [
  'selectedChapterContractCandidate', 'nextChapterContractCandidate', 'selectedChapterContract',
  'nextChapterContract', 'chapterContract', 'contract',
];

export function createWorkspace() {
  return {
    revision: 0,
    project: { title: '', genre: '', audience: '', tone: '' },
    currentStage: 'idea',
    chapterCycleVersion: CHAPTER_CYCLE_VERSION,
    chapterHistory: [],
    chapterRevisions: [],
    activeChapterRevision: null,
    currentChapter: createCurrentChapter(1),
    stages: structuredCloneSafe(stageDefaults),
    runs: [],
  };
}

export function normalizeWorkspace(payload) {
  const raw = payload?.workspace ?? payload?.data?.workspace ?? payload?.data ?? payload ?? {};
  const base = createWorkspace();
  const chapterCycleVersion = Number(raw.chapterCycleVersion) === CHAPTER_CYCLE_VERSION ? CHAPTER_CYCLE_VERSION : 0;
  const stages = {};

  for (const stage of STAGES) {
    const incoming = raw.stages?.[stage.id] ?? {};
    const fallback = stageDefaults[stage.id];
    const status = allowedStatuses.has(incoming.status) ? incoming.status : fallback.status;
    stages[stage.id] = {
      ...structuredCloneSafe(fallback),
      ...incoming,
      status,
      input:
        typeof fallback.input === 'object' && fallback.input !== null
          ? { ...fallback.input, ...(incoming.input && typeof incoming.input === 'object' ? incoming.input : {}) }
          : incoming.input ?? fallback.input,
      ...(stage.id === 'idea' ? {
        draw: {
          ...fallback.draw,
          ...(incoming.draw && typeof incoming.draw === 'object' ? incoming.draw : {}),
        },
      } : {}),
      ...(stage.id === 'draft' ? {
        chapterOutline: normalizeChapterOutline(incoming.chapterOutline),
        generationNotes: normalizeDraftGenerationNotes(incoming.generationNotes),
        generationTargets: normalizeDraftGenerationTargets(incoming.generationTargets),
        candidates: normalizeDraftCandidates(incoming.candidates),
        selectedCandidateId: String(incoming.selectedCandidateId ?? '').slice(0, 120),
        paragraphAnnotations: normalizeParagraphAnnotations(incoming.paragraphAnnotations),
      } : {}),
    };
  }

  return {
    ...base,
    ...raw,
    revision: Number.isFinite(Number(raw.revision)) ? Number(raw.revision) : 0,
    project: { ...base.project, ...(raw.project ?? {}) },
    currentStage: STAGES.some((stage) => stage.id === raw.currentStage) ? raw.currentStage : 'idea',
    chapterCycleVersion,
    chapterHistory: Array.isArray(raw.chapterHistory) ? raw.chapterHistory.map((entry) => structuredCloneSafe(entry)) : [],
    chapterRevisions: Array.isArray(raw.chapterRevisions) ? raw.chapterRevisions.map((entry) => structuredCloneSafe(entry)) : [],
    activeChapterRevision: raw.activeChapterRevision && typeof raw.activeChapterRevision === 'object'
      ? structuredCloneSafe(raw.activeChapterRevision)
      : null,
    currentChapter: normalizeCurrentChapter(raw.currentChapter, chapterCycleVersion),
    stages,
    runs: Array.isArray(raw.runs) ? raw.runs : [],
  };
}

function normalizeChapterOutline(value) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const status = ['empty', 'generating', 'suggested', 'confirmed', 'error'].includes(incoming.status)
    ? incoming.status
    : 'empty';
  return {
    status: status === 'generating' ? 'suggested' : status,
    suggestion: incoming.suggestion ?? null,
    confirmed: incoming.confirmed ?? null,
    feedback: String(incoming.feedback ?? ''),
    annotations: normalizeOutlineAnnotations(incoming.annotations),
    iterations: Array.isArray(incoming.iterations) ? incoming.iterations.slice(-20).map((item, index) => ({
      id: String(item?.id ?? `outline-v${index + 1}`),
      version: Math.max(1, Number.parseInt(item?.version, 10) || index + 1),
      suggestion: structuredCloneSafe(item?.suggestion ?? null),
      feedback: String(item?.feedback ?? ''),
      createdAt: item?.createdAt ?? null,
      providerName: String(item?.providerName ?? ''),
      model: String(item?.model ?? ''),
    })) : [],
    error: incoming.error && typeof incoming.error === 'object' ? incoming.error : null,
    updatedAt: incoming.updatedAt ?? null,
    confirmedAt: incoming.confirmedAt ?? null,
  };
}

function normalizeOutlineAnnotations(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => {
    const incoming = item && typeof item === 'object' && !Array.isArray(item) ? item : { instruction: item };
    return [String(key).slice(0, 120), { title: String(incoming.title ?? '').slice(0, 200), instruction: String(incoming.instruction ?? '').slice(0, 4000) }];
  }));
}

function normalizeDraftGenerationTargets(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item, index) => ({
    id: String(item?.id ?? `target-${index + 1}`).slice(0, 120),
    providerId: String(item?.providerId ?? '').slice(0, 64),
    model: String(item?.model ?? '').slice(0, 200),
    enabled: item?.enabled !== false,
  }));
}

function normalizeDraftCandidates(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).map((item, index) => ({
    id: String(item?.id ?? `candidate-${index + 1}`).slice(0, 120),
    targetId: String(item?.targetId ?? '').slice(0, 120),
    providerId: String(item?.providerId ?? '').slice(0, 64),
    providerName: String(item?.providerName ?? '').slice(0, 120),
    model: String(item?.model ?? '').slice(0, 200),
    status: ['generating', 'ready', 'error'].includes(item?.status) ? item.status : 'error',
    suggestion: structuredCloneSafe(item?.suggestion ?? null),
    error: item?.error ? { message: String(item.error.message ?? item.error).slice(0, 1000) } : null,
    latencyMs: Math.max(0, Number(item?.latencyMs) || 0),
    createdAt: item?.createdAt ?? null,
  }));
}

function normalizeDraftGenerationNotes(value) {
  const incoming = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const minChars = Math.min(10000, Math.max(500, Number.parseInt(incoming.minChars, 10) || 2000));
  const maxChars = Math.min(12000, Math.max(minChars + 200, Number.parseInt(incoming.maxChars, 10) || 3000));
  const requestedTarget = Number.parseInt(incoming.targetChars, 10);
  const targetChars = Number.isFinite(requestedTarget)
    ? Math.min(maxChars, Math.max(minChars, requestedTarget))
    : Math.round((minChars + maxChars) / 2);
  return {
    minChars,
    targetChars,
    maxChars,
    style: String(incoming.style ?? '').slice(0, 6000),
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
  return ['short', 'normal', 'long', 'focus'].includes(value) ? value : 'normal';
}

function normalizeParagraphAnnotations(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).map((annotation, index) => {
    const status = ['editing', 'ready', 'error', 'applied'].includes(annotation?.status)
      ? annotation.status
      : 'editing';
    return {
      id: String(annotation?.id ?? `paragraph-note-${index + 1}`),
      paragraphIndex: Math.max(0, Number.parseInt(annotation?.paragraphIndex, 10) || 0),
      sourceText: String(annotation?.sourceText ?? ''),
      instruction: String(annotation?.instruction ?? ''),
      status,
      candidate: String(annotation?.candidate ?? ''),
      changeSummary: String(annotation?.changeSummary ?? ''),
      continuityWarnings: Array.isArray(annotation?.continuityWarnings) ? annotation.continuityWarnings : [],
      error: annotation?.error && typeof annotation.error === 'object' ? annotation.error : null,
      createdAt: annotation?.createdAt ?? null,
      updatedAt: annotation?.updatedAt ?? null,
      appliedAt: annotation?.appliedAt ?? null,
      model: String(annotation?.model ?? ''),
      provider: String(annotation?.provider ?? ''),
    };
  });
}

export function isChapterCycleWorkspace(workspace) {
  return Number(workspace?.chapterCycleVersion) === CHAPTER_CYCLE_VERSION;
}

export function getCurrentChapterContractState(workspace) {
  return isChapterCycleWorkspace(workspace)
    ? normalizeChapterContract(workspace?.currentChapter?.contract)
    : null;
}

export function getConfirmedCurrentChapterContract(workspace) {
  if (isChapterCycleWorkspace(workspace)) {
    const contract = getCurrentChapterContractState(workspace);
    return contract?.status === 'confirmed' && hasContractContent(contract.confirmed)
      ? structuredCloneSafe(contract.confirmed)
      : null;
  }
  return getLegacyChapterContract(workspace?.stages?.blueprint);
}

export function hasConfirmedCurrentChapterContract(workspace) {
  return getConfirmedCurrentChapterContract(workspace) != null;
}

export function getCurrentChapterContractCandidate(workspace) {
  const contract = getCurrentChapterContractState(workspace);
  return contract?.candidate == null ? null : structuredCloneSafe(contract.candidate);
}

export function canConfirmCurrentChapterContract(workspace) {
  const contract = getCurrentChapterContractState(workspace);
  return Boolean(contract?.status === 'suggested' && hasContractContent(contract.candidate));
}

export function prepareCurrentChapterContract(workspace, timestamp = new Date().toISOString()) {
  if (!isChapterCycleWorkspace(workspace)) return workspace;
  const currentChapter = normalizeCurrentChapter(workspace.currentChapter, CHAPTER_CYCLE_VERSION);
  const currentContract = currentChapter.contract;
  if (currentContract.status === 'confirmed' || currentContract.candidate != null) return workspace;

  const candidateSource = findBlueprintContractCandidate(workspace, currentChapter.number);
  const candidate = candidateSource?.value ?? createContractTemplate(currentChapter.number);
  return {
    ...workspace,
    currentChapter: {
      ...currentChapter,
      contract: {
        status: 'suggested',
        candidate: structuredCloneSafe(candidate),
        confirmed: null,
        source: candidateSource?.source ?? { kind: 'author-contract-template', targetChapterNumber: currentChapter.number },
        proposedAt: timestamp,
        confirmedAt: null,
      },
    },
  };
}

export function updateCurrentChapterContractCandidate(workspace, candidate, timestamp = new Date().toISOString()) {
  if (!isChapterCycleWorkspace(workspace)) return workspace;
  const currentChapter = normalizeCurrentChapter(workspace.currentChapter, CHAPTER_CYCLE_VERSION);
  if (currentChapter.contract.status === 'confirmed') return workspace;
  return {
    ...workspace,
    currentChapter: {
      ...currentChapter,
      contract: {
        ...currentChapter.contract,
        status: 'suggested',
        candidate: structuredCloneSafe(candidate),
        confirmed: null,
        source: currentChapter.contract.source ?? { kind: 'author-edited-contract', targetChapterNumber: currentChapter.number },
        proposedAt: currentChapter.contract.proposedAt ?? timestamp,
        confirmedAt: null,
      },
    },
  };
}

export function reopenCurrentChapterContract(workspace, timestamp = new Date().toISOString()) {
  if (!isChapterCycleWorkspace(workspace)) return null;
  const currentChapter = normalizeCurrentChapter(workspace.currentChapter, CHAPTER_CYCLE_VERSION);
  const currentContract = currentChapter.contract;
  if (currentContract.status !== 'confirmed' || !hasContractContent(currentContract.confirmed)) return null;
  const revisions = Array.isArray(currentContract.revisions) ? currentContract.revisions : [];
  return {
    ...workspace,
    currentChapter: {
      ...currentChapter,
      contract: {
        ...currentContract,
        status: 'suggested',
        candidate: structuredCloneSafe(currentContract.confirmed),
        confirmed: null,
        source: {
          kind: 'author-contract-revision',
          previousSource: structuredCloneSafe(currentContract.source),
          reopenedAt: timestamp,
        },
        revisions: [...revisions, {
          value: structuredCloneSafe(currentContract.confirmed),
          confirmedAt: currentContract.confirmedAt,
          reopenedAt: timestamp,
        }].slice(-20),
        proposedAt: timestamp,
        confirmedAt: null,
      },
    },
  };
}

export function confirmCurrentChapterContract(workspace, timestamp = new Date().toISOString()) {
  if (!canConfirmCurrentChapterContract(workspace)) return null;
  const currentChapter = normalizeCurrentChapter(workspace.currentChapter, CHAPTER_CYCLE_VERSION);
  const confirmed = structuredCloneSafe(currentChapter.contract.candidate);
  return {
    ...workspace,
    currentChapter: {
      ...currentChapter,
      title: chapterTitleFromContract(confirmed, currentChapter.number),
      contract: {
        ...currentChapter.contract,
        status: 'confirmed',
        confirmed,
        confirmedAt: timestamp,
      },
    },
  };
}

export function canCompleteCurrentChapter(workspace) {
  const draft = workspace?.stages?.draft;
  const review = workspace?.stages?.review;
  const chapterNumber = Number(workspace?.currentChapter?.number ?? 0);
  const history = Array.isArray(workspace?.chapterHistory) ? workspace.chapterHistory : [];
  return Boolean(
    chapterNumber > 0
    && getConfirmedCurrentChapterContract(workspace) != null
    && draft?.status === 'ready'
    && draft.confirmed != null
    && review?.status === 'ready'
    && review.confirmed != null
    && review.accepted === true
    && !history.some((entry) => Number(entry?.chapterNumber) === chapterNumber),
  );
}

export function prepareNextWorkspaceChapter(workspace, timestamp = new Date().toISOString()) {
  if (!canCompleteCurrentChapter(workspace)) return null;
  const currentChapter = normalizeCurrentChapter(workspace.currentChapter, isChapterCycleWorkspace(workspace) ? CHAPTER_CYCLE_VERSION : 0);
  const contract = getConfirmedCurrentChapterContract(workspace);
  const completed = {
    schemaVersion: 1,
    chapterNumber: currentChapter.number,
    title: currentChapter.title || chapterTitleFromContract(contract, currentChapter.number),
    contract: {
      value: structuredCloneSafe(contract),
      confirmedAt: currentChapter.contract?.confirmedAt ?? workspace.stages.blueprint?.confirmedAt ?? null,
    },
    draft: {
      value: structuredCloneSafe(workspace.stages.draft.confirmed),
      confirmedAt: workspace.stages.draft.confirmedAt ?? null,
    },
    review: {
      value: structuredCloneSafe(workspace.stages.review.confirmed),
      confirmedAt: workspace.stages.review.confirmedAt ?? null,
    },
    completedAt: timestamp,
    formalWritePerformed: false,
  };
  const nextNumber = currentChapter.number + 1;
  const next = {
    ...workspace,
    chapterCycleVersion: CHAPTER_CYCLE_VERSION,
    chapterHistory: [...(Array.isArray(workspace.chapterHistory) ? workspace.chapterHistory : []), completed],
    currentStage: 'blueprint',
    currentChapter: createCurrentChapter(nextNumber),
    stages: {
      ...workspace.stages,
      draft: structuredCloneSafe(stageDefaults.draft),
      review: structuredCloneSafe(stageDefaults.review),
    },
  };
  return prepareCurrentChapterContract(next, timestamp);
}

export function beginArchivedChapterRevision(workspace, chapterNumber, timestamp = new Date().toISOString()) {
  const number = Number(chapterNumber);
  const archived = (Array.isArray(workspace?.chapterHistory) ? workspace.chapterHistory : [])
    .find((entry) => Number(entry?.chapterNumber) === number);
  if (!archived) return null;
  const revisions = (Array.isArray(workspace?.chapterRevisions) ? workspace.chapterRevisions : [])
    .filter((entry) => Number(entry?.chapterNumber) === number);
  const latest = revisions.at(-1);
  const sourceDraft = latest?.draft?.value ?? archived.draft?.value;
  if (sourceDraft == null) return null;
  return {
    ...workspace,
    activeChapterRevision: {
      chapterNumber: number,
      title: latest?.title ?? archived.title ?? `第 ${number} 章`,
      sourceCompletedAt: archived.completedAt ?? null,
      sourceRevisionId: latest?.revisionId ?? null,
      originalDraft: structuredCloneSafe(sourceDraft),
      draft: structuredCloneSafe(sourceDraft),
      startedAt: timestamp,
    },
  };
}

export function updateArchivedChapterRevision(workspace, draft) {
  if (!workspace?.activeChapterRevision) return workspace;
  return {
    ...workspace,
    activeChapterRevision: {
      ...workspace.activeChapterRevision,
      draft: structuredCloneSafe(draft),
    },
  };
}

export function cancelArchivedChapterRevision(workspace) {
  return workspace?.activeChapterRevision ? { ...workspace, activeChapterRevision: null } : workspace;
}

export function confirmArchivedChapterRevision(workspace, timestamp = new Date().toISOString()) {
  const active = workspace?.activeChapterRevision;
  if (!active || !String(active.draft ?? '').trim()) return null;
  const revisions = Array.isArray(workspace.chapterRevisions) ? workspace.chapterRevisions : [];
  const revisionNumber = revisions.filter((entry) => Number(entry?.chapterNumber) === Number(active.chapterNumber)).length + 1;
  const revision = {
    schemaVersion: 1,
    revisionId: `chapter-${active.chapterNumber}-revision-${revisionNumber}`,
    revisionNumber,
    chapterNumber: Number(active.chapterNumber),
    title: active.title || `第 ${active.chapterNumber} 章`,
    sourceCompletedAt: active.sourceCompletedAt ?? null,
    sourceRevisionId: active.sourceRevisionId ?? null,
    draft: { value: structuredCloneSafe(active.draft), confirmedAt: timestamp },
    completedAt: timestamp,
    formalWritePerformed: false,
  };
  return {
    ...workspace,
    chapterRevisions: [...revisions, revision],
    activeChapterRevision: null,
  };
}

export function createSettings() {
  const providerId = 'provider-default';
  return {
    version: 2,
    providers: [
      {
        id: providerId,
        name: 'OpenAI Compatible',
        type: 'openai-compatible',
        kind: 'custom',
        baseUrl: '',
        hasApiKey: false,
        apiKeyMasked: '',
        configured: false,
        models: [],
      },
    ],
    routes: Object.fromEntries(['idea', 'logic', 'blueprint', 'outline', 'writer', 'review'].map((role) => [role, { providerId, model: '' }])),
    temperature: 0.7,
    jsonMode: true,
  };
}

export function normalizeSettings(payload) {
  const raw = payload?.settings ?? payload?.data?.settings ?? payload?.data ?? payload ?? {};
  const defaults = createSettings();
  const returnedApiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  const legacyMasked = raw.apiKeyMasked ?? raw.maskedApiKey ?? (isMaskedApiKey(returnedApiKey) ? returnedApiKey : '');
  const providerInputs = Array.isArray(raw.providers) && raw.providers.length
    ? raw.providers
    : [{
        id: raw.provider?.id ?? 'provider-default',
        name: raw.providerName ?? raw.provider?.name ?? 'OpenAI Compatible',
        type: 'openai-compatible',
        kind: 'custom',
        baseUrl: raw.baseUrl ?? raw.provider?.baseUrl ?? '',
        hasApiKey: raw.hasApiKey ?? raw.apiKeySet ?? raw.apiKeyConfigured ?? raw.provider?.hasApiKey ?? Boolean(legacyMasked),
        apiKeyMasked: legacyMasked || (raw.apiKeySet ? '••••••••' : ''),
      }];
  const providers = providerInputs.map((provider, index) => {
    const masked = provider.apiKeyMasked ?? provider.maskedApiKey ?? (isMaskedApiKey(provider.apiKey) ? provider.apiKey : '');
    const hasApiKey = Boolean(provider.hasApiKey ?? provider.apiKeySet ?? provider.apiKeyConfigured ?? masked);
    const baseUrl = String(provider.baseUrl ?? '').trim();
    return {
      id: String(provider.id ?? ('provider-' + (index + 1))).trim() || ('provider-' + (index + 1)),
      name: String(provider.name ?? ('API 渠道 ' + (index + 1))).trim() || ('API 渠道 ' + (index + 1)),
      type: String(provider.type ?? 'openai-compatible'),
      kind: String(provider.kind ?? 'custom'),
      baseUrl,
      hasApiKey,
      apiKeyMasked: masked || (hasApiKey ? '••••••••' : ''),
      configured: Boolean(provider.configured ?? (baseUrl && hasApiKey)),
      models: [...new Set((Array.isArray(provider.models) ? provider.models : []).map((model) => String(model ?? '').trim()).filter(Boolean))],
    };
  });
  const firstProviderId = providers[0]?.id ?? '';
  const modelInputs = raw.models ?? raw.modelByStage ?? {};
  const routeInputs = raw.routes ?? {};
  const routes = {};
  for (const role of ['idea', 'logic', 'blueprint', 'outline', 'writer', 'review']) {
    const legacyRole = role === 'writer' ? 'draft' : role;
    const incoming = routeInputs[role] ?? routeInputs[legacyRole] ?? (role === 'outline' ? routeInputs.logic : undefined);
    const fallbackRoute = role === 'outline' ? routes.logic : null;
    routes[role] = {
      providerId: String(incoming && typeof incoming === 'object' ? incoming.providerId : fallbackRoute?.providerId ?? firstProviderId).trim() || firstProviderId,
      model: String(
        (incoming && typeof incoming === 'object' ? incoming.model : incoming) ??
        modelInputs[role] ?? modelInputs[legacyRole] ?? (role === 'outline' ? routes.logic?.model : undefined) ?? raw[role + 'Model'] ?? ''
      ).trim(),
    };
  }
  const temperatureSource = raw.temperature ?? raw.defaults?.temperature ?? 0.7;
  const globalTemperature =
    typeof temperatureSource === 'number'
      ? temperatureSource
      : temperatureSource?.idea ?? temperatureSource?.logic ?? Object.values(temperatureSource ?? {}).find((value) => typeof value === 'number') ?? 0.7;

  return {
    ...defaults,
    version: 2,
    providers,
    routes,
    temperature: clampNumber(globalTemperature, 0, 2),
    jsonMode: Boolean(raw.jsonMode ?? raw.defaults?.jsonMode ?? true),
  };
}

export function getModelRoute(settings, role) {
  const route = settings?.routes?.[role] ?? { providerId: '', model: '' };
  const provider = settings?.providers?.find((item) => item.id === route.providerId) ?? null;
  const model = String(route.model ?? '').trim();
  return {
    provider,
    providerId: String(route.providerId ?? ''),
    model,
    configured: Boolean(provider?.baseUrl && provider?.hasApiKey && model),
  };
}

export function getStage(stageId) {
  return STAGES.find((stage) => stage.id === stageId) ?? STAGES[0];
}

export function getStageIndex(stageId) {
  return Math.max(0, STAGES.findIndex((stage) => stage.id === stageId));
}

export function getNextStage(stageId) {
  const index = getStageIndex(stageId);
  return STAGES[index + 1] ?? null;
}

export function getPreviousStage(stageId) {
  const index = getStageIndex(stageId);
  return STAGES[index - 1] ?? null;
}

export function hasArtifactContent(artifact) {
  if (!artifact) return false;
  return Boolean(
    hasValue(artifact.input) ||
      hasValue(artifact.text) ||
      hasValue(artifact.suggestion) ||
      hasValue(artifact.confirmed) ||
      (Array.isArray(artifact.findings) && artifact.findings.length),
  );
}

export function canAccessStage(workspace, stageId) {
  const index = getStageIndex(stageId);
  if (index === 0) return { allowed: true, reason: '' };

  if (stageId === 'draft' && isChapterCycleWorkspace(workspace) && !hasConfirmedCurrentChapterContract(workspace)) {
    const number = workspace?.currentChapter?.number ?? 1;
    return { allowed: false, reason: `先确认第 ${number} 章章节契约` };
  }

  const artifact = workspace.stages?.[stageId];
  if (artifact?.status !== 'empty' || hasArtifactContent(artifact)) {
    return { allowed: true, reason: '' };
  }

  const previous = STAGES[index - 1];
  const previousStatus = workspace.stages?.[previous.id]?.status;
  if (previousStatus === 'ready') return { allowed: true, reason: '' };

  return { allowed: false, reason: `先确认${previous.label}` };
}

export function markDownstreamStale(workspace, sourceStageId) {
  const sourceIndex = getStageIndex(sourceStageId);
  const stages = { ...workspace.stages };

  STAGES.slice(sourceIndex + 1).forEach((stage) => {
    const artifact = stages[stage.id];
    if (!artifact || (!hasArtifactContent(artifact) && artifact.status === 'empty')) return;
    stages[stage.id] = {
      ...artifact,
      status: 'stale',
      staleFrom: sourceStageId,
      ...(stage.id === 'review' ? { accepted: false } : {}),
    };
  });

  return { ...workspace, stages };
}

export function editStage(workspace, stageId, patch) {
  const current = workspace.stages[stageId];
  const wasConfirmed = current.status === 'ready' || current.status === 'stale' || hasValue(current.confirmed);
  const next = {
    ...workspace,
    stages: {
      ...workspace.stages,
      [stageId]: {
        ...current,
        ...patch,
        status: current.status === 'generating' ? current.status : 'editing',
        error: null,
      },
    },
  };

  return wasConfirmed ? markDownstreamStale(next, stageId) : next;
}

export function summarizeArtifact(artifact) {
  if (!artifact) return '尚未建立';
  const value = artifact.confirmed ?? artifact.suggestion ?? artifact.text ?? artifact.input;
  const text = valueToText(value).replace(/\s+/g, ' ').trim();
  return text ? (text.length > 78 ? `${text.slice(0, 78)}…` : text) : STATUS_META[artifact.status]?.label ?? '尚未建立';
}

export function valueToText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${humanizeKey(key)}：${valueToText(item)}`)
      .filter((line) => !line.endsWith('：'))
      .join('\n');
  }
  return String(value);
}

export function humanizeKey(key) {
  const labels = {
    highConcept: '高概念',
    promise: '读者承诺',
    difference: '差异点',
    gaps: '待验证缺口',
    desire: '核心欲望',
    resistance: '主要阻力',
    stakes: '失败代价',
    escalation: '升级链',
    mystery: '长线悬念',
    positioning: '作品定位',
    characters: '角色关系',
    volumes: '卷纲',
    chapterContract: '下一章契约',
    title: '标题',
    content: '内容',
    summary: '摘要',
    findings: '审查发现',
    severity: '优先级',
    issue: '问题',
    suggestion: '建议',
  };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function extractSuggestion(response) {
  const raw =
    response?.suggestion ??
    response?.result?.suggestion ??
    response?.result?.content ??
    response?.content ??
    response?.output ??
    response?.data?.suggestion ??
    response?.data?.content ??
    response?.data ??
    response;
  return tryParseJson(raw);
}

export function extractFindings(response, suggestion) {
  const possible = response?.findings ?? response?.result?.findings ?? response?.data?.findings ?? suggestion?.findings;
  if (Array.isArray(possible)) return possible;
  if (Array.isArray(suggestion)) return suggestion;
  return [];
}

export function countRisks(workspace, settings) {
  let count = 0;
  count += STAGES.filter((stage) => !getModelRoute(settings, stage.modelKey).configured).length;
  count += STAGES.filter((stage) => workspace.stages[stage.id]?.status === 'stale').length;
  count += STAGES.filter((stage) => workspace.stages[stage.id]?.status === 'error').length;
  if (isChapterCycleWorkspace(workspace) && workspace.stages.blueprint?.status === 'ready' && !hasConfirmedCurrentChapterContract(workspace)) count += 1;
  const blockers = workspace.stages.review?.findings?.filter((finding) => ['P0', 'P1'].includes(String(finding?.severity ?? finding?.priority ?? '').toUpperCase()));
  count += blockers?.length ?? 0;
  return count;
}

export function firstActionableStage(workspace) {
  if (isChapterCycleWorkspace(workspace) && !hasConfirmedCurrentChapterContract(workspace)) {
    return getStage('blueprint');
  }
  if (canCompleteCurrentChapter(workspace)) return getStage('review');

  const current = getStage(workspace.currentStage);
  if (canAccessStage(workspace, current.id).allowed && workspace.stages[current.id]?.status !== 'ready') return current;
  const nextIncomplete = STAGES.find((stage) => canAccessStage(workspace, stage.id).allowed && workspace.stages[stage.id]?.status !== 'ready');
  return nextIncomplete ?? STAGES[STAGES.length - 1];
}

function createCurrentChapter(number) {
  const chapterNumber = Number.isInteger(Number(number)) && Number(number) > 0 ? Number(number) : 1;
  return {
    number: chapterNumber,
    title: `第 ${chapterNumber} 章`,
    contract: structuredCloneSafe(chapterContractDefaults),
  };
}

function normalizeCurrentChapter(value, chapterCycleVersion) {
  const incoming = isPlainObject(value) ? value : {};
  const fallback = createCurrentChapter(incoming.number);
  const title = String(incoming.title ?? fallback.title).trim().slice(0, 200) || fallback.title;
  return {
    ...fallback,
    ...incoming,
    number: fallback.number,
    title,
    contract: normalizeChapterContract(incoming.contract, chapterCycleVersion),
  };
}

function normalizeChapterContract(value) {
  const incoming = isPlainObject(value) ? value : {};
  const candidate = incoming.candidate ?? null;
  const confirmed = incoming.confirmed ?? null;
  let status = chapterContractStatuses.has(incoming.status) ? incoming.status : 'unconfirmed';
  if (status === 'confirmed' && !hasContractContent(confirmed)) status = hasContractContent(candidate) ? 'suggested' : 'unconfirmed';
  if (status === 'suggested' && candidate == null) status = 'unconfirmed';
  return {
    ...chapterContractDefaults,
    ...incoming,
    status,
    candidate: candidate == null ? null : structuredCloneSafe(candidate),
    confirmed: status === 'confirmed' ? structuredCloneSafe(confirmed) : null,
    source: incoming.source == null ? null : structuredCloneSafe(incoming.source),
    proposedAt: incoming.proposedAt ?? null,
    confirmedAt: status === 'confirmed' ? incoming.confirmedAt ?? null : null,
  };
}

function getLegacyChapterContract(blueprintArtifact) {
  const confirmed = tryParseJson(blueprintArtifact?.confirmed);
  if (isPlainObject(confirmed)) {
    const contract = confirmed.chapterContract
      ?? confirmed.nextChapterContract
      ?? confirmed.nextChapterContractCandidate
      ?? confirmed.selectedChapterContract
      ?? confirmed.selectedChapterContractCandidate
      ?? confirmed.contract
      ?? null;
    if (hasContractContent(contract)) return structuredCloneSafe(contract);
  }
  const inputContract = blueprintArtifact?.input?.chapterContract;
  return hasContractContent(inputContract) ? structuredCloneSafe(inputContract) : null;
}

function hasContractContent(value) {
  if (typeof value === 'string') return Boolean(value.trim());
  if (!isPlainObject(value)) return Array.isArray(value) ? value.some(hasContractContent) : false;
  return Object.entries(value).some(([key, item]) => !contractMetadataKeys.has(key) && hasValue(item));
}

function chapterTitleFromContract(contract, chapterNumber) {
  if (isPlainObject(contract)) {
    const title = String(contract.candidateTitle ?? contract.title ?? '').trim();
    if (title) return title.slice(0, 200);
  }
  return `第 ${chapterNumber} 章`;
}

function createContractTemplate(chapterNumber) {
  return {
    chapterNumber,
    candidateTitle: `第 ${chapterNumber} 章`,
    chapterGoal: '',
    coreConflict: '',
    chapterEndHook: '',
    candidateBeatSequence: [],
  };
}

function findBlueprintContractCandidate(workspace, targetChapterNumber) {
  const blueprint = workspace?.stages?.blueprint;
  if (blueprint?.status !== 'ready') return null;
  const root = tryParseJson(blueprint.confirmed);
  if (!isPlainObject(root)) return null;
  const exact = [];
  const unspecified = [];
  const seen = new Set();

  const add = (value, sourcePath) => {
    if (!hasContractContent(value) || seen.has(value)) return;
    seen.add(value);
    const sourceChapterNumber = contractChapterNumber(value);
    const item = {
      value: structuredCloneSafe(value),
      source: {
        kind: 'blueprint-next-contract-candidate',
        sourcePath,
        targetChapterNumber,
        sourceChapterNumber,
        blueprintConfirmedAt: blueprint.confirmedAt ?? null,
      },
    };
    if (sourceChapterNumber === targetChapterNumber) exact.push(item);
    else if (sourceChapterNumber == null) unspecified.push(item);
  };

  const visit = (value, sourcePath, depth = 0) => {
    if (!isPlainObject(value) || depth > 4) return;
    if (looksLikeChapterContract(value)) add(value, sourcePath);
    for (const key of contractCandidateKeys) {
      if (value[key] != null) add(value[key], `${sourcePath}.${key}`);
    }
    for (const key of ['chapterContracts', 'chapters']) {
      if (!Array.isArray(value[key])) continue;
      value[key].forEach((item, index) => add(item, `${sourcePath}.${key}[${index}]`));
    }
    Object.entries(value).forEach(([key, child]) => {
      if (isPlainObject(child)) visit(child, `${sourcePath}.${key}`, depth + 1);
    });
  };

  visit(root, 'stages.blueprint.confirmed');
  const alreadyUsed = (candidate) => {
    const history = Array.isArray(workspace?.chapterHistory) ? workspace.chapterHistory : [];
    const used = history.map((entry) => entry?.contract?.value).filter(Boolean);
    const current = getConfirmedCurrentChapterContract(workspace);
    if (current) used.push(current);
    return used.some((value) => sameJsonValue(value, candidate.value));
  };
  return exact.find((candidate) => !alreadyUsed(candidate)) ?? unspecified.find((candidate) => !alreadyUsed(candidate)) ?? null;
}

function looksLikeChapterContract(value) {
  return isPlainObject(value) && [
    'chapterId', 'chapterNumber', 'candidateTitle', 'title', 'chapterGoal', 'goal',
    'coreConflict', 'chapterEndHook', 'endHook', 'hook', 'requiredBeats', 'mustInclude',
  ].some((key) => Object.hasOwn(value, key));
}

function contractChapterNumber(value) {
  if (!isPlainObject(value)) return null;
  const raw = value.chapterNumber ?? value.chapterId ?? value.number ?? value.id;
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJsonValue(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === 'object') return Object.values(value).some(hasValue);
  return true;
}

function isMaskedApiKey(value) {
  return typeof value === 'string' && /^[*•●·]{4,}$/.test(value.trim());
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
