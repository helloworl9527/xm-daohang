# 实施报告

- 项目：收藏系统
- 最终计划：`implementation-plan.md` revision 5
- 实施日期：2026-08-08 至 2026-08-09（Asia/Shanghai）
- 实施状态：T01–T25 已实现；全部非 Docker 门禁已通过。真实 Docker 构建、compose/restore drill 与 `docker images` SIZE 因本机没有 Docker CLI/daemon 未执行，见“环境阻塞”。
- 发布状态：未部署、未推送、未打 Tag、未创建 Release、未操作生产数据。

## 实现范围

- T01–T04：Next.js/TypeScript 基线、结构化日志脱敏、SSR F/URL 规范化、PostgreSQL/Drizzle schema、pgvector 精确余弦检索与向量元数据约束。
- T05–T08：Argon2id、会话双过期、登录 HMAC/限流、管理守卫、AES-256-GCM 设置、模型探测与版本化向量重建。
- T09–T13：受控网页/文本/PDF/GitHub 提取、中文受约束总结、embedding、pg-boss/outbox、重试/代际幂等、手动及定时重抓、GitHub 持久 backoff。
- T14–T16：管理端添加、收藏库筛选、详情编辑/删除/重抓，统一 session/Origin/CSRF/严格 JSON Content-Type/Zod/no-store 管线。
- T17–T19：语义检索 Top10、每日三条持久轮换、可信代理 IP、公开双层限流/问答、业务日时区、中英文界面。
- T20–T21：Telegram 白名单添加/提问、long polling、持久完成回执 dispatcher 与 at-least-once 指标。
- T22–T25：结构化业务埋点、公开端完整状态与固定提问框、统一管理设置、四服务编排、健康检查、worker 心跳/优雅停机、保留清理、管理员初始化/恢复、备份/恢复演练与中文 README。

## 变更组件

- 应用：`src/app/` 公开端、管理端、管理 API、`/ask`、`/api/health/live`、`/api/health/ready`。
- 服务：`src/lib/` 下的认证、配置、抓取、AI、检索、限流、i18n、队列和日志模块。
- Worker：`src/worker/index.ts` 通过 Next instrumentation 在 worker target 启动；注册 pg-boss 处理/定时/maintenance，轮询 processing 与 TG receipt outbox，并处理 SIGTERM/SIGINT。
- 数据：`src/db/schema.ts`、三条迁移、pgvector 精确扫描和保留策略。
- 运维：`Dockerfile`、`docker-compose.yml`、`Caddyfile`、`.env.example`、`scripts/`、`docs/deployment.md`、`README.md`。
- 测试：41 个 Vitest 文件和 7 个 Playwright spec，覆盖单元、真实 PostgreSQL 16+pgvector 集成、生产 standalone 桌面/移动流程。

## 迁移

1. `0000_initial.sql`：首句启用 pgvector 后建立全部 v1 表、约束与基础索引。
2. `0001_exact_vector_scan.sql`：`items_retrievable_idx` 与 `ANALYZE`，不建立 ANN 索引。
3. `0002_embedding_constraints.sql`：补齐 embedding 元数据非空与 `vector_dims(embedding)=embedding_dim` 约束。

本机 PostgreSQL 16 + pgvector 上 `drizzle-kit migrate` 与生产 `drizzle-orm` migrator 均幂等通过。未执行破坏性 down migration；回滚策略仍为备份后使用 schema 兼容的旧镜像和前向修复迁移。

## 验证证据

| 门禁 | 新鲜结果 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | PASS，锁文件无变化，256ms |
| `corepack pnpm audit --prod` | PASS，`No known vulnerabilities found` |
| `DATABASE_URL=... corepack pnpm db:migrate` | PASS，3 条迁移已应用/幂等 |
| `DATABASE_URL=... corepack pnpm db:migrate:prod` | PASS，生产 drizzle-orm migrator 幂等 |
| `corepack pnpm test`（真实 PG16+pgvector） | PASS，42 files / 255 tests，0 failed，23.35s |
| T25 定向 `deploy-smoke` | PASS，7/7；含全根 devDependency 正向/反向门禁、真实 pg-boss heartbeat + graceful stop |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，0 errors |
| 独立 `corepack pnpm build` | PASS，Next.js 15.5.23 standalone，22 个 route，编译/类型/静态生成完成；构建末尾 prune 后 15/15 根 devDependencies 均不存在 |
| `env -u DATABASE_URL corepack pnpm build`（PA-01） | PASS，数据库模块加载不再读取连接配置；首次实际 `query/connect` 才严格校验；Docker builder 另注入非生产占位 URL |
| `env -u APP_TIMEZONE ... vitest retention/deploy-smoke`（OBS-A） | PASS，2 files / 9 tests；用例自行设置并恢复 `Asia/Shanghai`，不依赖 ambient 时区 |
| `corepack pnpm e2e` | PASS，22/22；Chromium desktop 11、mobile 11；生产 standalone server |
| `sh -n scripts/backup.sh scripts/restore-smoke.sh` | PASS |
| README 命令/路径/链接静态核验 | PASS：manifest 脚本、相对链接、目录、环境变量名与 compose target 均存在；部署命令仅核验定义，未执行外部状态操作 |

生产进程的 30 次本机回环样本：公开首页 P95 `16.98ms`（门禁 `<1.5s`），添加即时回执 P95 `13.85ms`（门禁 `<1s`）。本轮 pgvector 100/500/1000 行 fixture 的 recall@10 均为 `1.0`，P95 分别为 `0.445/0.349/0.499ms`（门禁 `<2s`），执行计划为带 completed/version/dim/non-null 过滤的精确 `Seq Scan + Sort`。第三方 LLM/站点耗时未用真实供应商 Key 测量，按计划属于外部观测目标；测试使用注入 adapter 验证零调用、重试和失败关闭。

UI 证据：T23/T24 桌面 1440 与移动 390 截图位于 `.workflow/screenshots/`；Playwright 另覆盖 320px、固定提问框几何、键盘/aria-live、无横向溢出、控制台零错误、reduced-motion、reduced-transparency 与 prefers-contrast。

## 镜像体积

### 无 daemon 实测

- 独立 `next build` 完成并执行生产 prune 后，`du -sh .next/standalone` 为 `52M`，其中 standalone `node_modules` 为 `46M`；静态资源另为 `1.0M`，Dockerfile 会复制到同一最终文件系统。Playwright 启动脚本会把静态资源复制进 standalone，故 E2E 后再次查看目录为 `53M`，镜像估算按两者合计计算，不重复计入。
- 临时目录执行 `pnpm install --prod --ignore-scripts --frozen-lockfile --offline` 后 `du -sh node_modules`：`514M`（526,092 KiB），devDependencies 明确 skipped。最终镜像没有复制这棵完整依赖树，只复制 standalone tracing 产物及生产迁移需要的 `drizzle-orm`（约 `16M`），因此不会把 514M 全量带入镜像。
- 基础镜像：`node:22.22.0-bookworm-slim`，Docker Hub 官方 tag API 对本机目标 `linux/arm64` 报 `79,443,440` bytes（75.8MiB）压缩大小，manifest digest `sha256:5e22e6fb4448236070fdb260662e49fd58779876855baf95388534475c3dcd11`。从官方 registry 按该 manifest 流式解压五个 layer 得 `251,815,936` bytes（240.2MiB）。来源：`https://hub.docker.com/v2/repositories/library/node/tags/22.22.0-bookworm-slim` 与 `https://registry-1.docker.io/v2/library/node/manifests/<digest>`。同一 tag 的官方 `linux/amd64` 压缩大小为 `79,425,362` bytes。

### 估算方法与区间

`docker images` 展示的本地虚拟大小可按基础层解压 240.2MiB + standalone/静态约 53M + 单独复制的 drizzle-orm 约 16M + 迁移/脚本/用户与元数据少量开销估算。app 与 worker target 共享相同文件系统，worker 只增加 ENV/CMD 元数据，因此二者估算均约为 **300–325MiB**。这是基于官方 layer 与本地产物的估算区间，不是真实 `docker images` 输出。

完整 `--prod` 依赖树偏大主要来自 Next/SWC 平台包、pdfjs-dist 和可选原生包；当前 standalone tracing 已是主要瘦身措施。后续可评估按 app/worker 分离 trace、只保留目标架构二进制、将迁移器做成更小的一次性 target，但不得在无回归/restore drill 证据时删除 PDF 或运行依赖。

### 环境阻塞与复现命令

本机没有 Docker CLI/daemon（`docker: command not found`），所以未执行镜像构建、`docker images` SIZE、`docker compose config/up`、Caddy 实际加载和 backup→restore 容器演练。不得把估算冒充真实值。有 Docker 的主机在准备好 `.env` 与权限为 `0600` 的 `restore-admin-password.secret` 后，应从项目根目录一次执行以下复验：

```bash
set -eu
docker build --target app -t collection-system-app:local .
docker build --target worker -t collection-system-worker:local .
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' collection-system-app:local
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' collection-system-worker:local
docker compose config
docker compose up -d --build --wait
docker compose ps
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)})"
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)})"
docker compose exec -T worker node --experimental-strip-types scripts/check-worker-health.ts
docker compose exec -T postgres sh -eu -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
backup=$(scripts/backup.sh ./backups | tail -n 1)
scripts/restore-smoke.sh "$backup" ./restore-admin-password.secret
```

## 已批准偏差与实现级选择

- **DEV-001（已批准）**：把 `CREATE EXTENSION IF NOT EXISTS vector` 前移为初始迁移第一条语句，确保建 `embedding vector` 列前类型已存在。影响仅迁移顺序，不改变列、数据模型、索引类型或检索语义。
- **DEV-002（已批准）**：可信客户端 IP 使用 Caddy 剥离客户端头后注入 `X-Real-Client-IP` + `X-Proxy-Auth` 共享密钥。应用只有在常量时间校验 `PROXY_SHARED_SECRET` 后才信任单值 IP；无/错密钥时 403、零计数、零模型调用。替代 socket peer CIDR 校验，等价满足防伪造属性。多副本/更换反代时必须同步密钥和剥离规则。
- 实现级选择：Next standalone 通过 `src/instrumentation.ts` 在 `WORKER_MODE=1` 时装载 worker；运维 TS 脚本使用 Node 22 type stripping；生产迁移使用已有 drizzle-orm migrator，不把 drizzle-kit/devDependencies 复制进最终镜像。该选择不改变产品行为或数据边界。
- **R13（最终验收返工，已修复）**：修复前 standalone tracing 从 builder 误带根 devDependency `typescript`（约 9.1M），原报告关于生产产物纯净的断言不准确。现由 `scripts/verify-production-artifact.mjs` 在构建末尾删除全部根 devDependency 的顶层入口和 pnpm store 实体，并在 builder 产物及最终 app/worker 文件系统分别 fail-closed 校验 15/15 项；反向 fixture 重新放入 `typescript` 时稳定报 `DEV_DEPENDENCIES_PRESENT:typescript`。最终镜像还设置 `pnpm_config_verify_deps_before_run=false`，防止运维脚本启动时 pnpm 因依赖同步检查自动安装完整依赖；迁移和改密脚本在模拟最终文件系统内均已直接运行通过，运行前后门禁均保持通过。
- **PA-01（实施后审计 High，已修复）**：此前各次本机构建均带有 ambient `DATABASE_URL`，不能证明无构建期数据库配置的 Docker builder 可用；原 `src/db/client.ts` 又在模块导入时急抛错，故原报告的 build PASS 对文档化镜像路径证据不足。现数据库客户端改为首次实际 `query/connect` 时才创建连接池并严格校验 `DATABASE_URL`，模块加载不连接数据库；Docker builder 同时注入只存在于构建阶段的 localhost 占位 URL 作为防御纵深。已显式移除 `DATABASE_URL` 实跑完整 `pnpm build` 并通过，首次无配置查询仍稳定拒绝。
- **PA-02（报告准确性，已修复）**：本报告已明确区分修复前 ambient `DATABASE_URL` 掩盖的问题、修复后的无变量构建证据，以及仍未在本机执行的真实 Docker 证据，不再用前者推断后者。
- **OBS-A（已落实）**：`retention` 与 `deploy-smoke` 集成测试在生命周期内自行设置并恢复 `APP_TIMEZONE=Asia/Shanghai`；显式移除 ambient 时区后 9/9 通过。

## 残余风险与观察项

- **AR-001（用户已接受）**：Telegram sendMessage 保持 at-least-once。发送成功后、outbox 标记前崩溃可能重复一条回执；`tg_receipt{duplicate_possible}` 指标已保留，dispatcher 使用 lease/幂等键并支持崩溃恢复，但 Telegram Bot API 不提供端到端幂等保证。
- **OBS-01**：`GITHUB_PUBLIC_API_TOKEN` 只提升公开 GitHub API 配额。代码仍要求仓库元信息 `private=false`，不会解锁/抓取私有仓库；README、`.env.example` 与部署手册已明确。
- Docker 环境阻塞：真实镜像大小、compose 拓扑、Caddyfile 语法加载、容器健康检查和完整 restore drill 尚需有 Docker 的独立验收环境执行。静态合同测试和非 Docker 脚本测试已通过，但不能替代真实容器证据。
- Node 22 的 type stripping 当前会输出 experimental warning；脚本功能与事务边界已测试，升级 Node 大版本前需复跑 init/reset/migrate/restore。

## README 核验

README 按“项目名称、一句话描述、简介、快速开始、功能特性、技术栈、项目结构、开发指南、部署、许可证”顺序编写。仓库无 remote，故未猜测 clone URL；仓库无 `LICENSE`，已明确标注目前无法确认。README 未记录真密钥，只列环境变量及用途；`cp .env.example .env`、pnpm scripts、health 路径、内部文档链接和目录均已核验存在。Docker/部署/恢复命令只核验定义与参数，未在无授权/无 Docker 环境中执行。
