# 实施进度

## 2026-08-09：阶段验收返工 R1/R2

- 范围：仅修复 T01 日志内嵌 URL 脱敏 fail-open 与 T03/T04 embedding 元数据约束 fail-open；未进入 T05。
- 红灯：`pnpm vitest run tests/unit/logger.test.ts` 退出 1，新增 2 个日志用例失败；真实 PostgreSQL 上运行 `tests/integration/pgvector.test.ts` 退出 1，新增 2 个非法 embedding 插入均被数据库接受。
- R1：任意字符串位置的 HTTP(S) URL 均移除 userinfo，并删除 `token`、`key`、`secret`、`password`、`authorization` 等敏感 query 参数；Error 继续使用既定 allowlist，message/cause 经同一字符串清洗，stack 与其他可枚举字段不进入输出。
- R2：新增 `0002_embedding_constraints.sql` 前向迁移，严格要求 embedding 与 dim/version 全空或全合法，并校验 `vector_dims(embedding) = embedding_dim`；未修改既有迁移。
- 绿灯：日志定向测试 6/6；真实 PostgreSQL pgvector 定向测试 5/5，两类非法写入均以 SQLSTATE `23514` 拒绝；验收员原始日志反向命令退出 0。
- 全量验证：干净库迁移退出 0；`pnpm test` 为 6 files / 47 tests 通过；`pnpm typecheck`、`pnpm lint` 退出 0；`pnpm audit --prod` 报告无已知漏洞。
- 变更文件：`src/lib/log/logger.ts`、`tests/unit/logger.test.ts`、`src/db/schema.ts`、`tests/integration/pgvector.test.ts`、`src/db/migrations/0002_embedding_constraints.sql` 及 Drizzle migration metadata。
- 回滚：回退本次代码提交；数据库遵循批准的前向兼容策略，不执行破坏性 down migration。若应用代码需要回退，新约束可保留，不改变合法数据语义。

## 2026-08-09：T15 收藏库列表与筛选

- 红灯：路由集成测试因 `/admin/api/items/list` 不存在退出 1；组件测试因 `LibraryView` 不存在退出 1。
- 查询与边界：新增管理员鉴权 GET 路由，支持标题/总结/链接关键词、多标签交集、状态组合筛选以及 `updated_at,id` 稳定游标分页；响应仅显式映射展示 DTO，不返回 embedding、内部代际、canonical URL 或配置密文。
- 界面：实现 loading、空库、筛选无结果、失败/重试、加载更多状态；筛选写入 URL，桌面高密度列表与移动端单列均无溢出。
- 验证：真实 PostgreSQL 16 + pgvector 定向集成/单元测试 10/10；生产构建 Playwright 桌面/移动 2/2，正常筛选流程控制台零错误且无横向溢出；`pnpm typecheck`、`pnpm lint`、`git diff --check` 退出 0。
- 视觉证据：`.workflow/screenshots/t15-admin-library-desktop.png`、`.workflow/screenshots/t15-admin-library-mobile.png`。

## 2026-08-09：T16 条目详情编辑、重抓与删除

- 红灯：集成测试因 `/admin/api/items/[id]` 路由不存在退出 1；组件测试因 `ItemDetail` 不存在退出 1。
- API：新增鉴权 GET/PATCH/DELETE 详情管线与 POST refetch；PATCH 仅允许 summary，用数据库完整 `updated_at` 精度编码 ETag 实现乐观并发，成功后置 `summary_manual=true`；重抓复用 T12 事务且 processing 冲突返回 409；删除依靠既定 FK cascade 清理向量条目、处理 outbox、Telegram 回执与每日选择。
- UI：实现详情 loading/error/retry，人工总结编辑与失败草稿保留，processing 重抓禁用，原生 modal dialog 二次确认及关闭后焦点返回，保存/重抓/删除统一 `aria-live` 通知；桌面双列与移动单列均通过视觉核对。
- 安全与边界：所有写操作依次执行会话、Origin、CSRF、JSON Content-Type 与 schema 检查；详情 DTO 不返回 embedding、canonical URL、process generation、密文或 internal stack；无新增外部依赖与日志敏感文本。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 27 files / 153 tests PASS（精确向量基准 100/500/1000 行 recall@10 均为 1）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；`pnpm db:migrate` 成功；生产构建 Playwright 8/8 PASS；Web Interface Guidelines 新鲜规范复核通过。
- 视觉证据：`.workflow/screenshots/t16-admin-detail-desktop.png`、`.workflow/screenshots/t16-admin-detail-mobile.png`。

## 2026-08-09：阶段验收返工 R6–R10

- R6/R7 红灯：有效 session/CSRF 下，`application/jsonp` 与同 host 跨 scheme Origin 的 DELETE 均实际返回 204 并删除条目。修复后统一 `requireAdminWrite` 用 `MIMEType.essence` 精确接受 `application/json` 及合法参数，Origin 同时匹配请求 scheme 与 Host 的 host+port；跨 scheme/端口/host、缺失和畸形值均在业务前拒绝。共享写管线定向集成 28/28 PASS，生产 Next 运行兼容。提交 `d3e1f25`、`bd58faf`。
- R8 红灯：refetch 对畸形 JSON/数组/多余字段均返回 202 并入队，DELETE 对同类输入均返回 204 并删除。修复后两路由在写入前完成 JSON 解析与 strict 空对象 Zod 校验，无效输入返回 400 且 generation/outbox/item 零变化。提交 `958afb6`。
- R9 红灯：canonical `src/app/admin/api/items/route.ts` 的 GET 为 undefined，7/7 集合合同测试失败。修复后 GET/POST 同驻 `/admin/api/items`，前端、集成与 E2E 全部迁移，`/list` 路由与引用已物理删除；定向 14/14 PASS。提交 `ce3b0b7`。
- R10 红灯：加载状态内 `.library-skeleton-row` 数量为 0。修复后提供 3 行与真实列表一致的主内容/元信息网格骨架，桌面双列、移动单列，保留可读 `role=status` 文案；组件 3/3 与生产 E2E 桌面/移动 2/2 PASS。提交 `d9b256d`。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 27 files / 161 tests PASS（精确向量基准 recall@10 均为 1）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；`pnpm db:migrate` 成功；生产 `next build + next start` Playwright 8/8 PASS。
- 新增视觉证据：`.workflow/screenshots/t15-admin-library-loading-desktop.png`、`.workflow/screenshots/t15-admin-library-loading-mobile.png`。

## 2026-08-09：阶段验收 R6 残留项窄修

- 红灯：有效 session/CSRF/同源下，`Content-Type: application/json; charset` 被 Node `MIMEType` 容错为 `application/json`，DELETE 实际返回 204 并删除条目。
- 修复：统一 `requireAdminWrite` 不再依赖容错 MIME 解析，改为对原始 Header 整串做严格白名单校验；仅接受 `application/json` 或单一且值为 `utf-8` 的 `charset` 参数（大小写不敏感），裸参数、空值、未知/多参数和重复分号均在业务写入前返回 415。
- 回归：详情集成测试覆盖 8 类非法 Content-Type 且确认零删除，同时验证无参数、`charset=utf-8` 与大小写变体合法；定向共享写管线 29/29 PASS。代码提交 `0068b51`。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 27 files / 162 tests PASS（精确向量基准 recall@10 均为 1）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；`pnpm db:migrate` 成功；生产 `next build + next start` Playwright 桌面/移动 8/8 PASS；工作流校验器 PASS（stage=implementation, revision=5）。

## 2026-08-09：T17–T19 检索、每日轮换与国际化

- T17 红灯：`retrieve`/`pickDaily` 目标模块不存在，2 个计划测试套件退出 1。实现后用真实 pgvector 验证当前 version/dim/status 隔离、动态阈值、Top10 精确余弦排序、非 ready 在 embedding 前 fail-closed；每日选择在 advisory lock 事务内持久化，并发首访同组同序、同日稳定、未展示/最久未展示优先、少于 3 条与删除补位均通过。提交 `fbd4c29`。
- T18 红灯：公开问答路由、回答 schema 与可信 IP/限流模块不存在，2 个套件退出 1。实现 DB-only readiness 快检与事务内锁后复检，global→IP 固定顺序原子计数，超限/存储异常不调模型，无命中返回固定文案且 LLM=0，归纳仅接受命中 ID 白名单，来源 DTO 由服务端组装。定向 29/29 PASS。提交 `bdc15aa`，Next route 导出合同修复 `a7d8401`。
- DEV-002（架构师已批准）：Next App Router 不暴露 TCP peer，因此以 Caddy/应用独占 `PROXY_SHARED_SECRET` 常量时间认证代替 socket peer CIDR 校验；仅认证成功才信任单值规范化 `X-Real-Client-IP`，否则 403、零计数、零模型。客户端伪造 XFF/真实 IP 头无有效密钥均不受信；IP 仅以 `HMAC-SHA256(IP_HASH_KEY, day || ip)` 按日不可链接 scope 入库。Caddy 剥离/注入规则依批准计划在 T25 落地，最终报告需再登记失效条件。
- T19 红灯：中英字典与 request config 不存在，集成套件退出 1；完成 SSR cookie canonical locale、localStorage 单向镜像、递归中文回退、两端共享切换器、当前管理端全状态字典与本地化日期。TSX 静态扫描无未登记中文 UI 字面量；英文 UI 中条目/标签/AI 中文总结保持原样。提交 `fc12606`。
- 新增运行时依赖：`next-intl@4.13.5`，用于 Next App Router SSR/客户端国际化，MIT License。初选 4.3.12 被 `pnpm audit --prod` 检出 2 个 Moderate 公告后立即升级；4.13.5 审计为无已知漏洞。不使用的 `@parcel/watcher`/`@swc/core` 传递安装脚本在 pnpm 策略中显式拒绝，冻结锁文件安装、生产构建与 E2E 均通过。修复提交 `9b754b0`。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 32 files / 202 tests PASS（精确向量基准 100/500/1000 行 recall@10=1，P95 均 <1ms）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；冻结锁文件安装、`pnpm db:migrate`、独立生产 `next build` 通过；生产 `next build + next start` Playwright 桌面/移动 10/10 PASS；workflow validator PASS（stage=implementation, revision=5）。
- Web Interface Guidelines 新鲜审查后，语言切换按钮补齐 44px 触控目标、hover 反馈与全局 `focus-visible`；桌面/移动截图无重叠或横向溢出。证据：`.workflow/screenshots/t19-i18n-en-desktop.png`、`.workflow/screenshots/t19-i18n-en-mobile.png`（提交 `3d1d64c`）。

## 2026-08-09：阶段验收返工 R11

- 红灯：新增业务日测试引用的 `businessDay`/`pickDailyForNow` 不存在，2 个套件退出 1；验收探针已证明旧限流实现使用 UTC `toISOString()` 切日，上海零点后仍写前一日。
- 修复：新增集中 `businessDay(now)`，用 `Intl.DateTimeFormat.formatToParts` 与经校验的 `APP_TIMEZONE` 生成 `YYYY-MM-DD`；限流的 `ask_counters.day` 和 IP HMAC day 共用该值。配置缺失、无效或时刻无效时报 `APP_TIMEZONE_INVALID`，限流事务回滚并 fail-closed 为 `MODEL_UNAVAILABLE`，不生成计数。
- 每日轮换核对：旧 `pickDaily(day)` 只消费显式业务日，本身没有 UTC 取日；本次新增 `pickDailyForNow(now)` 并复用同一 `businessDay()`，供 T23 公开首页调用。集成测试在 `2026-08-09T16:30Z` 同时执行限流与每日选择，两表 day 均为 `2026-08-10`。
- 回归：覆盖上海零点 `UTC 16:00±`、UTC 零点不误换日、缺失/非法时区零写入、计数/HMAC scope 同步轮换、限流/每日选择同时刻一致；定向 39/39 PASS。提交 `6d8de26`。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 33 files / 210 tests PASS（精确向量基准 recall@10=1，P95 均 <1ms）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；冻结锁文件安装、`pnpm db:migrate`、独立 `next build` 通过；生产 Playwright 桌面/移动 10/10 PASS；workflow validator PASS（stage=implementation, revision=5）。

## 2026-08-09：阶段验收返工 R11b

- 红灯：`ratelimit_enabled=false` 且 `APP_TIMEZONE` 缺失/非法时，`consumePublicAsk` 在业务日校验前提前 commit，2 个反向用例均错误解析为 `{allowed:true}`。
- 修复：将 `businessDay(now)` 前移到 disabled 早退之前；限流开关只决定是否写计数，不绕过业务日配置门禁。回归确认 disabled+缺失/非法时区在 service 层拒绝、handler 503、retrieve/answer=0、counter=0；disabled+合法时区仍正常放行且零计数。定向 35/35 PASS，提交 `fdb8762`。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 33 files / 213 tests PASS（recall@10=1，P95 均 <1ms）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；冻结锁文件安装、`pnpm db:migrate`、独立 `next build` 通过；生产 Playwright 桌面/移动 10/10 PASS；workflow validator PASS（stage=implementation, revision=5）。

## 2026-08-09：T20–T21 Telegram 添加、回执与私有提问

- T20 红灯：`tgAdd.test.ts` 与 `tgReceipt.test.ts` 因 bot/dispatcher 模块不存在退出 1。实现 grammY long polling adapter，在解析消息前查询 `tg_allowed_ids` 白名单；单消息去重后最多逐条处理 10 个 URL，复用 `assertPublicUrl` 和 processing outbox，chat ID 仅以按键 HMAC 与随机 AES-GCM 密文入库。
- T20 回执：dispatcher 用 `FOR UPDATE SKIP LOCKED` 原子领取、30 秒 lease 和超时回收；429 按 `retry_after` 持久退避，无终态 outcome 的异常 ready 记录 fail-closed 不发送。保留已接受 AR-001：Telegram 无幂等键，发送后、标记 sent 前崩溃时重试可重复，第二次 lease 将 `duplicatePossible=true` 供 T22 指标记录。提交 `f0125c8`。
- T21 红灯：新增 6 个提问/命令用例时 5 个失败，证明旧 handler 对非 URL 消息直接忽略。实现“白名单 → `/refetch|/retry <8 位短 ID>` → URL 添加 → 非空提问”优先级；短 ID 未知或歧义统一回“未找到”，畸形命令不降级为检索。提问在模型/embedding rebuild DB-only readiness 通过后复用 `retrieve` + `answerFromHits`，无命中固定回执且 LLM=0，来源仅由服务端 hits 拼装且最多 10 条；未调用公开限流，`ask_counters` 保持为空。提交 `f6a2877`。
- 新增运行时依赖：`grammy@1.38.3`，用于 Telegram Bot API long polling 与 `sendMessage` adapter，MIT License；`pnpm audit --prod` 报告无已知漏洞。Telegram 网络在测试中使用注入 transport，未访问真实 Bot API，Token 仅通过服务端 `getDecryptedSecret` 读取。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 36 files / 228 tests PASS（精确向量基准 100/500/1000 行 recall@10=1，P95 均 <1ms）；T20–T21 定向 15/15 PASS；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；冻结锁文件安装、干净库 `pnpm db:migrate`、独立 `next build` 通过；生产 `next build + next start` Playwright 桌面/移动 10/10 PASS；workflow validator PASS（stage=implementation, revision=5）。

## 2026-08-09：阶段验收返工 R12

- 红灯：完成回执对“第一句。第二句。第三句。”与 `Foo. Bar.` 均发送整段，连续省略号也未截断，定向测试 9 例中 3 例失败。
- 修复：`firstSentence` 在 trim 后以第一组连续中英文句末标点（`。！？!?.…`）为边界，保留完整标点组并截断后文；无句末标点时保留整段，null/空白总结使用固定占位。未改动 dispatcher 领取、lease、退避或发送状态机。
- 回归：覆盖中文无空格多句、英文句点、无标点、null 与连续省略号/多标点，定向 9/9 PASS。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 36 files / 233 tests PASS（recall@10=1，P95 均 <1ms）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；冻结锁文件安装、干净库 `pnpm db:migrate`、独立 `next build` 通过；生产 Playwright 桌面/移动 10/10 PASS；workflow validator PASS（stage=implementation, revision=5）。
