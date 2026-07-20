# 协作开发

## 环境要求

- Windows 10/11（默认开发平台）或受支持的 Linux 环境
- Node.js `22.12` 或更高版本，且低于 `25`
- npm `10` 或更高版本
- Git

## 本地启动

Windows 推荐：

```powershell
git clone <repository-url>
Set-Location xuguang-novel-studio
.\setup-windows.cmd
.\dev-xuguang.cmd
```

Windows 启动器使用 `%LOCALAPPDATA%\XuguangNovelStudio` 和用户文档目录，不与 WSL 共用运行数据。

通用 npm 方式：

```bash
git clone <repository-url>
cd xuguang-novel-studio
npm ci
npm run dev
```

开发界面：`http://127.0.0.1:5178/`

开发 API：`http://127.0.0.1:8790/`

## 数据边界

- `.data/` 保存本地 Workspace、模型配置、运行记录和 checkpoint，禁止提交。
- API Key 只能放在本地 `.data/settings.json`，禁止写入源码、测试夹具和日志。
- 小说库通过 `NOVEL_STUDIO_LIBRARY_ROOT` 指向本地目录，仓库不携带作者正文。
- 自动化测试必须使用临时目录或隔离的 smoke 数据目录，不得操作真实小说库。

代码仓库负责同步产品代码；作者内容和生产数据应使用独立、加密的备份与迁移流程。

## 分支与提交

从最新 `main` 创建短生命周期分支：

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description
```

提交信息使用明确前缀：

- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 不改变行为的重构
- `test:` 测试
- `docs:` 文档
- `chore:` 工程维护

一个提交只处理一个主题。不要把格式化、依赖升级和业务功能混在同一提交中。

## 合并前检查

```bash
npm ci
npm run check
npm run test:all
```

涉及部署、存储、写回或安全边界时，再执行：

```bash
npm run release:verify
```

Windows 本地无法直接验证 Linux shell 语法时，`npm run check:deployment` 会完成 Node 部署脚本检查，并由 GitHub Actions 的 Ubuntu 任务验证 `deploy/*.sh`。

通过 Pull Request 合并到 `main`。PR 需要说明：

1. 修改了什么；
2. 为什么这样修改；
3. 如何验证；
4. 是否影响 `.data/`、小说库、模型调用费用或正式写回。
