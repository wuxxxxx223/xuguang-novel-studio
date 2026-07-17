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
    confirmed: null,
  },
  blueprint: {
    status: 'empty',
    input: { positioning: '', characters: '', volumes: '', chapterContract: '' },
    suggestion: null,
    confirmed: null,
  },
  draft: { status: 'empty', text: '', suggestion: null, confirmed: null },
  review: { status: 'empty', input: { focus: '' }, suggestion: null, confirmed: null, findings: [], accepted: false },
};

export function createWorkspace() {
  return {
    revision: 0,
    project: { title: '', genre: '', audience: '', tone: '' },
    currentStage: 'idea',
    currentChapter: { number: 1, title: '第一章' },
    stages: structuredCloneSafe(stageDefaults),
    runs: [],
  };
}

export function normalizeWorkspace(payload) {
  const raw = payload?.workspace ?? payload?.data?.workspace ?? payload?.data ?? payload ?? {};
  const base = createWorkspace();
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
    };
  }

  return {
    ...base,
    ...raw,
    revision: Number.isFinite(Number(raw.revision)) ? Number(raw.revision) : 0,
    project: { ...base.project, ...(raw.project ?? {}) },
    currentStage: STAGES.some((stage) => stage.id === raw.currentStage) ? raw.currentStage : 'idea',
    currentChapter: { ...base.currentChapter, ...(raw.currentChapter ?? {}) },
    stages,
    runs: Array.isArray(raw.runs) ? raw.runs : [],
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
      },
    ],
    routes: Object.fromEntries(['idea', 'logic', 'blueprint', 'writer', 'review'].map((role) => [role, { providerId, model: '' }])),
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
    };
  });
  const firstProviderId = providers[0]?.id ?? '';
  const modelInputs = raw.models ?? raw.modelByStage ?? {};
  const routeInputs = raw.routes ?? {};
  const routes = {};
  for (const role of ['idea', 'logic', 'blueprint', 'writer', 'review']) {
    const legacyRole = role === 'writer' ? 'draft' : role;
    const incoming = routeInputs[role] ?? routeInputs[legacyRole];
    routes[role] = {
      providerId: String((incoming && typeof incoming === 'object' ? incoming.providerId : '') ?? firstProviderId).trim() || firstProviderId,
      model: String(
        (incoming && typeof incoming === 'object' ? incoming.model : incoming) ??
        modelInputs[role] ?? modelInputs[legacyRole] ?? raw[role + 'Model'] ?? ''
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
  const blockers = workspace.stages.review?.findings?.filter((finding) => ['P0', 'P1'].includes(String(finding?.severity ?? finding?.priority ?? '').toUpperCase()));
  count += blockers?.length ?? 0;
  return count;
}

export function firstActionableStage(workspace) {
  const current = getStage(workspace.currentStage);
  if (canAccessStage(workspace, current.id).allowed && workspace.stages[current.id]?.status !== 'ready') return current;
  const nextIncomplete = STAGES.find((stage) => canAccessStage(workspace, stage.id).allowed && workspace.stages[stage.id]?.status !== 'ready');
  return nextIncomplete ?? STAGES[STAGES.length - 1];
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

