import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceLibrary } from './workspace-library.mjs';

function defaultWorkspace() {
  return {
    revision: 0,
    project: { title: '', genre: '', audience: '', tone: '' },
    currentStage: 'idea',
    currentChapter: { number: 1, title: '第一章' },
    stages: {
      idea: { status: 'editing', input: '', draw: { mode: 'random', constraints: '' }, suggestion: null, confirmed: null },
      logic: { status: 'empty' },
      blueprint: { status: 'empty' },
      draft: { status: 'empty' },
      review: { status: 'empty' },
    },
    runs: [],
  };
}

function normalizeWorkspace(input, revisionOverride) {
  const workspace = structuredClone(input);
  workspace.revision = revisionOverride ?? Number(workspace.revision ?? 0);
  workspace.project = { ...defaultWorkspace().project, ...(workspace.project ?? {}) };
  workspace.currentChapter = { ...defaultWorkspace().currentChapter, ...(workspace.currentChapter ?? {}) };
  workspace.stages = { ...defaultWorkspace().stages, ...(workspace.stages ?? {}) };
  workspace.stages.idea = {
    ...defaultWorkspace().stages.idea,
    ...(workspace.stages.idea ?? {}),
    draw: { ...defaultWorkspace().stages.idea.draw, ...(workspace.stages.idea?.draw ?? {}) },
  };
  workspace.runs = Array.isArray(workspace.runs) ? workspace.runs : [];
  return workspace;
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-library-'));
try {
  const legacyFile = path.join(tempDir, 'workspace.json');
  await fs.writeFile(legacyFile, `${JSON.stringify({
    ...defaultWorkspace(),
    revision: 7,
    project: { ...defaultWorkspace().project, title: '历史作品' },
  })}\n`);

  const library = createWorkspaceLibrary({
    dataDir: tempDir,
    legacyWorkspaceFile: legacyFile,
    defaultWorkspace,
    normalizeWorkspace,
  });

  const migrated = await library.listWorkspaces();
  assert.equal(migrated.workspaces.length, 1, '历史单 Workspace 应迁移为一条作品记录');
  assert.equal(migrated.workspaces[0].title, '历史作品');
  assert.equal(migrated.workspaces[0].active, true);
  assert.equal((await library.getActiveWorkspace()).revision, 7);

  const created = await library.createWorkspace({
    ...defaultWorkspace(),
    project: { ...defaultWorkspace().project, title: '新作品', genre: '悬疑' },
    stages: {
      ...defaultWorkspace().stages,
      idea: {
        ...defaultWorkspace().stages.idea,
        draw: { mode: 'guided', constraints: '海上孤岛，不要系统流' },
      },
    },
  });
  assert.equal(created.workspace.project.title, '新作品');
  assert.equal(created.workspace.stages.idea.draw.mode, 'guided');
  assert.equal((await library.listWorkspaces()).workspaces.length, 2, '新建不能覆盖历史作品');

  const saved = await library.saveActiveWorkspace({ ...created.workspace, revision: 1 });
  assert.equal(saved.revision, 1);
  assert.equal(JSON.parse(await fs.readFile(legacyFile, 'utf8')).project.title, '新作品', '兼容镜像应跟随当前作品');

  await library.activateWorkspace(migrated.workspaces[0].id);
  assert.equal((await library.getActiveWorkspace()).project.title, '历史作品', '切换后应恢复对应 Workspace');
  assert.equal(JSON.parse(await fs.readFile(legacyFile, 'utf8')).project.title, '历史作品');

  console.log('workspace library smoke passed');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

