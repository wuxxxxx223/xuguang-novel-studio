# Novel Studio 生产部署 Runbook

## 1. 适用边界

当前版本按**单用户、单实例、文件存储**部署。服务能够保存模型 API Key，并在作者双重确认后写入正式小说文件，因此：

- 不允许将应用端口直接发布到公网或不受信任 LAN。
- 跨主机访问必须经过 TLS、身份认证和访问限制。
- 不允许同时运行两个指向同一数据目录或小说库的实例。
- `.data` 与小说库必须作为同一恢复点备份。

## 2. 主机前置条件

- Linux x86_64/arm64，Docker Engine 与 Docker Compose v2。
- 至少 2 CPU、2 GiB 内存；磁盘容量按小说库与运行记录增长另行规划。
- 专用非 root 运维账号。
- 两个绝对路径：
  - 应用数据：建议 `/srv/xuguang-novel-studio/data`
  - 小说库：建议 `/srv/xuguang-novel-studio/library`
- 小说库目录对容器内 UID 1000 可读写；数据目录权限为 `0700`。

生产镜像使用 Node 24；本地直接运行允许 Node 22.12 到 24.x。

## 3. 首次部署

```bash
cd novel-studio-next
cp .env.production.example .env.production
$EDITOR .env.production

./deploy/preflight.sh .env.production
docker compose --env-file .env.production -f compose.production.yml build --pull
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml ps
node deploy/smoke.mjs
```

默认只可通过 `http://127.0.0.1:8790` 访问。需要远程访问时，以 `deploy/nginx.conf.example` 为模板配置 TLS 和 Basic Auth/企业统一认证，并将：

```dotenv
NOVEL_STUDIO_TRUST_PROXY=loopback
NOVEL_STUDIO_TRUSTED_ORIGINS=https://novel.example.com
```

写入 `.env.production` 后重建容器。反向代理认证文件、TLS 私钥和环境文件不得提交 Git。

## 4. 上线门禁

每次发布必须通过：

```bash
npm ci
npm run release:verify
NOVEL_STUDIO_DATA_DIR=/srv/xuguang-novel-studio/data npm run audit:checkpoints
```

checkpoint 审计不是自动修复工具。若发现 `prepared`、`files_applied`、
`rollback_failed` 或损坏 manifest，保持应用停止，不要删除 checkpoint；
先对照其 `manifest.json`、快照和正式文件判断应完成侧车收口还是从同一恢复点回滚。

当前机器未安装 Docker 时，只能完成源码与脚本校验，不能宣称镜像已验证。正式主机必须额外执行：

```bash
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml build --pull
docker run --rm --entrypoint node "$NOVEL_STUDIO_IMAGE" --version
```

## 5. 健康检查

- `GET /api/health/live`：进程存活。
- `GET /api/health/ready`：数据目录、小说库、设置、工作区和构建产物可用，且进程未排空。
- `GET /api/health`：兼容聚合入口。

容器只使用 readiness 作为健康检查。模型供应商故障不会让整个应用失去 readiness；具体模型任务应在 Run Ledger 中失败。

## 6. 日志

生产日志输出到 stdout/stderr，格式为单行 JSON。默认 Docker 日志轮转：

- 单文件 10 MiB。
- 最多 5 个文件。

日志只包含请求 ID、方法、路径、状态码、耗时和运行事件；不要在代理层记录请求体、Authorization、Cookie、模型输入或正文。

常用命令：

```bash
docker compose --env-file .env.production -f compose.production.yml logs --since=30m app
docker compose --env-file .env.production -f compose.production.yml logs -f --tail=200 app
```

## 7. 一致性备份

当前文件存储没有在线快照协调协议，生产备份采用冷备：

```bash
docker compose --env-file .env.production -f compose.production.yml stop app
test ! -e /srv/xuguang-novel-studio/data/.novel-studio.instance.lock

NOVEL_STUDIO_OFFLINE_BACKUP_CONFIRMED=yes \
  ./deploy/backup.sh \
  /srv/xuguang-novel-studio/data \
  /srv/xuguang-novel-studio/library \
  /srv/xuguang-novel-studio/backups

docker compose --env-file .env.production -f compose.production.yml start app
node deploy/smoke.mjs
```

备份包含明文模型 API Key，必须使用受控密钥加密后复制到另一台主机或不可变对象存储。建议：

- 每次发布和批量正式写回前即时备份。
- 每日加密离机备份，保留 30 天。
- 每周保留 12 周。
- 每月至少一次隔离恢复演练。

## 8. 恢复

恢复永远先落入新目录：

```bash
NOVEL_STUDIO_OFFLINE_RESTORE_CONFIRMED=yes \
  ./deploy/restore.sh \
  /srv/xuguang-novel-studio/backups/novel-studio-YYYYMMDDTHHMMSSZ \
  /srv/xuguang-novel-studio/restore-data \
  /srv/xuguang-novel-studio/restore-library
```

然后修改一份临时环境文件指向恢复目录，启动、检查 readiness、执行 smoke，并人工抽查最近章节、章节契约与追踪账本。验证通过后再切换正式挂载；保留旧目录直到观察期结束。

## 9. 升级

1. 固定 Git commit 和镜像标签。
2. 运行全部门禁测试。
3. 停止应用并完成一致性备份。
4. 构建新标签，不覆盖旧标签。
5. 启动新版本并等待 readiness。
6. 执行 smoke 和一条无正式写回的工作流检查。
7. 记录 commit、镜像 ID、部署时间和备份目录。

```bash
docker image inspect "$NOVEL_STUDIO_IMAGE" --format '{{.Id}}'
```

## 10. 回滚

若新版本尚未写入数据：停止新镜像，恢复上一镜像标签并启动。

若新版本已经执行正式写回或改变 `.data`：只回滚代码不安全。停止应用，将与旧版本匹配的 `.data + 小说库` 备份成对恢复到新目录，再用旧镜像验证后切换。

## 11. 停机

Compose 发送 SIGTERM 后，应用立即让 readiness 返回 503、停止接收新连接、
关闭空闲连接，并在默认 30 秒内等待存量请求和 Benchmark 后台任务收口；
完成后才释放单实例锁。Compose 宽限期为 40 秒。超时会强制断开并以失败状态退出。

## 12. 已知架构限制

- 文件存储只支持单实例。
- 尚无数据库级事务或跨进程文件锁。
- 正式多文件写回使用 checkpoint 和进程内回滚，但主机断电/`kill -9` 后仍需要检查未终态 checkpoint。
- 尚未提供内置 Prometheus 指标；现阶段至少监控容器健康、重启次数、5xx、磁盘/inode、备份新鲜度和未终态 checkpoint。

这些限制意味着生产环境应保持单用户、低并发、可冷备；在实现持久事务恢复与项目级锁之前，不应扩展为多实例或多租户 SaaS。
