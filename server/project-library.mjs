import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_DIRS = ['正文', '设定', '大纲', '追踪'];
const TEXT_LIMIT = 768 * 1024;

export function createProjectLibrary({ libraryRoot }) {
  const root = path.resolve(libraryRoot);

  async function listProjects() {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'novel-studio-next') continue;
      const projectRoot = path.join(root, entry.name);
      if (!(await isNovelProject(projectRoot))) continue;
      try {
        projects.push(await buildProjectSummary(projectRoot, entry.name));
      } catch {
        projects.push({
          id: projectId(entry.name),
          title: entry.name,
          directoryName: entry.name,
          status: 'unknown',
          currentChapter: null,
          updatedAt: null,
          warning: '项目追踪信息暂时无法读取',
        });
      }
    }
    return projects.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || a.title.localeCompare(b.title, 'zh-CN'));
  }

  async function getDashboard(id) {
    const projects = await listProjects();
    const project = projects.find((item) => item.id === id);
    if (!project) return null;
    const projectRoot = path.join(root, project.directoryName);
    assertInside(root, projectRoot);

    const progress = await readJsonSafe(path.join(projectRoot, '追踪', 'progress.json'), {});
    const todayMarkdown = await readTextSafe(path.join(projectRoot, '追踪', '今日工作台.md'));
    const contextMarkdown = await readTextSafe(path.join(projectRoot, '追踪', '上下文.md'));
    const rulesMarkdown = await readTextSafe(path.join(projectRoot, '追踪', '规则.md'));
    const today = parseTodayWorkbench(todayMarkdown);
    const currentChapter = normalizeChapterNumber(progress.current_chapter ?? project.currentChapter ?? today.currentChapter ?? 1);
    const chapters = await listChapterFiles(path.join(projectRoot, '正文'));
    const contracts = await listChapterFiles(path.join(projectRoot, '大纲', '章节契约'));
    const currentDraft = chapters.find((item) => item.number === currentChapter) ?? null;
    const currentContract = contracts.find((item) => item.number === currentChapter) ?? null;
    const contractPreview = currentContract ? summarizeMarkdown(await readTextSafe(path.join(projectRoot, ...currentContract.relativePath.split('/'))), 520) : '';
    const progressRisks = Array.isArray(progress.open_risks)
      ? progress.open_risks.map((label) => ({ severity: inferSeverity(label), label: String(label), source: '追踪/progress.json' }))
      : [];
    const risks = dedupeRisks([...today.risks, ...progressRisks]);
    const completed = Array.isArray(progress.completed_chapters)
      ? progress.completed_chapters.map(normalizeChapterNumber).filter(Number.isFinite)
      : chapters.filter((item) => item.number < currentChapter).map((item) => item.number);

    return {
      project,
      progress: {
        status: stringOr(progress.status, project.status),
        currentPhase: stringOr(progress.current_phase, today.stage),
        currentVolume: stringOr(progress.current_volume, today.currentVolume),
        currentArc: stringOr(progress.current_arc, today.currentArc),
        currentChapter,
        completedChapters: completed,
        nextStep: stringOr(progress.next_step, today.nextStep),
        updatedAt: stringOr(progress.updated_at, project.updatedAt),
      },
      today: {
        stage: stringOr(today.stage, progress.current_phase, '待恢复'),
        nextStep: stringOr(today.nextStep, progress.next_step, `继续推进第 ${currentChapter} 章`),
        mainTask: stringOr(today.mainTask, `推进第 ${currentChapter} 章`),
        mustAchieve: today.mustAchieve,
        tasks: today.tasks,
        references: today.references,
      },
      chapter: {
        number: currentChapter,
        title: currentDraft?.title || currentContract?.title || `第${currentChapter}章`,
        contractReady: Boolean(currentContract),
        contractPath: currentContract?.relativePath ?? null,
        contractPreview,
        draftExists: Boolean(currentDraft),
        draftPath: currentDraft?.relativePath ?? null,
        completed: completed.includes(currentChapter),
      },
      readiness: {
        progress: Boolean(Object.keys(progress).length),
        todayWorkbench: Boolean(todayMarkdown.trim()),
        context: Boolean(contextMarkdown.trim()),
        rules: Boolean(rulesMarkdown.trim()),
        contract: Boolean(currentContract),
        draft: Boolean(currentDraft),
      },
      risks,
      counts: {
        completedChapters: completed.length,
        chapters: chapters.length,
        contracts: contracts.length,
        blockingRisks: risks.filter((risk) => ['P0', 'P1'].includes(risk.severity)).length,
        warnings: risks.filter((risk) => !['P0', 'P1'].includes(risk.severity)).length,
      },
      sourceFiles: {
        progress: '追踪/progress.json',
        todayWorkbench: '追踪/今日工作台.md',
        context: '追踪/上下文.md',
        rules: '追踪/规则.md',
      },
      readOnly: true,
    };
  }

  async function getCalibrationContext(id) {
    const dashboard = await getDashboard(id);
    if (!dashboard) return null;
    const projectRoot = path.join(root, dashboard.project.directoryName);
    assertInside(root, projectRoot);
    const chapterNumber = dashboard.chapter.number;
    const contractFile = dashboard.chapter.contractPath
      ? path.join(projectRoot, ...dashboard.chapter.contractPath.split('/'))
      : null;
    const chapters = await listChapterFiles(path.join(projectRoot, '正文'));
    const previousChapter = [...chapters].reverse().find((item) => item.number < chapterNumber) ?? null;
    const previousChapterFile = previousChapter ? path.join(projectRoot, ...previousChapter.relativePath.split('/')) : null;
    const arcOutline = await findArcOutline(projectRoot, dashboard.progress.currentArc);
    const detailOutline = await findChapterDetailOutline(projectRoot, chapterNumber);
    const readProjectFile = async (...segments) => clipText(await readTextSafe(path.join(projectRoot, ...segments)), 28_000);
    return {
      project: dashboard.project,
      chapter: dashboard.chapter,
      today: dashboard.today,
      risks: dashboard.risks,
      formalFacts: {
        contract: contractFile ? clipText(await readTextSafe(contractFile), 36_000) : '',
        rules: await readProjectFile('追踪', '规则.md'),
        context: await readProjectFile('追踪', '上下文.md'),
        coreSetting: await readProjectFile('设定', '核心设定.md'),
        characterState: await readProjectFile('追踪', '角色状态.md'),
        foreshadowing: await readProjectFile('追踪', '伏笔.md'),
        timeline: await readProjectFile('追踪', '时间线.md'),
        compass: await readProjectFile('大纲', '指南针.md'),
        arcOutline: arcOutline ? clipText(await readTextSafe(arcOutline.absolutePath), 28_000) : '',
        chapterDetail: detailOutline ? clipText(await readTextSafe(detailOutline.absolutePath), 28_000) : '',
        previousChapter: previousChapterFile ? clipText(await readTextSafe(previousChapterFile), 42_000) : '',
      },
      sourceLabels: [
        dashboard.chapter.contractPath,
        detailOutline?.relativePath,
        arcOutline?.relativePath,
        '大纲/指南针.md',
        previousChapter?.relativePath,
        '追踪/规则.md',
        '追踪/上下文.md',
        '设定/核心设定.md',
        '追踪/角色状态.md',
        '追踪/伏笔.md',
        '追踪/时间线.md',
      ].filter(Boolean),
      readOnly: true,
      chapterNumber,
    };
  }

  return { root, listProjects, getDashboard, getCalibrationContext };
}

async function isNovelProject(projectRoot) {
  const states = await Promise.all(REQUIRED_DIRS.map(async (name) => {
    try { return (await fs.stat(path.join(projectRoot, name))).isDirectory(); }
    catch { return false; }
  }));
  return states.every(Boolean);
}

async function buildProjectSummary(projectRoot, directoryName) {
  const progress = await readJsonSafe(path.join(projectRoot, '追踪', 'progress.json'), {});
  const today = parseTodayWorkbench(await readTextSafe(path.join(projectRoot, '追踪', '今日工作台.md')));
  return {
    id: projectId(directoryName),
    title: stringOr(progress.book, today.bookTitle, directoryName),
    directoryName,
    status: stringOr(progress.status, 'active'),
    currentChapter: normalizeChapterNumber(progress.current_chapter ?? today.currentChapter),
    currentPhase: stringOr(progress.current_phase, today.stage),
    updatedAt: stringOr(progress.updated_at),
  };
}

function projectId(directoryName) {
  return crypto.createHash('sha256').update(directoryName, 'utf8').digest('base64url').slice(0, 18);
}

async function listChapterFiles(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => {
      const number = chapterNumberFromName(entry.name);
      return Number.isFinite(number) ? {
        number,
        title: entry.name.replace(/\.md$/i, ''),
        relativePath: path.basename(directory) === '正文' ? `正文/${entry.name}` : `大纲/章节契约/${entry.name}`,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}

async function findChapterDetailOutline(projectRoot, chapterNumber) {
  const outlineRoot = path.join(projectRoot, '大纲');
  let entries;
  try { entries = await fs.readdir(outlineRoot, { withFileTypes: true }); }
  catch { return null; }
  const padded = String(chapterNumber).padStart(3, '0');
  const match = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && (
    entry.name.includes(`第${chapterNumber}章`) || entry.name.includes(`第${padded}章`) || new RegExp(`(?:细纲|章节).*0*${chapterNumber}(?:章|\\D|$)`, 'i').test(entry.name)
  ));
  return match ? { absolutePath: path.join(outlineRoot, match.name), relativePath: `大纲/${match.name}` } : null;
}

async function findArcOutline(projectRoot, currentArc) {
  const outlineRoot = path.join(projectRoot, '大纲');
  let entries;
  try { entries = await fs.readdir(outlineRoot, { withFileTypes: true }); }
  catch { return null; }
  const tokens = String(currentArc ?? '').split(/[-—·・_\s]+/).map((item) => item.replace(/[第卷弧线]/g, '')).filter((item) => item.length >= 2);
  const candidates = entries.filter((entry) => entry.isFile() && /^弧纲_.*\.md$/i.test(entry.name));
  const match = candidates.find((entry) => tokens.every((token) => entry.name.includes(token)))
    ?? candidates.find((entry) => tokens.some((token) => entry.name.includes(token)))
    ?? (candidates.length === 1 ? candidates[0] : null);
  return match ? { absolutePath: path.join(outlineRoot, match.name), relativePath: `大纲/${match.name}` } : null;
}

function parseTodayWorkbench(markdown) {
  const top = parseBulletMap(extractSection(markdown, '顶部状态'));
  const mustAchieveSection = extractSection(markdown, '主任务');
  const taskLines = mustAchieveSection.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const mainTask = taskLines.find((line) => !line.startsWith('>') && !line.startsWith('-') && !line.startsWith('#'))?.replace(/[。.]$/, '') ?? '';
  const risks = parseMarkdownTable(extractSection(markdown, '风险')).map((row) => ({
    severity: stringOr(row['优先级'], inferSeverity(row['风险'])),
    label: stringOr(row['风险'], row['处理']),
    resolution: stringOr(row['处理']),
    source: '追踪/今日工作台.md',
  })).filter((risk) => risk.label);
  return {
    bookTitle: markdown.match(/^#\s+今日工作台\s*[·・]\s*《([^》]+)》/m)?.[1] ?? '',
    currentChapter: normalizeChapterNumber(top['当前章']),
    currentVolume: stringOr(top['当前卷']),
    currentArc: stringOr(top['当前弧']),
    stage: stringOr(top['当前阶段']),
    nextStep: stringOr(top['下一步']),
    mainTask,
    mustAchieve: parseBullets(mustAchieveSection),
    tasks: parseMarkdownTable(extractSection(markdown, '今日任务清单')).map((row) => ({
      status: stringOr(row['状态']),
      task: stringOr(row['任务']),
      file: stripTicks(row['文件']),
    })).filter((task) => task.task),
    risks,
    references: parseBullets(extractSection(markdown, '可用参考')).map(stripTicks),
  };
}

function extractSection(markdown, title) {
  const pattern = new RegExp(`^#{2,3}\\s+${escapeRegExp(title)}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s+|\\Z)`, 'm');
  return markdown.match(pattern)?.[1]?.trim() ?? '';
}

function parseBulletMap(section) {
  return Object.fromEntries(parseBullets(section).map((item) => {
    const index = item.indexOf('：');
    return index > 0 ? [item.slice(0, index).trim(), item.slice(index + 1).trim()] : [item, ''];
  }));
}

function parseBullets(section) {
  return section.split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1] ?? '')
    .filter(Boolean);
}

function parseMarkdownTable(section) {
  const lines = section.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('|'));
  if (lines.length < 3) return [];
  const split = (line) => line.split('|').slice(1, -1).map((cell) => cell.trim());
  const headers = split(lines[0]);
  return lines.slice(2).map((line) => {
    const cells = split(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function chapterNumberFromName(name) {
  const match = name.match(/第\s*0*(\d+)\s*章/i) ?? name.match(/ch\s*0*(\d+)/i);
  return match ? Number(match[1]) : NaN;
}

function normalizeChapterNumber(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const match = String(value ?? '').match(/0*(\d+)/);
  return match ? Number(match[1]) : NaN;
}

function inferSeverity(value) {
  const match = String(value ?? '').match(/\b(P[0-3])\b/i);
  return match ? match[1].toUpperCase() : '提醒';
}

function dedupeRisks(risks) {
  const seen = new Set();
  return risks.filter((risk) => {
    const label = String(risk.label ?? '').replace(/\s+/g, ' ').trim();
    const key = label.includes('\u6797\u70ec') ? 'wrong-protagonist-name' : label.includes('\u540e\u5c71\u7981\u5730') ? 'wrong-ch004-plot' : label;
    if (!label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readJsonSafe(file, fallback) {
  try { return JSON.parse(await readText(file)); }
  catch { return fallback; }
}

async function readTextSafe(file) {
  try { return await readText(file); }
  catch { return ''; }
}

async function readText(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > TEXT_LIMIT) throw new Error('文件不可读取或超过限制');
  return fs.readFile(file, 'utf8');
}

function summarizeMarkdown(markdown, limit) {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[`*_>|]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function clipText(value, limit) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n[内容已按校准上下文上限截断]` : text;
}

function stripTicks(value) { return String(value ?? '').replace(/`/g, '').trim(); }
function stringOr(...values) { return values.map((value) => String(value ?? '').trim()).find(Boolean) ?? ''; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('项目路径越界');
}

