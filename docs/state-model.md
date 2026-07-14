# 叙光 Novel Studio：状态模型

## 对象

Workspace、Stage Artifact、AI Run、Model Provider、Model Route。

## 创作状态枚举

| 状态 | 含义 | 可进入动作 | 可退出动作 |
|---|---|---|---|
| empty | 尚未建立作品 | 建立作品 | editing |
| editing | 作者正在编辑 | 保存、请求 AI | generating / ready |
| generating | AI 请求中 | 等待、取消 | suggested / error |
| suggested | 建议稿待确认 | 修改、采用 | ready / editing |
| ready | 阶段已确认 | 进入下一阶段 | editing（改动后下游 stale） |
| stale | 上游变化 | 保留或重做 | ready / editing |
| error | 调用失败 | 重试、改配置 | generating / editing |

## API 服务渠道状态

| 状态 | 含义 | UI 标识 | 可用动作 |
|---|---|---|---|
| empty | 尚未添加渠道 | 中性灰 | 添加渠道 |
| incomplete | 名称、地址或密钥缺失 | 琥珀色 | 编辑、保存 |
| configured | Base URL 与密钥已存在 | 深绿色 | 测试、绑定路由 |
| testing | 正在执行连接测试 | 蓝色脉冲 | 等待 |
| error | 最近测试失败 | 红色 | 修正后重试 |

## 阶段路由状态

| 状态 | 含义 | 主动作影响 |
|---|---|---|
| unassigned | 未选择 API 渠道 | 阻塞当前阶段 AI |
| model_missing | 已选择 API 渠道但模型 ID 为空 | 阻塞当前阶段 AI |
| provider_incomplete | 渠道缺地址或密钥 | 阻塞当前阶段 AI |
| ready | API 渠道与模型均完整 | 允许当前阶段 AI |

## 账本映射

| 状态 | 来源文件 | 写入文件 |
|---|---|---|
| Workspace | 浏览器请求 | `.data/workspace.json` |
| Model Providers / Routes | 应用内配置抽屉 | `.data/settings.json` |
| AI Run | 当前确认上下文 + 服务端实际路由 | Workspace `runs` 摘要 |

## UI 显示

| 状态 | 标识 | 文案 | 主动作 |
|---|---|---|---|
| empty | 中性灰 | 从一个清晰的作品承诺开始 | 建立作品 |
| editing | 墨色 | 正在编辑 | 生成建议 / 保存确认 |
| generating | 蓝色脉冲 | 模型正在处理 | 处理中 |
| suggested | 珊瑚色 | 建议稿待你裁决 | 确认采用 |
| ready | 深绿色 | 本阶段已确认 | 进入下一阶段 |
| stale | 琥珀色 | 上游已变化 | 重新确认 |
| error | 红色 | 调用失败，内容未丢失 | 重试 |

## Model Settings 核心结构

```json
{
  "version": 2,
  "providers": [
    {
      "id": "provider-default",
      "name": "OpenAI Compatible",
      "type": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "仅服务端保存"
    }
  ],
  "routes": {
    "idea": { "providerId": "provider-default", "model": "" },
    "logic": { "providerId": "provider-default", "model": "" },
    "blueprint": { "providerId": "provider-default", "model": "" },
    "writer": { "providerId": "provider-default", "model": "" },
    "review": { "providerId": "provider-default", "model": "" }
  },
  "temperature": {},
  "maxTokens": {},
  "timeoutMs": 120000,
  "jsonMode": false
}
```

前端公开结构只包含每个渠道的 `hasApiKey` 与 `apiKeyMasked`，不包含密钥原文。旧版单渠道 `baseUrl/apiKey/models` 在加载时迁移为一个默认渠道和五条阶段路由。

## Workspace 核心结构

```json
{
  "revision": 0,
  "project": { "title": "", "genre": "", "audience": "", "tone": "" },
  "currentStage": "idea",
  "stages": {
    "idea": { "status": "editing", "input": "", "suggestion": null, "confirmed": null },
    "logic": { "status": "empty", "input": {}, "suggestion": null, "confirmed": null },
    "blueprint": { "status": "empty", "suggestion": null, "confirmed": null },
    "draft": { "status": "empty", "text": "", "suggestion": null, "confirmed": null },
    "review": { "status": "empty", "findings": [], "accepted": false }
  },
  "runs": []
}
```

---

## v0.2：真实项目状态模型

### 新增对象

- `ProjectSummary`：服务端发现的本地小说项目摘要。
- `ProjectDashboard`：某项目今日工作台的只读聚合视图。
- `ChapterReadiness`：当前章节契约、正文和追踪账本的就绪状态。

### ProjectSummary

```json
{
  "id": "服务端生成的稳定项目ID",
  "title": "苟成仙帝，出关即无敌",
  "directoryName": "苟成仙帝",
  "status": "active",
  "currentChapter": 4,
  "updatedAt": "2026-07-09"
}
```

### ProjectDashboard

```json
{
  "project": {},
  "progress": {},
  "today": {
    "stage": "预写完成，待正式写草稿",
    "nextStep": "按第004章契约写第4章正式正文",
    "mustAchieve": [],
    "tasks": [],
    "references": []
  },
  "chapter": {
    "number": 4,
    "contractReady": true,
    "draftExists": false,
    "completed": false
  },
  "risks": [],
  "counts": {
    "completedChapters": 3,
    "contracts": 1,
    "drafts": 3
  }
}
```

### 读写权重

1. `设定/`、`正文/`、`追踪/上下文.md`、`追踪/规则.md`：正式事实。
2. `大纲/章节契约/`：当前章节执行合同。
3. `编译流/`：侧车参考。
4. `追踪/诊断.md`：只读 Finding。
5. `.data/workspace.json`：网页候选稿与交互状态，不自动晋升为正式事实。

### 当前阶段写入规则

v0.2 只读取真实项目；所有正式文件写回延后到“差异预览 + 作者确认 + checkpoint”能力完成后。

---

## v0.3：厂商协议与校准状态

### Provider

```json
{
  "id": "provider-xxx",
  "name": "我的第三方中转",
  "kind": "relay",
  "type": "openai-compatible",
  "baseUrl": "https://example.com/v1",
  "apiKey": "仅服务端保存"
}
```

`kind` 只用于界面分类；`type` 决定服务端调用适配器：

- `openai-compatible`
- `anthropic-messages`
- `gemini-generate-content`

### CalibrationRun

```json
{
  "id": "calibration-uuid",
  "projectId": "...",
  "chapter": 4,
  "mode": "writer",
  "status": "completed_with_errors",
  "createdAt": "ISO-8601",
  "candidates": [
    {
      "candidateId": "candidate-a",
      "providerId": "...",
      "providerName": "...",
      "requestedModel": "...",
      "actualModel": "...",
      "status": "success",
      "latencyMs": 0,
      "usage": {},
      "result": {}
    }
  ]
}
```

### 校准状态机

`idle → validating → running → completed | completed_with_errors | error`

校准记录只写 `.data/calibrations/`，不改变 Workspace 阶段状态，也不晋升为正式事实。


---

## v0.4：ProjectChapterWorkspace 状态

```json
{
  "version": 1,
  "projectId": "...",
  "chapter": 4,
  "revision": 0,
  "candidate": {
    "status": "empty | editing | saved | generated | confirmed",
    "text": "",
    "title": "",
    "source": "manual | model",
    "contentHash": "sha256",
    "providerId": "",
    "providerName": "",
    "model": "",
    "updatedAt": "ISO-8601"
  },
  "review": {
    "status": "empty | running | ready | stale | error",
    "candidateHash": "sha256",
    "providerId": "",
    "providerName": "",
    "model": "",
    "result": null,
    "updatedAt": "ISO-8601"
  },
  "confirmation": {
    "status": "unconfirmed | confirmed",
    "candidateHash": "sha256",
    "confirmedAt": "ISO-8601"
  }
}
```

### 状态规则

- 候选文本保存后计算 `contentHash`。
- `review.candidateHash !== candidate.contentHash` 时审查为 `stale`。
- `confirmation.candidateHash !== candidate.contentHash` 时确认自动失效。
- 只有 `review.status = ready` 且哈希一致时才能确认候选。
- 所有记录位于 `.data/project-chapters/`，不属于正式事实。

---

## v0.5：WriteBackPlan 状态

```json
{
  "status": "empty | preparing | ready | stale | committing | committed | error",
  "candidateHash": "sha256",
  "reviewHash": "sha256",
  "confirmationHash": "sha256",
  "planHash": "sha256",
  "preparedAt": "ISO-8601",
  "providerId": "",
  "providerName": "",
  "model": "",
  "sync": {
    "chapterTitle": "",
    "chapterSummary": "",
    "characterUpdates": [],
    "foreshadowingUpdates": [],
    "timelineEvent": "",
    "contextUpdate": "",
    "nextChapterTarget": ""
  },
  "files": [
    {
      "relativePath": "正文/第4章 ...md",
      "layer": "canon | tracking | runtime",
      "action": "create | update | append",
      "beforeExists": false,
      "beforeHash": "sha256 或 __missing__",
      "afterHash": "sha256",
      "beforeText": "",
      "afterText": "",
      "summary": ""
    }
  ],
  "commit": {
    "status": "uncommitted | committed",
    "checkpointId": "",
    "committedAt": null,
    "writtenFiles": [],
    "formalWritePerformed": false
  }
}
```

### 哈希关系

- `candidateHash = candidate.contentHash`。
- `reviewHash = sha256(review.result + review.candidateHash)`。
- `confirmationHash = confirmation.candidateHash`。
- `planHash = sha256(candidateHash + reviewHash + sync + files[].relativePath/afterHash)`。
- 提交时逐项比较 `files[].beforeHash` 与磁盘当前 hash。

### 状态迁移

```text
confirmed candidate
  -> empty
  -> preparing
  -> ready
  -> committing
  -> committed

ready -- candidate/review/source changed --> stale
preparing/committing -- failure --> error
error -- retry prepare --> preparing
error -- retry commit (only source unchanged) --> committing
```

### 正式写入事务

1. 校验章节侧车 revision 与全部哈希。
2. 创建 `.data/writeback-checkpoints/{projectId}/{checkpointId}/manifest.json`。
3. 把所有已存在目标文件复制到 checkpoint；不存在目标在 manifest 中记为 `missing`。
4. 为所有 after 文本在目标目录创建临时文件。
5. 依次 rename 临时文件到目标路径。
6. 任一步失败：删除本次新建文件、从 checkpoint 恢复旧文件、保留失败 manifest 供诊断。
7. 全部成功：manifest 标记 committed，并更新章节侧车 `writeBack.commit`。

### 下一章切换

正式提交后，当前章节侧车保留在 `project-chapters/{projectId}-ch00004.json` 作为审计记录；dashboard 从 `progress.current_chapter = 5` 读取下一章，并加载新的 ch00005 空侧车。旧候选不会迁移到下一章。

---

## v0.6：ContractDraft 状态

```json
{
  "status": "empty | saved | stale | committed",
  "title": "第5章 ...",
  "text": "Markdown",
  "contentHash": "sha256",
  "updatedAt": "ISO-8601",
  "providerId": "",
  "providerName": "",
  "model": "",
  "validation": {
    "valid": false,
    "requiredSections": [],
    "missingSections": [],
    "emptySections": []
  },
  "plan": {
    "status": "empty | ready | stale | committed",
    "relativePath": "大纲/章节契约/第005章.md",
    "draftHash": "sha256",
    "beforeHash": "__missing__",
    "afterHash": "sha256",
    "planHash": "sha256",
    "beforeText": "",
    "afterText": "",
    "commit": {
      "checkpointId": "",
      "committedAt": null,
      "formalWritePerformed": false
    }
  }
}
```

### 迁移规则

- 正式契约存在时，服务端以 dashboard 为准返回 `formal` 视图，侧车草稿不获得正式权重。
- 保存草稿重新计算 `contentHash` 与结构校验，并使旧 plan 失效。
- `plan.draftHash !== contentHash` 时 plan 为 `stale`。
- prepare 只接受结构完整、正式目标不存在的草稿。
- commit 必须显式 `confirmFormalWrite = true`，且 before hash 仍为 `__missing__`。
- commit 成功后 dashboard 的正式契约成为 source of truth；侧车仅保留审计记录。


---

## v0.7：GenerationGate 临时状态

```json
{
  "status": "closed | open",
  "acknowledged": false,
  "routeSignature": "providerId:model",
  "chapterRevision": 0,
  "mode": "initial | regenerate"
}
```

### 请求约束

候选生成请求增加：

```json
{
  "expectedRevision": 0,
  "confirmModelSpend": true
}
```

### 规则

- `GenerationGate` 只存在于前端会话，不写入正式项目，也不需要进入章节侧车账本。
- route signature、当前章或章节账本 revision 变化时，前端关闭 gate 并清除确认。
- 服务端在解析模型路由和发出上游请求前校验 `confirmModelSpend === true`。
- 缺失确认返回 HTTP 400 / `MODEL_SPEND_CONFIRMATION_REQUIRED`。
- 通过确认不代表允许正式写回；模型输出仍只更新 candidate。
---

## v0.8：WritingPipeline 状态

`WritingPipeline` 扩展 v0.4 的章节侧车，不改变正式项目事实来源。

```json
{
  "status": "generating | candidate_ready | candidate_blocked | dirty | review_ready",
  "taskPackage": {
    "status": "ready | stale",
    "chapter": 5,
    "formalFacts": [{ "relativePath": "追踪/上下文.md", "contentHash": "sha256" }],
    "previousChapter": { "relativePath": "正文/第4章 ...md", "contentHash": "sha256" },
    "chapterContract": { "relativePath": "大纲/章节契约/第005章.md", "contentHash": "sha256" },
    "packageHash": "sha256",
    "createdAt": "ISO-8601"
  },
  "beats": {
    "contentHash": "sha256",
    "items": [
      {
        "id": "beat-01",
        "order": 1,
        "sceneGoal": "",
        "conflictOrTurn": "",
        "emotionOrPayoff": "",
        "targetWords": 0,
        "contractTargets": []
      }
    ]
  },
  "candidate": {
    "text": "完整候选正文",
    "contentHash": "sha256",
    "source": "model | rewrite | manual",
    "updatedAt": "ISO-8601"
  },
  "qualityGate": {
    "status": "pending | passed | blocked | stale",
    "rulesVersion": "v1",
    "packageHash": "sha256",
    "beatsHash": "sha256",
    "candidateHash": "sha256",
    "checks": [
      { "code": "CONTRACT_TARGET_COVERAGE", "severity": "blocker", "passed": true, "locations": [] }
    ],
    "rewriteTargets": []
  },
  "review": {
    "status": "empty | running | ready | stale | error",
    "candidateHash": "sha256",
    "findings": []
  }
}
```

### 确定性门禁

门禁不调用模型，至少包含：

- 任务包三类输入齐全且 source hash 未变化。
- 节拍字段完整、顺序唯一、目标字数合计在章节区间内。
- 章节契约每个必达项至少映射到一个节拍，禁写项无命中。
- 候选正文非空、字数在允许区间、章末钩子存在。
- `packageHash + beatsHash + candidateHash + rulesVersion` 与本次报告完全一致。

### 状态迁移

```text
ready task package -- generate --> generating
generating -- gate passed --> candidate_ready
generating -- gate blocked --> candidate_blocked
candidate_blocked -- targeted rewrite --> generating
candidate_ready -- manual edit --> dirty
review_ready -- manual edit --> dirty
dirty -- save + gate passed --> candidate_ready
dirty -- save + gate blocked --> candidate_blocked
candidate_ready -- matching review completed --> review_ready
```

### 失效与分层规则

- 任一正式输入 hash 变化：`taskPackage.status = stale`，旧门禁和旧审查失效；不得用旧任务包继续生成或重写。
- 节拍或候选变化：`qualityGate.status = stale`、`review.status = stale`，页面进入 `dirty`。
- `candidate_blocked` 只能定向重写或手改，不能进入 review；`review_ready` 必须绑定当前 `candidate.contentHash`。
- 初次生成与重写都原子保存“完整节拍 + 完整候选”；结构解析失败不覆盖上一版本。
- `taskPackage`、`beats`、`candidate` 属于侧车候选；`qualityGate` 与 `review.findings` 属于诊断；三者都不得写入 `正文/`。
- token、usage 与费用仍可记录在 run 元数据，但不参与 `WritingPipeline.status` 判定。

---

## v0.9：WorkspaceMode 与开书阶段状态

```json
{
  "workspaceMode": "origin | continuation",
  "origin": {
    "currentStage": "idea | logic | blueprint | draft | review",
    "currentChapter": { "number": 1, "title": "第一章" }
  },
  "continuation": {
    "projectId": "local-project-id",
    "chapter": 4
  }
}
```

### 规则

- 应用首次加载默认 `workspaceMode = origin`，即使发现本地正式项目也不得自动进入 `continuation`。
- `origin` 的 source of truth 为 `.data/workspace.json`；初始 `currentStage = idea`、`currentChapter.number = 1`。
- `continuation` 只有在作者从作品切换器显式选择本地项目后才建立，并加载项目 dashboard 与章节侧车。
- 返回 `origin` 时清除前端当前 `projectDashboard` 引用，但不删除 continuation 侧车数据。
- Origin 阶段状态沿用 `empty → editing → generating → suggested → ready`；上游修改继续将下游标记为 `stale`。

### 关键迁移

```text
app hydrate -> origin/today
origin/today -> origin/idea                 [开始打磨 Idea]
origin/idea -> origin/logic                 [Idea 已确认]
origin/blueprint -> origin/draft chapter 1  [蓝图已确认]
origin/* -> continuation/today              [显式选择“续写已有正文”]
continuation/* -> origin/today              [选择“开书重建”]
```

### 不变量

- 自动发现项目 ≠ 自动切换模式。
- 开书流程的当前章永远从第 1 章开始，除非作者在该 Workspace 内完成并推进章节。
- 模式切换不改变正式事实、候选稿、审查 Finding 或 checkpoint。

---

## v1.0：IdeaIteration 状态模型

```json
{
  "stages": {
    "idea": {
      "status": "editing | generating | suggested | error | ready | stale",
      "input": "作者原始灵感",
      "suggestion": {},
      "refinementFeedback": "本轮作者反馈",
      "iterations": [
        {
          "id": "idea-v2-uuid",
          "version": 2,
          "source": "model | author-edit | restored",
          "suggestion": {},
          "feedback": "产生该版本所依据的反馈",
          "provider": "provider id",
          "model": "model id",
          "createdAt": "ISO-8601"
        }
      ],
      "confirmed": null,
      "confirmedAt": null
    }
  }
}
```

### 迁移

```text
editing -- generate initial --> generating
suggested -- submit feedback --> generating
error -- retry feedback --> generating
generating -- complete --> suggested + append iteration
generating -- fail --> error + preserve suggestion/feedback/history
suggested -- manual edit --> suggested + dirty current suggestion
suggested/error -- restore version --> suggested + copy selected suggestion
suggested -- explicit confirm --> ready + confirmed=current suggestion
ready -- edit upstream --> suggested/stale downstream
```

### 不变量

- `suggestion` 永远是当前可编辑工作稿；`iterations` 是不可变快照历史。
- 生成下一版前，若当前稿与最后一个历史快照不同，必须先追加 `author-edit` 快照。
- 新模型结果必须以完整对象替换当前稿，同时追加新快照；不得只保存 diff。
- 恢复旧版不删除历史，确认也不删除历史。
- `confirmed` 只能来自作者明确确认时的当前稿，模型响应不能直接写入。
- Idea 未确认前，logic/blueprint/draft/review 不得因模型生成而自动解锁。
