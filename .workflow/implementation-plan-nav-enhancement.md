# 导航站增强（M2）Implementation Plan

> **Plan revision: 11（Codex M2 Cycle 5 修订）**  
> **For implementation agent:** 只有用户在最终审计后明确 go，才按本计划施工。复选框跟踪实施；不得在方案审查阶段提前实现产品代码。

**Goal:** 在已交付的收藏系统上增加固定单主分类、公开目录与独立关键词字面搜索；管理员可反复生成并审核分类 diff；公开首页采用已批准的 C 工作台布局，同时保持既有 AI 问答行为。

**Architecture:** `categories` 与 items 分类字段构成当前 taxonomy；`app_settings.category_version` 为并发代际。AI diff 在短事务内原子应用并写 `category_change_runs`，可选的存量重跑交给 pg-boss 后台作业，LLM 永不在 DB 事务内调用。新条目 worker 在事务外推理、提交时重验 taxonomy version 与人工保护。公开目录由 RSC 读取；关键词 API 使用独立、fail-closed 的 IP/global 限流和参数化 LIKE 字面匹配；favicon 通过只接受已收录 item id 的同源受限路由提供。管理 API 复用现有 session/Origin/CSRF/Content-Type/Zod 管线。

**Tech Stack:** Next.js 15 App Router、React 19、Drizzle ORM、PostgreSQL 16 + pgvector、pg-boss、现有 OpenAI-compatible `generateLlmText`、zod、next-intl、Vitest、Playwright；UI 命令图标增加 `lucide-react@1.31.0`（2026-08-11 registry 查询，ISC）并更新 lockfile。除该已批准 UI 所需依赖外，不新增分类/搜索核心库。

## 0. Global Invariants

- 事实源：已确认的 `.workflow/requirements-nav-enhancement.md`（state/UI 记录为 v0.6；需求文件头仍误标 v0.5，不改该审批产物）与已批准的 `.workflow/ui-spec-nav-enhancement.md`。旧 M1 `decisions.md` 的 hero/daily 展示已被 M2 用户决定推翻。
- 目录与关键词结果只包含 `status='completed' AND type IN ('web','github')`；doc 永不出现。问答语料范围保持 M1 全库 completed 行为，不能用目录计数替代。
- 一条 item 至多一个 `category_id`；NULL 是系统“未分类”，不是 categories 行；单层分类、单管理员不变。
- `category_manual=true` 表示人工选择（包括人工选择 NULL）。worker、自动重跑及 AI diff 的自动迁移都只能更新 `category_manual=false`。
- **AI diff 的破坏性保护：** merge/delete 若 source 仍有关联的人工条目，服务端以 `MANUAL_CATEGORY_CONFLICT` fail closed，整个 diff apply 不落库；管理员先在 F204 明确迁移这些条目，或在预览中忽略该项。管理员在独立 CRUD 删除确认中属于显式人工操作，FK 可把所有条目置 NULL，但必须保留其原 `category_manual` 值。
- 所有 taxonomy 写操作在同一短事务中锁 `app_settings(id=1)`、校验/递增 `category_version`。外部网络/LLM 调用不进入事务。
- `categories_initialized=false` 时 F203 不调用分类模型。第一次成功 AI apply，或管理员首次手工创建正式分类时，在同一事务置 true；之后即使分类被删空也不回退 false。
- F209 仅字面子串匹配 title/summary/tags，不导入或调用 embedding/LLM/ask handler；LIKE 元字符按普通字符处理。
- F207 `/ask`、检索阈值、答案边界和 AI 问答额度不改。关键词请求使用独立 counter scopes，不消耗 ask quota。
- 首页只移除 hero 和 daily 展示/调用；`dailySelections`、`pickDailyForNow` 后端保留。显示标题为“目录”/“Directory”，关键词框在同一标题行右侧，AI 问答固定底部原位。
- 所有公开/管理错误都使用稳定 code；鉴权、代理验证、限流、版本/人工保护校验及 DB 异常均 fail closed。日志不记录关键词原文、URL、summary、tags、prompt 或模型原始响应。
- 新增 UI 文案同时进入 zh/en；AI 总结、分类建议、问答答案保持中文。

## 1. Files And Contracts

### 1.1 Data and category core

**Create**
- `src/db/migrations/0003_categories.sql` 与 `src/db/migrations/meta/0003_snapshot.json`；更新 `meta/_journal.json`。
- `src/lib/categories/store.ts`：接受 `Queryable/Transaction` 的分类读写和 overview。
- `src/lib/categories/classify.ts`：单条严格输出分类。
- `src/lib/categories/propose.ts`：bounded map-reduce 建议与判别联合 DTO。
- `src/lib/categories/apply.ts`：短事务、幂等、版本化 diff apply。
- `src/lib/categories/reclassify.ts`、`src/worker/jobs/reclassifyCategories.ts`：持久后台重跑。

**Modify**
- `src/db/schema.ts`、`src/worker/index.ts`、`src/worker/jobs/processItem.ts`。

**Schema**
- `categories(id uuid pk, name text not null, slug text not null unique, sort int not null default 0 check sort>=0, created_at timestamptz, updated_at timestamptz)`；`name` 使用唯一索引 `lower(btrim(name))`，拒绝空白名。`slug` 为稳定 `cat-<uuid-without-dashes>`，不依赖中文转写，公开锚点仍使用 id/slug，不从显示名拼接。
- `items.category_id uuid null references categories(id) on delete set null`；`items.category_manual boolean not null default false`；`items_category_idx`。
- `app_settings.categories_initialized boolean not null default false`；`category_version integer not null default 0 check >=0`。
- `category_change_runs(id uuid pk, request_key uuid unique, mode supplement|full|manual, base_version int, applied_version int null, accepted jsonb, ignored jsonb, reclassify_requested bool, reclassify_generation int not null default 0, snapshot_at timestamptz, cursor_created_at timestamptz null, cursor_id uuid null, status applying|reclassifying|completed|partial|failed|superseded, added/renamed/merged/deleted/ignored_count/manual_protected/reclassified/moved_unclassified ints default 0, error_code text null, created_at/updated_at/completed_at)`；检查计数、generation 非负与状态枚举。失败数不缓存，始终从 failure 明细 `count(*)` 派生。
- `category_reclassify_failures(run_id uuid references category_change_runs on delete cascade, item_id uuid references items on delete cascade, error_code text not null, attempts int not null default 1, updated_at timestamptz, primary key(run_id,item_id))`，只存稳定错误码，不存内容/模型响应。
- `category_run_retry_requests(run_id uuid references category_change_runs on delete cascade, request_key uuid not null, generation int not null check >=1, created_at timestamptz, primary key(run_id,request_key), unique(run_id,generation))`，append-only 保存所有 retry 幂等结果。

**Proposal DTO**
- `CategoryRef = {kind:'existing', categoryId} | {kind:'proposal', proposalId}`。
- `Diff` 为严格判别联合：`add{proposalId,name}`；`rename{proposalId,sourceCategoryId,name}`；`merge{proposalId,sourceCategoryId,target:CategoryRef}`；`delete{proposalId,sourceCategoryId}`。服务端附加 `autoCount/manualCount`，不信任模型/客户端计数。
- `AutoDestination = {kind:'unclassified'} | {kind:'target', target:CategoryRef}`。`AppliedDiff` 在上述字段外带最终编辑值；merge/delete 都必须带 `autoDestination`，可选择未分类或明确 target。所有 ID/name/ref 在 apply 时再次校验；target 必须在 apply 后存在且不得属于同批删除 source。

### 1.2 APIs and UI

**Create**
- `/admin/api/categories` GET/POST；`/admin/api/categories/[id]` PATCH/DELETE。
- `/admin/api/categories/propose` POST；`/admin/api/categories/apply` POST；`/admin/api/categories/runs/[id]` GET；`/admin/api/categories/runs/[id]/retry` POST。
- `/admin/api/items/[id]/category` PATCH（If-Match）。
- `src/app/admin/(protected)/categories/page.tsx` 与 `_components/CategoryWorkbench.tsx`。
- `src/app/admin/(protected)/library/[id]/CategorySelector.tsx`。
- `src/lib/categories/publicDirectory.ts`、`src/lib/search/keyword.ts`、`src/lib/ratelimit/publicKeyword.ts`、`src/lib/items/publicCorpus.ts`。
- `src/app/(public)/search/route.ts`、`src/app/(public)/favicon/[id]/route.ts`、`src/lib/favicon/siteFavicon.ts`。
- `src/app/(public)/_components/DirectoryShell.tsx`、`KeywordSearch.tsx`、`DirectoryData.tsx`、`DirectoryView.tsx`（只负责已加载目录/结果卡片）。

**Modify**
- `src/app/admin/(protected)/AdminNav.tsx`、`src/lib/items/detail.ts`、`src/app/admin/api/items/[id]/route.ts`、`src/app/admin/(protected)/library/[id]/ItemDetail.tsx`。
- `src/app/(public)/page.tsx`、`src/app/(public)/loading.tsx`、`src/messages/{zh,en}.json`、`src/app/globals.css`、`package.json`、`pnpm-lock.yaml`。

**Stable errors**
- Admin: `AUTH_REQUIRED`, `CSRF_INVALID`, `VALIDATION`, `DUPLICATE_CATEGORY`, `CATEGORY_NOT_FOUND`, `ITEM_NOT_FOUND`, `ITEM_CONFLICT`, `STALE_TAXONOMY`, `MANUAL_CATEGORY_CONFLICT`, `RUN_NOT_FOUND`, `AI_UPSTREAM_FAILED`, `AI_OUTPUT_INVALID`, `INTERNAL_ERROR`。
- Public search: 成功固定为 `{query:string,matches:SiteCard[]}`；错误固定为现有 `{error:{code,message,retryable}}` envelope。`QUERY_INVALID` 400、`RATE_LIMITED` 429、`SEARCH_UNAVAILABLE` 503；全部 `Cache-Control: no-store`。favicon 不暴露上游错误，失败返回同尺寸本地 fallback。

## 2. Ordered Implementation Tasks

### Task 1 — 迁移、schema 与升级证据（F201）

**Files:** migration/schema/meta；`tests/categories/schema.test.ts`、`tests/integration/migration-nav.test.ts`。

- [ ] 先从当前 M1 schema 运行 `corepack pnpm db:generate` 生成 0003/meta，再人工核对 SQL 只含本节 additive changes；禁止重写 0000～0002。
- [ ] 迁移增加 categories、items 字段、settings 字段、category_change_runs、category_reclassify_failures 和 category_run_retry_requests；外键 `ON DELETE SET NULL`；名称规范化唯一索引、slug 唯一、计数/状态/version checks。
- [ ] Schema 测试：默认值、NULL 分类、重复规范名、稳定 slug、FK set-null 后 manual true/false 均保持原值、旧 items type/status/embedding/tags checks 仍生效。
- [ ] 升级测试从应用完 0000～0002 且含 completed/failed/doc/vector fixture 的数据库执行 0003，断言原数据/向量/约束不变，并再次运行 0003 验证迁移工具不会重复应用。
- [ ] 生产步骤：先 `pg_dump`；应用 0003；运行 migration-aware readiness。回滚采用前向兼容：先回滚应用代码，保留新增表/列；不得在普通回滚中 drop taxonomy 数据。

### Task 2 — 事务可组合的分类 store（F201/F204）

**Files:** `src/lib/categories/store.ts`；`tests/categories/store.test.ts`。

- [ ] 定义 `CategoryError` 与 queryable 参数；apply 内所有 helper 必须使用传入 tx，测试用 spy 证明不回落全局 db。
- [ ] `listCategories` 按 sort/name/id；create/rename 先 NFKC + trim、1～80 字符、拒绝控制字符，依靠 DB 规范名唯一；slug 使用应用生成 UUID 构造，不手写中文 slugify。
- [ ] create 首次正式分类时原子置 initialized=true 并递增 category_version；rename/delete 同样递增 version。AI apply 使用内部“不单独增 version” helper，由 apply 整批只增一次。
- [ ] delete 返回受影响 auto/manual 数；显式 CRUD 删除依赖 FK set-null，保留 `category_manual`；overview 的 classified/unclassified 仅统计目录 eligible items，manual/docs 单独明确口径。
- [ ] 覆盖并发重名、not-found、事务回滚、首次初始化、删空后 initialized 仍 true。

### Task 3 — F203 单条分类器（纯模块）

**Files:** `src/lib/categories/classify.ts`；`tests/categories/classify.test.ts`。

- [ ] 输入 title/summary/tags 与 `{id,name}` 候选；内容用结构化 JSON 作为“不可信收藏数据”分隔，system prompt 禁止遵循其中指令，响应 JSON 的 categoryId 只允许现有 id 或 null（语义为 `NONE`）。
- [ ] 使用现有 `generateLlmText`；严格 zod 解析 `{categoryId:string|null,confidence:number}`，confidence 限 0～1，去围栏容错但限制响应大小。`categoryId=null`/`NONE` 或 confidence `<0.65` 均为可靠“未分类”；合法 ID 白名单以外视为 invalid。无候选不调用模型。
- [ ] 返回判别结果 `selected | unclassified | upstream_error | invalid_output`，让 worker 能区分可靠 NULL 与模型故障；模型异常不抛给主 worker。非法 JSON、阈值边界、超长输出、prompt-injection fixture 均有测试与脱敏 outcome 日志。

### Task 4 — worker 非阻断归类与并发门禁（F203）

**Files:** `src/worker/jobs/processItem.ts`；扩展 `tests/integration/processItem.test.ts`。

- [ ] 扩展依赖注入 `classify` 和 `loadTaxonomy`。summary/tags 生成后，在 completion transaction 之外读取 `{initialized,version,categories}`；仅 initialized + web/github + 当前 item 非人工时调用。
- [ ] 分类准备阶段任何 DB/AI 错误都转换为判别 outcome，不得进入 `failRequest`。`selected` 写候选、可靠 `unclassified` 写 NULL、`upstream_error|invalid_output` 不改现有分类（新 item 本来为 NULL）。记录 matched/unclassified/skipped/reason，不含内容。
- [ ] completion 短事务继续原子提交 item + processing request + Telegram receipt；分类字段只在 `items.category_manual=false` 且 settings.category_version 仍等于 snapshot version 时更新。候选分类还必须在同事务存在；不存在或 version 变化时不更新分类（新 item 保持 NULL，重处理 item 保持旧值），但 status 仍 completed。
- [ ] 测试：未初始化/doc/manual 不调用；合法/NULL；classifier/list DB 抛错仍 completed；推理期间管理员手动改分类不会覆盖；推理期间分类删除/version 变化不触发 FK/重试；Telegram receipt 仍 completed。

### Task 5 — F202 建议生成（bounded + strict）

**Files:** `src/lib/categories/propose.ts`；`tests/categories/propose.test.ts`。

- [ ] 只读取 snapshot 时刻前的 completed web/github；按 `(created_at,id)` keyset 每批最多 40 条，单 summary 最多 800 字、每 tag 80 字、总 prompt 有硬上限。每批提炼候选主题，再用第二阶段对候选与当前 taxonomy 聚合；所有项目均被某批考虑。
- [ ] `supplement` 输出过滤为 add 且不得与规范化现有名重复；`full` 可输出四型。模型仅返回 proposal refs/白名单 existing IDs；zod 严格解析、最多 50 项、name 1～80。AI 建议 name 必须含中文字符且不得是纯英文/数字；首次不合格时至多一次受约束重试，仍不合格抛 `AI_OUTPUT_INVALID`。管理员后续人工编辑名称不受“AI 输出中文”校验限制，但仍受通用名称校验。
- [ ] merge proposal target 可引用 existing 或同响应 add proposal；检测环、自合并、重复 source、悬空 ref。auto/manual counts 全部由 snapshot DB 查询覆盖模型值。
- [ ] 返回 `{mode,baseVersion,snapshotAt,diffs}`。AI/解析/分页失败抛稳定 `CategoryProposeError`，不写 taxonomy/run；记录触发模式、条目数、候选数与失败 code 的脱敏日志。
- [ ] 测试 supplement 只 add、四类 full、非法/注入/悬空/cycle、超过一批、并发分类版本改变（仍返回原 baseVersion，apply 再拒绝 stale）。

### Task 6 — 原子、幂等 diff apply 与持久 run（F202）

**Files:** `src/lib/categories/apply.ts`；`tests/categories/apply.test.ts`。

- [ ] 输入 `{requestKey,mode,baseVersion,accepted,ignored,reclassifyAuto}`；requestKey UUID 唯一。重复 key 返回既有 run，不重复写。不同 key 但 stale baseVersion 返回 `STALE_TAXONOMY`。
- [ ] 单个短事务：锁 settings；严格重验 DTO/refs/name/现有分类；预计算 source auto/manual。任一 merge/delete source 有 manual>0 则整个 apply `MANUAL_CATEGORY_CONFLICT`；不部分落库。
- [ ] 按 add→rename→merge→delete 拓扑应用。自动迁移只 `WHERE category_manual=false`；`AutoDestination.target` 必须最终存在且不在删除集合，unclassified 置 category_id=NULL 且 manual 仍 false。所有 helper 使用 tx；覆盖 delete→existing、新 add、改名后 target 及非法 target。
- [ ] 整批成功后 version 只加 1、initialized=true，写 run 的 accepted/ignored 与 server-derived counts。`reclassifyAuto=false` 置 completed；true 置 reclassifying、generation=0，并在事务提交后用 singleton key `category-reclassify:<runId>:0` 发 pg-boss。发送失败保留可由 publisher 扫描恢复的 reclassifying run。
- [ ] 测试 rename 保留人工项；AI merge/delete 人工冲突全回滚；自动 target/unclassified；拓扑 ref；请求幂等、stale preview、唯一冲突、publisher crash 恢复。

### Task 7 — 后台自动条目重跑（F202）

**Files:** `src/lib/categories/reclassify.ts`、`src/worker/jobs/reclassifyCategories.ts`、`src/worker/index.ts`；`tests/categories/reclassify.test.ts`。

- [ ] run 固定 `applied_version` 与 `snapshot_at`；keyset 扫描 snapshot 前 `completed AND web/github AND category_manual=false`。LLM 每条在事务外调用，提交短事务再次检查 manual=false、item 仍 eligible、settings version=run version、候选仍存在。
- [ ] item 更新与 run cursor/count 在同一事务；合法分类写 id，可靠无法归类写 NULL；网络/非法输出保持原值，在 `category_reclassify_failures` upsert 稳定 code/attempts。后续成功删除 failure 行。不得把 item status 改 failed。
- [ ] 新 taxonomy apply 令旧 run version 失效时标 superseded，旧结果不再写。pg-boss 重试从持久 cursor 继续；崩溃最多重复 LLM 调用，不重复计数/覆盖人工值。
- [ ] GET run 在同一查询中从 failure 表派生 `failedCount`，并以 `exists(failure)` 判定 partial；taxonomy 本身已应用。受保护 POST retry 输入 `requestKey`：事务内先查 `category_run_retry_requests`，已存在则永久返回其 generation、不重复发布；否则只允许 partial/failed 且 settings.version=run.applied_version，分配 `reclassify_generation+1` 并插入 `(run,key,generation)`、置 reclassifying，提交后用 singleton key `category-reclassify:<runId>:<generation>` 只遍历 failure 行。reclassifying 时新 key 返回 409；版本已变返回 STALE_TAXONOMY。
- [ ] failure upsert 增加 attempts 但不维护缓存总数；成功、item 已删除、已变 manual、已非 eligible 都删除 failure（后三者记 resolved_skipped，不改分类）。完成状态在事务内按 failure `exists` 置 completed/partial；记录 reclassified/unclassified/failed/resolved_skipped/superseded 事件。
- [ ] 测试离页轮询、worker 重启、人工竞态、新版本抢占、非法候选、重复失败不重计、人工处理后收敛、部分失败、相同/不同 retry key 和重试成功清零。

### Task 8 — 管理 API 与条目详情分类选择器（F202/F204）

**Files:** admin routes、分类 page/workbench、`CategorySelector.tsx`、现有 detail DTO/API/UI；`tests/categories/api.test.ts`、管理 e2e。

- [ ] 所有 admin GET 先 `requireAdminApi` 且 no-store；写操作先 `requireAdminWrite`（session→Origin→CSRF→Content-Type），再 body zod。任何 guard 失败立即返回。
- [ ] propose 返回临时 diff；apply 要 requestKey/baseVersion；run GET 与 retry POST 支持重进恢复。错误按 §1.2 映射，模型错误 502，stale/conflict 409。apply 响应 `{runId,status,counts}`；retry 响应同一 run 的新 generation/status。
- [ ] 分类 CRUD 删除先返回/展示受影响 auto/manual 数并二次确认；直接删除后 manual 标志保持。系统“未分类”不是可编辑行。
- [ ] 扩展 item detail DTO 为 `categoryId/categoryName/categoryManual`；详情页显示单选分类/未分类。PATCH category 需要现有 If-Match，验证 category 存在，在一个 update 中设置 category_id、`category_manual=true`、updated_at，并返回新 ETag；并发摘要编辑得到 409 而非静默覆盖。
- [ ] Workbench 严格实现批准的两入口、diff 接受/忽略/编辑、自动去向、人工保护横幅、放弃预览、独立确认、默认开但可关的重跑、真实进度/partial/error/retry；全部忽略禁用应用，请求开始后防重复。
- [ ] E2E：未登录/CSRF/content-type；补充仅 add；full 四型；人工冲突引导先改条目；响应丢失用相同 requestKey 恢复；离页再进恢复 run；CRUD；详情分类保存/冲突/失败回滚。

### Task 9 — F209 字面查询与独立 fail-closed 限流

**Files:** `src/lib/search/keyword.ts`、`src/lib/ratelimit/publicKeyword.ts`、`src/app/(public)/search/route.ts`；搜索测试。

- [ ] `q` NFKC+trim，1～100 字符，拒绝 NUL/控制字符；空 q 在 UI 不发请求，API 空值返回 `QUERY_INVALID`。搜索仅 eligible items。
- [ ] `escapeLikeLiteral` 把 `\\`、`%`、`_` 转义；参数值为 `%${escaped}%`，SQL 明确 `ILIKE $n ESCAPE '\\'`。tags 使用 `EXISTS (SELECT 1 FROM unnest(items.tags) tag WHERE tag ILIKE $n ESCAPE '\\')`；所有值参数化，禁止 SQL 字符串拼接。
- [ ] 结果字段 id/title/url/summary/tags/categoryName/faviconPath；left join categories；按 `lower(coalesce(title,url)),id` 确定性排序。route 成功严格返回 `{query:normalizedQ,matches}`；不得 import/call retrieve、embedding、LLM 或 ask。
- [ ] `consumePublicKeyword(ip)` 复用 `getTrustedClientIp`、按日 HMAC 与同事务固定顺序行锁；counter scopes 使用 `kw:global` 和 `kw:ip:<hash>`，数值沿用现有公开配置但与 ask scopes 隔离；不检查模型 readiness。代理/密钥/DB/事务异常返回 503，绝不放行。
- [ ] 单元/集成：title/summary/tag、大小写、doc/非 completed 排除、空/101/NUL、`%`/`_`/`\\`/`%';drop` 按字面、确定排序、0 次 LLM/向量；并发屏障证明不超过 IP/global 上限，关键词请求不改变 ask counters。

### Task 10 — 公开目录、favicon 与问答可用性（F205/F207）

**Files:** `publicDirectory.ts`、`publicCorpus.ts`、favicon module/route；目录/favicon 测试。

- [ ] `getPublicDirectory` 一次查询/可控查询数返回全部 categories（包括空组）和 eligible items；分类 sort/name/id、站点 title/url/id 排序；未分类组始终存在并固定末尾。SiteCard 的 faviconPath 为同源 `/favicon/<itemId>`。
- [ ] favicon route 只接受 UUID item id；先查询该 id 必须是 eligible item，再从其已存 URL origin 推导 `/favicon.ico`，不接受 query URL/host。复用/抽取现有 `safeFetch` 的全 A/AAAA、逐跳 redirect、固定已审查 IP、超时与流式 128 KiB 限制；仅 `image/png|jpeg|gif|webp|x-icon|vnd.microsoft.icon`，拒绝 SVG/HTML。用 Next server cache/请求合并缓存成功 7 天、失败 1 小时；响应公共缓存，任何错误返回本地 data/fallback，不泄露目标。
- [ ] `hasCompletedAskCorpus()` 只判断任意 completed item（含 doc）。首页继续独立调用它与 `getPublicAskReadiness()` 构造原 AskExperience disabledReason；不以目录为空禁用问答。
- [ ] 测试：空分类、始终有未分类末组、排序/过滤、查询规模；favicon 任意 URL 不可输入、非 eligible 404/fallback、重定向内网/超限/错误 MIME fail closed、缓存；doc-only 时 ask 可用而目录空。

### Task 11 — 公开 C 工作台首页与 URL 状态（F205/F206/F208/F209）

**Files:** `page.tsx`、`loading.tsx`、`DirectoryShell.tsx`、`KeywordSearch.tsx`、`DirectoryData.tsx`、`DirectoryView.tsx`、CSS、public e2e。

- [ ] page 删除 hero/daily render 与 `pickDailyForNow` import/call，保留品牌/语言、skip link、问答 readiness 与 `AskExperience`。`DirectoryShell` 与 `KeywordSearch` 先渲染且不读取目录；`DirectoryData` 是唯一 suspend/catch `getPublicDirectory` 的 async child，成功把数据交给纯展示 `DirectoryView`，失败返回局部 error props。AskExperience 是 shell 的 sibling，不在 Suspense/error 区。`loading.tsx` 渲染同一标题行/搜索占位、目录骨架与底部问答占位，不退回 hero/daily。
- [ ] `DirectoryShell/KeywordSearch` 以 URL `q` 为已提交事实源：输入可编辑但不自动请求；Enter/按钮提交 `router.push`，清空移除 q；首载/刷新/复制链接/前进后退按 q 取结果。新请求 abort 旧请求，响应只更新对应 query。默认时展示 `DirectoryData` 子区域，搜索提交后只用结果区替换它。
- [ ] 默认目录、输入中、3 骨架 loading(`aria-busy`)、结果、无结果、具体失败+重试齐全。目录读取失败由局部 `role=alert` + `router.refresh` 恢复，关键词框与问答仍可见；搜索失败不是空结果。结果替换目录主体；标题/命中数/不调用 AI 文案按 UI spec。关键词控件与 AI 问答保持空间/名称区分；输入边界错误内联显示并把焦点留在输入框。
- [ ] 锚点设置稳定 id、`scroll-margin-top`；点击后焦点到连续标题并设 `aria-current=location`。reduced motion 禁平滑；移动端关键词完整宽度、按钮和所有触控目标至少 44px；长文本不溢出。
- [ ] 卡片整卡 `<a target="_blank" rel="noopener nofollow">`，真实 favicon 失败显示同尺寸域名首字母且不布局跳动。
- [ ] Playwright 在 1440×1000 与 390×844 覆盖无 hero/daily/旧文案、标题行几何、URL 状态四场景、目录初载/局部失败恢复、所有搜索状态、abort 竞态、锚点焦点、空分类/末组、安全外链、favicon fallback、doc-only AskExperience、问答提交回归；检查横向溢出、控制台/CSP 错误、reduced-motion/transparency/contrast。

### Task 12 — i18n、管理导航与可访问性收口

**Files:** zh/en、AdminNav、相关 UI/CSS；i18n/unit/e2e。

- [ ] 新增目录/关键词/diff/run/分类/错误/状态文案，zh/en 键集完全一致；页面不再引用 eyebrow、副标题、关键词说明或 daily 展示键。
- [ ] 用 `corepack pnpm add lucide-react@1.31.0 --save-exact` 更新 package/lock；只做命名 import 所需图标，记录 ISC/官方仓库核对并运行 `corepack pnpm audit --prod`（已知项需记录，不以自动 force 升级破坏锁）。AdminNav 增加分类入口；桌面/移动遵循 C 工作台批准布局，图标按钮使用 Lucide/可访问名；不手绘 SVG，不新增卡片嵌套。
- [ ] 复用现有 `Pressable`/`MotionRegion`/`MaterialSurface`：pointer-down 立即反馈、cancel/新输入从当前状态恢复，锚点滚动/面板/toast 可中断；reduced motion 禁位移/平滑滚动，reduced transparency 改实色。禁止为展示加入 setTimeout/人工进度。unit/e2e 覆盖 pointer cancel、快速重复输入与源码/假时钟无演示延迟。
- [ ] 键盘走通关键词、锚点、外链、F202 两入口、diff 编辑/去向/确认、CRUD、详情分类；状态不只靠颜色；role/status/alert/live 与焦点恢复明确。
- [ ] 自动断言 WCAG AA 对比度目标、44px 触控、标题层级/skip link、name/autocomplete、无页面级横向溢出；保存批准尺寸截图作为实施证据。

### Task 13 — 观测、性能、回归与发布门禁

**Files:** logger events、tests、`.workflow/implementation-report.md`（实施阶段填写）。

- [ ] 结构化事件：`category_proposal_generated`、`category_diff_applied`、`category_classified`、`category_reclassify_progress|finished`、`keyword_search_limited|completed`；只含 mode/outcome/count/ms/version/errorCode，不含内容/IP/hash。
- [ ] 数百条 fixture（至少 500 eligible + 50 doc）验证目录查询次数有界、DB keyword p95 目标先定为本机集成环境 <1s；不达标停止发布或由用户明确接受，不偷偷分页漏掉“全量”。F202 多批测试证明全部 fixture 被考虑。
- [ ] `corepack pnpm typecheck`、`corepack pnpm lint`。
- [ ] `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm test`，含 migration/category/worker/search/favicon/ask 回归。
- [ ] `DATABASE_URL=... APP_TIMEZONE=Asia/Shanghai corepack pnpm e2e`，含公开与管理批准流程。
- [ ] PA-01 强制门禁：`env -u DATABASE_URL corepack pnpm build` 必须退出 0；再运行 `node scripts/verify-production-artifact.mjs --prune .next/standalone`，证明新 server modules 未在 import 时访问 DB。保留现有 Dockerfile placeholder smoke 断言。
- [ ] 在 0000～0003 数据库运行 readiness、worker heartbeat、reclassify crash recovery；执行新备份的 restore smoke，确认 categories/run/items 分类与既有向量均恢复。
- [ ] implementation report 记录逐命令退出码/测试数/截图/性能、迁移备份与回滚演练、任何偏差和残余风险；无证据不得勾选完成。

## 3. Requirement Traceability

| Requirement | Tasks | Required evidence |
| --- | --- | --- |
| F201 数据模型 | 1, 2 | M1→0003 升级、schema/FK/manual/version/run constraints |
| F202 补充/全量 diff | 5, 6, 7, 8, 13 | strict proposal、原子幂等 apply、后台恢复/部分失败、审计/指标、e2e |
| F203 新条目归类 | 3, 4, 13 | initialized/manual/version 门禁、失败仍 completed、日志 |
| F204 CRUD/人工优先 | 2, 8 | admin guards、删除确认、详情 ETag selector、人工竞态 |
| F205 公开目录 | 10, 11 | 全量 eligible、空组/末组/排序、favicon/外链、500 条基准 |
| F206 首页布局 | 11, 12 | 无 hero/daily/旧文案、标题行搜索、底部问答、响应式截图 |
| F207 问答不变 | 10, 11, 13 | doc-only/readiness 与既有 ask 回归，独立 quota |
| F208 锚点 | 11, 12 | scroll+focus+aria-current+reduced motion |
| F209 字面搜索 | 9, 11, 13 | literal escape/参数化、独立 fail-closed 限流、URL/状态/e2e、0 AI |

## 4. Stop Conditions And Residual Decisions

- 如 approved requirements/UI 对“AI merge/delete 时仍保留被删 source 的人工归属”被解释为必须物理保留已删除分类，则当前 FK 模型不可实现；本计划选择 fail-closed 阻止该 destructive diff，直到管理员显式迁移人工条目。最终审计若认为这改变批准语义，必须退回用户裁决，不能静默放宽保护。
- 如果现有 `safeFetch` 无法安全支持 binary favicon，不得直接放开 CSP 或远端 img-src；使用本地首字母 fallback 并把真实 favicon 标记为未完成阻断项。
- 如果数百条 F202 两阶段聚合超过模型上下文/费用上限，停止并记录观测数据，由用户决定更小样本或离线批处理；不得静默忽略尾部条目。
- 任何 migration、worker non-blocking、manual protection、public limiter、ask regression、approved Playwright 或 no-DATABASE_URL build 门禁失败都阻止发布。
