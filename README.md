# 叙光 Novel Studio

独立的 AI 小说创作工作台，默认面向 Windows 10/11 开发，不依赖旧 `workbench/` 或 `novel-compiler/studio` 前端。

本仓库只同步产品代码。作者 Workspace、小说正文、模型密钥和运行数据均保留在本地或生产数据目录，不进入 Git。

## Windows 三分钟启动

准备 Git for Windows 后，在 PowerShell 中运行：

```powershell
git clone git@github.com:wuxxxxx223/xuguang-novel-studio.git
Set-Location xuguang-novel-studio
.\setup-windows.cmd
```

安装脚本会检查 Node.js `22.12-24.x`；缺失时优先通过 `winget` 安装当前 Node.js LTS，然后执行 `npm ci`、构建并打开应用。

日常入口：

- `dev-xuguang.cmd`：启动 Windows 原生热更新开发环境。
- `launch-xuguang.cmd`：构建并在后台启动本地应用。
- `stop-xuguang.cmd`：只停止由 Windows 启动器记录的后台实例。

Windows 数据保存在 `%LOCALAPPDATA%\XuguangNovelStudio`，默认小说库保存在 `%USERPROFILE%\Documents\Xuguang Novel Library`。启动器只会复用 Windows 原生 `win32` 服务；即使 WSL 已占用默认端口，也会选择其他端口和独立数据目录。

## 隔离体验模式

这是给协作者、评审者和第一次试用者的最快路径：它会启动一套**隔离的临时数据目录**，不会读取或修改本机 `.data/`、作者正文或已有模型 Key。

```bash
npm ci
npm run quickstart
```

然后打开 `http://127.0.0.1:5178/`。无需 Docker、生产环境、小说库或 API Key；没有配置模型时仍可浏览界面、手写内容和审查流程。按 `Ctrl+C` 停止后，本次临时体验数据会自动清理。

启动前想检查 Node 版本、依赖和默认端口，可执行：

```bash
npm run doctor
```

若 `5178` / `8790` 被其他程序占用，先关闭已有本地服务，或使用一对空闲端口：

```bash
npm run quickstart -- --web-port 15178 --api-port 18790
```

需要打开或继续本机真实 Workspace 时，Windows 使用 `dev-xuguang.cmd`；其他平台可使用下方的 `npm run dev`。它们会读取持久化数据目录，和隔离体验模式不同。

## 开发运行

```bash
npm ci
npm run dev
```

访问 `http://127.0.0.1:5178/`，API 运行在 `http://127.0.0.1:8790/`。

直接运行 npm 命令时，默认数据目录是仓库内 `.data/`。Windows 团队开发优先使用上述 CMD 启动器，以获得平台隔离的数据目录和端口处理。

## 本地生产模式

```bash
npm ci
npm run build
npm start
```

访问 `http://127.0.0.1:8790/`。

模型密钥只保存在本项目 `.data/settings.json`，前端只能读取脱敏后的配置状态。

模型配置支持多个 OpenAI-compatible API 服务渠道，并可为 Idea、逻辑、蓝图、写作和审查阶段分别路由到不同渠道与模型 ID。API Key 必须与对应渠道的 Base URL 配套，模型品牌只通过模型 ID 指定。

## 团队协作

- 从 `main` 创建 `feat/*` 或 `fix/*` 分支。
- 通过 Pull Request 合并，不直接在多人环境中改写 `main` 历史。
- 提交前至少执行 `npm run check` 和 `npm run test:all`。
- `.data/`、`.env*`、模型密钥、作者正文和生产备份不得提交。
- GitHub Actions 会对 `main` 和 Pull Request 执行构建与 smoke tests。

详细约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 当前真实项目工作流

- 首页读取工作区中的真实小说项目，并以“今日工作台”作为首屏。
- 当前章契约草稿、候选正文、模型生成、只读审查与作者确认先写入 `.data/project-chapters/`，不会直接覆盖正式项目。
- 当前章缺少正式契约时，日更路径会锁住正文、校准、审查与写回；作者需先补齐六项结构并生成单文件差异预览。
- 契约正式创建要求明确确认与 `.data/contract-checkpoints/` checkpoint；已存在正式契约时禁止覆盖。
- 候选正文模型生成先展示厂商、模型、正式输入和侧车边界；只有作者明确确认第三方费用后，服务端才允许发出模型请求。
- 作者确认后可生成完整正式文件差异；预览阶段 `formalWritePerformed = false`。
- 正式提交要求再次勾选确认，先创建 `.data/writeback-checkpoints/`，再写入正文与追踪账本；源文件变化会阻塞提交。
- 正式正文字节级来自作者已确认候选，追踪同步模型只提取摘要、角色、伏笔、时间线和下一章目标。

## Linux 生产部署

当前生产拓扑是**单用户、单实例、文件存储**。应用端口默认仅发布到宿主机
`127.0.0.1`；远程访问必须经过 TLS 与身份认证代理。完整部署、备份、恢复、
升级和回滚步骤见 [`docs/production-runbook.md`](docs/production-runbook.md)。

`deploy/*.sh`、Docker 和 Compose 属于 Linux 生产部署层，不是 Windows 本地开发依赖。

生产发布门禁：

```bash
npm ci
npm run release:verify
```

契约与正文写回烟测只在 `.data/*-smoke/` 隔离目录运行，不会操作真实小说项目。
未终态 checkpoint 会让 readiness 返回 503；上线前必须检查：

```bash
NOVEL_STUDIO_DATA_DIR=/absolute/path/to/data npm run audit:checkpoints
```

## 多项目批处理

服务启动后，可串行处理所有项目或指定项目的当前章：

```bash
npm run batch:projects -- --operation generate --all --dry-run
npm run batch:projects -- --operation generate --all --confirm-spend
npm run batch:projects -- --operation review --projects <项目ID,项目ID> --confirm-spend
```

`--dry-run` 只显示可处理项目和跳过原因，不调用模型。真实执行时单项目失败不会中断后续项目。脚本只生成或审查侧车候选，不会自动确认，也不会正式写回。
