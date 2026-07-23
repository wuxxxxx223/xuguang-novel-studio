export class ApiError extends Error {
  constructor(message, { status = 0, details = null, endpoint = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.endpoint = endpoint;
  }
}

async function request(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error?.message ??
      payload?.error ??
      `${response.status} ${response.statusText || '请求失败'}`;
    throw new ApiError(String(message), {
      status: response.status,
      details: payload,
      endpoint,
    });
  }

  return payload ?? {};
}

async function writeResource(endpoint, value) {
  try {
    return await request(endpoint, { method: 'PUT', body: JSON.stringify(value) });
  } catch (error) {
    if (!(error instanceof ApiError) || ![404, 405].includes(error.status)) throw error;
    return request(endpoint, { method: 'POST', body: JSON.stringify(value) });
  }
}

export function getProjects() {
  return request('/api/projects');
}

export function getWorkspaces() {
  return request('/api/workspaces');
}

export function createWorkspaceRecord(input) {
  return request('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function activateWorkspace(workspaceId) {
  return request(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function getProjectDashboard(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/dashboard`);
}

export function getProjectChapterWorkspace(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace`);
}

export function saveProjectContractDraft(projectId, { expectedRevision, text, title = '' }) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/contract-draft`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRevision, text, title }),
  });
}

export function generateProjectContractDraft(projectId, expectedRevision) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/contract-draft/generate`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  });
}

export function prepareProjectContractDraft(projectId, expectedRevision) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/contract-draft/prepare`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  });
}

export function commitProjectContractDraft(projectId, { expectedRevision, planHash, confirmFormalWrite }) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/contract-draft/commit`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, planHash, confirmFormalWrite }),
  });
}

export function saveProjectChapterWorkspace(projectId, { expectedRevision, text, title = '' }) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRevision, text, title }),
  });
}

export function generateProjectChapterDraft(projectId, expectedRevision, confirmModelSpend = false, mode = 'full') {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/generate`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, confirmModelSpend, mode }),
  });
}

export function reviewProjectChapterDraft(projectId, expectedRevision) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/review`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  });
}

export function confirmProjectChapterDraft(projectId, expectedRevision) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/confirm`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  });
}

export function prepareProjectChapterWriteBack(projectId, expectedRevision) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/writeback/prepare`, {
    method: 'POST', body: JSON.stringify({ expectedRevision }),
  });
}

export function commitProjectChapterWriteBack(projectId, { expectedRevision, planHash, confirmFormalWrite }) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/chapter-workspace/writeback/commit`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, planHash, confirmFormalWrite }),
  });
}

export function getProjectCalibrations(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/calibrations`);
}

export function runProjectCalibration(projectId, { mode, candidates }) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/calibrations`, {
    method: 'POST',
    body: JSON.stringify({ mode, candidates }),
  });
}

export function getWorkspace() {
  return request('/api/workspace');
}

export function saveWorkspace(workspace) {
  return writeResource('/api/workspace', workspace);
}

export function getSettings() {
  return request('/api/settings');
}

export function saveSettings(settings) {
  return writeResource('/api/settings', settings);
}

export function testModelConnection(settings, options = {}) {
  return request('/api/models/test', {
    method: 'POST',
    body: JSON.stringify({ settings, ...options }),
  });
}

export function discoverProviderModels(settings, providerId) {
  return request('/api/models/discover', {
    method: 'POST',
    body: JSON.stringify({ settings, providerId }),
  });
}

export function generateWithAI({ stage, workspace, input, context, refinement = null, ideation = null, writingMode = null, chapterId = null }) {
  return request('/api/ai/generate', {
    method: 'POST',
    body: JSON.stringify({
      stage,
      workspace,
      input,
      context,
      ...(refinement ? { refinement } : {}),
      ...(ideation ? { ideation } : {}),
      ...(writingMode ? { writingMode } : {}),
      ...(chapterId != null ? { chapterId } : {}),
    }),
  });
}

export function generateDraftBatch({ workspace, input, context, chapterId, targets }) {
  return request('/api/ai/generate-batch', {
    method: 'POST',
    body: JSON.stringify({ stage: 'draft', writingMode: 'draft', workspace, input, context, chapterId, targets }),
  });
}
