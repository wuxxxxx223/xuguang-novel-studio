# 叙光 Novel Studio

全新独立的 AI 小说创作工作台，不依赖旧 `workbench/` 或 `novel-compiler/studio` 前端。

本仓库只同步产品代码。作者 Workspace、小说正文、模型密钥和运行数据均保留在本地或生产数据目录，不进入 Git。

## 开发运行

```bash
npm ci
npm run dev
```

访问 `http://127.0.0.1:5178/`，API 运行在 `http://127.0.0.1:8790/`。

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

## 生产部署

当前生产拓扑是**单用户、单实例、文件存储**。应用端口默认仅发布到宿主机
`127.0.0.1`；远程访问必须经过 TLS 与身份认证代理。完整部署、备份、恢复、
升级和回滚步骤见 [`docs/production-runbook.md`](docs/production-runbook.md)。

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
