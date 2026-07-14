# 叙光 Novel Studio

全新独立的 AI 小说创作工作台，不依赖旧 `workbench/` 或 `novel-compiler/studio` 前端。

## 运行

```powershell
npm install
npm run build
npm start
```

访问 `http://127.0.0.1:8790/`。

模型密钥只保存在本项目 `.data/settings.json`，前端只能读取脱敏后的配置状态。

模型配置支持多个 OpenAI-compatible API 服务渠道，并可为 Idea、逻辑、蓝图、写作和审查阶段分别路由到不同渠道与模型 ID。API Key 必须与对应渠道的 Base URL 配套，模型品牌只通过模型 ID 指定。

## 当前真实项目工作流

- 首页读取工作区中的真实小说项目，并以“今日工作台”作为首屏。
- 当前章契约草稿、候选正文、模型生成、只读审查与作者确认先写入 `.data/project-chapters/`，不会直接覆盖正式项目。
- 当前章缺少正式契约时，日更路径会锁住正文、校准、审查与写回；作者需先补齐六项结构并生成单文件差异预览。
- 契约正式创建要求明确确认与 `.data/contract-checkpoints/` checkpoint；已存在正式契约时禁止覆盖。
- 候选正文模型生成先展示厂商、模型、正式输入和侧车边界；只有作者明确确认第三方费用后，服务端才允许发出模型请求。
- 作者确认后可生成完整正式文件差异；预览阶段 `formalWritePerformed = false`。
- 正式提交要求再次勾选确认，先创建 `.data/writeback-checkpoints/`，再写入正文与追踪账本；源文件变化会阻塞提交。
- 正式正文字节级来自作者已确认候选，追踪同步模型只提取摘要、角色、伏笔、时间线和下一章目标。

## 验证

```powershell
npm run build
npm run test:contract
npm run test:writeback
node --check server/index.mjs
node --check server/contract-writeback.mjs
```

契约烟测只在 `.data/contract-writeback-smoke/` 下验证“模板校验、预览不落盘、外部目标冲突、checkpoint 与精确文本写入”；正文写回烟测只在 `.data/writeback-smoke/` 下验证多文件事务。两者都不会操作真实小说目录。