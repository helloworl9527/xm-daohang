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

---

# 导航站增强（M2）实施记录

- 最终计划：`implementation-plan-nav-enhancement.md` revision 11
- 实施日期：2026-08-11（Asia/Shanghai）
- 当前状态：实施中；本节按任务批次追加，不覆盖上方 M1 历史。
- 发布状态：未部署、未推送、未打 Tag、未操作生产数据。

## M2 Task 1：迁移、schema 与升级证据

### 实现范围

- 新增 `categories`、`category_change_runs`、`category_reclassify_failures`、`category_run_retry_requests` 四张表。
- `items` 新增 nullable `category_id` 与默认 false 的 `category_manual`；外键删除行为为 `ON DELETE SET NULL`，并新增分类索引。
- `app_settings` 新增 `categories_initialized=false`、`category_version=0` 与非负版本约束。
- Drizzle 从 0002 snapshot 生成 `0003_categories.sql`、`meta/0003_snapshot.json` 并更新 journal；人工核对迁移仅含 additive DDL，0000～0002 未改写。
- Vitest 新增计划约定的 `tests/categories/**` 收集范围。

### 迁移与回滚

- 0003 包含分类规范名唯一索引 `lower(btrim(name))`、空白名/排序/模式/状态/version/generation/attempt/count checks、run request key 唯一约束及 retry `(run_id,generation)` 唯一约束。
- 升级测试先用 0000～0002 建立 M1 数据库，写入 completed web 向量与 failed doc fixture，再由 migrator 应用 0003；旧行与向量保留，并逐一反测 `items_type_check`、`items_status_check`、`items_completed_tags_check`、`items_embedding_metadata_check`、`items_embedding_dimension_check` 的稳定 constraint 名。
- 第二次运行完整 migrator 不新增 migration 记录，证明迁移工具幂等。
- 生产执行步骤仍须先 `pg_dump`；普通回滚采用旧应用代码兼容新增列/表的前向兼容策略，不 drop taxonomy 数据。本批未连接或修改生产数据库。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test APP_TIMEZONE=Asia/Shanghai corepack pnpm vitest run tests/categories/schema.test.ts tests/integration/migration-nav.test.ts` | PASS，2 files / 7 tests |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，0 errors；审批原型有 1 条既有 unused warning |
| `git diff --check` | PASS |
| 0003 destructive DDL 静态扫描 | PASS，无 `DROP TABLE`、`DROP COLUMN`、`ALTER COLUMN`、`DROP CONSTRAINT` |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test` | 263/265 PASS；2 项非本批失败，见下 |

完整回归的两个失败均未落在 Task 1 变更面：`deploy-smoke` 因当前工作区尚无构建后的 `.next/standalone/node_modules` 报 `PRODUCTION_NODE_MODULES_MISSING`；`settingsRoutes` 旧 fixture 断言固定业务日 `2026-08-09`，实际当前业务日为 `2026-08-11`。新增分类 schema 与 M1→M2 升级测试全部通过，且分别中和上述任一旧约束时对应升级测试失败。这两项将在后续完整 build/Task 13 回归门禁前关闭并重跑，不据此宣称完整回归已通过。

### 偏差、未解决项与残余风险

- 无需求、架构、安全边界或已接受风险偏差。
- 未执行生产 `pg_dump`、生产迁移或真实生产 readiness；这些属于发布阶段操作，当前无授权且计划尚未完成。
- 当前工作树原有 M2 审批产物和 workflow 修改均被保留；Task 1 未整理或覆盖它们。

## M2 Task 2：事务可组合的分类 store

### 实现范围

- 新增 `src/lib/categories/store.ts`，定义稳定 `CategoryError`、显式 `CategoryQueryable`、分类名称 NFKC/trim/长度/控制字符校验与 PostgreSQL 唯一冲突映射。
- `createCategoryRecord`、`renameCategoryRecord`、`lockCategoryState`、`advanceCategoryVersion` 均只使用调用者传入的 queryable，供后续 Task 6 在同一 apply transaction 中复用。
- 公共 create/rename/delete 使用短事务并锁 `app_settings(id=1)`；create 原子置 `categories_initialized=true`，所有成功 taxonomy 写只递增一次 `category_version`，删空不回退 initialized。
- slug 固定为应用生成 UUID 的 `cat-<uuid-without-dashes>`；list 按 sort/name/id 确定性排序。
- 显式 CRUD delete 返回全部关联条目的 auto/manual 影响数，依赖 FK SET NULL 且不修改 `category_manual`。
- overview 明确拆分：目录 eligible 的 classified/unclassified/total、全库 manual item 数、completed doc 数，以及各正式分类下全量 auto/manual 关联数。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm vitest run tests/categories/store.test.ts` | PASS，1 file / 20 tests |
| Task 1+2 联合定向测试 | PASS，3 files / 27 tests |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error/0 warning；审批原型保留 1 条既有 warning |
| `git diff --check` | PASS |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test` | 283/285 PASS；2 项非本批失败，见下 |

覆盖证据包括：全角字符 NFKC、稳定 slug、排序、非法名称、并发规范名冲突、not-found/version 不变、FK SET NULL 保留 manual true/false、删空仍 initialized、overview 口径。`lockCategoryState`、`advanceCategoryVersion`、`createCategoryRecord`、`renameCategoryRecord`、`listCategories`、`createCategory`、`renameCategory`、`deleteCategory`、`getCategoryOverview` 均有独立调用者 transaction 测试，按实际使用的方法 spy 全局 `db.transaction/insert/execute/update/delete/select` 并断言零调用；所有写路径在调用者回滚后进一步断言分类、settings 初始化/version、item 分类/manual 均未持久变化。真实双事务探针把第二个 writer 的 `lock_timeout` 固定为 100ms，确认第一个调用者 transaction 释放前稳定得到 PostgreSQL `55P03`，释放后可重新取得锁。

在由当前基准与未提交测试补丁构成的隔离 worktree 中，逐项把上述九个 API 改为忽略传入 queryable、回落全局 `db`，对应九条命名测试均为 1 failed / 19 skipped、进程 exit 1；失败分别命中全局 `insert/update/select/transaction/execute` spy。另仅把 `lockCategoryState` 的 `FOR UPDATE` 查询改为全局 `db.execute`，行锁命名用例因期望 `55P03`、实际无锁超时而 exit 1。首次反证尝试因 pnpm 对 symlink worktree 的依赖目录校验提前退出，已明确作废；以上有效结果改为直接调用仓库已安装的 Vitest 二进制取得，均确认存在 Vitest assertion failure，不把工具启动错误计作门禁证据。

### 偏差、未解决项与残余风险

- 无计划语义偏差；AI apply 尚未接入这些内部 helper，按依赖顺序留待 Task 6。
- 完整回归为 43/45 files、283/285 tests；失败仍只有 `deploy-smoke` 缺 `.next/standalone/node_modules` 的 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 旧 fixture 固定断言 `2026-08-09`、当前业务日为 `2026-08-11` 导致 usedGlobal/day 不匹配。两项均与 Task 2 变更面无关，本批不扩大处理范围，也不据此宣称完整回归通过。

## M2 Task 3：F203 单条分类器

### 实现范围

- 新增纯模块 `src/lib/categories/classify.ts`，默认复用现有 `generateLlmText`，并保留 generator/logger 依赖注入以验证所有模型与日志边界。
- 输入只包含 title/summary/tags 与服务端 `{id,name}` 候选；system prompt 明确把条目和分类名称视为不可信数据并禁止遵循其中指令，user prompt 仅使用结构化 JSON 分隔数据。
- 模型输出以 4 KiB UTF-8 字节为硬上限，允许剥离一个完整 JSON fence，随后由 strict zod schema 校验且拒绝额外字段；`categoryId` 必须为候选白名单 ID、`null` 或字面 `NONE`，confidence 必须在 0～1。
- confidence `<0.65`、`null`、`NONE` 或无候选均返回可靠 `unclassified`；0.65 边界可选中。未知 ID/格式/超长输出返回 `invalid_output`，模型异常转换为 `upstream_error`，均不向 worker 抛出。
- 结构化日志固定为 `category_classification` + outcome，不记录 title、summary、tags、prompt、候选内容、模型原始响应或异常详情；日志 writer 异常也不改变分类结果。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `corepack pnpm vitest run tests/categories/classify.test.ts` | PASS，1 file / 18 tests |
| Task 1+2+3 联合定向测试 | PASS，4 files / 45 tests |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error/0 warning；审批原型保留 1 条既有 warning |
| `git diff --check` | PASS |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test` | 301/303 PASS；2 项非本批失败，见下 |

测试覆盖合法选中、无候选零模型调用、`null`/`NONE`、0.65 上下边界、完整 JSON fence、非法 JSON、未知 ID、额外字段、confidence 类型/范围、超长但其余合法的响应、模型抛错、prompt-injection fixture、四种稳定 outcome 日志、日志失败隔离与内容/原始输出脱敏。注入 fixture 同时包含恶意 title、summary、全部 tags 与两个恶意候选分类名，并断言 system message 等于固定模板、所有不可信值仅存在于结构化 user JSON。

反向门禁在隔离 worktree 中逐项验证：中和无候选短路、strict schema、候选白名单、0.65 边界、4 KiB 输出上限和“不可信数据/禁止遵循”prompt 门禁，六条对应命名测试均出现 Vitest assertion failure、进程 exit 1；R1 返工又分别只把 `input.tags.join(",")` 或首个恶意候选分类名追加到 system message，两次注入命名测试均为 1 failed / 17 skipped、exit 1，失败命中固定模板等值断言。以上门禁不会因任一不可信字段泄漏到 system 而静默放行。

### 偏差、未解决项与残余风险

- 无新增依赖、迁移、数据库写入或 worker 接线；worker 三门禁与事务外推理按依赖顺序留待 Task 4。
- 完整回归为 44/46 files、301/303 tests；失败仍仅为未构建 standalone 产物及固定 `2026-08-09` 的历史日期 fixture，未落在 Task 3 变更面。本批不修改或掩盖这两项，也不据此宣称完整回归通过。

## M2 Task 4：worker 非阻断归类与并发门禁

### 实现范围

- 扩展 `processItem` 依赖注入，增加 taxonomy 快照读取与单条分类器；仅对 initialized taxonomy 下的 web/github 且初始非人工分类条目调用模型。
- taxonomy 快照在独立短事务内按 `app_settings FOR SHARE` 后读取分类，事务结束后才执行模型推理，LLM 不进入数据库事务。
- taxonomy/分类器异常均转换为稳定 skipped outcome，不进入 `failRequest`；可靠 `unclassified` 才写 NULL，`invalid_output`、`upstream_error` 与准备异常均保留原分类。
- completion 短事务保持 item、processing request 与 Telegram receipt 原子提交；分类写入前在同一事务重验 taxonomy version、候选分类存在性与当前 `category_manual=false`，并在最终 update 条件再次约束人工保护。
- 增加无内容字段的 `category_classified` 结构化日志，outcome 仅为 matched/unclassified/skipped，并记录稳定 reason。
- 无 schema 迁移、无新增依赖、无 UI 变更；Task 5 尚未开始。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm vitest run tests/integration/processItem.test.ts` | PASS，1 file / 20 tests |
| Task 1+2+3+4 联合定向测试 | PASS，5 files / 65 tests |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error；审批原型保留 1 条既有 warning |
| `git diff --check` | PASS |
| project-delivery-workflow validator | PASS |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test` | 310/312 PASS；2 项非本批失败，见下 |

测试覆盖 initialized web 的合法选中、可靠未分类写 NULL、invalid/upstream 保留旧分类、未初始化/doc/初始人工保护零调用、taxonomy/classifier 抛错仍 completed 且不生成 retry、推理期间人工覆盖、taxonomy version 变化和候选删除均不覆盖/不触发 FK 重试，以及 Telegram receipt 仍 completed。人工保护同时覆盖正式分类与人工选择 NULL：初始 `category_manual=true/category_id=NULL` 时 taxonomy 与 classifier 均零调用；推理挂起期间管理员改为人工 NULL 后仍保持 NULL 并记录 `manual_override`。分类器挂起期间对 `db.transaction` 的 spy 证明 completion transaction 尚未开始，释放模型结果后才进入一次短事务。

在隔离副本中逐项中和 type、初始 manual、initialized、taxonomy 错误隔离、classifier 错误隔离、可靠 NULL、completion manual、version、候选存在性九项门禁，对应命名测试均为 assertion failure、exit 1，失败命中 Vitest 断言。另把 `prepareClassification` 故意包入 `db.transaction` 时，事务外推理命名测试因分类器挂起期间 transaction 调用数由 0 变为 1 而 assertion failure、exit 1。R1 返工又把初始 manual 门禁弱化为依赖非 NULL categoryId，对应人工 NULL 命名测试因 taxonomy/classifier 被调用而 exit 1；中和 completion manual 保护时，推理期间人工 NULL 被自动候选覆盖，对应命名测试 exit 1。以上反向门禁均由行为断言捕获，不把语法、依赖或启动错误计作证据。

### 偏差、未解决项与残余风险

- 无需求、架构、安全边界或已接受风险偏差；人工保护、taxonomy version 与候选存在性三门禁均在 completion transaction 内重验。
- 完整回归为 44/46 files、310/312 tests；失败仍仅为 `deploy-smoke` 缺未构建的 `.next/standalone/node_modules`，以及 `settingsRoutes` 历史 fixture 固定断言 `2026-08-09`、当前业务日为 `2026-08-11`。两项与 Task 4 变更面无关，本批不扩大处理范围，也不据此宣称完整回归通过。

## M2 Task 5–7：F202 分类建议、原子应用与后台重归类

### 实现范围

- 新增 `src/lib/categories/propose.ts`：按 `(created_at,id)` keyset 每批 40 条读取 snapshot 时点前的 completed web/github 条目；title/summary/tag、prompt 与模型输出均有硬上限。两阶段 map-reduce 不截断尾部 themes，supplement 仅允许 add，full 支持 add/rename/merge/delete；strict zod DTO、中文名称、引用/环/重复 source 校验均 fail closed，模型异常与非法输出映射为稳定错误码。模型与客户端提供的计数一律不可信，最终 auto/manual count 由服务端 snapshot 附加。
- 新增 `src/lib/categories/apply.ts`：strict `AppliedDiff`/`AutoDestination` 合同在短事务内锁 `app_settings(id=1)`、重验 `baseVersion`、锁 destructive source 关联条目，并原子执行 add→rename→merge/delete、version +1、initialized=true 与 `category_change_runs` 持久化。merge/delete 只要 source 存在任一 `category_manual=true` 条目即整批 `MANUAL_CATEGORY_CONFLICT` 回滚；自动迁移只更新 `category_manual=false`。`request_key` 永久幂等，旧 reclassifying run 在新 taxonomy 提交中原子 supersede；pg-boss publish 只在提交后执行，发布失败保留可恢复 run。
- 新增 `src/lib/categories/reclassify.ts` 与 `src/worker/jobs/reclassifyCategories.ts`：持久 cursor、generation 与 append-only retry request 支持崩溃恢复和重复投递；相同 retry key 永久返回既有 generation 且不重复 publish，不同活动 key fail closed。模型逐条在 snapshot/commit 事务外调用，提交时按 settings→run→item 锁序重验 version、manual（含人工 NULL）、status/type 和候选存在性；仅更新自动 web/github 条目。失败明细只记录 `AI_UPSTREAM_FAILED`/`AI_OUTPUT_INVALID` 稳定码并递增 attempts，`failedCount` 每次由明细派生而不缓存。
- `src/worker/index.ts` 注册 category reclassify queue、worker、事务外 pending publisher 与 graceful `offWork`。本批复用 Task 1 已验收 schema，不新增迁移或依赖；API 路由属于 rev11 Task 8，本批未提前实现。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm vitest run tests/categories/propose.test.ts tests/categories/apply.test.ts tests/categories/reclassify.test.ts` | PASS，3 files / 40 tests |
| Task 1–7 联合定向测试 | PASS，8 files / 105 tests |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error；审批原型保留 1 条既有 warning |
| `git diff --check && git diff --cached --check` | PASS |
| project-delivery-workflow validator | PASS，`stage=implementation revision=11` |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test` | 49 files；350/352 PASS；2 项非本批失败，见下 |

测试覆盖 bounded snapshot/map-reduce、所有 themes 进入 reduce、strict DTO、supplement add-only、四种 full diff、服务端计数、重复名/引用/环/输出上限与脱敏错误；apply 的幂等、并发 stale version、destructive 行锁、人工冲突整批回滚、人工 NULL、拓扑应用、事务 helper、单次 version、initialized、旧 run supersede 与提交后发布；reclassify 的自动条目范围、四态结果、稳定失败明细、attempts、retry key/generation、人工 NULL、version/candidate 三门禁、持久 cursor、重复 delivery、事务外模型与派生失败数。

在隔离 worktree 中逐项中和关键不变量，并串行使用专用测试库运行对应命名用例，以下 15 项均进程 exit 1：重新截断 reduce themes；supplement 放行非 add；strict schema 改为 passthrough；服务端 source counts 固定为 0；移除 apply 人工冲突；移除 apply version 重验；跳过 request-key 幂等返回；移除 destructive source item `FOR UPDATE`；移除 reclassify manual、version、candidate 三门禁；重复 retry key 再次 publish；移除重复 delivery cursor guard；把分类模型包入持 settings share 的事务；失败明细 attempts 不递增。除 request-key 中和直接抛出 `CategoryApplyError: STALE_TAXONOMY` 外，其余均由对应 Vitest 行为断言捕获；不再把 15 项笼统记为全部 AssertionError。首次把四个数据库反测并行运行导致测试间 schema reset 竞争，该轮结果明确作废；上述有效证据均已在无并发 reset 的串行复跑中取得。

R1 修复 destructive impact 的 TOCTOU：事务先锁扫描时已在 source 的 items，在 `afterImpactLock` 探针后按分类 ID 稳定顺序锁 destructive source 的 `categories` 行，再在该锁保护下重新扫描并锁 source items、重验不存在 `category_manual=true`。PostgreSQL FK 检查会让任何 `NULL/其它分类→source` 的 `category_id` 赋值自动取得 referenced category row key-share，因此所有现有和后续赋值路径天然进入同一协议：赋值若先完成，二次扫描看见并整批 `MANUAL_CATEGORY_CONFLICT`；source 行锁若先取得，后续赋值阻塞到删除完成并因 FK 目标不存在而失败，不存在扫描后静默进入 source 的窗口。

新增 merge/delete 各两条确定性并发用例：并发事务先把人工 NULL 赋入 source 并持有 FK 锁时，apply 确认等待分类行锁，提交并发事务后两类均被二次扫描拒绝，新增分类、run、version 与 destructive 操作全部回滚，人工条目保持 manual=true 且仍指向 source；在 `afterImpactLock` 暂停点提交同一赋值时，两类同样返回 `MANUAL_CATEGORY_CONFLICT` 并断言整批零落库。隔离反证分别移除 source 分类行锁、移除锁保护下 manual 重验：前者使 merge/delete 锁等待命名用例因找不到分类行锁而 exit 1；后者使 `afterImpactLock` 两条用例错误 resolved completed/appliedVersion+1，命中拒绝断言并 exit 1。

### 偏差、未解决项与残余风险

- 无需求、架构、安全边界或 AR-M2-01 偏差；LLM 均在事务外，AI 不会自动迁移或清空人工分类条目，包括人工选择 NULL。
- pg-boss 发布失败保留 recoverable `reclassifying` run，由 worker publisher 循环补发；本批未操作生产队列或生产数据。
- 完整回归为 47/49 files、350/352 tests；失败仍仅为 `deploy-smoke` 缺未构建的 `.next/standalone/node_modules` 而报 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 历史 fixture 固定断言 `2026-08-09`、当前业务日为 `2026-08-11`。两项与本批变更面无关，未被掩盖，也不据此宣称完整回归通过。

## M2 Task 8：管理端分类 API 与 C 工作台

### 实现范围

- 新增 `/admin/api/categories` GET/POST、`[id]` PATCH/DELETE、`propose` POST、`apply` POST、`runs/[id]` GET、`runs/[id]/retry` POST 与 `/admin/api/items/[id]/category` PATCH。所有读路由先复用 `requireAdminApi`，所有写路由先复用 `requireAdminWrite` 的 session→Origin→CSRF→Content-Type 门禁，再解析 strict zod body；响应统一 no-store，错误映射为计划规定的稳定 code/HTTP status，不回传模型原文或异常详情。
- 条目详情 DTO 增加 `categoryId/categoryName/categoryManual`。分类 PATCH 要求现有 If-Match，在短事务中对目标分类取得 `FOR KEY SHARE`、校验存在、按 ETag 条件更新并设置 `category_manual=true`；人工选择 NULL 同样受保护，响应返回新 ETag。该分类行锁与 Task 5–7 destructive source `FOR UPDATE` 串行协议相容。
- 新增管理端 `/admin/categories` C 工作台：补充建议/全量重拟双入口、常驻人工保护带、四类 diff 的接受/忽略/编辑、自动条目去向、全忽略禁用、放弃预览、独立原生 dialog 确认、默认开启且可关闭的自动重跑、`MANUAL_CATEGORY_CONFLICT` 明确迁移/忽略引导、真实 run 轮询/partial/failed retry、固定分类 CRUD、删除确认与目录概况。
- 分类 GET 与服务端页面同时读取最近一次持久 run；离页返回可恢复服务端真实状态、应用计数与重跑结果，不依赖客户端伪造历史。应用网络/冲突重试保留同一 requestKey；只有成功应用或放弃预览才清除。
- 条目详情新增单主分类选择器；保存期间只禁当前选择器，409/网络失败恢复原选择，成功显示人工优先反馈。AdminNav 增加分类管理入口，桌面为 74px 图标侧栏、移动为带文字横向导航。
- 严格实现批准 UI：桌面 diff 三列、移动单列/整行决策，控件至少 44px，忽略项字段禁用，原生 dialog 支持 ESC/焦点恢复，reduced motion/transparency/contrast、触控按压反馈、显式 focus-visible、长文本换行和 tabular 数字。未引入外部资源或放宽 CSP。

### 依赖与安全审计

- 按最终计划唯一新增 `lucide-react@1.31.0`，精确锁版，用于管理导航、工作台和人工保护图标；许可证 ISC。
- `corepack pnpm audit --prod`：PASS，`No known vulnerabilities found`。图标从本地 bundle 加载，无 CDN/外部运行时请求。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| Task 1–8 联合定向（categories 全部、migration-nav、processItem、itemDetail、工作台 UI） | PASS，12 files / 137 tests |
| Task 8 API + reclassify + detail + UI 定向 | PASS，5 files / 45 tests |
| `corepack pnpm vitest run tests/unit/categoryWorkbench.test.tsx tests/unit/itemDetail.test.tsx` | PASS，2 files / 10 tests |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error/0 warning；审批原型保留 1 条既有 unused warning |
| `git diff --check` | PASS |
| `env -u DATABASE_URL corepack pnpm build` | PASS，Next.js 15.5.23；28 个动态 route，Task 8 未回归 PA-01；standalone devDependency prune 门禁通过 |
| `corepack pnpm exec playwright test tests/e2e/admin-categories.spec.ts` | PASS，Chromium desktop 1 + mobile 1；生产 standalone server |
| `corepack pnpm audit --prod` | PASS，0 known vulnerabilities |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test` | 50/51 files、365/366 tests；1 项既有失败，见下 |

Playwright 在 `1440×1000` 与移动项目上通过生产 standalone 覆盖登录与分类导航、full 四类 diff、名称编辑/自动去向、独立确认、默认重跑、人工冲突引导、忽略后复用 requestKey，以及真实 CRUD、删除二次确认、条目人工选择 NULL 与数据库 `category_manual=true`。其中 propose/apply 响应由 Playwright route mock 提供，只验证 UI 状态机、请求重试和错误呈现，不作为 UI/API 合同证据；四型请求合同由真实 `applyCategoriesInputSchema` 契约测试与真实 apply route API 测试独立覆盖。两端均断言无页面级横向溢出；移动 CRUD 还断言重命名/删除 44px 几何盒不相交并以键盘 Enter 完成删除。预期 409 经 UI 文案断言后从控制台采样中剔除，后续控制台与 pageerror 均为 0。截图位于 `.workflow/screenshots/nav-enhancement/admin-c-diff-{desktop,mobile}.png`。

按最新 Web Interface Guidelines 审计 Task 8 文件并修正：所有图标按钮有 aria-label、装饰图标 aria-hidden、表单均有 label/name/autocomplete、async 反馈有 aria-live/alert、原生 dialog 有 ESC/焦点恢复/overscroll containment、全局 focus-visible 可见、控件 touch-action 与按压 transform 支持 reduced-motion。未发现剩余阻断项。

### 反向门禁

在默认专用测试库上串行临时中和后立即反向补丁恢复，以下六项均由对应命名 Vitest 行为断言捕获、进程 exit 1：

1. 忽略 categories GET 的匿名鉴权响应：期望 401、实际 200。
2. 条目分类保存不设置 `category_manual=true`：返回 DTO 的 manual 断言失败。
3. 把 ETag 条件弱化为只要求 `$3` 非空：旧 ETag 第二次更新错误返回 200，期望 `ITEM_CONFLICT` 409。
4. 把 `MANUAL_CATEGORY_CONFLICT` UI 映射为通用错误：迁移/忽略引导文案断言失败。
5. 冲突后清除 requestKey：连续两次 apply body 的 requestKey 等值断言失败。首次反证发现测试的 randomUUID 固定值会 fail-open，已改为递增 UUID fixture 后重新验证 exit 1。
6. 移除“接受数为 0”禁用条件：全忽略命名用例的 disabled 断言失败。

恢复后 API 7/7、工作台 7/7 再次通过，`git diff --check` 通过。E2E 另锁定忽略字段 disabled、same requestKey、人工冲突引导、删除确认、人工 NULL 和移动操作盒不重叠。

### 偏差、未解决项与残余风险

- 无需求、架构、安全边界、UI 决策或 AR-M2-01 偏差；本批无迁移、无生产队列/数据操作、未部署、未推送、未打 Tag。
- 完整回归唯一失败为既有 `tests/integration/settingsRoutes.test.ts` 固定断言业务日 `2026-08-09`，当前 `Asia/Shanghai` 业务日为 `2026-08-11`，因此实际返回 day `2026-08-11`、usedGlobal `0`。本批未修改该历史用例，也不据此宣称完整回归全绿。
- 本轮已先生成生产 standalone，因此 `deploy-smoke` 7/7 通过；与早期批次“缺构建产物”的环境失败不矛盾。

### Task 8 R1：merge 契约与 retry 冲突映射

- 修复工作台接受 merge 时遗漏严格 `AppliedDiff.target` 的契约错误：请求同时保留 proposal 的语义合并 target，以及管理员选择的 `autoDestination`，由 apply 继续执行目标存在、同批删除 source 等服务端校验。API 测试明确断言缺失 merge target 返回 `VALIDATION` 400。
- 活动 reclassify run 收到新 retry key 时仍返回稳定 `VALIDATION` code，但 HTTP 状态改为计划规定的 409；同 key 永久幂等仍返回既有 generation，非法 UUID 与非可重试终态仍保持 400。
- R1 正向定向：直接相关 UI/API 为 2 files / 17 tests PASS；其中前端生成的 add/rename/merge/delete 四型 accepted body 使用真实 `applyCategoriesInputSchema` strict 解析，并基于同一前端产出体逐型删除 `add.name`、`rename.name`、`merge.target`、`delete.autoDestination`，四个负变体均被 schema 拒绝；真实 apply route 另断言缺 merge target 返回 400。Task 8 API/reclassify/detail/UI 扩展定向为 5 files / 48 tests PASS。`typecheck`、lint（0 error、1 条审批原型既有 warning）、diff check、workflow validator、`env -u DATABASE_URL pnpm build` 与桌面/移动 Playwright 2/2 均通过。
- R1 完整回归为 50/51 files、368/369 tests；唯一失败仍是 `settingsRoutes` 固定断言 `2026-08-09`、实际业务日 `2026-08-11`，本次 merge/retry 窄修未触及该历史用例。
- R1 反向门禁：分别临时移除工作台 add name、rename name、merge 顶层 target、delete autoDestination，四次同一四型合同命名用例均因真实 schema `safeParse=false` 命中 Vitest AssertionError、exit 1；临时移除活动 run 的冲突标记后，独立命名 API 用例观测实际 400、期望 409，Vitest AssertionError、exit 1。全部恢复后重新正向验证，不把语法或启动错误计作证据。

## M2 Task 9：F209 关键词字面搜索

### 实现范围

- 新增公开 `POST /search`、字面搜索服务、公开语料查询与独立关键词限流。输入为 strict `{query}`，trim 后只接受 2–100 字符；成功固定 `{query,matches}`，失败固定 `QUERY_INVALID` 400、`RATE_LIMITED` 429、`SEARCH_UNAVAILABLE` 503，全部 `Cache-Control: no-store`。
- 语料只查询 `status='completed' AND type IN ('web','github')`，使用单一参数 `$1` 对 title/summary/tags 做大小写不敏感子串匹配；`%`、`_`、反斜杠在进入参数前逐字符转义，SQL 固定声明 `ESCAPE '\\'`，用户输入不进入 SQL 文本。doc 与 processing/failed 永不返回。
- 限流复用可信代理 IP 校验，但只使用 `kw:global` 与 `kw:ip:<HMAC>` scopes；不读取、更新 `global`/`ip:` ask scopes，也不导入 ask handler、retrieve、embedding 或 LLM。代理证明、IP hash secret、settings/counter/数据库异常均 fail closed 为 `SEARCH_UNAVAILABLE`。

### 验证证据

- Task 9 定向：5 files / 13 tests PASS，覆盖真实 PostgreSQL title/summary/tags 命中、大小写、doc/processing 排除、`%/_/\\` 三种字面字符和 SQL 注入样本；SQL 参数化静态门禁；query/content-type/envelope/no-store；可信代理 fail-closed；独立 kw scope/IP 限流且零 ask scope。
- `typecheck` PASS；lint 0 error（审批原型 1 条既有 warning）；`git diff --check` PASS；`env -u DATABASE_URL pnpm build` PASS，生产 prune 门禁通过并生成 `/search` dynamic route。
- 完整回归为 55/56 files、381/382 tests；唯一失败仍是 `settingsRoutes` 固定断言 `2026-08-09`，当前业务日 `2026-08-12`，不在 Task 9 变更面。
- 静态 import 测试确认四个产品模块不引用 `@/lib/ai`、`search/retrieve`、`ask/handler`、embedText 或 generateLlmText。

### 反向门禁

- 临时中和 LIKE 转义后，`%` 字面命名用例从仅匹配包含 `%` 的记录退化为通配并命中额外记录，Vitest assertion failure、exit 1。
- 临时放行 doc 类型后，范围命名用例返回 doc，Vitest assertion failure、exit 1。
- 临时把可信代理失败回落到伪 IP，并让限流依赖成功时，fail-closed 命名用例错误返回 200、期望 503，exit 1。
- 临时向 keyword 模块导入 embedding 后，零 AI 架构测试命中禁用 import、exit 1。所有变异均已恢复并重新正向验证。

### Task 9 R1：rev11 查询、DTO 与并发合同

- 查询入口改为 NFKC→trim，再按规范化值验证 1–100 字符并拒绝 C0/C1 控制字符；成功 envelope 与搜索依赖均收到 normalized query。NUL/控制字符/空/101 在可信代理与 quota 之前返回 400，consume/search 均零调用。
- SiteCard 补齐 `categoryName/faviconPath`，SQL `LEFT JOIN categories`，favicon 固定同源 `/favicon/<itemId>`，排序固定 `lower(coalesce(items.title,items.url)),items.id`。真实 PostgreSQL 测试同时验证 DTO、分类为空兼容与确定顺序。
- 并发屏障新增同 IP 8 并发仅 2 允许、多 IP 8 并发仅 global 3 允许；预置 ask `global/ip:` counters 在关键词消耗后值不变。静态锁协议门禁要求 settings 与 counter 两处 `FOR UPDATE`。
- R1 反向：去 NFKC、去控制字符拒绝、删 favicon 字段、改回 created_at 排序、移除 settings 行锁均由对应命名用例 assertion failure、exit 1；所有实现已恢复。

## M2 Task 10：公开目录、favicon 与问答可用性

### 实现范围

- 新增 `getPublicDirectory()`，固定使用两次可控查询读取全部分类与 eligible items。分类按 `sort,name,id`，站点按 `title,url,id` 确定排序；空分类保留，`id/name=null` 的未分类组始终存在并固定末尾。站点复用完整 SiteCard DTO，favicon 只暴露同源 `/favicon/<itemId>`。
- 新增同源 `/favicon/[id]` 与 `siteFavicon`：route 只接受 UUID，不读取 query URL/host；先以参数化查询确认 completed web/github 条目，再仅从数据库已存 URL 的 origin 派生 `/favicon.ico`。网络读取复用 `safeFetch` 的逐跳全 A/AAAA 审查、固定已审查 IP、redirect/降级保护、总超时与流式上限，favicon 固定 128 KiB/5 秒且只允许 PNG/JPEG/GIF/WebP/ICO，SVG/HTML fail closed。
- favicon 同 key 并发在进程内合并；成功用 Next server cache 7 天，失败/非 eligible 负缓存 1 小时。响应使用对应 public `max-age/s-maxage`、`nosniff`；错误统一返回本地 PNG fallback 404，不返回目标 URL、host 或异常详情。
- 新增 `hasCompletedAskCorpus()`，只判断是否存在任意 completed item，明确包含 doc。首页保持 Task 11 之前的既有结构，只把 AskExperience 的空库判定改为独立调用 corpus 与既有 readiness；doc-only 时目录为空但问答不因目录为空被禁用。本批未实施 Task 11 的首页目录 UI 重组。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| Task 10 + safeFetch/publicCorpus 联合定向 | PASS，6 files / 26 tests |
| `pnpm typecheck` | PASS，0 errors |
| `pnpm lint` | PASS，产品代码 0 error；审批原型 1 条既有 warning |
| `git diff --check` | PASS |
| `pnpm build` | PASS，Next.js 15.5.23 生成 `/favicon/[id]`；standalone devDependency prune 门禁通过 |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai pnpm test` | 59/60 files、399/400 tests；唯一既有失败见下 |

目录真实 PostgreSQL 测试覆盖空分类、eligible 过滤、分类与站点顺序、未分类末组、同源 faviconPath、两次查询规模，以及 doc-only completed corpus 可用但目录无站点。favicon 测试覆盖 UUID、忽略任意 query URL/host、非 eligible 零 fetch、仅从存储 URL 派生 origin、同 key 请求合并、7 天成功/1 小时失败缓存、公共响应头、fallback 不泄漏；联合现有 `safeFetch` 测试覆盖逐跳公网复验、内网 redirect 拒绝、HTTPS 降级、循环/超跳、错误 MIME、content-length/流式超限及总超时。

### 反向门禁

在默认专用测试库串行临时中和产品门禁，以下五项对应命名 Vitest 均 assertion failure、exit 1，恢复后联合定向重新 26/26：

1. 把未分类组从末尾移到首位，目录组末位断言红。
2. 把分类排序反转为 `sort/name/id desc`，真实顺序及 SQL 合同断言红。
3. 让 favicon route 优先采用 query `url` 而不是 item UUID，任意 URL 不可输入断言红。
4. 把 `image/svg+xml` 加入 favicon MIME 白名单，raster-only 门禁红。
5. 把问答空库判定退回 `dailyItems.length===0`，NAV-005 独立 corpus 架构门禁红。

所有临时变异均已通过反向补丁恢复，不把 Perl 环境 locale 启动失败的一次作废脚本计入反测证据。

### 偏差、未解决项与残余风险

- 无需求、架构、安全边界或 NAV-005/NAV-008 偏差；本批无 schema 迁移、新依赖、外部服务或生产数据操作，未提前实施 Task 11。
- favicon 缓存为 Next server cache 加进程内请求合并/负缓存；多实例之间由共享 CDN/反向代理的 `s-maxage` 合并响应缓存，不承诺跨实例内存锁。
- 完整回归唯一失败仍是 `tests/integration/settingsRoutes.test.ts` 固定断言业务日 `2026-08-09`，当前 `Asia/Shanghai` 业务日为 `2026-08-12`，实际返回 day `2026-08-12`、usedGlobal `0`。本批未修改该历史用例，不据此宣称完整回归全绿。

## M2 Task 11：公开 C 工作台首页

### 实现范围

- 首页删除 `pickDailyForNow`、hero/eyebrow/副标题、daily 三卡与旧空态渲染，保留品牌栏、语言切换、skip link、独立 completed corpus/readiness 判定和原 AskExperience。AskExperience 是 DirectoryShell 的 sibling，不在目录 Suspense/错误边界内。
- 新增 `DirectoryData` 作为唯一调用 `getPublicDirectory()` 的 async child，catch 后只返回局部错误 props；`DirectoryView` 为纯数据展示，保留全部分类、空分类和末尾未分类。直达带 `q` URL 时 server page 不挂载 DirectoryData，避免搜索模式仍读取隐藏目录。
- 新增独立 `KeywordSearch` 与 `DirectoryShell` 客户端状态机：输入不自动请求，显式按钮/Enter 才 NFKC+trim 校验并写 URL；清空移除 q；URL q 驱动首载/刷新/复制/前进后退。每次请求创建 AbortController，同时用 active token 拦截忽略 abort 的旧 Promise，保证旧响应不覆盖新 query。
- 搜索区覆盖三卡 aria-busy 骨架、结果、空结果、具体失败+重试；失败明确不是空结果。结果标题显示 query、命中数、字面匹配与“不调用 AI”；输入错误内联且焦点留在输入。默认目录/搜索结果只占同一主体位置。
- C 工作台目录索引桌面六栏、平板三栏、移动横向滚动；stable category id、标题 `scroll-margin-top`、点击移焦并设置 `aria-current=location`。目录站点桌面三列/移动单列，整卡安全外链；36px 同源 favicon 失败切同尺寸域名首字母，不产生布局跳动。
- `loading.tsx` 改为同一目录标题/搜索占位、3 个目录骨架和问答占位，不渲染 hero/daily。新增中英文 Task 11 文案键；Task 12 的 i18n 全量收口与管理导航未提前实施。
- Playwright 首轮发现 Next Image 为动态 favicon 注入 inline style，触发当前 nonce CSP；改为带明确 width/height、lazy、同源且已安全边界处理的原生 img，并保留局部 lint 说明。另把 eligible item 的上游 favicon 失败改为 200 本地 PNG fallback、非 eligible 仍 404，消除浏览器资源错误且不放宽数据范围。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| Task 11 UI/架构 + favicon 定向 | PASS，5 files / 18 tests |
| `pnpm typecheck` | PASS，0 errors |
| `pnpm lint` | PASS，产品代码 0 error/0 warning；审批原型 1 条既有 warning |
| `git diff --check` | PASS |
| `pnpm build` | PASS，首页动态 route；standalone devDependency prune 门禁通过 |
| `pnpm exec playwright test tests/e2e/public.spec.ts` | PASS，desktop/mobile 12/12；生产 standalone |
| `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai pnpm test` | 62/63 files、408/409 tests；唯一既有失败见下 |

Playwright 在 `1440×1000` 和 `390×844` 覆盖无 hero/daily、标题行几何、移动搜索满宽与 44px 按钮、默认/输入/加载/结果/空/失败/清空、URL q、旧请求竞态、空分类/末组、锚点焦点、整卡安全外链、favicon fallback、真实局部目录故障与 router.refresh 恢复、doc-only 问答可用及真实问答提交回归。两视口均无横向溢出、页面 console/pageerror/CSP 错误为 0；另验证 reduced motion、contrast more 与实色问答 dock。截图：`.workflow/screenshots/nav-enhancement/public-c-directory-{desktop,mobile}.png`、`public-c-keyword-results-{desktop,mobile}.png`。

按 2026-08-12 拉取的最新 Web Interface Guidelines 审计并修正：关键词 compound control focus-within、交互 focus-visible、favicon lazy/明确尺寸、tabular 计数、占位省略号、长文本 min-width/overflow、reduced motion/transparency/contrast。未发现剩余 Task 11 阻断项。

### 反向门禁

在最终产品代码上逐项临时中和、只运行对应命名用例，以下五项均 Vitest AssertionError、exit 1，恢复后定向 18/18：重新 import daily；让带 q 页面仍挂 DirectoryData；移除旧响应 active token；把卡片 `rel="noopener nofollow"` 弱化；让 eligible favicon 上游失败错误返回 404。所有变异均已恢复，不把 Playwright strict selector 或首次移动时序波动作产品失败/反测证据。

### 偏差、未解决项与残余风险

- 无需求、架构、安全边界或批准 UI 方向偏差；未新增依赖、迁移，未实施 Task 12/13，未操作外部服务或生产环境。
- 完整回归唯一失败仍是 `settingsRoutes` 固定断言 `2026-08-09`，当前业务日为 `2026-08-12`，实际 day `2026-08-12`、usedGlobal `0`。与本批公共 UI 无关，不据此宣称完整回归全绿。

## M2 Task 12：i18n、管理导航与可访问性收口

### 实现范围

- zh/en 叶子键继续完全一致，并删除公开首页已不再引用的 hero/daily `eyebrow/title/description/itemsLabel/dailyError` 键；目录加载与空态文案改为当前目录语义。合同测试同时锁定两套键集和废弃键不得回归。
- 复核并执行批准命令 `corepack pnpm add lucide-react@1.31.0 --save-exact`，package/lock 已是精确版本，命令为 no-op。Lucide 官方仓库为 `https://github.com/lucide-icons/lucide`，包许可证 ISC；公开搜索清空/提交、目录外链、问答提交与分类变更方向均改用命名 import，不含手绘 SVG 或字符图标。AdminNav 保持已验收的 `FolderTree` 分类入口。
- 公开关键词/问答、分类 F202 两入口与条目分类保存接入 `Pressable`，pointer-down 立即反馈，pointer-cancel/leave/up 清除；目录结果、分类 diff/run 接入可中断 `MotionRegion`，人工保护使用结构型 `MaterialSurface`。MotionRegion 只做位移，不用透明度短暂隐藏可访问内容；reduced-motion 禁位移/动画，reduced-transparency 使用实色。
- 关键词 Enter 与按钮共享 NFKC/控制字符/长度校验；Enter keydown 显式提交，提交读取 DOM 最新值，覆盖快速输入与受控 state 更新竞态。分类确认 dialog 保持 ESC、首焦点与触发器焦点恢复；状态继续使用 note/status/alert/live region。
- 公共与管理端保持 44px 触控、可见 focus、skip link、标题层级、name/autocomplete、长文本与页面无横向溢出。未增加展示 `setTimeout` 或人工进度；后台 run 的既有真实轮询保留。

### 验证证据

| 命令 | 结果 |
| --- | --- |
| Task 12 unit/contracts 定向 | PASS，4 files / 21 tests；含 zh/en、Lucide、无字符图标、primitives、pointer cancel、快速输入、dialog 焦点恢复 |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error；审批原型 1 条既有 unused warning |
| `git diff --check` | PASS |
| `corepack pnpm audit --prod` | PASS，`No known vulnerabilities found` |
| Playwright public + admin categories | PASS，desktop/mobile 14/14；每轮先完成生产 build 与 standalone prune |
| workflow validator | PASS，`stage=implementation revision=11` |
| 完整 Vitest 回归 | 63/64 files、414/415 tests；唯一既有失败见下 |

Playwright 在 `1440x1000` 与 `390x844` 覆盖目录/关键词/问答、锚点焦点、安全外链、reduced motion/contrast、局部错误恢复、F202 两入口、四型 diff 编辑/去向/确认、人工冲突、CRUD、详情人工 NULL，以及控制台/pageerror 和横向溢出门禁。Task 12 截图为 `.workflow/screenshots/nav-enhancement/task12-public-accessibility-{desktop,mobile}.png` 和 `task12-admin-accessibility-{desktop,mobile}.png`。Playwright apply 仍只作为 UI 状态机证据；真实 UI body 合同继续由 Task 8 的 strict schema 与 route 测试证明。

### 反向门禁与残余风险

- 初始红测准确捕获旧 daily/hero 键、字符图标和未接入 primitives；修复后合同测试 4/4。pointer cancel 若不清理 `data-pressed`，`uiPrimitives` 命名断言红；快速提交若只读取陈旧 React state，最新 DOM 值命名断言红。源码门禁还禁止产品 `setTimeout(`、手绘 SVG 与 `x/multiplication/arrow` 字符图标回归。
- 本批无迁移、无额外依赖、无外部服务或生产操作，未开始 Task 13。完整回归唯一失败为 `tests/integration/settingsRoutes.test.ts` 固定断言业务日 `2026-08-09`，当前业务日 `2026-08-12`，实际 `usedGlobal=0`；本批未修改该历史用例，不据此宣称全绿。

### Task 12 R1：移动分类页导航溢出

- 修复 390px 设备上四列 `minmax(104px,1fr)` 把 viewport 撑至 461px：移动 shell/sidebar 明确 `min-width:0`、sidebar 限制为 `100vw` 并裁切页面级溢出；AdminNav 改为 `width:100%` 的内部 flex 横向滚动轨道，四个 104px 触控项保持可访问且不扩大页面。
- Playwright 在 `/admin/categories` 进入后、跳转详情前立即读取真实几何：固定 `screen.width=390`、`innerWidth=390`、document `scrollWidth<=390`，同时要求 nav `scrollWidth>clientWidth`，证明滚动发生在导航容器而非页面。
- 反向门禁恢复旧 grid 并移除 sidebar 宽度协议后，同一移动 E2E 观测 `innerWidth=461`、期望 390，Playwright assertion failure、exit 1；恢复后移动用例重新通过。本修复未改变桌面导航或分类业务行为。

## M2 Task 13：观测、性能、回归与发布门禁

### 实现范围

- 将分类建议、diff 应用、单条分类、重分类进度/结束及关键词限流/完成统一为七个批准事件名。事件载荷只使用 `mode/outcome/count/ms/version/errorCode`；删除 `reason/runId/itemId/query/IP/hash` 等内容或高基数维度，并增加源码合同门禁禁止旧事件名和未批准字段。
- 新增 500 个 completed web/github 与 50 个 completed doc 的真实 PostgreSQL 基准。目录固定两次查询且返回全部 500 个 eligible 站点；关键词查询重复 25 次，最终完整回归 p95 为 3.80ms，低于本机集成环境 1s 门槛且不返回 doc。F202 继续由多页 map 与全主题 reduce 用例证明尾批不丢失。
- 修正三个历史测试时间/异步假设：settings route 与管理 E2E 使用当前上海业务日；条目详情断言不再假设分类请求必为最后一次 fetch；公开目录故障恢复先确认表已恢复，再用有界状态重试等待局部 refresh。本组属于历史门禁加固，不改变 M2 产品合同。
- README 按最终产品现状移除每日三条描述，补充公开目录、字面搜索和分类工作台；其余已核验的环境、安装、配置、运行、部署和许可证说明保持不变。

### 验证证据

| 命令/演练 | 结果 |
| --- | --- |
| Task 13 观测/性能/F202 定向 | PASS；3 files、6 tests（另 10 skipped）；p95 3.44ms |
| 最终完整 `pnpm test` | PASS；66 files、420/420 tests；p95 3.80ms |
| 最终完整 `pnpm e2e` | PASS；desktop/mobile 26/26；运行前生产 build 与 standalone prune 均成功 |
| `corepack pnpm typecheck` | PASS，0 errors |
| `corepack pnpm lint` | PASS，产品代码 0 error；审批原型 1 条既有 unused warning |
| `git diff --check` | PASS |
| `env -u DATABASE_URL corepack pnpm build` | PASS；Next.js 15.5.23，构建期无数据库环境变量 |
| `verify-production-artifact --prune` | PASS；排除 15 个根 devDependencies |
| `corepack pnpm audit --prod` | PASS；No known vulnerabilities found |
| workflow validator | PASS；`stage=implementation revision=11` |
| readiness + worker heartbeat + crash recovery | PASS；3/3，包含真实 pg-boss heartbeat 与 41 条 cursor 恢复且不重复计数 |

使用专用 `collection_system_test` 在 0000～0003 迁移上执行新 `pg_dump -Fc`，恢复到新建临时数据库后联合查询得到 `Task13恢复分类|t|t|t|completed|7`：分类存在、人工条目仍指向分类、向量非空、run 为 completed 且 applied_version=7。随后删除临时恢复库；未接触生产数据库。当前宿主机没有 Docker CLI（`docker: command not found`），因此未执行容器内 restore 脚本；本机 `/opt/homebrew/bin/pg_dump`、`pg_restore`、`createdb`、`dropdb` 的等价新备份恢复演练已成功。Dockerfile placeholder/readiness 由 `deploy-smoke` 7/7 覆盖，但不把它表述为真实容器启动。

README 命令与路径静态核验：Node/pnpm/PostgreSQL/Docker 要求分别来自 `package.json`、锁文件和 compose；`.env.example`、`docs/development.md`、`docs/deployment.md`、脚本及目录均存在；`dev/build/start/db:migrate/test/typecheck/lint/e2e/audit` 均与 manifest 脚本一致。构建、测试、检查命令已实际运行；部署命令只核验定义与参数，未在无授权情况下执行发布或外部状态变更。

### 反向门禁与残余风险

- 临时向 `category_reclassify_progress` 加入 `runId`，观测合同测试准确报告未批准维度并以 AssertionError、exit 1 失败；恢复后合同测试 2/2。
- 临时给目录 eligible SQL 加 `limit 499`，500 条全量断言实际只收到 499 并以 AssertionError、exit 1 失败；恢复后性能测试 2/2。现有 F202 尾批 map/reduce 两个命名用例继续全绿。
- 本批无 schema 迁移、新运行时依赖、部署、push、外部服务或生产操作。性能数据是本机 PostgreSQL 单节点集成结果，不代表所有生产硬件；发布环境仍应持续观察 p95。Docker 不可用导致未取得真实 compose restore 证据，是明确残余环境限制；本机原生 PostgreSQL 的新备份恢复已降低该风险。
