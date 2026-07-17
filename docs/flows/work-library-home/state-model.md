# 作品主界面状态模型

## 对象

- `WorkspaceRecord`：一份独立的新书创作 Workspace。
- `WorkspaceSummary`：作品主界面使用的安全摘要。
- `ActiveWorkspacePointer`：当前创作 Workspace 指针。
- `FormalProjectSummary`：磁盘中已有正文项目的只读摘要。
- `NewWorkspaceDraft`：尚未提交的新建作品表单。

## 状态枚举

| 状态 | 含义 | 可进入动作 | 可退出动作 |
|---|---|---|---|
| library_loading | 正在读取作品库 | 等待 | library_ready / library_error |
| library_ready | 作品主界面可用 | 新建、打开作品 | creating / opening |
| library_error | 作品库不可用 | 重试 | library_loading |
| creating | 正在填写新作品 | 编辑、取消、提交 | library_ready / opening / create_error |
| create_error | 创建失败且表单保留 | 修正、重试、取消 | creating / library_ready |
| opening | 正在切换当前作品 | 等待 | workspace_ready / library_error |
| workspace_ready | 已进入具体作品 | 编辑、保存、返回主页 | library_ready |

## 账本映射

| 状态 | 来源文件 | 写入文件 |
|---|---|---|
| WorkspaceRecord | 新建表单或历史迁移 | `.data/workspaces/<id>.json` |
| WorkspaceSummary | WorkspaceRecord 派生 | 不单独持久化 |
| ActiveWorkspacePointer | 用户打开/新建作品 | `.data/workspace-active.json` |
| 当前 Workspace 兼容镜像 | 当前 WorkspaceRecord | `.data/workspace.json` |
| FormalProjectSummary | 小说库只读扫描 | 不写入 |

## WorkspaceRecord

```json
{
  "version": 1,
  "id": "uuid",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "workspace": {
    "revision": 0,
    "project": {
      "title": "",
      "genre": "",
      "audience": "",
      "tone": ""
    },
    "currentStage": "idea",
    "stages": {
      "idea": {
        "status": "editing",
        "input": "",
        "draw": {
          "mode": "random",
          "constraints": ""
        }
      }
    }
  }
}
```

## WorkspaceSummary

```json
{
  "id": "uuid",
  "title": "未命名作品",
  "genre": "",
  "currentStage": "idea",
  "readyStages": 0,
  "updatedAt": "ISO-8601",
  "active": true
}
```

## UI 显示

| 状态 | 标识 | 文案 | 主动作 |
|---|---|---|---|
| library_loading | 蓝色进度 | 正在读取作品 | 等待 |
| library_ready / empty | 中性灰 | 还没有创作中的作品 | 新建作品 |
| library_ready / has_items | 正常 | 选择继续，或从零开始 | 新建作品 |
| creating | 墨色 | 建立新作品的最小上下文 | 创建作品并进入抽卡 |
| create_error | 红色 | 创建失败，填写内容仍保留 | 重试 |
| opening | 蓝色进度 | 正在打开作品 | 等待 |
| workspace_ready | 按阶段状态 | 当前作品工作台 | 当前阶段唯一主动作 |

## 迁移规则

1. 若 `.data/workspace-active.json` 已存在，按指针读取当前 Workspace。
2. 若作品库目录已有记录但指针缺失，选最近更新的一条恢复指针。
3. 若只有历史 `.data/workspace.json`，使用固定迁移 ID 写入作品库，避免中断重试产生重复作品。
4. 迁移只复制并规范化数据，不删除历史兼容文件。
5. 此后每次保存当前 Workspace，同时更新独立记录和兼容镜像。

