import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BookCheck, BookMarked, BookOpenText,
  BrainCircuit, Check, CheckCircle2, ChevronDown, Circle, Compass, Download,
  Eye, EyeOff, FileText, History, Home, KeyRound, Layers3, Lightbulb,
  ListChecks, LoaderCircle, LockKeyhole, MoreHorizontal, PanelRightOpen,
  PanelsTopLeft, PenLine, PlugZap, Plus, RefreshCw, Route, Save, ScanSearch,
  Server, Settings2, ShieldAlert, Sparkles, Trash2, X,
} from 'lucide-react';
import {
  ApiError, commitProjectChapterWriteBack, commitProjectContractDraft, confirmProjectChapterDraft, generateProjectChapterDraft, generateProjectContractDraft, generateWithAI,
  getProjectChapterWorkspace, getProjectDashboard, getProjects, getSettings, getWorkspace,
  prepareProjectChapterWriteBack, prepareProjectContractDraft, reviewProjectChapterDraft, saveProjectChapterWorkspace, saveProjectContractDraft,
  saveSettings, saveWorkspace, testModelConnection,
} from './api.js';
import {
  STAGES, STATUS_META, canAccessStage, countRisks, createSettings,
  createWorkspace, editStage, extractFindings, extractSuggestion,
  firstActionableStage, getModelRoute, getNextStage, getPreviousStage, getStage,
  getStageIndex, humanizeKey, markDownstreamStale, normalizeSettings, normalizeWorkspace,
  summarizeArtifact, tryParseJson, valueToText,
} from './state.js';
import { ProjectChapterWorkspace, ProjectContractWorkspace, ProjectInspector, ProjectModelLab, ProjectReviewWorkspace, ProjectTodayWorkspace, ProjectWriteBackWorkspace } from './ProjectDashboard.jsx';
import IdeaDrawPanel from './IdeaDrawPanel.jsx';
import IdeaWorkshop from './IdeaWorkshop.jsx';
import StoryEngineWorkshop from './StoryEngineWorkshop.jsx';
import BlueprintWorkshop from './BlueprintWorkshop.jsx';
import DraftWorkshop from './DraftWorkshop.jsx';
import ReviewWorkshop from './ReviewWorkshop.jsx';

const NAV_ITEMS = [
  { id: 'today', label: '今日', icon: Home },
  { id: 'idea', label: 'Idea', icon: Lightbulb },
  { id: 'logic', label: '故事引擎', icon: Route },
  { id: 'blueprint', label: '小说蓝图', icon: PanelsTopLeft },
  { id: 'draft', label: '章节写作', icon: PenLine },
  { id: 'review', label: '审查定稿', icon: ScanSearch },
];

const STAGE_COPY = {
  idea: {
    eyebrow: '01 · 收敛灵感',
    title: '把灵感变成清晰的作品承诺',
    description: '先写你真正想讲的故事。模型只负责补齐高概念、读者承诺、差异点与待验证缺口。',
  },
  logic: {
    eyebrow: '02 · 建立故事引擎',
    title: '让欲望、阻力与代价彼此咬合',
    description: '用因果而不是事件清单推动故事，确认冲突如何升级，悬念如何穿过长线。',
  },
  blueprint: {
    eyebrow: '03 · 搭建小说蓝图',
    title: '把长篇方向压缩成可执行的章节契约',
    description: '确认作品定位、角色关系、卷纲，并给下一章一个明确、可检验的写作任务。',
  },
  draft: {
    eyebrow: '04 · 章节写作',
    title: '只写当前章节，不替未来透支答案',
    description: '正文候选严格依据已确认章节契约生成；作者稿与模型候选始终分开。',
  },
  review: {
    eyebrow: '05 · 审查定稿',
    title: '先处理阻塞问题，再打磨语言表面',
    description: '从逻辑、节奏、角色一致性与 AI 痕迹四个方向诊断，由你决定哪些结论进入定稿。',
  },
};

const LOGIC_FIELDS = [
  { key: 'desire', label: '核心欲望', hint: '主角必须得到什么，为什么是现在？', rows: 4 },
  { key: 'resistance', label: '主要阻力', hint: '谁或什么持续阻挡，并且会主动反击？', rows: 4 },
  { key: 'stakes', label: '失败代价', hint: '失败后失去什么，为什么无法轻易恢复？', rows: 4 },
  { key: 'escalation', label: '升级链', hint: '每次选择如何让问题更难、更贵、更私人？', rows: 5 },
  { key: 'mystery', label: '长线悬念', hint: '读者会带着哪个问题继续翻页？', rows: 5 },
];

const BLUEPRINT_FIELDS = [
  { key: 'positioning', label: '作品定位', hint: '一句话定位、类型预期与核心体验。', rows: 4 },
  { key: 'characters', label: '角色关系', hint: '关键角色之间的欲望、债务、秘密和变化方向。', rows: 6 },
  { key: 'volumes', label: '卷纲', hint: '按卷写清阶段目标、转折和不可逆结果。', rows: 8 },
  { key: 'chapterContract', label: '下一章契约', hint: '本章目标、冲突、信息增量、情绪落点与结尾钩子。', rows: 7 },
];

const MODEL_ROWS = [
  { key: 'idea', label: 'Idea 模型', description: '高概念与读者承诺' },
  { key: 'logic', label: '逻辑模型', description: '因果、升级链与悬念' },
  { key: 'blueprint', label: '蓝图模型', description: '角色、卷纲与章节契约' },
  { key: 'writer', label: '写作模型', description: '章节正文候选' },
  { key: 'review', label: '审查模型', description: '问题诊断与修改建议' },
];
const PROVIDER_PRESETS = [
  { id: 'relay', name: '第三方中转', short: '自定义 Base URL', type: 'openai-compatible', baseUrl: '', icon: 'R' },
  { id: 'openai', name: 'OpenAI 官方', short: 'OpenAI Compatible', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', icon: 'O' },
  { id: 'deepseek', name: 'DeepSeek 官方', short: '独立 DeepSeek Key', type: 'openai-compatible', baseUrl: 'https://api.deepseek.com', icon: 'D' },
  { id: 'anthropic', name: 'Anthropic 官方', short: 'Messages API', type: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', icon: 'A' },
  { id: 'gemini', name: 'Gemini 官方', short: 'Generate Content', type: 'gemini-generate-content', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', icon: 'G' },
];

const PROVIDER_TYPE_LABELS = {
  'openai-compatible': 'OpenAI Compatible',
  'anthropic-messages': 'Anthropic Messages',
  'gemini-generate-content': 'Gemini Generate Content',
};

export default function App() {
  const [workspace, setWorkspace] = useState(createWorkspace);
  const [settings, setSettings] = useState(createSettings);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [projectDashboard, setProjectDashboard] = useState(null);
  const [projectChapterWorkspace, setProjectChapterWorkspace] = useState(null);
  const [projectFormalContract, setProjectFormalContract] = useState({ exists: false, relativePath: '', text: '' });
  const [projectContractTemplate, setProjectContractTemplate] = useState('');
  const [projectContractText, setProjectContractText] = useState('');
  const [projectContractDirty, setProjectContractDirty] = useState(false);
  const [projectDraftText, setProjectDraftText] = useState('');
  const [projectDraftDirty, setProjectDraftDirty] = useState(false);
  const [projectChapterBusy, setProjectChapterBusy] = useState('');
  const [view, setView] = useState('today');
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState('');
  const [saveState, setSaveState] = useState({ status: 'idle', message: '尚未保存' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const hydratedRef = useRef(false);
  const localVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const serverRevisionRef = useRef(0);
  const workspaceSaveQueueRef = useRef(Promise.resolve());
  const toastTimerRef = useRef(null);
  const workspaceRef = useRef(workspace);
  const activeProjectIdRef = useRef(activeProjectId);
  const projectRequestEpochRef = useRef(0);
  const generationEpochRef = useRef(0);

  const notify = useCallback((message, tone = 'neutral') => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      const [workspaceResult, settingsResult, projectsResult] = await Promise.allSettled([getWorkspace(), getSettings(), getProjects()]);
      if (!active) return;
      if (workspaceResult.status === 'fulfilled') {
        const normalizedWorkspace = normalizeWorkspace(workspaceResult.value);
        serverRevisionRef.current = normalizedWorkspace.revision;
        setWorkspace(normalizedWorkspace);
      }
      else setLoadWarning('服务端 Workspace 暂时不可用；你仍可编辑，恢复连接后请手动保存。');
      if (settingsResult.status === 'fulfilled') setSettings(normalizeSettings(settingsResult.value));
      else if (workspaceResult.status === 'fulfilled') setLoadWarning('模型配置尚未读取；需要 AI 时可在应用内重新配置。');
      if (projectsResult.status === 'fulfilled') {
        const discovered = Array.isArray(projectsResult.value?.projects) ? projectsResult.value.projects : [];
        setProjects(discovered);
        // 默认保持“开书重建”模式。发现本地正文不等于作者要继续日更；
        // 只有在作品切换器中显式选择项目后，才加载章节 Dashboard。
      }
      hydratedRef.current = true;
      setLoading(false);
      setSaveState({
        status: workspaceResult.status === 'fulfilled' ? 'saved' : 'error',
        message: workspaceResult.status === 'fulfilled' ? '已读取 Workspace' : '等待连接',
      });
    }
    hydrate();
    return () => {
      active = false;
      clearTimeout(toastTimerRef.current);
    };
  }, []);

  const updateWorkspace = useCallback((updater) => {
    localVersionRef.current += 1;
    setWorkspace((current) => (typeof updater === 'function' ? updater(current) : updater));
  }, []);

  const saveWorkspaceQueued = useCallback((target) => {
    const job = workspaceSaveQueueRef.current.catch(() => undefined).then(async () => {
      const candidate = { ...target, revision: serverRevisionRef.current };
      const response = await saveWorkspace(candidate);
      const revision = response?.workspace?.revision ?? response?.revision;
      if (Number.isFinite(Number(revision))) {
        const nextRevision = Number(revision);
        serverRevisionRef.current = nextRevision;
        setWorkspace((current) => ({ ...current, revision: nextRevision }));
      }
      return response;
    });
    workspaceSaveQueueRef.current = job.catch(() => undefined);
    return job;
  }, []);

  const persistWorkspace = useCallback(async (target, announce = false) => {
    const version = localVersionRef.current;
    setSaveState({ status: 'saving', message: '正在保存…' });
    try {
      await saveWorkspaceQueued(target);
      savedVersionRef.current = Math.max(savedVersionRef.current, version);
      setSaveState({ status: 'saved', message: `已保存 ${formatTime(new Date())}` });
      setLoadWarning('');
      if (announce) notify('Workspace 已保存', 'success');
      return true;
    } catch (error) {
      setSaveState({ status: 'error', message: '保存失败，内容仍在本页' });
      if (announce) notify(toErrorMessage(error), 'error');
      return false;
    }
  }, [notify, saveWorkspaceQueued]);

  useEffect(() => {
    if (!hydratedRef.current || localVersionRef.current <= savedVersionRef.current) return undefined;
    const versionAtSchedule = localVersionRef.current;
    const timer = setTimeout(async () => {
      setSaveState({ status: 'saving', message: '正在自动保存…' });
      try {
        await saveWorkspaceQueued(workspace);
        savedVersionRef.current = Math.max(savedVersionRef.current, versionAtSchedule);
        setSaveState({ status: 'saved', message: `已保存 ${formatTime(new Date())}` });
        setLoadWarning('');
      } catch {
        setSaveState({ status: 'error', message: '自动保存失败' });
      }
    }, 760);
    return () => clearTimeout(timer);
  }, [saveWorkspaceQueued, workspace]);

  useEffect(() => {
    const handler = (event) => {
      if (event.key !== 'Escape') return;
      setSettingsOpen(false);
      setInspectorOpen(false);
      setCommandOpen(false);
      setProjectOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (!projectContractDirty && !projectDraftDirty) return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [projectContractDirty, projectDraftDirty]);

  const projectViews = ['today', 'project-contract', 'project-chapter', 'model-lab', 'project-review', 'project-writeback'];
  const activeStageId = projectViews.includes(view) ? (view === 'today' ? firstActionableStage(workspace).id : ['project-review', 'project-writeback'].includes(view) ? 'review' : view === 'project-contract' ? 'blueprint' : 'draft') : view;
  const activeStage = getStage(activeStageId);
  const activeArtifact = workspace.stages[activeStageId];
  const projectFindings = Array.isArray(projectChapterWorkspace?.review?.result?.findings) ? projectChapterWorkspace.review.result.findings : [];
  const projectFindingRisks = projectFindings.filter((item) => ['P0', 'P1'].includes(String(item?.severity ?? item?.priority ?? '').toUpperCase())).length;
  const riskCount = projectDashboard && projectViews.includes(view) ? projectDashboard.risks.length + projectFindingRisks : countRisks(workspace, settings);
  const logicReady = getModelRoute(settings, 'logic').configured;
  const writerRoute = getModelRoute(settings, 'writer');
  const writerReady = writerRoute.configured;
  const reviewReady = getModelRoute(settings, 'review').configured;
  const busyMessage = projectChapterBusy === 'reviewing' ? '正在审查候选'
    : projectChapterBusy === 'confirming' ? '正在确认版本'
      : projectChapterBusy === 'preparing-writeback' ? '正在生成写回预览'
        : projectChapterBusy === 'committing-writeback' ? '正在创建 checkpoint 并正式写入'
          : projectChapterBusy === 'generating-contract' ? '正在生成章节契约'
            : projectChapterBusy === 'preparing-contract' ? '正在生成契约差异预览'
              : projectChapterBusy === 'committing-contract' ? '正在创建契约 checkpoint'
                : projectChapterBusy === 'rewriting' ? '正在定向重写候选'
                  : projectChapterBusy === 'generating' ? '正在生成候选' : projectChapterBusy ? '正在保存侧车账本' : '';
  const projectSaveState = projectDashboard && projectViews.includes(view) && view !== 'today'
    ? projectChapterBusy
      ? { status: 'saving', message: busyMessage }
      : view === 'project-contract' && projectContractDirty
        ? { status: 'idle', message: '契约侧车有未保存修改' }
        : view === 'project-chapter' && projectDraftDirty
          ? { status: 'idle', message: '候选有未保存修改' }
          : { status: 'saved', message: `侧车账本已同步 r${projectChapterWorkspace?.revision ?? 0}` }
    : saveState;

  useEffect(() => {
    const project = projectDashboard?.project?.title || workspace.project.title || '未命名作品';
    const page = view === 'today' ? '今日工作台'
      : view === 'project-contract' ? `第 ${projectDashboard?.chapter?.number ?? ''} 章章节契约`
        : view === 'project-chapter' ? `第 ${projectDashboard?.chapter?.number ?? ''} 章候选稿`
        : view === 'model-lab' ? '模型校准'
          : view === 'project-review' ? '审查定稿'
            : view === 'project-writeback' ? '正式写回预览'
              : activeStage.label;
    document.title = `${project} · ${page} — 叙光`;
  }, [workspace.project.title, view, activeStage.label, projectDashboard]);

  const confirmProjectLeave = useCallback(() => {
    if (!projectContractDirty && !projectDraftDirty) return true;
    const parts = [];
    if (projectContractDirty) parts.push('章节契约');
    if (projectDraftDirty) parts.push('候选正文');
    return window.confirm(`${parts.join('和')}还有未保存修改。离开会放弃这些修改，确定继续吗？`);
  }, [projectContractDirty, projectDraftDirty]);

  const enterOriginWorkspace = useCallback(() => {
    if (projectChapterBusy) {
      notify('当前章节操作仍在执行，请完成后再切换创作模式', 'warning');
      return;
    }
    if (!confirmProjectLeave()) return;
    projectRequestEpochRef.current += 1;
    activeProjectIdRef.current = '';
    setProjectOpen(false);
    setCommandOpen(false);
    setActiveProjectId('');
    setProjectDashboard(null);
    setProjectChapterWorkspace(null);
    setProjectFormalContract({ exists: false, relativePath: '', text: '' });
    setProjectContractTemplate('');
    setProjectContractText('');
    setProjectContractDirty(false);
    setProjectDraftText('');
    setProjectDraftDirty(false);
    setProjectChapterBusy('');
    setView('today');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify('已返回开书重建，从 Idea 开始打磨', 'success');
  }, [confirmProjectLeave, notify, projectChapterBusy]);

  const selectProject = useCallback(async (projectId) => {
    setProjectOpen(false);
    if (!projectId || (projectId === activeProjectId && projectDashboard)) return;
    if (projectChapterBusy) {
      notify('当前章节操作仍在执行，请完成后再切换作品', 'warning');
      return;
    }
    if (!confirmProjectLeave()) return;
    const requestEpoch = ++projectRequestEpochRef.current;
    try {
      const [dashboardResponse, chapterResponse] = await Promise.all([
        getProjectDashboard(projectId), getProjectChapterWorkspace(projectId),
      ]);
      if (requestEpoch !== projectRequestEpochRef.current) return;
      const nextChapterWorkspace = chapterResponse?.chapterWorkspace ?? null;
      activeProjectIdRef.current = projectId;
      setActiveProjectId(projectId);
      const formalContract = chapterResponse?.formalContract ?? { exists: false, relativePath: '', text: '' };
      const template = chapterResponse?.contractTemplate ?? '';
      const savedContract = nextChapterWorkspace?.contractDraft?.text ?? '';
      setProjectDashboard(dashboardResponse?.dashboard ?? null);
      setProjectChapterWorkspace(nextChapterWorkspace);
      setProjectFormalContract(formalContract);
      setProjectContractTemplate(template);
      setProjectContractText(savedContract || (!formalContract.exists ? template : ''));
      setProjectContractDirty(!savedContract && !formalContract.exists && Boolean(template));
      setProjectDraftText(nextChapterWorkspace?.candidate?.text ?? '');
      setProjectDraftDirty(false);
      setProjectChapterBusy('');
      setView('today');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (requestEpoch !== projectRequestEpochRef.current) return;
      notify(toErrorMessage(error), 'error');
    }
  }, [activeProjectId, confirmProjectLeave, notify, projectChapterBusy, projectDashboard]);

  const navigate = useCallback((target) => {
    setProjectOpen(false);
    setCommandOpen(false);
    if (target === 'today') {
      setView('today');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (projectDashboard && ['project-contract', 'project-chapter', 'model-lab', 'project-review', 'project-writeback'].includes(target)) {
      if (target !== 'project-contract' && !projectDashboard.chapter.contractReady) {
        notify(`第 ${projectDashboard.chapter.number} 章缺少正式章节契约，请先完成契约预览与提交。`, 'warning');
        setView('project-contract');
        return;
      }
      if (target === 'project-review' && projectDraftDirty) {
        notify('候选稿有未保存修改，请先保存当前版本再进入审查', 'warning');
        setView('project-chapter');
        return;
      }
      if (target === 'project-review' && !String(projectChapterWorkspace?.candidate?.text ?? '').trim()) {
        notify('请先完成并保存当前章候选稿', 'warning');
        return;
      }
      if (target === 'project-writeback' && !(projectChapterWorkspace?.confirmation?.status === 'confirmed' && projectChapterWorkspace?.confirmation?.candidateHash === projectChapterWorkspace?.candidate?.contentHash)) {
        notify('请先完成审查并确认当前候选版本', 'warning');
        return;
      }
      setView(target);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const access = canAccessStage(workspace, target);
    if (!access.allowed) {
      notify(access.reason, 'warning');
      return;
    }
    setView(target);
    updateWorkspace((current) => ({ ...current, currentStage: target }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [notify, projectChapterWorkspace, projectDashboard, projectDraftDirty, updateWorkspace, workspace]);

  const editProject = useCallback((patch) => {
    updateWorkspace((current) => {
      let next = { ...current, project: { ...current.project, ...patch } };
      const idea = current.stages.idea;
      if (idea.status === 'ready' || idea.status === 'stale' || idea.confirmed) next = editStage(next, 'idea', {});
      return next;
    });
  }, [updateWorkspace]);

  const editArtifact = useCallback((stageId, patch) => {
    updateWorkspace((current) => editStage(current, stageId, patch));
  }, [updateWorkspace]);

  const updateSuggestion = useCallback((stageId, suggestion) => {
    updateWorkspace((current) => {
      const currentArtifact = current.stages[stageId];
      const next = {
        ...current,
        stages: {
          ...current.stages,
          [stageId]: { ...currentArtifact, suggestion, status: 'suggested' },
        },
      };
      return currentArtifact.confirmed != null ? markDownstreamStale(next, stageId) : next;
    });
  }, [updateWorkspace]);

  const updateIdeaFeedback = useCallback((feedback) => {
    updateWorkspace((current) => ({
      ...current,
      stages: {
        ...current.stages,
        idea: { ...current.stages.idea, refinementFeedback: feedback },
      },
    }));
  }, [updateWorkspace]);

  const updateIdeaDraw = useCallback((draw) => {
    updateWorkspace((current) => ({
      ...current,
      stages: {
        ...current.stages,
        idea: {
          ...current.stages.idea,
          draw: {
            mode: draw?.mode === 'guided' ? 'guided' : 'random',
            constraints: String(draw?.constraints ?? ''),
          },
        },
      },
    }));
  }, [updateWorkspace]);

  const restoreIdeaIteration = useCallback((iteration) => {
    if (!iteration?.suggestion) return;
    updateWorkspace((current) => {
      const next = {
        ...current,
        stages: {
          ...current.stages,
          idea: {
            ...current.stages.idea,
            status: 'suggested',
            suggestion: cloneValue(iteration.suggestion),
            refinementFeedback: '',
            restoredFrom: iteration.version,
            error: null,
          },
        },
      };
      return current.stages.idea.confirmed != null ? markDownstreamStale(next, 'idea') : next;
    });
    notify(`已把第 ${iteration.version} 版恢复为当前工作稿；历史版本未删除`, 'success');
  }, [notify, updateWorkspace]);

  const isConfiguredForStage = useCallback((stageId) => {
    const modelKey = getStage(stageId).modelKey;
    return getModelRoute(settings, modelKey).configured;
  }, [settings]);

  const generateStage = useCallback(async (stageId, options = {}) => {
    if (!isConfiguredForStage(stageId)) {
      setSettingsOpen(true);
      notify(`请先补全 ${getStage(stageId).label} 的模型配置`, 'warning');
      return;
    }
    const missingUpstream = STAGES
      .slice(0, getStageIndex(stageId))
      .find((stage) => workspace.stages[stage.id]?.status !== 'ready');
    if (missingUpstream) {
      notify(`请先确认${missingUpstream.label}，当前阶段不能基于旧上游生成`, 'warning');
      return;
    }

    const isIdeaRefinement = stageId === 'idea' && options.mode === 'iterate';
    const isIdeaDraw = stageId === 'idea' && options.mode === 'draw';
    const ideaArtifact = stageId === 'idea' ? workspace.stages.idea : null;
    const feedback = isIdeaRefinement ? String(ideaArtifact?.refinementFeedback ?? '').trim() : '';
    if (isIdeaRefinement && ideaArtifact?.suggestion == null) {
      notify('当前没有可继续打磨的 Idea 工作稿', 'warning');
      return;
    }
    if (isIdeaRefinement && !feedback) {
      notify('先写清这一轮要保留、推翻或继续深挖什么', 'warning');
      return;
    }

    const ideaHistory = stageId === 'idea' ? prepareIdeaIterations(ideaArtifact) : null;
    const snapshot = stageId === 'idea'
      ? {
          ...workspace,
          stages: {
            ...workspace.stages,
            idea: { ...ideaArtifact, iterations: ideaHistory, refinementFeedback: feedback || ideaArtifact.refinementFeedback || '' },
          },
        }
      : workspace;
    const refinement = isIdeaRefinement
      ? {
          mode: 'iterate',
          feedback,
          currentSuggestion: cloneValue(ideaArtifact.suggestion),
          history: ideaHistory.slice(-6).map(compactIdeaIterationForPrompt),
        }
      : null;
    const ideaDraw = isIdeaDraw ? {
      mode: ideaArtifact?.draw?.mode === 'guided' ? 'guided' : 'random',
      constraints: String(ideaArtifact?.draw?.constraints ?? '').trim(),
    } : null;
    const ideation = isIdeaDraw ? {
      mode: 'draw',
      unrestricted: ideaDraw.mode === 'random',
      constraints: ideaDraw.mode === 'guided' ? ideaDraw.constraints : '',
    } : null;
    const generationEpoch = ++generationEpochRef.current;
    const generationSignature = buildGenerationSignature(snapshot, stageId);

    const persisted = await persistWorkspace(snapshot, false);
    if (!persisted) {
      notify('请先解决 Workspace 保存冲突，再调用模型', 'error');
      return;
    }
    const startedAt = Date.now();
    updateWorkspace((current) => ({
      ...current,
      currentStage: stageId,
      stages: {
        ...current.stages,
        [stageId]: {
          ...current.stages[stageId],
          ...(stageId === 'idea' ? { iterations: ideaHistory, restoredFrom: null } : {}),
          status: 'generating',
          error: null,
        },
      },
    }));
    try {
      const response = await generateWithAI({
        stage: stageId,
        workspace: snapshot,
        input: getStageInput(snapshot, stageId),
        context: buildGenerationContext(snapshot, stageId),
        refinement,
        ideation,
      });
      if (generationEpoch !== generationEpochRef.current) return;
      if (generationSignature !== buildGenerationSignature(workspaceRef.current, stageId)) {
        updateWorkspace((current) => ({
          ...current,
          stages: {
            ...current.stages,
            [stageId]: {
              ...current.stages[stageId],
              status: 'stale',
              staleFrom: stageId,
            },
          },
        }));
        notify('生成期间作者输入发生变化，本次结果未覆盖当前工作稿；请重新生成', 'warning');
        return;
      }
      const suggestion = extractSuggestion(response);
      const findings = stageId === 'review' ? extractFindings(response, suggestion) : undefined;
      const run = buildRun({ stageId, status: 'success', settings, startedAt, response });
      const ideaIteration = stageId === 'idea'
        ? createIdeaIteration({
            version: nextIdeaVersion(ideaHistory),
            suggestion,
            source: isIdeaDraw ? 'draw' : 'model',
            feedback: isIdeaRefinement
              ? feedback
              : isIdeaDraw
                ? ideaDraw.mode === 'guided' && ideaDraw.constraints
                  ? `方向约束：${ideaDraw.constraints.slice(0, 300)}`
                  : '完全随机抽卡'
                : ideaHistory.length ? '基于当前作者输入重新生成完整 Idea' : '初始生成',
            run,
          })
        : null;
      updateWorkspace((current) => ({
        ...current,
        stages: {
          ...current.stages,
          [stageId]: {
            ...current.stages[stageId], status: 'suggested', suggestion,
            ...(stageId === 'idea' ? {
              iterations: [...ideaHistory, ideaIteration],
              refinementFeedback: '',
              suggestionAt: ideaIteration.createdAt,
              restoredFrom: null,
            } : {}),
            ...(stageId === 'review' ? { findings: findings ?? [] } : {}), error: null,
          },
        },
        runs: [...(current.runs ?? []), run].slice(-30),
      }));
      notify(stageId === 'idea'
        ? `第 ${ideaIteration.version} 版 Idea 已返回；${isIdeaDraw ? '抽卡结果' : '当前结果'}只进入建议稿`
        : '建议稿已返回，确认前不会覆盖作者内容', 'success');
    } catch (error) {
      if (generationEpoch !== generationEpochRef.current) return;
      const message = toErrorMessage(error);
      const run = buildRun({ stageId, status: 'error', settings, startedAt, error });
      updateWorkspace((current) => ({
        ...current,
        stages: {
          ...current.stages,
          [stageId]: {
            ...current.stages[stageId], status: 'error',
            ...(stageId === 'idea' ? { iterations: ideaHistory, refinementFeedback: feedback || current.stages.idea.refinementFeedback } : {}),
            error: { message, status: error instanceof ApiError ? error.status : 0, provider: getModelRoute(settings, getStage(stageId).modelKey).provider?.name || '未配置服务商', at: new Date().toISOString() },
          },
        },
        runs: [...(current.runs ?? []), run].slice(-30),
      }));
      notify(message, 'error');
    }
  }, [isConfiguredForStage, notify, persistWorkspace, settings, updateWorkspace, workspace]);

  const confirmSuggestion = useCallback((stageId) => {
    const artifact = workspace.stages[stageId];
    if (artifact.suggestion == null) {
      notify('当前没有可确认的建议稿', 'warning');
      return;
    }
    updateWorkspace((current) => {
      const currentArtifact = current.stages[stageId];
      const confirmed = cloneValue(currentArtifact.suggestion);
      const confirmedChanged = currentArtifact.confirmed != null && !sameJsonValue(currentArtifact.confirmed, confirmed);
      const findings = extractFindings({}, confirmed);
      const ideaIterations = stageId === 'idea' ? prepareIdeaIterations(currentArtifact) : null;
      const next = {
        ...current,
        stages: {
          ...current.stages,
          [stageId]: {
            ...currentArtifact, status: 'ready', confirmed,
            ...(stageId === 'idea' ? { iterations: ideaIterations, refinementFeedback: '', restoredFrom: null } : {}),
            ...(stageId === 'review' ? { findings: findings.length ? findings : currentArtifact.findings ?? [], accepted: true } : {}),
            confirmedAt: new Date().toISOString(), staleFrom: null,
          },
        },
      };
      return confirmedChanged ? markDownstreamStale(next, stageId) : next;
    });
    notify(stageId === 'idea' ? '当前 Idea 已由你定稿，故事引擎现已解锁' : '已写入作者确认稿，下游阶段现已可继续', 'success');
  }, [notify, updateWorkspace, workspace]);

  const applyProjectChapterWorkspace = useCallback((nextChapterWorkspace) => {
    setProjectChapterWorkspace(nextChapterWorkspace);
    setProjectContractText(nextChapterWorkspace?.contractDraft?.text ?? '');
    setProjectContractDirty(false);
    setProjectDraftText(nextChapterWorkspace?.candidate?.text ?? '');
    setProjectDraftDirty(false);
    return nextChapterWorkspace;
  }, []);

  const applyProjectChapterResponse = useCallback((response, options = {}) => {
    const { preserveLocal = false } = options;
    const nextChapterWorkspace = response?.chapterWorkspace ?? null;
    const formalContract = response?.formalContract ?? { exists: false, relativePath: '', text: '' };
    const template = response?.contractTemplate ?? '';
    const savedContract = nextChapterWorkspace?.contractDraft?.text ?? '';
    setProjectFormalContract(formalContract);
    setProjectContractTemplate(template);
    setProjectChapterWorkspace(nextChapterWorkspace);
    if (!preserveLocal || !projectContractDirty) {
      setProjectContractText(savedContract || (!formalContract.exists ? template : ''));
      setProjectContractDirty(!savedContract && !formalContract.exists && Boolean(template));
    }
    if (!preserveLocal || !projectDraftDirty) {
      setProjectDraftText(nextChapterWorkspace?.candidate?.text ?? '');
      setProjectDraftDirty(false);
    }
    return nextChapterWorkspace;
  }, [projectContractDirty, projectDraftDirty]);

  const refreshProjectChapterWorkspace = useCallback(async (options = {}) => {
    if (!activeProjectId) return null;
    const projectId = activeProjectId;
    const response = await getProjectChapterWorkspace(activeProjectId);
    if (activeProjectIdRef.current !== projectId) return null;
    return applyProjectChapterResponse(response, options);
  }, [activeProjectId, applyProjectChapterResponse]);

  const saveProjectContract = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace || projectFormalContract.exists) return false;
    setProjectChapterBusy('saving-contract');
    try {
      const response = await saveProjectContractDraft(activeProjectId, {
        expectedRevision: projectChapterWorkspace.revision,
        text: projectContractText,
        title: `第${projectDashboard?.chapter?.number ?? ''}章章节契约`,
      });
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify('章节契约已保存到侧车账本；正式大纲未改动', 'success');
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
      return false;
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, projectContractText, projectDashboard, projectFormalContract.exists, refreshProjectChapterWorkspace]);

  const generateProjectContract = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace || projectFormalContract.exists) return;
    if (!logicReady) {
      setSettingsOpen(true);
      notify('请先配置逻辑模型路由', 'warning');
      return;
    }
    if (projectContractDirty) {
      notify('请先保存当前契约修改，再让逻辑模型重新生成', 'warning');
      return;
    }
    setProjectChapterBusy('generating-contract');
    try {
      const response = await generateProjectContractDraft(activeProjectId, projectChapterWorkspace.revision);
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify('逻辑模型已生成侧车契约；正式大纲未改动', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, logicReady, notify, projectChapterWorkspace, projectContractDirty, projectFormalContract.exists, refreshProjectChapterWorkspace]);

  const prepareProjectContract = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace || projectFormalContract.exists) return;
    if (projectContractDirty) {
      notify('请先保存章节契约，再生成正式差异预览', 'warning');
      return;
    }
    setProjectChapterBusy('preparing-contract');
    try {
      const response = await prepareProjectContractDraft(activeProjectId, projectChapterWorkspace.revision);
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify('正式契约差异预览已生成；尚未写入项目', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, projectContractDirty, projectFormalContract.exists, refreshProjectChapterWorkspace]);

  const commitProjectContract = useCallback(async () => {
    const planHash = projectChapterWorkspace?.contractDraft?.plan?.planHash;
    if (!activeProjectId || !planHash || projectFormalContract.exists) return;
    setProjectChapterBusy('committing-contract');
    try {
      await commitProjectContractDraft(activeProjectId, {
        expectedRevision: projectChapterWorkspace.revision,
        planHash,
        confirmFormalWrite: true,
      });
      const [dashboardResponse, chapterResponse] = await Promise.all([
        getProjectDashboard(activeProjectId), getProjectChapterWorkspace(activeProjectId),
      ]);
      setProjectDashboard(dashboardResponse?.dashboard ?? null);
      applyProjectChapterResponse(chapterResponse);
      setView('project-chapter');
      notify('章节契约 checkpoint 已创建，正式契约已写入；现在可以开始候选正文', 'success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterResponse, notify, projectChapterWorkspace, projectFormalContract.exists, refreshProjectChapterWorkspace]);

  const saveProjectCandidate = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace) return false;
    setProjectChapterBusy('saving');
    try {
      const response = await saveProjectChapterWorkspace(activeProjectId, {
        expectedRevision: projectChapterWorkspace.revision,
        text: projectDraftText,
        title: projectChapterWorkspace.candidate?.title || `第${projectDashboard?.chapter?.number ?? ''}章`,
      });
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify('候选稿已安全保存；正式正文未改动', 'success');
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
      return false;
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, projectDashboard, projectDraftText, refreshProjectChapterWorkspace]);

  const generateProjectCandidate = useCallback(async (mode = 'full') => {
    if (!activeProjectId || !projectChapterWorkspace) return;
    if (!writerReady) {
      setSettingsOpen(true);
      notify('请先配置写作模型路由', 'warning');
      return;
    }
    if (projectDraftDirty) {
      notify('请先保存手写修改，再重新生成候选稿', 'warning');
      return;
    }
    setProjectChapterBusy(mode === 'full' ? 'generating' : 'rewriting');
    try {
      const response = await generateProjectChapterDraft(activeProjectId, projectChapterWorkspace.revision, true, mode);
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify(mode === 'full' ? '模型候选已生成并保存到侧车账本；正式正文未改动' : '定向重写已完成并保存为新的候选版本；正式正文未改动', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, projectDraftDirty, refreshProjectChapterWorkspace, writerReady]);

  const runProjectReview = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace) return;
    if (!reviewReady) {
      setSettingsOpen(true);
      notify('请先配置审查模型路由', 'warning');
      return;
    }
    if (projectDraftDirty) {
      notify('候选稿有未保存修改，请先保存再审查', 'warning');
      return;
    }
    setProjectChapterBusy('reviewing');
    try {
      const response = await reviewProjectChapterDraft(activeProjectId, projectChapterWorkspace.revision);
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      setView('project-review');
      notify('只读审查完成；正文没有被模型改写', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, projectDraftDirty, refreshProjectChapterWorkspace, reviewReady]);

  const confirmProjectCandidate = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace) return;
    setProjectChapterBusy('confirming');
    try {
      const response = await confirmProjectChapterDraft(activeProjectId, projectChapterWorkspace.revision);
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify(response?.formalWritePerformed === false ? '当前候选版本已确认；正式正文仍未写入' : '当前候选版本已确认', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, refreshProjectChapterWorkspace]);
  const prepareProjectWriteBack = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace) return;
    if (!reviewReady) {
      setSettingsOpen(true);
      notify('请先配置审查模型路由；追踪同步提案使用该路由', 'warning');
      return;
    }
    setProjectChapterBusy('preparing-writeback');
    try {
      const response = await prepareProjectChapterWriteBack(activeProjectId, projectChapterWorkspace.revision);
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify('正式文件差异预览已生成；尚未写入磁盘项目', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, refreshProjectChapterWorkspace, reviewReady]);

  const commitProjectWriteBack = useCallback(async () => {
    if (!activeProjectId || !projectChapterWorkspace?.writeBack?.planHash) return;
    setProjectChapterBusy('committing-writeback');
    try {
      const response = await commitProjectChapterWriteBack(activeProjectId, {
        expectedRevision: projectChapterWorkspace.revision,
        planHash: projectChapterWorkspace.writeBack.planHash,
        confirmFormalWrite: true,
      });
      applyProjectChapterWorkspace(response?.chapterWorkspace ?? null);
      notify(response?.formalWritePerformed ? 'Checkpoint 已创建，当前章与追踪账本已正式写入' : '写回请求完成', 'success');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refreshProjectChapterWorkspace({ preserveLocal: true }).catch(() => null);
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterWorkspace, notify, projectChapterWorkspace, refreshProjectChapterWorkspace]);

  const enterNextProjectChapter = useCallback(async () => {
    if (!activeProjectId) return;
    setProjectChapterBusy('loading-next');
    try {
      const [dashboardResponse, chapterResponse] = await Promise.all([
        getProjectDashboard(activeProjectId), getProjectChapterWorkspace(activeProjectId),
      ]);
      const nextDashboard = dashboardResponse?.dashboard ?? null;
      setProjectDashboard(nextDashboard);
      applyProjectChapterResponse(chapterResponse);
      setView('today');
      const nextNumber = nextDashboard?.chapter?.number ?? '下一';
      notify(nextDashboard?.chapter?.contractReady ? '已进入第 ' + nextNumber + ' 章今日工作台' : '已进入第 ' + nextNumber + ' 章；请先补章节契约', nextDashboard?.chapter?.contractReady ? 'success' : 'warning');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      notify(toErrorMessage(error), 'error');
    } finally {
      setProjectChapterBusy('');
    }
  }, [activeProjectId, applyProjectChapterResponse, notify]);
  const establishProject = useCallback(() => {
    setView('idea');
    updateWorkspace((current) => ({ ...current, currentStage: 'idea' }));
    notify('已进入 Idea；可以手写，也可以直接抽卡', 'success');
  }, [notify, updateWorkspace]);

  const handlePrimaryAction = useCallback(() => {
    if (view === 'today') {
      if (projectDashboard) {
        if (!projectDashboard.chapter.contractReady) {
          setView('project-contract');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        navigate('project-chapter');
      } else if (
        !String(workspace.stages.idea.input ?? '').trim()
        && workspace.stages.idea.suggestion == null
        && workspace.stages.idea.confirmed == null
      ) establishProject();
      else navigate(firstActionableStage(workspace).id);
      return;
    }
    if (view === 'project-chapter') {
      saveProjectCandidate();
      return;
    }
    const status = activeArtifact.status;
    if (status === 'generating') return;
    if (status === 'suggested') {
      if (activeStageId === 'idea') {
        document.getElementById('idea-refinement')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      confirmSuggestion(activeStageId);
      return;
    }
    if (status === 'ready') {
      const next = getNextStage(activeStageId);
      navigate(next ? next.id : 'today');
      return;
    }
    generateStage(activeStageId);
  }, [activeArtifact.status, activeStageId, confirmSuggestion, establishProject, generateStage, navigate, projectDashboard, saveProjectCandidate, updateWorkspace, view, workspace]);

  const primaryAction = projectDashboard && view === 'today'
    ? projectDashboard.chapter.contractReady
      ? { kicker: '唯一下一步', label: `开始写第 ${projectDashboard.chapter.number} 章`, hint: '先进入候选正文区；不会覆盖正式章节文件。', icon: 'check' }
      : { kicker: '写作前置', label: `先补第 ${projectDashboard.chapter.number} 章契约`, hint: '章节契约缺失时保持正式事实只读，不能直接进入正文生成。', icon: 'check' }
    : getPrimaryAction({ view, workspace, stageId: activeStageId, configured: isConfiguredForStage(activeStageId) });

  const ideaWorkshopActive = !projectDashboard && view === 'idea' && workspace.stages.idea.suggestion != null && workspace.stages.idea.status !== 'ready';

  const exportWorkspace = useCallback(() => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(workspace.project.title || 'novel-workspace')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setCommandOpen(false);
    notify('Workspace 已导出；密钥不包含在文件中', 'success');
  }, [notify, workspace]);

  const onSettingsSaved = useCallback((nextSettings) => {
    setSettings(nextSettings);
    setSettingsOpen(false);
    notify('模型配置已安全保存', 'success');
  }, [notify]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="app-frame">
      <TopBar
        workspace={workspace} view={view} activeStage={activeStage} riskCount={riskCount}
        projects={projects} activeProjectId={activeProjectId} projectDashboard={projectDashboard}
        saveState={projectSaveState} projectOpen={projectOpen} commandOpen={commandOpen}
        onProjectToggle={() => { setProjectOpen((open) => !open); setCommandOpen(false); }} onProjectSelect={selectProject} onOriginSelect={enterOriginWorkspace}
        onCommandToggle={() => { setCommandOpen((open) => !open); setProjectOpen(false); }}
        onSave={() => {
          setCommandOpen(false);
          if (projectDashboard && view === 'project-contract') saveProjectContract();
          else if (projectDashboard && view === 'project-chapter') saveProjectCandidate();
          else if (projectDashboard) notify('当前页面没有需要手动保存的编辑内容', 'neutral');
          else persistWorkspace(workspace, true);
        }}
        onExport={exportWorkspace}
        onHistory={() => {
          setCommandOpen(false); setInspectorOpen(true);
          setTimeout(() => document.getElementById('run-history')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
        }}
        onSettings={() => setSettingsOpen(true)} onInspector={() => setInspectorOpen(true)}
      />

      {loadWarning && (
        <div className="connection-banner" role="status">
          <AlertTriangle size={16} /><span>{loadWarning}</span>
          <button type="button" onClick={() => persistWorkspace(workspace, true)}>重试保存</button>
        </div>
      )}

      <div className="workspace-shell">
        <StageNavigation view={view} workspace={workspace} dashboard={projectDashboard} chapterWorkspace={projectChapterWorkspace} onNavigate={navigate} />
        <main className="main-workspace">
          {view === 'today' ? (
            projectDashboard ? <ProjectTodayWorkspace dashboard={projectDashboard} /> : <TodayWorkspace
              workspace={workspace} settings={settings} onProjectChange={editProject}
              onIdeaChange={(input) => editArtifact('idea', { input })}
            />
          ) : view === 'project-contract' ? (
            <ProjectContractWorkspace
              dashboard={projectDashboard}
              chapterWorkspace={projectChapterWorkspace}
              formalContract={projectFormalContract}
              contractTemplate={projectContractTemplate}
              contractText={projectContractText}
              dirty={projectContractDirty}
              busy={projectChapterBusy}
              logicReady={logicReady}
              onContractChange={(text) => { setProjectContractText(text); setProjectContractDirty(true); }}
              onSave={saveProjectContract}
              onGenerate={generateProjectContract}
              onPrepare={prepareProjectContract}
              onCommit={commitProjectContract}
              onCandidate={() => navigate('project-chapter')}
              onSettings={() => setSettingsOpen(true)}
            />
          ) : view === 'project-chapter' ? (
            <ProjectChapterWorkspace
              dashboard={projectDashboard}
              chapterWorkspace={projectChapterWorkspace}
              formalContract={projectFormalContract}
              draftText={projectDraftText}
              dirty={projectDraftDirty}
              busy={projectChapterBusy}
              writerReady={writerReady}
              writerRoute={writerRoute}
              onDraftChange={(text) => { setProjectDraftText(text); setProjectDraftDirty(true); }}
              onSave={saveProjectCandidate}
              onGenerate={generateProjectCandidate}
              onReview={() => navigate('project-review')}
              onOpenModelLab={() => navigate('model-lab')}
              onSettings={() => setSettingsOpen(true)}
            />
          ) : view === 'model-lab' ? (
            <ProjectModelLab dashboard={projectDashboard} settings={settings} onSettings={() => setSettingsOpen(true)} notify={notify} />
          ) : view === 'project-review' ? (
            <ProjectReviewWorkspace
              dashboard={projectDashboard}
              chapterWorkspace={projectChapterWorkspace}
              formalContract={projectFormalContract}
              busy={projectChapterBusy}
              reviewReady={reviewReady}
              onRunReview={runProjectReview}
              onConfirm={confirmProjectCandidate}
              onBackToDraft={() => navigate('project-chapter')}
              onWriteBack={() => navigate('project-writeback')}
              onSettings={() => setSettingsOpen(true)}
            />
          ) : view === 'project-writeback' ? (
            <ProjectWriteBackWorkspace
              dashboard={projectDashboard}
              chapterWorkspace={projectChapterWorkspace}
              busy={projectChapterBusy}
              reviewReady={reviewReady}
              onPrepare={prepareProjectWriteBack}
              onCommit={commitProjectWriteBack}
              onBackToReview={() => navigate('project-review')}
              onNextChapter={enterNextProjectChapter}
              onSettings={() => setSettingsOpen(true)}
            />
          ) : (
            <StageWorkspace
              stageId={activeStageId} workspace={workspace} onProjectChange={editProject}
              onArtifactChange={(patch) => editArtifact(activeStageId, patch)}
              onSuggestionChange={(value) => updateSuggestion(activeStageId, value)}
              onIdeaDrawChange={updateIdeaDraw}
              onIdeaDraw={() => generateStage('idea', { mode: 'draw' })}
              onIdeaFeedbackChange={updateIdeaFeedback}
              onIdeaRefine={() => generateStage('idea', { mode: 'iterate' })}
              onIdeaConfirm={() => confirmSuggestion('idea')}
              onIdeaRestore={restoreIdeaIteration}
              ideaConfigured={isConfiguredForStage('idea')}
              onIdeaSettings={() => setSettingsOpen(true)}
            />
          )}
          {(!projectDashboard || view === 'today') && !ideaWorkshopActive && <PrimaryActionDock action={primaryAction} onAction={handlePrimaryAction} saveState={saveState} />}
        </main>
        {projectDashboard && ['today', 'project-contract', 'project-chapter', 'model-lab', 'project-review', 'project-writeback'].includes(view) ? (
          <ProjectInspector dashboard={projectDashboard} open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
        ) : (
          <Inspector
            open={inspectorOpen} stageId={activeStageId} workspace={workspace} settings={settings}
            onClose={() => setInspectorOpen(false)} onSettings={() => setSettingsOpen(true)}
          />
        )}
      </div>

      {settingsOpen && (
        <SettingsDrawer initialSettings={settings} onClose={() => setSettingsOpen(false)} onSaved={onSettingsSaved} notify={notify} />
      )}
      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">
          {toast.tone === 'success' ? <CheckCircle2 size={17} /> : toast.tone === 'error' ? <AlertCircle size={17} /> : <Circle size={12} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function TopBar({ workspace, view, activeStage, riskCount, saveState, projectOpen, commandOpen, projects, activeProjectId, projectDashboard, onProjectToggle, onProjectSelect, onOriginSelect, onCommandToggle, onSave, onExport, onHistory, onSettings, onInspector }) {
  const projectTitle = projectDashboard?.project?.title || workspace.project.title || '未命名作品';
  const objectLabel = projectDashboard && ['today', 'project-contract', 'project-chapter', 'model-lab', 'project-review', 'project-writeback'].includes(view)
    ? `第 ${projectDashboard.chapter.number} 章`
    : ['draft', 'review'].includes(activeStage.id) ? `${workspace.currentChapter?.number ?? 1}. ${workspace.currentChapter?.title || '未命名章节'}` : view === 'today' ? '开书重建' : activeStage.label;
  const stageLabel = projectDashboard && view === 'today' ? projectDashboard.today.stage : view === 'project-contract' ? '章节契约' : view === 'project-chapter' ? '候选正文' : view === 'model-lab' ? '模型校准' : view === 'project-review' ? '审查定稿' : view === 'project-writeback' ? '正式写回' : view === 'today' ? firstActionableStage(workspace).shortLabel : activeStage.shortLabel;
  return (
    <header className="topbar">
      <div className="brand-block" aria-label="叙光 Novel Studio">
        <span className="brand-mark"><BookOpenText size={20} strokeWidth={1.8} /></span>
        <div><strong>叙光</strong><span>Novel Studio</span></div>
      </div>
      <div className="location-bar" aria-label="当前位置">
        <div className="location-segment project-switcher">
          <span className="location-kicker">作品</span>
          <button type="button" className="location-value location-button" onClick={onProjectToggle} aria-expanded={projectOpen}>
            <span>{projectTitle}</span><ChevronDown size={14} />
          </button>
          {projectOpen && (
            <div className="popover project-popover">
              <span className="popover-label">创作模式</span>
              <button type="button" className={`project-option origin-option ${!projectDashboard ? 'active' : ''}`} onClick={onOriginSelect}>
                <Lightbulb size={16} />
                <span><strong>开书重建 · 从 Idea 开始</strong><small>作品承诺 → 故事引擎 → 蓝图 → 第一章</small></span>
                {!projectDashboard ? <Check size={15} /> : <ArrowRight size={14} />}
              </button>
              <span className="popover-label project-group-label">续写已有正文</span>
              {projects.length ? projects.map((project) => (
                <button type="button" className={`project-option ${project.id === activeProjectId ? 'active' : ''}`} key={project.id} onClick={() => onProjectSelect(project.id)}>
                  <BookMarked size={16} />
                  <span><strong>{project.title}</strong><small>{project.currentChapter ? `当前第 ${project.currentChapter} 章` : '待恢复进度'}</small></span>
                  {project.id === activeProjectId ? <Check size={15} /> : <ArrowRight size={14} />}
                </button>
              )) : <p>尚未发现包含正文、设定、大纲和追踪目录的项目。</p>}
              <p>只有显式选择后才进入续写；开书重建不会改动现有正文。</p>
            </div>
          )}
        </div>
        <span className="location-divider" />
        <div className="location-segment hide-compact"><span className="location-kicker">对象</span><span className="location-value">{objectLabel}</span></div>
        <span className="location-divider hide-compact" />
        <div className="location-segment"><span className="location-kicker">阶段</span><span className="location-value">{stageLabel}</span></div>
      </div>
      <div className="top-actions">
        <div className={`save-indicator save-${saveState.status}`} title={saveState.message}>
          {saveState.status === 'saving' ? <LoaderCircle size={14} className="spin" /> : saveState.status === 'error' ? <AlertCircle size={14} /> : <Check size={14} />}
          <span>{saveState.message}</span>
        </div>
        <button type="button" className={`risk-button ${riskCount ? 'has-risk' : ''}`} onClick={onInspector}>
          <ShieldAlert size={16} /><span>{riskCount ? `${riskCount} 项风险` : '无阻塞'}</span>
        </button>
        <button type="button" className="icon-button mobile-only" onClick={onInspector} aria-label="打开检查器"><PanelRightOpen size={18} /></button>
        <button type="button" className="icon-button" onClick={onSettings} aria-label="模型配置"><Settings2 size={18} /></button>
        <div className="command-wrap">
          <button type="button" className="icon-button" onClick={onCommandToggle} aria-label="更多命令" aria-expanded={commandOpen}><MoreHorizontal size={19} /></button>
          {commandOpen && (
            <div className="popover command-popover">
              <button type="button" onClick={onSave}><Save size={16} /><span>保存当前进度</span></button>
              <button type="button" onClick={onExport}><Download size={16} /><span>导出 Workspace</span></button>
              <button type="button" onClick={onHistory}><History size={16} /><span>查看最近运行</span></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function StageNavigation({ view, workspace, dashboard, chapterWorkspace, onNavigate }) {
  const navListRef = useActiveNavIntoView(view);
  if (dashboard) return <ProjectNavigation view={view} dashboard={dashboard} chapterWorkspace={chapterWorkspace} onNavigate={onNavigate} />;
  return (
    <nav className="stage-nav" aria-label="创作阶段">
      <div className="stage-nav-heading"><span>创作路径</span><small>5 个产物阶段</small></div>
      <div className="stage-nav-list" ref={navListRef}>
        {NAV_ITEMS.map((item, index) => {
          const Icon = item.icon;
          const isToday = item.id === 'today';
          const access = isToday ? { allowed: true, reason: '' } : canAccessStage(workspace, item.id);
          const artifact = isToday ? null : workspace.stages[item.id];
          const active = view === item.id;
          return (
            <button type="button" key={item.id} className={`stage-nav-item ${active ? 'active' : ''} ${!access.allowed ? 'locked' : ''}`} onClick={() => onNavigate(item.id)} aria-current={active ? 'page' : undefined} aria-disabled={!access.allowed} title={!access.allowed ? access.reason : item.label}>
              <span className="nav-icon"><Icon size={18} strokeWidth={1.8} /></span>
              <span className="nav-copy"><span className="nav-label">{item.label}</span><small>{isToday ? '当前任务' : access.allowed ? STATUS_META[artifact.status]?.label : access.reason}</small></span>
              {isToday ? null : !access.allowed ? <LockKeyhole className="nav-state" size={14} /> : <span className={`nav-dot tone-${STATUS_META[artifact.status]?.tone}`} aria-label={STATUS_META[artifact.status]?.label} />}
              {!isToday && <span className="nav-number">{String(index).padStart(2, '0')}</span>}
            </button>
          );
        })}
      </div>
      <div className="nav-footnote"><Layers3 size={15} /><span>上游修改会自动标记下游产物为过期。</span></div>
    </nav>
  );
}

function useActiveNavIntoView(activeId) {
  const listRef = useRef(null);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    listRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
    });
  }, [activeId]);
  return listRef;
}

function ProjectNavigation({ view, dashboard, chapterWorkspace, onNavigate }) {
  const navListRef = useActiveNavIntoView(view);
  const contractReady = dashboard.chapter.contractReady;
  const contractDraft = chapterWorkspace?.contractDraft ?? {};
  const contractPlan = contractDraft.plan ?? {};
  const candidate = chapterWorkspace?.candidate ?? {};
  const review = chapterWorkspace?.review ?? {};
  const hasCandidate = Boolean(String(candidate.text ?? '').trim());
  const confirmed = chapterWorkspace?.confirmation?.status === 'confirmed' && chapterWorkspace?.confirmation?.candidateHash === candidate.contentHash;
  const reviewIsCurrent = review.status === 'ready' && review.candidateHash === candidate.contentHash;
  const contractDetail = contractReady
    ? '正式契约已就绪'
    : contractPlan.status === 'ready' ? '等待核对并提交'
      : contractDraft.validation?.valid ? '侧车结构已通过'
        : contractDraft.text ? '契约结构待补齐' : '先建立本章契约';
  const candidateDetail = !contractReady ? '先完成正式契约' : !hasCandidate ? '候选正文待写' : confirmed ? '候选版本已确认' : `${String(candidate.text).replace(/\s+/g, '').length} 字候选稿`;
  const reviewDetail = !hasCandidate ? '先完成候选稿' : review.status === 'stale' ? '候选变化，需重审' : reviewIsCurrent ? '审查已完成' : '等待只读审查';
  const writeBack = chapterWorkspace?.writeBack ?? {};
  const writeBackDetail = writeBack.status === 'committed' ? '已创建 checkpoint 并写入' : writeBack.status === 'ready' ? '等待核对差异' : writeBack.status === 'stale' ? '预览过期，需重建' : confirmed ? '可生成写回预览' : '先确认候选版本';
  const items = [
    { id: 'today', label: '今日工作台', detail: dashboard.today.stage, icon: Home },
    { id: 'project-contract', label: `第 ${dashboard.chapter.number} 章契约`, detail: contractDetail, icon: BookCheck },
    { id: 'project-chapter', label: `第 ${dashboard.chapter.number} 章候选正文`, detail: candidateDetail, icon: PenLine, disabled: !contractReady },
    { id: 'model-lab', label: '模型校准', detail: contractReady ? '同题对照多个厂商' : '正式契约就绪后可用', icon: BrainCircuit, disabled: !contractReady },
    { id: 'project-review', label: '审查定稿', detail: reviewDetail, icon: ScanSearch, disabled: !contractReady || !hasCandidate },
    { id: 'project-writeback', label: '正式写回', detail: writeBackDetail, icon: BookMarked, disabled: !contractReady || !confirmed },
  ];
  return <nav className="stage-nav project-stage-nav" aria-label="项目日更路径">
    <div className="stage-nav-heading"><span>本章日更路径</span><small>CH {String(dashboard.chapter.number).padStart(3, '0')}</small></div>
    <div className="stage-nav-list" ref={navListRef}>{items.map((item, index) => {
      const Icon = item.icon;
      const active = view === item.id;
      return <button type="button" key={item.id} className={`stage-nav-item ${active ? 'active' : ''} ${item.disabled ? 'locked' : ''}`} onClick={() => !item.disabled && onNavigate(item.id)} aria-current={active ? 'page' : undefined} aria-disabled={item.disabled}>
        <span className="nav-icon"><Icon size={18} strokeWidth={1.8} /></span>
        <span className="nav-copy"><span className="nav-label">{item.label}</span><small>{item.detail}</small></span>
        {item.disabled ? <LockKeyhole className="nav-state" size={14} /> : <span className={`nav-dot ${active ? 'tone-active' : 'tone-ready'}`} />}
        <span className="nav-number">{String(index + 1).padStart(2, '0')}</span>
      </button>;
    })}</div>
    <div className="nav-footnote"><Layers3 size={15} /><span>契约与正文正式写入都必须经过差异预览、作者核对与 checkpoint。</span></div>
  </nav>;
}
function TodayWorkspace({ workspace, settings, onProjectChange, onIdeaChange }) {
  const hasProject = Boolean(
    workspace.project.title.trim()
    || String(workspace.stages.idea.input ?? '').trim()
    || workspace.stages.idea.suggestion != null
    || workspace.stages.idea.confirmed != null
  );
  const projectTitle = workspace.project.title.trim() || '未命名作品';
  const target = firstActionableStage(workspace);
  const targetArtifact = workspace.stages[target.id];
  const readyCount = STAGES.filter((stage) => workspace.stages[stage.id]?.status === 'ready').length;
  return (
    <div className="content-column today-content">
      <ContentHeader
        eyebrow="今日工作台"
        title={hasProject ? `从 Idea 重新打磨「${projectTitle}」` : '从一个清晰的作品承诺开始'}
        description={hasProject ? '先把这本书当作新书重新推演：不跳到第 4 章，只确认当前最重要的 Idea 产物。' : '可以先手写最小上下文，也可以直接进入 Idea 页让 AI 抽一张。'}
      />
      {!hasProject ? (
        <section className="paper-card start-card">
          <div className="card-heading-row"><div className="section-icon coral"><BookMarked size={19} /></div><div><span className="section-kicker">今天从这里开始</span><h2>建立这本书的最小上下文</h2></div></div>
          <div className="form-grid two-col">
            <Field label="作品名" hint="可稍后填写"><input value={workspace.project.title} onChange={(event) => onProjectChange({ title: event.target.value })} placeholder="例如：潮汐尽头的来信" autoFocus /></Field>
            <Field label="类型"><input value={workspace.project.genre} onChange={(event) => onProjectChange({ genre: event.target.value })} placeholder="悬疑 / 科幻 / 言情…" /></Field>
          </div>
          <Field label="一句原始灵感" hint="可选；没有想法就直接进入 Idea 抽卡。"><textarea rows={6} value={workspace.stages.idea.input ?? ''} onChange={(event) => onIdeaChange(event.target.value)} placeholder="当一个人发现……但他必须……否则……" /></Field>
          <div className="quiet-note"><Sparkles size={15} /><span>当前输入会先保存；进入 Idea 后才由你决定是否调用模型。</span></div>
        </section>
      ) : (
        <>
          <section className="paper-card today-task-card">
            <div className="task-index">NEXT</div>
            <div className="task-main">
              <div className="task-meta"><StatusBadge status={targetArtifact.status} /><span>阶段 {getStageIndex(target.id) + 1}/5</span></div>
              <h2>{STAGE_COPY[target.id].title}</h2><p>{getTodayTaskDescription(target.id, targetArtifact.status)}</p>
              <div className="task-context-row"><span><Compass size={15} />{workspace.project.genre || '类型待补充'}</span><span><BookOpenText size={15} />{workspace.project.audience || '读者待补充'}</span><span><Activity size={15} />{readyCount}/5 阶段已确认</span></div>
            </div>
            <div className="task-arrow"><ArrowRight size={22} /></div>
          </section>
          <section className="progress-ledger" aria-label="阶段进度">
            {STAGES.map((stage, index) => {
              const artifact = workspace.stages[stage.id];
              return <div className={`ledger-item ${artifact.status === 'ready' ? 'complete' : ''}`} key={stage.id}><div className="ledger-line"><span>{String(index + 1).padStart(2, '0')}</span><i /></div><strong>{stage.label}</strong><small>{STATUS_META[artifact.status]?.label}</small></div>;
            })}
          </section>
          <section className="paper-card project-brief-card">
            <div className="card-heading-row compact"><div><span className="section-kicker">作品指南针</span><h2>保持承诺一致</h2></div><span className="subtle-tag">可随时修订</span></div>
            <div className="form-grid two-col">
              <Field label="类型"><input value={workspace.project.genre} onChange={(event) => onProjectChange({ genre: event.target.value })} placeholder="为故事建立类型预期" /></Field>
              <Field label="目标读者"><input value={workspace.project.audience} onChange={(event) => onProjectChange({ audience: event.target.value })} placeholder="谁会最想读完它？" /></Field>
              <Field label="语气"><input value={workspace.project.tone} onChange={(event) => onProjectChange({ tone: event.target.value })} placeholder="冷峻、明亮、克制…" /></Field>
              <Field label="模型状态"><div className={`inline-readout ${settings.providers.some((provider) => provider.configured) ? 'ok' : 'warning'}`}><BrainCircuit size={16} /><span>{settings.providers.some((provider) => provider.configured) ? `已配置 ${settings.providers.filter((provider) => provider.configured).length} 个 API 渠道` : '尚未配置，不影响手动编辑'}</span></div></Field>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function StageWorkspace({
  stageId, workspace, onProjectChange, onArtifactChange, onSuggestionChange,
  onIdeaDrawChange, onIdeaDraw, onIdeaFeedbackChange, onIdeaRefine,
  onIdeaConfirm, onIdeaRestore, ideaConfigured, onIdeaSettings,
}) {
  const artifact = workspace.stages[stageId];
  const copy = STAGE_COPY[stageId];
  const hasDedicatedReader = ['logic', 'blueprint', 'draft', 'review'].includes(stageId);
  const readerValue = artifact.status === 'ready'
    ? artifact.confirmed
    : artifact.suggestion ?? artifact.confirmed;
  const readerArtifact = readerValue == null ? artifact : { ...artifact, suggestion: readerValue };
  const readerReadOnly = artifact.status === 'ready' || artifact.suggestion == null;
  return (
    <div className="content-column">
      <ContentHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} status={artifact.status} />
      <StageNotice stageId={stageId} artifact={artifact} />
      {stageId === 'idea' && (
        <IdeaDrawPanel
          artifact={artifact}
          configured={ideaConfigured}
          onChange={onIdeaDrawChange}
          onDraw={onIdeaDraw}
          onSettings={onIdeaSettings}
        />
      )}
      {stageId === 'idea' && <IdeaEditor workspace={workspace} onProjectChange={onProjectChange} onChange={onArtifactChange} />}
      {stageId === 'idea' && artifact.suggestion != null && artifact.status !== 'ready' ? (
        <IdeaWorkshop
          artifact={artifact}
          onSuggestionChange={onSuggestionChange}
          onFeedbackChange={onIdeaFeedbackChange}
          onRefine={onIdeaRefine}
          onConfirm={onIdeaConfirm}
          onRestore={onIdeaRestore}
          configured={ideaConfigured}
          onSettings={onIdeaSettings}
        />
      ) : null}
      {hasDedicatedReader && readerValue != null && (
        <>
          <ArtifactStatusStrip artifact={artifact} />
          {stageId === 'logic' && <StoryEngineWorkshop artifact={readerArtifact} onSuggestionChange={onSuggestionChange} readOnly={readerReadOnly} />}
          {stageId === 'blueprint' && <BlueprintWorkshop artifact={readerArtifact} onSuggestionChange={onSuggestionChange} readOnly={readerReadOnly} />}
          {stageId === 'draft' && <DraftWorkshop artifact={readerArtifact} workspace={workspace} onSuggestionChange={onSuggestionChange} readOnly={readerReadOnly} />}
          {stageId === 'review' && <ReviewWorkshop artifact={readerArtifact} workspace={workspace} onSuggestionChange={onSuggestionChange} readOnly={readerReadOnly} />}
        </>
      )}
      {hasDedicatedReader && (
        <StageSourcePanel
          key={stageId}
          stageId={stageId}
          artifact={artifact}
          summary={getStageSourceSummary(stageId, workspace)}
          defaultOpen={readerValue == null}
        >
          {stageId === 'logic' && <StructuredEditor fields={LOGIC_FIELDS} value={artifact.input} onChange={(input) => onArtifactChange({ input })} intro="故事引擎账本" icon={Route} embedded />}
          {stageId === 'blueprint' && <BlueprintEditor workspace={workspace} fields={BLUEPRINT_FIELDS} value={artifact.input} onChange={(input) => onArtifactChange({ input })} embedded />}
          {stageId === 'draft' && <DraftEditor workspace={workspace} onChange={onArtifactChange} embedded />}
          {stageId === 'review' && <ReviewEditor workspace={workspace} onChange={onArtifactChange} embedded />}
        </StageSourcePanel>
      )}
      {stageId === 'idea' && artifact.confirmed != null && <ConfirmedPanel value={artifact.confirmed} status={artifact.status} confirmedAt={artifact.confirmedAt} />}
    </div>
  );
}

function ContentHeader({ eyebrow, title, description, status }) {
  return <header className="content-header"><div><span className="content-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{status && <StatusBadge status={status} />}</header>;
}

function StageNotice({ stageId, artifact }) {
  if (artifact.status === 'stale') {
    const ownInputChanged = artifact.staleFrom === stageId;
    return <div className="stage-notice stale-notice"><AlertTriangle size={18} /><div><strong>{ownInputChanged ? '生成依据已经变化' : '上游内容已经变化'}</strong><span>现有{getStage(stageId).label}仍保留，但不再代表最新上下文。请重新生成并确认，或先检查输入差异。</span></div></div>;
  }
  if (artifact.status === 'error') {
    return <div className="stage-notice error-notice"><AlertCircle size={18} /><div><strong>模型调用失败，作者内容未丢失</strong><span>{artifact.error?.provider ? `${artifact.error.provider} · ` : ''}{artifact.error?.status ? `HTTP ${artifact.error.status} · ` : ''}{artifact.error?.message || '请检查配置后重试。'}</span></div></div>;
  }
  if (artifact.status === 'generating') {
    return <div className="stage-notice generating-notice"><LoaderCircle size={18} className="spin" /><div><strong>模型正在处理当前确认上下文</strong><span>返回结果只会进入建议稿，不会覆盖作者确认内容。</span></div></div>;
  }
  return null;
}

function IdeaEditor({ workspace, onProjectChange, onChange }) {
  const artifact = workspace.stages.idea;
  const hasSuggestion = artifact.suggestion != null;
  return (
    <details className="paper-card editor-card idea-source-editor" defaultOpen={!hasSuggestion}>
      <summary>
        <div className="card-heading-row compact"><div className="section-icon coral"><Lightbulb size={19} /></div><div><span className="section-kicker">作者输入</span><h2>原始 Idea 与作品边界</h2><p>{hasSuggestion ? truncateIdeaSource(artifact.input, 88) : '先写下让你真正想讲这个故事的画面、人物或问题。'}</p></div></div>
        <span className="idea-source-toggle">{hasSuggestion ? '按需修改' : '正在编辑'}<ChevronDown size={15} /></span>
      </summary>
      <div className="idea-source-body">
        <div className="form-grid two-col">
          <Field label="作品名" hint="可等抽卡后再定"><input value={workspace.project.title} onChange={(event) => onProjectChange({ title: event.target.value })} placeholder="作品名" /></Field>
          <Field label="类型"><input value={workspace.project.genre} onChange={(event) => onProjectChange({ genre: event.target.value })} placeholder="类型与题材" /></Field>
          <Field label="目标读者"><input value={workspace.project.audience} onChange={(event) => onProjectChange({ audience: event.target.value })} placeholder="最希望打动谁？" /></Field>
          <Field label="叙事语气"><input value={workspace.project.tone} onChange={(event) => onProjectChange({ tone: event.target.value })} placeholder="克制、黑色幽默、浪漫…" /></Field>
        </div>
        <Field label="原始灵感" hint="可选。保留你的措辞、矛盾与不确定性；这里是作者输入，不是模型结论。">
          <textarea className="large-textarea" rows={11} value={artifact.input ?? ''} onChange={(event) => onChange({ input: event.target.value })} placeholder="写下最初让你想讲这个故事的画面、人物或问题……" />
        </Field>
        <div className="prompt-notes"><span>可以不完整</span><span>优先写冲突</span><span>留下未知问题</span><span>不要提前写大纲</span></div>
      </div>
    </details>
  );
}

function truncateIdeaSource(value, length = 88) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '尚未填写原始 Idea。';
  return text.length > length ? text.slice(0, length) + '…' : text;
}
function StageSourcePanel({ stageId, artifact, summary, defaultOpen, children }) {
  const stage = getStage(stageId);
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="stage-source-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="stage-source-icon">{stageId === 'logic' ? <Route size={17} /> : stageId === 'blueprint' ? <PanelsTopLeft size={17} /> : stageId === 'draft' ? <PenLine size={17} /> : <ScanSearch size={17} />}</span>
        <span className="stage-source-copy">
          <strong>生成依据 · {stage.label}</strong>
          <small>{summary}</small>
        </span>
        <span className="stage-source-state">{artifact.status === 'generating' ? '生成中' : '按需修改'}<ChevronDown size={15} /></span>
      </summary>
      <div className="stage-source-body">{children}</div>
    </details>
  );
}

function ArtifactStatusStrip({ artifact }) {
  const ready = artifact.status === 'ready';
  const stale = artifact.status === 'stale' || artifact.status === 'editing';
  return (
    <div className={`artifact-lifecycle ${ready ? 'confirmed' : stale ? 'stale' : 'suggested'}`}>
      {ready ? <CheckCircle2 size={17} /> : stale ? <AlertTriangle size={17} /> : <Sparkles size={17} />}
      <div>
        <strong>{ready ? '作者确认稿' : stale ? '当前产物基于修改前的生成依据' : 'AI 建议稿，等待作者确认'}</strong>
        <span>{ready ? `已进入 Workspace 账本${artifact.confirmedAt ? ` · ${formatDateTime(artifact.confirmedAt)}` : ''}` : stale ? '内容保留供比对；重新生成前不会覆盖。' : '默认使用阅读稿呈现，确认前不会成为正式事实。'}</span>
      </div>
    </div>
  );
}

function StructuredEditor({ fields, value = {}, onChange, intro, icon: Icon, embedded = false }) {
  return (
    <section className={`${embedded ? 'embedded-editor' : 'paper-card'} editor-card`}>
      <div className="card-heading-row compact"><div className="section-icon ink"><Icon size={19} /></div><div><span className="section-kicker">作者账本</span><h2>{intro}</h2></div></div>
      <div className="structured-grid">
        {fields.map((field, index) => (
          <Field key={field.key} label={field.label} index={index + 1}>
            <textarea rows={field.rows} value={value?.[field.key] ?? ''} onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} placeholder={field.hint} />
          </Field>
        ))}
      </div>
    </section>
  );
}

function BlueprintEditor({ workspace, fields, value = {}, onChange, embedded = false }) {
  return (
    <>
      <section className="upstream-strip"><Route size={16} /><div><span>已确认故事引擎</span><p>{summarizeArtifact(workspace.stages.logic)}</p></div></section>
      <StructuredEditor fields={fields} value={value} onChange={onChange} intro="长篇结构与下一章契约" icon={PanelsTopLeft} embedded={embedded} />
    </>
  );
}

function DraftEditor({ workspace, onChange, embedded = false }) {
  const artifact = workspace.stages.draft;
  const contract = getChapterContract(workspace.stages.blueprint);
  return (
    <>
      <section className="contract-card"><div className="contract-label"><ListChecks size={17} /><span>已确认章节契约</span></div><p>{summarizeChapterContract(contract) || '蓝图中尚未提取到章节契约。请先确认小说蓝图。'}</p></section>
      <section className={`${embedded ? 'embedded-editor' : 'paper-card'} editor-card manuscript-card`}>
        <div className="chapter-heading"><div><span>CHAPTER {String(workspace.currentChapter?.number ?? 1).padStart(2, '0')}</span><h2>{workspace.currentChapter?.title || '未命名章节'}</h2></div><span className="word-count">{countChineseWords(artifact.text ?? '')} 字</span></div>
        <Field label="作者正文" hint="可以先手写，也可以等待模型正文候选。候选不会自动进入这里。">
          <textarea className="manuscript-textarea" rows={24} value={artifact.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} placeholder="从第一个不可回避的动作开始……" />
        </Field>
      </section>
    </>
  );
}

function ReviewEditor({ workspace, onChange, embedded = false }) {
  const artifact = workspace.stages.review;
  const draftText = getDraftBody(workspace.stages.draft.confirmed ?? workspace.stages.draft.text ?? workspace.stages.draft.suggestion);
  return (
    <>
      <section className={`${embedded ? 'embedded-editor' : 'paper-card'} review-source-card`}>
        <div className="card-heading-row compact"><div className="section-icon green"><FileText size={19} /></div><div><span className="section-kicker">待审章节</span><h2>{workspace.currentChapter?.title || '当前章节'}</h2></div><span className="word-count">{countChineseWords(draftText)} 字</span></div>
        <div className="review-excerpt">{draftText ? `${draftText.slice(0, 760)}${draftText.length > 760 ? '…' : ''}` : '尚无已确认章节正文。'}</div>
      </section>
      <section className={`${embedded ? 'embedded-editor' : 'paper-card'} editor-card`}>
        <div className="card-heading-row compact"><div className="section-icon ink"><ScanSearch size={19} /></div><div><span className="section-kicker">审查范围</span><h2>本轮特别关注</h2></div></div>
        <Field label="作者审查要求" hint="可选。系统默认检查阻塞问题、节奏、逻辑、角色一致性与 AI 痕迹。">
          <textarea rows={6} value={artifact.input?.focus ?? ''} onChange={(event) => onChange({ input: { ...(artifact.input ?? {}), focus: event.target.value } })} placeholder="例如：重点检查第三场对话的信息重复，以及结尾钩子是否足够具体。" />
        </Field>
        <div className="review-axis-list">{['P0 / P1 阻塞问题', '节奏与信息密度', '因果与角色一致性', '套话、解释腔与 AI 痕迹'].map((item) => <span key={item}><Check size={14} />{item}</span>)}</div>
      </section>
    </>
  );
}

function SuggestionPanel({ stageId, value, findings, onChange }) {
  const parsed = tryParseJson(value);
  return (
    <section className="suggestion-card">
      <div className="artifact-heading"><div><span className="artifact-label coral"><Sparkles size={15} />AI 建议稿</span><h2>{stageId === 'draft' ? '章节正文候选' : stageId === 'review' ? '审查建议' : '等待你的裁决'}</h2></div><span className="artifact-state">不会自动覆盖</span></div>
      <p className="artifact-help">你可以先修改建议稿，再使用页面底部的唯一主动作确认采用。</p>
      {stageId === 'review' && Array.isArray(findings) && findings.length ? <FindingsList findings={findings} /> : <EditableValue value={parsed} onChange={onChange} large={stageId === 'draft'} />}
    </section>
  );
}

function EditableValue({ value, onChange, large = false, disabled = false }) {
  if (typeof value === 'string' || value == null) return <textarea className={`suggestion-editor ${large ? 'manuscript' : ''}`} rows={large ? 24 : 12} value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled} />;
  if (Array.isArray(value)) return <textarea className="suggestion-editor" rows={14} value={JSON.stringify(value, null, 2)} onChange={(event) => onChange(tryParseJson(event.target.value))} disabled={disabled} />;
  return (
    <div className="suggestion-fields">
      {Object.entries(value).map(([key, item]) => (
        <Field key={key} label={humanizeKey(key)}>
          {typeof item === 'string' ? (
            <textarea rows={Math.max(3, Math.min(8, Math.ceil(item.length / 60)))} value={item} onChange={(event) => onChange({ ...value, [key]: event.target.value })} disabled={disabled} />
          ) : (
            <textarea rows={6} value={JSON.stringify(item, null, 2)} onChange={(event) => onChange({ ...value, [key]: tryParseJson(event.target.value) })} disabled={disabled} />
          )}
        </Field>
      ))}
    </div>
  );
}

function ConfirmedPanel({ value, status, confirmedAt }) {
  return (
    <section className={`confirmed-card ${status !== 'ready' ? 'prior-version' : ''}`}>
      <div className="artifact-heading"><div><span className="artifact-label green"><CheckCircle2 size={15} />{status === 'ready' ? '作者确认稿' : '上一版作者确认稿'}</span><h2>{status === 'ready' ? '已进入 Workspace 账本' : '保留供比对，等待重新确认'}</h2></div>{confirmedAt && <span className="artifact-state">{formatDateTime(confirmedAt)}</span>}</div>
      <StructuredValue value={value} />
    </section>
  );
}

function StructuredValue({ value }) {
  const parsed = tryParseJson(value);
  if (typeof parsed === 'string' || parsed == null) return <div className="prose-value">{parsed || '—'}</div>;
  if (Array.isArray(parsed)) return <div className="value-list">{parsed.map((item, index) => <div key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{valueToText(item)}</p></div>)}</div>;
  return <div className="structured-value">{Object.entries(parsed).map(([key, item]) => <div key={key}><span>{humanizeKey(key)}</span><p>{valueToText(item)}</p></div>)}</div>;
}

function FindingsList({ findings }) {
  return (
    <div className="findings-list">
      {findings.map((finding, index) => {
        const severity = String(finding?.severity ?? finding?.priority ?? 'P2').toUpperCase();
        return (
          <article className={`finding finding-${severity.toLowerCase()}`} key={finding?.id ?? index}>
            <div className="finding-priority">{severity}</div>
            <div><h3>{finding?.title ?? finding?.issue ?? `审查发现 ${index + 1}`}</h3><p>{finding?.description ?? finding?.detail ?? valueToText(finding)}</p>{finding?.suggestion && <div className="finding-suggestion"><ArrowRight size={14} />{valueToText(finding.suggestion)}</div>}</div>
          </article>
        );
      })}
    </div>
  );
}

function Field({ label, hint, required, index, children }) {
  return <label className="field"><span className="field-label">{index && <i>{String(index).padStart(2, '0')}</i>}{label}{required && <em>必填</em>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.empty;
  return <span className={`status-badge tone-${meta.tone}`}>{status === 'generating' ? <LoaderCircle size={13} className="spin" /> : status === 'ready' ? <Check size={13} /> : status === 'stale' || status === 'error' ? <AlertTriangle size={13} /> : <Circle size={9} />}{meta.label}</span>;
}

function PrimaryActionDock({ action, onAction, saveState }) {
  return (
    <div className="primary-dock">
      <div className="primary-dock-copy"><span>{action.kicker}</span><p>{action.hint}</p></div>
      <button type="button" className={`primary-button ${action.tone ?? ''}`} onClick={onAction} disabled={action.disabled}>
        {action.loading ? <LoaderCircle size={18} className="spin" /> : action.icon === 'check' ? <Check size={18} /> : action.icon === 'settings' ? <Settings2 size={18} /> : action.icon === 'refresh' ? <RefreshCw size={18} /> : <Sparkles size={18} />}
        <span>{action.label}</span>{!action.disabled && action.icon !== 'settings' && <ArrowRight size={17} />}
      </button>
      <div className={`dock-save-state save-${saveState.status}`}>{saveState.status === 'saving' ? <LoaderCircle size={12} className="spin" /> : <Circle size={8} />}{saveState.message}</div>
    </div>
  );
}

function Inspector({ open, stageId, workspace, settings, onClose, onSettings }) {
  const stage = getStage(stageId);
  const artifact = workspace.stages[stageId];
  const previous = getPreviousStage(stageId);
  const next = getNextStage(stageId);
  const latestRun = [...(workspace.runs ?? [])].reverse().find((run) => run.stage === stageId) ?? [...(workspace.runs ?? [])].at(-1);
  const risks = buildRisks(workspace, settings, stageId);
  const conditions = buildEntryConditions(workspace, settings, stageId);
  return (
    <>
      {open && <button type="button" className="inspector-scrim" onClick={onClose} aria-label="关闭检查器" />}
      <aside className={`inspector ${open ? 'open' : ''}`} aria-label="上下文检查器">
        <div className="inspector-mobile-head"><strong>上下文检查器</strong><button type="button" className="icon-button" onClick={onClose} aria-label="关闭上下文检查器"><X size={18} /></button></div>
        <section className="inspector-section compass-section">
          <SectionTitle icon={Compass} label="作品指南针" />
          <h3>{workspace.project.title || '未命名作品'}</h3>
          <div className="compass-meta"><span>{workspace.project.genre || '类型待补充'}</span><i /><span>{workspace.project.tone || '语气待补充'}</span></div>
          <p>{workspace.project.audience ? `为 ${workspace.project.audience} 写作。` : '目标读者尚未确认。'} {summarizeArtifact(workspace.stages.idea)}</p>
        </section>
        <section className="inspector-section">
          <SectionTitle icon={ListChecks} label={`${stage.label}进入条件`} />
          <div className="condition-list">{conditions.map((condition) => <div className={condition.ok ? 'ok' : 'missing'} key={condition.label}>{condition.ok ? <CheckCircle2 size={15} /> : <Circle size={14} />}<span>{condition.label}</span></div>)}</div>
        </section>
        <section className="inspector-section">
          <SectionTitle icon={ShieldAlert} label="风险与缺口" count={risks.length} />
          {risks.length ? <div className="risk-list">{risks.map((risk, index) => <div className={`inspector-risk ${risk.tone}`} key={`${risk.label}-${index}`}><AlertTriangle size={15} /><span>{risk.label}</span></div>)}</div> : <div className="all-clear"><CheckCircle2 size={16} /><span>当前没有阻塞问题</span></div>}
          {!getModelRoute(settings, stage.modelKey).configured && <button type="button" className="text-button" onClick={onSettings}><Settings2 size={14} />配置当前阶段模型</button>}
        </section>
        <section className="inspector-section" id="run-history">
          <SectionTitle icon={Activity} label="最近模型运行" />
          {latestRun ? (
            <div className={`run-card run-${latestRun.status}`}><div><span>{getStage(latestRun.stage)?.label ?? latestRun.stage}</span><strong>{latestRun.model || '未记录模型'}</strong></div><small>{latestRun.status === 'success' ? '成功' : '失败'} · {latestRun.durationMs ? `${(latestRun.durationMs / 1000).toFixed(1)}s` : '时长未知'} · {formatDateTime(latestRun.at)}</small></div>
          ) : <p className="empty-inspector">还没有模型运行记录。</p>}
        </section>
        <section className="inspector-section flow-summary">
          <SectionTitle icon={Layers3} label="上下游摘要" />
          {previous ? <div className="flow-item"><span>上游 · {previous.label}</span><p>{summarizeArtifact(workspace.stages[previous.id])}</p></div> : <div className="flow-item"><span>作品输入</span><p>{workspace.stages.idea.input || '尚未记录原始 Idea。'}</p></div>}
          {next ? <div className="flow-item muted"><span>下游 · {next.label}</span><p>{summarizeArtifact(workspace.stages[next.id])}</p></div> : <div className="flow-item muted"><span>本轮出口</span><p>{artifact.status === 'ready' ? '审查结论已确认，可进入下一轮修订。' : '确认审查结论后完成本轮。'}</p></div>}
        </section>
      </aside>
    </>
  );
}

function SectionTitle({ icon: Icon, label, count }) {
  return <div className="inspector-title"><Icon size={15} /><span>{label}</span>{Number.isFinite(count) && <em>{count}</em>}</div>;
}

function SettingsDrawer({ initialSettings, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    ...initialSettings,
    providers: initialSettings.providers.map((provider) => ({ ...provider, apiKey: '' })),
    routes: Object.fromEntries(Object.entries(initialSettings.routes).map(([role, route]) => [role, { ...route }])),
  }));
  const [activeProviderId, setActiveProviderId] = useState(initialSettings.providers[0]?.id ?? '');
  const [showKeys, setShowKeys] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const activeProvider = form.providers.find((provider) => provider.id === activeProviderId) ?? form.providers[0] ?? null;

  const updateProvider = (providerId, patch) => {
    setForm((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.id === providerId ? { ...provider, ...patch } : provider),
    }));
    setTestResult(null);
  };
  const updateRoute = (role, patch) => {
    setForm((current) => ({ ...current, routes: { ...current.routes, [role]: { ...current.routes[role], ...patch } } }));
  };
  const payload = () => ({
    version: 2,
    providers: form.providers.map((provider) => ({
      id: provider.id,
      name: provider.name.trim(),
      type: provider.type || 'openai-compatible',
      kind: provider.kind || 'custom',
      baseUrl: provider.baseUrl.trim(),
      ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
    })),
    routes: Object.fromEntries(Object.entries(form.routes).map(([role, route]) => [role, {
      providerId: route.providerId,
      model: String(route.model ?? '').trim(),
    }])),
    temperature: Number(form.temperature),
    jsonMode: Boolean(form.jsonMode),
  });
  const validateProviders = () => {
    if (!form.providers.length) return '至少保留一个 API 服务渠道';
    for (const provider of form.providers) {
      if (!provider.name.trim()) return '请填写渠道名称';
      if (provider.baseUrl.trim()) {
        try {
          const url = new URL(provider.baseUrl.trim());
          if (!['http:', 'https:'].includes(url.protocol)) return '渠道「' + provider.name + '」的 Base URL 必须使用 http(s)';
        } catch { return '渠道「' + provider.name + '」的 Base URL 不合法'; }
      }
    }
    return '';
  };
  const handleAddProvider = (presetId = 'relay') => {
    if (form.providers.length >= 20) { notify('API 服务渠道最多 20 个', 'warning'); return; }
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId) ?? PROVIDER_PRESETS[0];
    const id = createProviderId(form.providers);
    const sameKindCount = form.providers.filter((provider) => provider.kind === preset.id).length;
    const provider = {
      id,
      name: preset.name + (sameKindCount ? ` ${sameKindCount + 1}` : ''),
      type: preset.type,
      kind: preset.id,
      baseUrl: preset.baseUrl,
      apiKey: '',
      hasApiKey: false,
      apiKeyMasked: '',
      configured: false,
    };
    setForm((current) => ({ ...current, providers: [...current.providers, provider] }));
    setActiveProviderId(id);
    setTestResult(null);
  };
  const handleRemoveProvider = (providerId) => {
    if (form.providers.length === 1) { notify('至少保留一个 API 服务渠道', 'warning'); return; }
    const remaining = form.providers.filter((provider) => provider.id !== providerId);
    const fallbackId = remaining[0].id;
    setForm((current) => ({
      ...current,
      providers: remaining,
      routes: Object.fromEntries(Object.entries(current.routes).map(([role, route]) => [role, {
        ...route,
        providerId: route.providerId === providerId ? fallbackId : route.providerId,
      }])),
    }));
    if (activeProviderId === providerId) setActiveProviderId(fallbackId);
    setTestResult(null);
  };
  const handleSave = async () => {
    const errorMessage = validateProviders();
    if (errorMessage) { notify(errorMessage, 'warning'); return; }
    setSaving(true);
    try {
      const response = await saveSettings(payload());
      onSaved(normalizeSettings(response));
    } catch (error) { notify(toErrorMessage(error), 'error'); }
    finally { setSaving(false); }
  };
  const handleTest = async () => {
    if (!activeProvider) return;
    const providerError = validateProviders();
    if (providerError) { setTestResult({ ok: false, message: providerError }); return; }
    if (!activeProvider.baseUrl.trim()) { setTestResult({ ok: false, message: '请先填写当前渠道的 Base URL' }); return; }
    if (!activeProvider.apiKey.trim() && !activeProvider.hasApiKey) { setTestResult({ ok: false, message: '请先填写当前渠道的 API Key' }); return; }
    const assigned = MODEL_ROWS.find((row) => form.routes[row.key]?.providerId === activeProvider.id && form.routes[row.key]?.model?.trim());
    if (!assigned) { setTestResult({ ok: false, message: '请先将至少一个阶段路由到当前渠道，并填写模型 ID' }); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const response = await testModelConnection(payload(), { providerId: activeProvider.id, model: form.routes[assigned.key].model.trim() });
      setTestResult({ ok: true, message: '连接成功·' + (response?.providerName || activeProvider.name) + (response?.model ? ' · ' + response.model : '') });
    } catch (error) { setTestResult({ ok: false, message: toErrorMessage(error) }); }
    finally { setTesting(false); }
  };

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="模型配置">
      <button type="button" className="drawer-scrim" onClick={onClose} aria-label="点击遮罩关闭配置" />
      <aside className="settings-drawer">
        <header className="drawer-header">
          <div><span className="content-eyebrow">应用内设置</span><h2>模型配置</h2><p>先配置提供 API 的服务渠道，再选择模型 ID。API Key 与 Base URL 必须来自同一家服务。</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭模型配置"><X size={20} /></button>
        </header>
        <div className="drawer-content">
          <section className="settings-section">
            <div className="settings-section-title provider-toolbar">
              <Server size={17} />
              <div><strong>API 服务渠道</strong><span>官方接口、第三方中转和私有网关分别配置</span></div>
              <button type="button" className="secondary-button compact-button" onClick={() => handleAddProvider('relay')} disabled={form.providers.length >= 20}><Plus size={15} />空白渠道</button>
            </div>
            <div className="provider-preset-grid" aria-label="厂商预设">
              {PROVIDER_PRESETS.map((preset) => <button type="button" key={preset.id} onClick={() => handleAddProvider(preset.id)} disabled={form.providers.length >= 20}>
                <span>{preset.icon}</span><strong>{preset.name}</strong><small>{preset.short}</small>
              </button>)}
            </div>
            <div className="provider-list" aria-label="已配置的 API 服务渠道">
              {form.providers.map((provider) => {
                const ready = Boolean(provider.baseUrl.trim() && (provider.hasApiKey || provider.apiKey.trim()));
                return (
                  <div className={'provider-list-row ' + (provider.id === activeProvider?.id ? 'active' : '')} key={provider.id}>
                    <button type="button" className="provider-select-button" onClick={() => { setActiveProviderId(provider.id); setTestResult(null); }}>
                      <span><strong>{provider.name || '未命名渠道'}</strong><small>{PROVIDER_TYPE_LABELS[provider.type] || provider.type} · {providerHost(provider.baseUrl)}</small></span>
                      <i className={ready ? 'ready' : ''}>{ready ? '已配置' : '待配置'}</i>
                    </button>
                    <button type="button" className="provider-remove-button" onClick={() => handleRemoveProvider(provider.id)} disabled={form.providers.length === 1} aria-label={'删除' + provider.name}><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
            {activeProvider && (
              <div className="provider-editor">
                <div className="provider-editor-grid">
                  <Field label="渠道名称" required><input value={activeProvider.name} onChange={(event) => updateProvider(activeProvider.id, { name: event.target.value })} placeholder="例如：WuuuAPI / DeepSeek 官方 / 公司网关" /></Field>
                  <Field label="接口协议"><select value={activeProvider.type} onChange={(event) => updateProvider(activeProvider.id, { type: event.target.value, kind: event.target.value === 'openai-compatible' ? activeProvider.kind : 'custom' })}><option value="openai-compatible">OpenAI Compatible</option><option value="anthropic-messages">Anthropic Messages</option><option value="gemini-generate-content">Gemini Generate Content</option></select></Field>
                </div>
                <Field label="Base URL" hint="填写提供此 API Key 的同一家服务地址"><input value={activeProvider.baseUrl} onChange={(event) => updateProvider(activeProvider.id, { baseUrl: event.target.value })} placeholder="https://api.example.com/v1" spellCheck="false" /></Field>
                <Field label="渠道 API Key" hint={activeProvider.hasApiKey ? '已保存：' + (activeProvider.apiKeyMasked || '••••••••') + '。留空保留；必须与上方 Base URL 属于同一服务。' : '填写上方 Base URL 对应服务提供的密钥；模型品牌与密钥无关。'}>
                  <div className="secret-input"><KeyRound size={16} /><input type={showKeys[activeProvider.id] ? 'text' : 'password'} value={activeProvider.apiKey} onChange={(event) => updateProvider(activeProvider.id, { apiKey: event.target.value })} placeholder={activeProvider.hasApiKey ? '留空以保留现有密钥' : 'sk-…'} autoComplete="new-password" /><button type="button" onClick={() => setShowKeys((current) => ({ ...current, [activeProvider.id]: !current[activeProvider.id] }))} aria-label={showKeys[activeProvider.id] ? '隐藏密钥' : '显示密钥'}>{showKeys[activeProvider.id] ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                </Field>
                <div className="channel-guidance"><KeyRound size={16} /><span><strong>Key 跟着厂商实例走，不跟着模型名走。</strong>{activeProvider.kind === 'relay' ? '这里填写第三方中转服务发给你的 Key；Sol、Luna、Terra、DeepSeek 只是下方模型 ID。' : `这里填写 ${activeProvider.name} 自己签发的 Key，不要填其他厂商的密钥。`}</span></div>
              </div>
            )}
          </section>
          <section className="settings-section">
            <div className="settings-section-title"><BrainCircuit size={17} /><div><strong>阶段模型路由</strong><span>先选 API 渠道，再填写该渠道支持的模型 ID（例如 deepseek-chat）</span></div></div>
            <div className="model-route-list">
              {MODEL_ROWS.map((row) => {
                const route = form.routes[row.key] ?? { providerId: form.providers[0]?.id ?? '', model: '' };
                return (
                  <label key={row.key} className="model-route-row">
                    <span><strong>{row.label}</strong><small>{row.description}</small></span>
                    <div className="route-controls">
                      <select value={route.providerId} onChange={(event) => updateRoute(row.key, { providerId: event.target.value })} aria-label={row.label + ' API 渠道'}>
                        {form.providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name || '未命名渠道'}</option>)}
                      </select>
                      <input value={route.model} onChange={(event) => updateRoute(row.key, { model: event.target.value })} placeholder="模型 ID" spellCheck="false" />
                    </div>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="settings-section compact-settings">
            <div className="settings-section-title"><Settings2 size={17} /><div><strong>生成参数</strong><span>保持少量、可解释的全局参数</span></div></div>
            <div className="parameter-row">
              <label><span>温度 <strong>{Number(form.temperature).toFixed(1)}</strong></span><input type="range" min="0" max="1.5" step="0.1" value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: Number(event.target.value) }))} /></label>
              <label className="switch-row"><span><strong>JSON 模式</strong><small>结构化阶段优先返回 JSON</small></span><input type="checkbox" checked={form.jsonMode} onChange={(event) => setForm((current) => ({ ...current, jsonMode: event.target.checked }))} /><i /></label>
            </div>
          </section>
          {testResult && <div className={'test-result ' + (testResult.ok ? 'success' : 'error')}>{testResult.ok ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}<span>{testResult.message}</span></div>}
        </div>
        <footer className="drawer-footer">
          <button type="button" className="secondary-button" onClick={handleTest} disabled={testing || saving || !activeProvider}>{testing ? <LoaderCircle size={17} className="spin" /> : <PlugZap size={17} />}测试当前渠道</button>
          <button type="button" className="primary-button drawer-save" onClick={handleSave} disabled={saving || testing}>{saving ? <LoaderCircle size={17} className="spin" /> : <Save size={17} />}保存配置</button>
        </footer>
      </aside>
    </div>
  );
}

function createProviderId(providers) {
  const ids = new Set(providers.map((provider) => provider.id));
  const seed = Date.now().toString(36);
  let index = 1;
  let candidate = 'provider-' + seed;
  while (ids.has(candidate)) candidate = 'provider-' + seed + '-' + index++;
  return candidate;
}

function providerHost(baseUrl) {
  if (!baseUrl?.trim()) return '尚未填写 Base URL';
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

function LoadingScreen() {
  return <div className="loading-screen"><div className="loading-brand"><span className="brand-mark"><BookOpenText size={22} /></span><div><strong>叙光</strong><span>Novel Studio</span></div></div><div className="loading-rule"><i /></div><p><LoaderCircle size={16} className="spin" />正在打开独立 Workspace…</p></div>;
}

function getPrimaryAction({ view, workspace, stageId, configured }) {
  if (view === 'today') {
    const hasIdeaContext = Boolean(
      String(workspace.stages.idea.input ?? '').trim()
      || workspace.stages.idea.suggestion != null
      || workspace.stages.idea.confirmed != null
    );
    if (!hasIdeaContext) return { kicker: '唯一下一步', label: '进入 Idea：手写或抽卡', hint: '不要求先有书名或完整想法；可以完全随机，也可以限定大概方向。', icon: 'sparkles' };
    const target = firstActionableStage(workspace);
    const targetStatus = workspace.stages[target.id].status;
    return { kicker: '唯一下一步', label: target.id === 'idea' ? (targetStatus === 'suggested' || targetStatus === 'error' ? '继续打磨 Idea' : '开始打磨 Idea') : `继续${target.label}`, hint: getTodayTaskDescription(target.id, targetStatus), icon: 'check' };
  }
  const stage = getStage(stageId);
  const status = workspace.stages[stageId].status;
  if (status === 'generating') return { kicker: '\u6a21\u578b\u8fd0\u884c\u4e2d', label: '\u6b63\u5728\u5904\u7406', hint: '\u957f\u6587\u751f\u6210\u53ef\u80fd\u9700\u8981 1-5 \u5206\u949f\uff1b\u4f5c\u8005\u8f93\u5165\u4e0e\u5f53\u524d\u5efa\u8bae\u7a3f\u4f1a\u4e00\u76f4\u4fdd\u7559\u3002', loading: true, disabled: true };
  if (status === 'suggested') return stageId === 'idea'
    ? { kicker: 'Idea 仍在打磨', label: '继续打磨 Idea', hint: '填写本轮反馈，反复迭代到你愿意定稿；不会默认确认。', icon: 'refresh' }
    : { kicker: '需要你的裁决', label: stageId === 'review' ? '采纳审查结论' : '确认采用建议稿', hint: '确认后写入作者账本并解锁下一阶段。', icon: 'check', tone: 'confirm' };
  if (status === 'ready') {
    const next = getNextStage(stageId);
    return { kicker: '本阶段已确认', label: next ? `进入${next.label}` : '返回今日工作台', hint: next ? '下一阶段将只读取已经确认的内容。' : '本轮从 Idea 到审查已形成完整账本。', icon: 'check', tone: 'complete' };
  }
  if (!configured) return { kicker: 'AI 动作已阻塞', label: '配置模型后继续', hint: '仍可编辑并自动保存；密钥只由服务端保管。', icon: 'settings', tone: 'blocked' };
  if (status === 'stale') return { kicker: '上游已变化', label: '基于最新上游重新生成', hint: '旧产物会保留到新建议确认之后。', icon: 'refresh', tone: 'stale' };
  if (status === 'error') return { kicker: '上次调用失败', label: `重试${stage.label}`, hint: '将使用当前输入和已保存模型配置重试。', icon: 'refresh' };
  return { kicker: '唯一下一步', label: stageId === 'review' ? '运行章节审查' : stageId === 'draft' ? '生成章节正文候选' : `生成${stage.label}建议`, hint: '结果先进入独立建议稿，由你确认后才会成为事实。', icon: 'sparkles' };
}

function getTodayTaskDescription(stageId, status) {
  if (status === 'suggested') return stageId === 'idea'
    ? 'Idea 工作稿已经返回；请继续写反馈、打磨版本，满意后再定稿。'
    : `${getStage(stageId).label}建议已经返回，现在只需要确认或修订。`;
  if (status === 'stale') return `${getStage(stageId).label}已因上游变化而过期，需要重新确认。`;
  if (status === 'error') return `${getStage(stageId).label}上次调用失败，作者内容仍然完整。`;
  if (status === 'ready') return `${getStage(stageId).label}已完成，继续进入下一阶段。`;
  return STAGE_COPY[stageId].description;
}

function getStageInput(workspace, stageId) {
  const artifact = workspace.stages[stageId];
  if (stageId === 'draft') return artifact.text;
  if (stageId === 'review') return { focus: artifact.input?.focus ?? '', draft: getDraftBody(workspace.stages.draft.confirmed ?? workspace.stages.draft.text) };
  return artifact.input;
}

function buildGenerationSignature(workspace, stageId) {
  return JSON.stringify({
    input: getStageInput(workspace, stageId),
    context: buildGenerationContext(workspace, stageId),
    refinementFeedback: stageId === 'idea' ? workspace.stages.idea.refinementFeedback ?? '' : '',
    ideaDraw: stageId === 'idea' ? workspace.stages.idea.draw ?? null : null,
  });
}

function getStageSourceSummary(stageId, workspace) {
  const artifact = workspace.stages[stageId];
  if (stageId === 'draft') {
    const count = countChineseWords(artifact.text ?? '');
    return count ? `作者正文 ${count} 字；展开后可继续手写或调整。` : '当前没有手写正文；展开后可补充作者稿。';
  }
  if (stageId === 'review') {
    const focus = String(artifact.input?.focus ?? '').replace(/\s+/g, ' ').trim();
    return focus ? truncateIdeaSource(focus, 86) : '使用默认审查轴；展开后可补充本轮特别关注。';
  }
  const summary = valueToText(artifact.input).replace(/\s+/g, ' ').trim();
  return summary ? truncateIdeaSource(summary, 96) : `尚未填写${getStage(stageId).label}的作者生成依据。`;
}

function buildGenerationContext(workspace, stageId) {
  const index = getStageIndex(stageId);
  const upstream = {};
  STAGES.slice(0, index).forEach((stage) => { upstream[stage.id] = workspace.stages[stage.id].confirmed; });
  return { project: workspace.project, currentChapter: workspace.currentChapter, upstream };
}

function buildRun({ stageId, status, settings, startedAt, response, error }) {
  const modelKey = getStage(stageId).modelKey;
  const route = getModelRoute(settings, modelKey);
  return {
    id: response?.run?.id ?? response?.runId ?? `${stageId}-${Date.now()}`, stage: stageId, status,
    providerId: response?.providerId ?? response?.run?.providerId ?? route.providerId,
    model: response?.model ?? response?.run?.model ?? route.model,
    provider: response?.providerName ?? response?.run?.providerName ?? route.provider?.name ?? '未配置服务商',
    at: new Date().toISOString(), durationMs: Date.now() - startedAt,
    ...(error ? { message: toErrorMessage(error), statusCode: error.status ?? 0 } : {}),
  };
}

function buildEntryConditions(workspace, settings, stageId) {
  const index = getStageIndex(stageId);
  const modelKey = getStage(stageId).modelKey;
  const route = getModelRoute(settings, modelKey);
  const conditions = [];
  if (index > 0) {
    const previous = STAGES[index - 1];
    conditions.push({ label: `${previous.label}已确认`, ok: workspace.stages[previous.id].status === 'ready' });
  } else conditions.push({ label: '可手写原始灵感或使用抽卡', ok: true });
  if (stageId === 'draft') conditions.push({ label: '章节契约可读取', ok: Boolean(getChapterContract(workspace.stages.blueprint)) });
  if (stageId === 'review') conditions.push({ label: '章节正文可读取', ok: Boolean(getDraftBody(workspace.stages.draft.confirmed ?? workspace.stages.draft.text).trim()) });
  conditions.push({ label: `${getStage(stageId).label}模型已配置`, ok: route.configured });
  return conditions;
}

function buildRisks(workspace, settings, stageId) {
  const risks = [];
  const artifact = workspace.stages[stageId];
  const modelKey = getStage(stageId).modelKey;
  const route = getModelRoute(settings, modelKey);
  if (!route.provider) risks.push({ label: `${getStage(stageId).label}尚未选择 API 渠道`, tone: 'warning' });
  else if (!route.provider.baseUrl || !route.provider.hasApiKey) risks.push({ label: `渠道「${route.provider.name}」的服务地址或 API Key 尚未配置`, tone: 'warning' });
  else if (!route.model) risks.push({ label: `${getStage(stageId).label}模型 ID 缺失`, tone: 'warning' });
  if (artifact.status === 'stale') risks.push({ label: `当前产物因${getStage(artifact.staleFrom)?.label ?? '上游'}变化而过期`, tone: 'stale' });
  if (artifact.status === 'error') risks.push({ label: artifact.error?.message || '最近一次模型调用失败', tone: 'error' });
  if (stageId === 'idea' && !workspace.project.audience) risks.push({ label: '目标读者仍是一个待验证缺口', tone: 'neutral' });
  if (stageId === 'blueprint' && !workspace.stages.blueprint.input?.chapterContract) risks.push({ label: '下一章契约尚未填写', tone: 'neutral' });
  if (stageId === 'review') {
    const blockers = (workspace.stages.review.findings ?? []).filter((finding) => ['P0', 'P1'].includes(String(finding?.severity ?? finding?.priority ?? '').toUpperCase()));
    if (blockers.length) risks.push({ label: `${blockers.length} 个 P0/P1 审查问题待处理`, tone: 'error' });
  }
  return risks;
}

function getChapterContract(blueprintArtifact) {
  const confirmed = tryParseJson(blueprintArtifact?.confirmed);
  if (confirmed && typeof confirmed === 'object' && !Array.isArray(confirmed)) return confirmed.chapterContract ?? confirmed.nextChapterContract ?? confirmed.nextChapterContractCandidate ?? confirmed.selectedChapterContract ?? confirmed.selectedChapterContractCandidate ?? confirmed.contract ?? '';
  return blueprintArtifact?.input?.chapterContract ?? '';
}

function summarizeChapterContract(contract) {
  if (!contract) return '';
  if (typeof contract === 'string') return contract;
  if (typeof contract !== 'object' || Array.isArray(contract)) return valueToText(contract);
  const chapter = contract.candidateTitle ?? contract.title;
  const conflict = contract.coreConflict ?? contract.goal ?? contract.chapterGoal;
  const hook = contract.chapterEndHook ?? contract.endHook ?? contract.hook;
  return [
    chapter ? `《${valueToText(chapter)}》` : '',
    conflict ? `核心冲突：${valueToText(conflict)}` : '',
    hook ? `章末钩子：${valueToText(hook)}` : '',
  ].filter(Boolean).join(' · ') || valueToText(contract);
}

function getDraftBody(value) {
  const parsed = tryParseJson(value);
  if (typeof parsed === 'string') return parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return valueToText(parsed.draft ?? parsed.content ?? parsed.text ?? parsed.manuscript ?? parsed);
  }
  return valueToText(parsed);
}

function toErrorMessage(error) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '请求失败，请检查服务连接后重试。';
}
function formatTime(date) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function formatDateTime(value) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function countChineseWords(text) { return String(text ?? '').replace(/\s+/g, '').length; }
function sanitizeFilename(value) { return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 80); }
function prepareIdeaIterations(artifact) {
  const history = Array.isArray(artifact?.iterations) ? artifact.iterations.map((item) => cloneValue(item)) : [];
  if (artifact?.suggestion == null) return history;
  const last = history.at(-1);
  if (!last || !sameJsonValue(last.suggestion, artifact.suggestion)) {
    history.push(createIdeaIteration({
      version: nextIdeaVersion(history),
      suggestion: artifact.suggestion,
      source: artifact.restoredFrom ? 'restored' : last ? 'author-edit' : 'model',
      feedback: artifact.restoredFrom ? `恢复第 ${artifact.restoredFrom} 版后形成的当前工作稿` : last ? '作者直接修订当前工作稿' : '迁移现有初始建议稿',
      createdAt: artifact.suggestionAt ?? new Date().toISOString(),
    }));
  }
  return history;
}

function createIdeaIteration({ version, suggestion, source = 'model', feedback = '', run = null, createdAt = null }) {
  const timestamp = createdAt ?? new Date().toISOString();
  return {
    id: `idea-v${version}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
    version,
    source,
    suggestion: cloneValue(suggestion),
    feedback,
    providerId: run?.providerId ?? '',
    provider: run?.provider ?? '',
    model: run?.model ?? '',
    createdAt: timestamp,
  };
}

function compactIdeaIterationForPrompt(iteration) {
  return {
    version: iteration.version,
    source: iteration.source,
    feedback: iteration.feedback,
    suggestion: iteration.suggestion,
  };
}

function nextIdeaVersion(iterations) {
  return (Array.isArray(iterations) ? iterations.reduce((max, item) => Math.max(max, Number(item?.version) || 0), 0) : 0) + 1;
}

function sameJsonValue(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return left === right; }
}

function formatIdeaSource(source) {
  if (source === 'author-edit') return '作者修订';
  if (source === 'restored') return '历史恢复';
  if (source === 'draw') return '灵感抽卡';
  return '模型建议';
}

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}






