# Review Ledger（Codex 方案评审台账 · append-only）

> 记录每轮评审：稳定 finding ID、严重级、修复、证据、接受的风险、计划修订号。最多 5 轮；收敛标准=无未解决 Critical/High，Medium 已修或明示接受。

## 计划修订
- rev1（2026-08-08）：架构师初稿 implementation-plan.md，含 T01–T25、需求追踪矩阵、数据模型、安全/上线/回滚。
- rev4（2026-08-08）：Codex Cycle1–3 修订后经 codex_accepted；最终审计给出 conditional go。
- Cycle 4（待处理，2026-08-08T22:22 用户"继续改进"授权）：窄修订 final-audit 新增残余项 L-AUD-01(重建期先扣额度)、L-AUD-02(密码恢复runbook)、L-AUD-03(GitHub 限额错误码/退避)、L-AUD-04(ui-spec 状态同步) + decisions.md D-02~D-04 定稿；目标产出 rev5。范围仅限以上，不得改变已确认产品行为。

## Cycle 0（待 Codex 方案验证器分析）
- 状态：pending
- 未解决计数：critical=0 / high=0 / medium=0 / low=0（初始，待评审填充）
- Findings：待填充

## Cycle 1（完整分析：rev1）
- 状态：findings_recorded，待修订与复审
- 分析基线：implementation-plan.md rev1；requirements.md v0.4；ui-spec.md v0.4；decisions.md；acceptance-rubric 全 10 项。
- 未解决计数（修订前）：critical=1 / high=6 / medium=6 / low=0

### CR-001 — Critical — SSRF 边界可被重定向或 DNS rebinding 绕过
- 证据：rev1 T02 只在首次请求前 `dns.lookup`；T09 直接消费 `assertPublicUrl`，未规定每个 redirect hop 重新校验、连接时固定已审查 IP、响应流大小限制的执行点。
- 影响需求：F-03；NFR-安全。
- 影响：攻击者可让初始公网 URL 重定向到内网/云元数据，或在校验与连接间改变 DNS 答案，读取管理网络资源。
- 修复建议：建立唯一 `safeFetch` 出口；手动跟随有限次重定向并逐跳校验；解析全部 A/AAAA 且任一非公网即拒绝；连接通过自定义 lookup 固定到已审查地址；每跳重新固定；超时/字节/MIME 限制在流式读取层执行；任何校验异常 fail closed。
- 处置：open（目标 rev2）。

### CR-002 — High — Telegram 完成回执没有跨进程持久化通知合同
- 证据：rev1 T11 的作业没有 chat/request 上下文；T20 只写“作业完成回调/通知”，未给表、消息、幂等键、失败重试或 worker 重启恢复方式。
- 影响需求：F-02、F-03。
- 影响：入库作业能完成，但 bot 无法可靠知道应向哪个 chat 主动发送一句话总结；进程崩溃会永久丢回执。
- 修复建议：增加持久化 Telegram receipt/outbox；TG 接收时写订阅，作业最终成功/失败在同一 DB 事务中将 outbox 置 ready；独立 dispatcher 用 `FOR UPDATE SKIP LOCKED`、幂等键和退避发送。
- 处置：open（目标 rev2）。

### CR-003 — High — 固定 `vector(1536)` 与任意 OpenAI 兼容嵌入模型冲突，`ivfflat lists=100` 不适合几百条
- 证据：rev1 schema 固定 `vector(1536)`，设置默认 `emb_dim=1536`；T08 让 UI 改维度后运行期重建列；索引用 `ivfflat lists=100`，未给训练数据量、probes 或召回基准。
- 影响需求：F-06、F-08；NFR-性能。
- 影响：实际模型返回非 1536 维时写入/查询失败；几百条上 100 个倒排列表会造成低召回或空列表，且运行时 DDL 容易中断服务。
- 修复建议：v1 使用无 typmod 的 `vector` + 当前 `embedding_dim/version` 过滤并做精确扫描；保存配置前实调一次探测维度；模型/维度变化递增版本并重嵌入，旧版本不参与查询；以召回/时延基准作为未来 HNSW 门槛，不在几百条上使用 ivfflat。
- 处置：open（目标 rev2）。

### CR-004 — High — 公开提问的双计数原子性、可信客户端 IP 与失败策略未落地
- 证据：rev1 T18 仅称“原子 upsert 计数”，没有说明 IP 与 global 两行如何在一个事务内先判定再同时递增；没有反向代理信任边界、IPv4/IPv6 规范化、哈希密钥或 DB 失败行为。
- 影响需求：F-06、F-12；NFR-安全/隐私。
- 影响：并发请求可越过单 IP 或全站上限；伪造转发头可轮换身份；部分递增或 DB 错误放行会产生额外模型费用。
- 修复建议：同事务按固定顺序锁 settings/global/IP 行，先检查再同时 `count+1`；超限回滚且不调用 embedding/LLM；仅信任 Caddy 重写的单一客户端 IP 头且校验代理来源；规范化 IP 后用按日 HMAC；任何解析/存储错误 fail closed；增加并发屏障测试。
- 处置：open（目标 rev2）。

### CR-005 — High — Top10 无相关性门槛使“无命中”行为不可实现
- 证据：rev1 T17 总是从所有 completed 向量取 Top10；T18 仅以 hits 为空判断无命中，没有相似度阈值或质量校准。
- 影响需求：F-06、F-07。
- 影响：只要库非空，不相关问题也会返回若干最近邻并调用 LLM，违反固定无命中文案和禁止编造要求。
- 修复建议：retrieve 返回 score，使用版本一致、可配置/有默认值的余弦阈值；低于阈值全部丢弃；以正/负 fixture 校准并记录召回率；无 hits 时不调用归纳 LLM。
- 处置：open（目标 rev2）。

### CR-006 — High — 每日 3 条只更新条目字段，不能保证并发和数据变化下同日稳定
- 证据：rev1 T17 以日期种子查询并更新 `last_shown_on`，没有按 day/rank 保存选中集合或并发锁。
- 影响需求：F-11。
- 影响：同日首批并发请求可能看到不同组；当天新增/删除完成条目也会改变种子候选集。
- 修复建议：新增 `daily_selections(day,rank,item_id)`；首次请求在 advisory/行锁事务内选取并持久化，同日只读取；删除后的缺位使用明确、同锁补位策略。
- 处置：open（目标 rev2）。

### CR-007 — High — 作业去重、并发重抓与模型切换缺少代际幂等
- 证据：rev1 T11/T12/T13 只以 status 粗略阻止重复；cron 遍历后逐条发送，未给 singleton key、事务边界或旧作业覆盖新结果的防护。
- 影响需求：F-03、F-04、F-05、F-08；NFR-可靠性。
- 影响：手动/定时/模型重建并发时可重复付费，旧作业可能覆盖新模型向量或删除后的条目。
- 修复建议：为条目维护 `process_generation`，队列键含 item+generation；事务中递增代际并发任务；handler 仅在代际仍匹配时提交；调度作业使用 pg-boss singleton key，删除/过期作业视为幂等 no-op。
- 处置：open（目标 rev2）。

### CR-008 — Medium — CRUD/UI 任务过宽且路由合同互相矛盾
- 证据：rev1 T08/T14–T16/T24 使用 `*` 和 `…`；文件位于 `/admin/(protected)/api`，接口说明却写 `/api/...`；单个 Step3 同时承担整页、接口、状态和安全行为。
- 影响需求：F-01、F-04、F-08、F-09、F-12；ui-spec §6。
- 影响：实施者无法唯一确定 URL、组件边界及逐步验证点，容易漏状态或漏鉴权。
- 修复建议：确定所有管理 API 为 `/admin/api/...`；列出 page、form/list/detail/dialog/route 文件；按服务/API/UI 三个可验证子步骤拆分。无需逐行代码，需精确到组件、合同与断言。
- 处置：open（目标 rev2）。

### CR-009 — Medium — 写接口鉴权/授权、CSRF、输入验证与错误合同没有统一 fail-closed 规范
- 证据：rev1 仅零散写“鉴权+CSRF”；`requireAdmin(req): Session|Response401` 语义模糊；没有 Origin、token 绑定、Content-Type、Zod schema、错误码及缓存策略。
- 影响需求：F-01、F-04、F-08、F-09、F-12；NFR-安全。
- 影响：不同路由可能遗漏校验，UI 也难以稳定映射错误/恢复状态。
- 修复建议：增加统一管理 API pipeline 与错误 envelope；session/CSRF/origin/内容类型/schema 任一失败即停止；所有 `/admin` server page 与 route 分别使用明确 guard。
- 处置：open（目标 rev2）。

### CR-010 — Medium — “文档正文提取”没有支持范围或安全解析方案
- 证据：rev1 T09 只列 readability+jsdom，却承诺 `web/doc`；未定义 MIME allowlist、PDF/文本解析、压缩炸弹/二进制拒绝策略。
- 影响需求：F-01、F-03。
- 影响：实现可能把 PDF 当 HTML、静默产出垃圾摘要，或无界解析资源。
- 修复建议：明确 v1 支持 HTML、纯文本、PDF；PDF 复用成熟维护库；先检查 MIME/魔数和字节上限，再解析；未知/压缩/加密文档失败并给脱敏原因。
- 处置：open（目标 rev2）。

### CR-011 — Medium — 运维承诺未映射到可实施任务与恢复验证
- 证据：rev1 G 承诺 `/api/health`、worker 心跳、DB ping，F 承诺备份/回滚，但 T25 未列健康路由/心跳存储/restore drill，compose 服务数量描述也不一致。
- 影响需求：NFR-可靠性/可观测/安全。
- 影响：部署冒烟无法证明 worker 活性、队列恢复、备份可还原或反向代理边界正确。
- 修复建议：T25 增加 liveness/readiness、worker heartbeat、优雅停机、备份恢复演练与 Caddy 头部策略验证；明确 4 个服务。
- 处置：open（目标 rev2）。

### CR-012 — Medium — 依赖与第三方内容安全缺少验证门禁
- 证据：rev1 I 只有包名，无 lockfile、版本支持检查、漏洞审计；RAG 上下文和模型输出未规定引用白名单/结构校验。
- 影响需求：F-03、F-06、F-07；NFR-安全。
- 影响：供应链漂移；网页中的提示词可诱导模型输出不受信来源或泄露系统信息。
- 修复建议：锁定依赖并运行审计；把网页/问题都当不可信数据，结构化分隔；来源链接由服务端 hits 生成，模型只返回受 schema 校验的归纳/引用 ID，越界失败关闭。
- 处置：open（目标 rev2）。

### CR-013 — Medium — 选型记录仍标“候选/未定稿”，计划却直接依赖这些结论
- 证据：decisions.md D-02～D-04 仍为候选；rev1 已选择 PostgreSQL/pgvector、OpenAI 兼容层、long polling、pg-boss，但计划未列完整替代方案、失效条件和验证门槛。
- 影响需求：全局架构；验收量表 3、10。
- 影响：实施阶段遇到模型维度、队列或 TG 部署约束时无明确停止条件，事实源之间语义不一致。
- 修复建议：不改用户批准项；在计划内明确“实施级技术选择”及替代项、理由、后果、失效/停止条件，并将 decisions.md 的历史候选状态作为可见风险交给最终审计。
- 处置：open（目标 rev2）。

### Cycle 1 修订处置（plan rev2）
- 计划修订：rev2（2026-08-08T20:46:24+08:00）。
- CR-001 fixed：T02 增加唯一 safeFetch、逐跳手动 redirect、全 A/AAAA 拒绝、undici lookup 固定、rebind/redirect/流上限测试。
- CR-002 fixed：T11/T20 增加 processing outbox、TG receipt outbox、dispatcher、重启/429/崩溃恢复测试。
- CR-003 fixed：schema 改无 typmod vector；T04 精确扫描；T08 live probe 实测维度、版本化全量重建；明确 HNSW 评估门槛。
- CR-004 fixed：D.1/T18 定义 Caddy 信任边界、IP 规范化/按日 HMAC、settings+双计数同事务固定顺序锁、并发上限与 fail-closed 测试。
- CR-005 fixed：T17 增加 score、负样本阈值、recall@10；T18 无 hits 不调 LLM。
- CR-006 fixed：新增 daily_selections；T17 advisory lock、持久日选、并发/新增/删除补位测试。
- CR-007 fixed：新增 process_generation、processing_requests；T11 显式 attempt 0..3、旧代际/模型版本隔离、publisher 崩溃恢复。
- CR-008 fixed：D.1 统一 `/admin/api/**`；T08/T14～T16/T24 列出 route/component 并按 service/route/UI 验证。
- CR-009 fixed：D.1 定义 page/API guard、Origin+CSRF+Content-Type+Zod 顺序、统一 error envelope 与 no-store。
- CR-010 fixed：T09 明确 HTML/text/PDF allowlist、pdfjs-dist、MIME/魔数/页数/字节限制和失败类型。
- CR-011 fixed：T25 增加四服务、live/ready、worker heartbeat/重启、优雅停机、backup→restore smoke。
- CR-012 fixed：全局不可信数据边界、模型 schema/引用 ID 白名单、lockfile/audit 门禁已加入。
- CR-013 fixed：计划新增实施级选择表，含替代项、理由、后果与停止条件，并显式保留 decisions.md 历史候选状态供最终审计。
- 修订后计数：critical=0 / high=0 / medium=0 / low=0。

## Cycle 2（从头复审：rev2）
- 状态：findings_recorded，待修订与复审
- 未解决计数（修订前）：critical=0 / high=1 / medium=6 / low=0

### CR-014 — High — TG receipt schema 无法表达“等待未知结果”，唯一键和 lease 也不可实现
- 证据：rev2 `telegram_receipts.kind` 只允许 completed/failed 且 NOT NULL，但 T11 要在处理前写 waiting receipt；唯一键包含 AES-GCM 随机密文 `chat_id_enc`，相同 chat 重加密不会相等；T20 使用 lease 但表无 `lease_until/leased_by`。
- 影响需求：F-02、F-03。
- 影响：新 TG 请求可能无法插入，或重复插入；dispatcher 无法安全恢复领取，主动回执仍不可靠。
- 修复建议：用确定性 `chat_id_hash=HMAC` 做唯一键、密文只做取值；`outcome` 初始 null，结果事务填 completed/failed；增加 lease 字段与领取/回收状态；明确 Telegram 外部接口仅能 at-least-once，崩溃窗口可能重复并记录为低残余风险。
- 处置：open（目标 rev3）。

### CR-015 — Medium — 会话/登录限流 schema 与 rev2 合同不一致
- 证据：T06 要 24h idle sliding expiry 和 hashed IP；sessions 只有 expires_at，login_attempts 仍为明文 `inet ip`。
- 影响需求：F-09；NFR-安全/隐私。
- 影响：无法可靠判断闲置超时，实施者可能继续存明文 IP。
- 修复建议：sessions 增加 last_seen_at/idle_expires_at/absolute_expires_at；login_attempts 改 ip_hash 并设清理期；加索引和时钟测试。
- 处置：open（目标 rev3）。

### CR-016 — Medium — 非中文/非法总结被描述为本地“规整”，失败语义不可实现
- 证据：T10 Step1 要 mock LLM 返回英文后 `summarize` 将其规整为中文，但没有翻译器或二次调用合同。
- 影响需求：F-03。
- 影响：实现者可能用脆弱字符串处理伪装成中文约束，或保存不合格总结。
- 修复建议：Zod/语言/句数校验失败时最多一次受约束重试，仍失败抛可重试上游错误进入 T11；不得本地猜译/截断成合格内容。
- 处置：open（目标 rev3）。

### CR-017 — Medium — 国际化、浏览器矩阵和 Apple 增强没有覆盖已确认的全部两端 UI
- 证据：T19 只要求“主要文案”；T23 Apple 行为只落在公开端；测试仅列 1440/390，没有 320、Firefox/WebKit 或管理端 Apple 行为。
- 影响需求：F-10；ui-spec §3/§8/§9；NFR-兼容/可访问。
- 影响：管理端可能漏翻译、漏 motion/material/focus/haptic/reduced preferences，Safari/Firefox/320px 退化未被发现。
- 修复建议：增加共享 UI primitives/task 合同，所有可见文案字典扫描；Playwright Chromium/Firefox/WebKit 与 320/390/1440，管理关键流程验证 3 个偏好媒体查询。
- 处置：open（目标 rev3）。

### CR-018 — Medium — 运维段仍有回滚/健康/密钥恢复矛盾
- 证据：F 仍要求破坏性 down migration，与数据不变量的 expand/contract 冲突；G 写 `/api/health` 而 T25 是 `/api/health/live|ready`；未说明 APP_ENCRYPTION_KEY/IP_HASH_KEY 的独立备份与 app 端口不可直连。
- 影响需求：NFR-可靠性/安全。
- 影响：回滚可能毁数据；恢复出的密文不可解；绕过 Caddy 会破坏可信 IP 边界。
- 修复建议：统一为前向兼容回滚；精确健康路径；仅暴露 Caddy 端口；密钥不进 DB dump，单独离线备份并做 restore 验证/轮换说明。
- 处置：open（目标 rev3）。

### CR-019 — Medium — Telegram 多链接、重复与 `/refetch`/`/retry` 流程仍未成为可测试合同
- 证据：requirements F-02 规定多链接逐条、重复可指令重抓、最终失败给 retry；rev2 T20 只写“新 URL”，T21 只区分 URL/非 URL。
- 影响需求：F-02、F-07；ui-spec §7。
- 影响：关键 TG 异常/恢复流程可能漏实现。
- 修复建议：定义解析优先级和最大链接数；逐 URL 去重/即时回执；白名单 `/refetch shortId`、`/retry shortId` 调 T12；未知/越权 short ID 不泄露。
- 处置：open（目标 rev3）。

### CR-020 — Medium — 日志脱敏只按顶层 key，无法覆盖嵌套错误与字符串泄密
- 证据：T01 仅测试 `{apiKey}` 字段；上游 SDK error/header/URL query 可能嵌套携带 Authorization/Key，T22 只断言单次公开问答。
- 影响需求：F-08、F-09；NFR-安全/可观测。
- 影响：敏感值可能通过嵌套对象、Error.cause/header 或 URL query 写日志。
- 修复建议：递归、循环安全、深度/长度上限的结构化 sanitizer；Error 只保留 allowlist；URL 删除 userinfo/敏感 query；以嵌套 fixture 扫描所有关键事件。
- 处置：open（目标 rev3）。

### Cycle 2 修订处置（plan rev3）
- 计划修订：rev3（2026-08-08T20:52:09+08:00）。
- CR-014 fixed：receipt 改 `chat_id_hash` 唯一键 + 随机密文；outcome 可空；增加 lease；T20 明确领取/回收及 at-least-once 边界。
- CR-015 fixed：sessions 增加 idle/absolute/last_seen；login_attempts 改 HMAC hash + 索引/保留期。
- CR-016 fixed：T10 改为一次受约束重试，仍不合格即稳定失败，禁止本地猜译。
- CR-017 fixed：T01 共享交互 primitives；T19 全文案扫描；T23/T24 三浏览器、320/390/1440 与 3 偏好媒体查询。
- CR-018 fixed：F/G/T25 统一 live/ready、expand/contract、Caddy 单入口、DB dump+独立密钥恢复。
- CR-019 fixed：T20/T21 定义最多 10 URL 逐条处理、解析优先级及 refetch/retry/未知 ID 行为。
- CR-020 fixed：T01 递归循环安全 sanitizer；T22 扫描所有关键事件和嵌套上游错误。
- 修订后计数：critical=0 / high=0 / medium=0 / low=1（TG 外部发送 at-least-once 重复窗口，见 AR-001）。

### AR-001 — Low — Telegram 外部发送可能重复
- 证据：Telegram `sendMessage` 无客户端幂等键；T20 已消除内部重复，但发送成功后、标记 sent 前进程崩溃会重发。
- 影响需求：F-02（不影响最终可达，只可能重复同一完成/失败回执）。
- 接受理由：为保证主动回执不丢，at-least-once 优于丢消息；消息量仅白名单站主，且已记录 `duplicate_possible` 指标。
- 处置：accepted_risk（plan rev3；无需改变已确认产品行为）。

## Cycle 3（从头复审：rev3）
- 状态：findings_recorded，待窄修订与复审
- 未解决计数（修订前）：critical=0 / high=0 / medium=3 / low=1

### CR-021 — Medium — 定时重抓“所有条目”的 eligible 集合不明确
- 证据：requirements F-05 写自动重抓所有条目；rev3 T13 未明确 completed/failed/processing 的选择，早期计划倾向只遍历 completed。
- 影响需求：F-03、F-05。
- 影响：失败条目可能永不被下个周期自动恢复，或处理中条目被重复排队。
- 修复建议：eligible=completed+failed，processing 跳过；按快照上界+id keyset 遍历，单条失败不阻断；测试三种状态。
- 处置：open（目标 rev4）。

### CR-022 — Medium — 性能与语义质量基准没有明确通过阈值
- 证据：rev3 只写记录 P95/recall@10，未把 requirements §2.13 的 1.5s/1s/2s/8s 等目标和正负 fixture 通过值写入任务门禁。
- 影响需求：F-06；NFR-性能；验收量表 7。
- 影响：实施报告可以“记录了很慢/低召回”仍宣称任务通过。
- 修复建议：逐项引用 PRD 阈值；固定 fixture 要求所有必召回正样本进入 Top10、所有明确负样本无命中；第三方耗时按观测目标与硬 DB/接口门禁区分；不达标停止交付或记录用户接受风险。
- 处置：open（目标 rev4）。

### CR-023 — Medium — 无 2FA 取舍下未落实强密码最低规则
- 证据：requirements F-09/NFR 建议强密码弥补无 2FA；rev3 init-admin/改密只校验当前密码，没有长度上限/下限或通用错误行为。
- 影响需求：F-09；NFR-安全。
- 影响：站主可设置极弱密码，登录限流不能抵消凭证猜中/复用风险。
- 修复建议：初始化与改密共用 12–128 字符策略，允许密码管理器粘贴/Unicode，不设脆弱字符组合规则；拒绝等于用户名；错误不回显密码；添加边界测试。
- 处置：open（目标 rev4）。

### Cycle 3 修订与最终复审（plan rev4）
- 计划修订：rev4（2026-08-08T21:00:51+08:00）。
- CR-021 fixed：T13 明确 snapshot_at + `(created_at,id)` keyset，eligible=completed+failed，processing 跳过，并覆盖并发/新建/崩溃测试。
- CR-022 fixed：E 节写入 PRD 的首页/添加/向量硬 P95、第三方观测目标，并要求正 fixture 全入 Top10、负 fixture 全无命中；失败必须停止或经用户接受风险。
- CR-023 fixed：T05/T25 增加初始化/改密共用 12～128 Unicode、不得等于用户名、允许粘贴/密码管理器及边界测试。
- 最新从头复审：未新增 Critical/High/Medium finding。
- 最终未解决计数：critical=0 / high=0 / medium=0 / low=1（AR-001 accepted_risk）。

## Acceptance Rubric（rev4，2026-08-08）

| # | 项目 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | Scope | Pass | Goal/Global Constraints/J 与 requirements v0.4 的公开端、单管理员、非目标一致；A 节完整覆盖 F-01～F-12；性能门槛见 E。 |
| 2 | Traceability | Pass | A 节 12/12 requirement 均映射到任务和验证；脚本扫描 missing=[]、T01～T25 连续。 |
| 3 | Architecture | Pass | Architecture、实施级技术选择表、B 文件边界、T11/T13/T20 失败/重启/停止条件明确；历史候选状态显式可见。 |
| 4 | Data and interfaces | Pass | C 节 schema/迁移/不变量/保留期；D.1 路由、DTO、错误 envelope、幂等 generation、daily/outbox/lease 合同。 |
| 5 | Security and privacy | Pass | T01 日志、T02 redirect+DNS rebinding、D.1 auth/CSRF/trusted proxy、T18 原子双限流、T25 Caddy 单入口/密钥恢复均 fail closed。 |
| 6 | UX | Pass | T01 shared Apple primitives；T14～T16/T23/T24 对照 ui-spec 全状态、固定输入几何、3 偏好媒体查询、320/390/1440 与三浏览器。 |
| 7 | Quality | Pass | E 节 unit/integration/e2e/性能/审计门禁；并发、崩溃恢复、SSRF、召回正负 fixture 和具体 P95 均有预期证据。 |
| 8 | Operations | Pass | F/G/T25 覆盖 HTTPS、health、heartbeat、优雅停机、备份+独立密钥 restore、前向兼容回滚、retention maintenance。 |
| 9 | Execution | Pass | 25 个有序任务均给出精确文件/接口/失败测试/通过命令边界；CRUD/UI 精确到组件与 route，不需要逐行产品代码。 |
| 10 | Risk | Pass | 选择表列替代/失效/停止条件；公开库风险沿用用户接受；AR-001 明确 Telegram at-least-once Low 残余风险。 |

## Codex Acceptance
- 结论：accepted。
- 依据：rev4 最新完整复审无新增 Medium 以上问题；Critical/High/Medium 未解决均为 0；唯一 Low 为 AR-001，已明确接受并有监控缓解；10 项量表全部有证据。
- 说明：这是实施计划验收，不是产品代码/测试完成声明；本阶段未实施、提交或部署任何产品代码。
- 工作流校验：2026-08-08 运行 `.claude/skills/project-delivery-workflow/scripts/validate_workflow.py /Users/apple/Downloads/收藏系统`，退出码 0，输出 `PASS: workflow stage=codex_accepted revision=4`。

## Cycle 4（用户选择“继续改进”；基线 rev4）
- 授权依据：state.user_decision=`继续改进` @2026-08-08T22:22:21+08:00。
- 范围：仅处置 final-audit.md 的 L-AUD-01～04，并同步 decisions.md D-02～D-04 定稿状态；不得改变已确认产品行为、UI 或数据暴露边界。
- 修订前未解决计数：critical=0 / high=0 / medium=0 / low=4（AR-001 + L-AUD-01～03；L-AUD-04 为 Cosmetic）。

### L-AUD-01 — Low — 向量重建期间公开提问会先扣额度
- 证据：rev4 T18 先 `consumePublicAsk`，T17 才检查 `emb_rebuild_status`。
- 影响需求：F-06、F-08、F-12。
- 修复：在消费计数前做 DB-only ask readiness 快检，并在限流事务锁住 settings 后复核；非 ready/检查异常返回 `MODEL_UNAVAILABLE`，计数不变且 embedding/LLM 调用数为 0。
- 处置：open（目标 rev5）。

### L-AUD-02 — Low — 管理员密码恢复 runbook 缺失
- 证据：rev4 T25 只有 init-admin，没有忘记密码后的主机侧恢复与旧会话撤销步骤。
- 影响需求：F-09；NFR-运维/安全。
- 修复：新增仅主机/容器权限可运行的一次性 reset-admin-password 脚本；复用强密码规则；更新哈希与删除全部 session 同事务；无 Web/API 入口。
- 处置：open（目标 rev5）。

### L-AUD-03 — Low — GitHub 公开 API 限额没有独立分类与退避
- 证据：rev4 T09 仅写从 api.github.com 抓取，未识别 403/429、remaining/reset/retry-after；T13 未规定批量重抓的 GitHub 限额反馈。
- 影响需求：F-03、F-05；NFR-可靠性。
- 修复：新增 `GITHUB_RATE_LIMITED` + retryAt，优先遵守响应头并加 jitter；T13 对后续 GitHub 项共享 backoff/defer；允许环境变量 PAT，但仍校验 repo `private=false`，只抓公开内容。
- 处置：open（目标 rev5）。

### L-AUD-04 — Cosmetic — ui-spec 批准状态文案过期
- 证据：ui-spec 标题、状态说明和确认门槛仍写待确认，而 state.approvals.ui 已 approved。
- 影响需求：无行为影响；文档一致性。
- 修复：只同步批准状态与批准时间/原文，不改 UI 规范正文。
- 处置：open（目标 rev5）。

### DOC-001 — Cosmetic — decisions D-02～D-04 仍标候选
- 证据：final-audit §6；rev4 已实际采用 PostgreSQL+pgvector、OpenAI 兼容双客户端、Telegram long polling。
- 影响需求：无行为影响；架构事实源一致性。
- 修复：将总状态与 D-02～D-04 标为已定稿，保留候选、取舍、后果和停止条件，不引入新选型。
- 处置：open（目标 rev5）。

### Cycle 4 修订处置与从头复审（plan rev5）
- 计划修订：rev5（2026-08-08T22:28:46+08:00）。
- L-AUD-01 fixed：T18 增加 DB-only `getPublicAskReadiness`，路由在可信 IP/计数前快检，限流事务锁 settings 后复核；非 ready/检查失败返回 `MODEL_UNAVAILABLE`，不创建/递增 counter，embedding/LLM=0；含快检后状态竞态测试。
- L-AUD-02 fixed：F/T25 增加仅主机/容器权限的 `reset-admin-password` runbook；无 HTTP 入口，复用强密码/argon2id，更新哈希与删除全部 session 同事务，失败回滚并验证全部旧 cookie 失效。
- L-AUD-03 fixed：T09 增加 `GITHUB_RATE_LIMITED{retryAt}`、响应头优先/指数+jitter 退避；T13 增加 DB 持久 `github_backoff_until`、无 PAT 50/rolling-hour 安全预算与非 GitHub 隔离；可选 PAT 仅环境变量，API 响应必须 `private=false`。
- L-AUD-04 fixed：ui-spec 标题、状态说明、§12 已同步 `state.approvals.ui` 的批准时间/原文，UI 规范正文未改变。
- DOC-001 fixed：decisions 总状态与 D-02～D-04 已定稿；既有替代项、理由、后果和失效条件保留，未引入新选型。
- 从头快速复审：requirements F-01～F-12 矩阵 missing=[]；T01～T25 连续；已确认 UI/数据暴露边界未改变；安全/权限/fail-closed 边界保持成立。
- 最新复审新增 Medium 以上 finding：0。
- 修订后未解决计数：critical=0 / high=0 / medium=0 / low=1（仅 AR-001 accepted_risk；L-AUD-01～03 已修，Cosmetic 已清）。

## Codex Re-Acceptance（rev5）
- 结论：accepted。
- Acceptance Rubric：原 rev4 的 10/10 Pass 证据继续成立；本轮增强了 Data and interfaces（readiness/限额门禁）、Security and privacy（不计数/不调用模型、PAT 公开边界）、Operations（密码恢复）与 Risk（GitHub 限额）证据，未削弱任何项目。
- 依据：Cycle 4 授权范围全部关闭；Critical/High/Medium=0；最新复审无新增 Medium 以上；Low 仅为既有 AR-001。
- 说明：只修订 `.workflow` 方案与审查产物；未实施、提交或部署产品代码。
- 工作流校验：运行 `.claude/skills/project-delivery-workflow/scripts/validate_workflow.py /Users/apple/Downloads/收藏系统`，退出码 0，输出 `PASS: workflow stage=codex_accepted revision=5`。

---

# 导航站增强（M2）Codex 方案审查

> M2 使用独立事实源 `requirements-nav-enhancement.md`、`ui-spec-nav-enhancement.md` 与唯一 canonical `implementation-plan-nav-enhancement.md`。以下周期不改写上方 M1 历史。

## M2 Cycle 1（完整分析：plan rev6）
- 时间：2026-08-11T01:10:00+08:00。
- 状态：findings_recorded，待修订与从头复审。
- 分析基线：`implementation-plan-nav-enhancement.md` rev6；已确认需求（文件头误标 v0.5，state/UI 均指向已确认 v0.6 显示文案）；已批准 C 工作台 UI；M1 当前 schema、迁移、worker、公开问答、鉴权、CSP 与惰性 DB client。
- 量表：acceptance-rubric 1～10 全量检查；安全、权限、数据隔离与 fail-closed 单独检查。
- 修订前未解决：critical=0 / high=5 / medium=7 / low=0。

### NAV-001 — High — F202 把外部 AI 重跑放入同步单事务，无法满足可恢复进度和真实部分失败
- 证据：rev6 Task 5 要求 `applyCategoryDiff` “全流程放单个 db 事务”，同时在 `reclassifyAuto=true` 时逐条调用 `classifyItem`；Task 7 却要求后台进度、离页恢复和部分失败。
- 影响需求：F202；UI spec §5.3～5.4；量表 3、4、6、8。
- 影响：长时间持锁、HTTP 超时和 LLM 故障会把分类结构与重跑一起回滚；客户端无法恢复服务端真实状态，也无法报告逐条失败。
- 修复建议：分类 diff 在短事务内原子应用并写持久 run/audit；可选重跑改为 pg-boss 后台批处理，持久进度与稳定状态，任何 LLM 调用均在事务外；按 taxonomy version 防旧作业覆盖。
- 处置：open（目标 rev7）。

### NAV-002 — High — merge/delete 与人工分类保护在 FK 语义上不可同时成立
- 证据：rev6 Task 1 使用 `ON DELETE SET NULL`；Task 5 同时写“删 source”与“人工条目保持原归属”，还把置 NULL 描述成“保留 manual=false 语义”。被删除分类不可能继续作为人工条目的 `category_id`。
- 影响需求：F202、F204、Q3；UI spec §5.2、§6；量表 1、4、10。
- 影响：实施者可能静默清除人工归属、错误翻转保护标记，或触发 FK 失败。
- 修复建议：区分 AI diff 与管理员显式 CRUD。AI diff 的 merge/delete 若 source 仍有 `category_manual=true` 条目必须 fail closed，要求先通过 F204 明确迁移这些人工条目；直接 CRUD 删除是管理员显式动作，可 `SET NULL` 但必须保留 `category_manual=true`（人工未分类）。
- 处置：open（目标 rev7）。

### NAV-003 — High — F209 的“参数化 + 公开限流”合同不足以实现字面匹配和 fail-closed
- 证据：rev6 Task 8 只写 Drizzle `ilike('%q%')` 与“复用 ask 限流”。`%`、`_`、`\\` 仍会被 LIKE 当通配符；现有 `consumePublicAsk` 依赖模型 readiness 且会消耗 AI 问答额度；未规定可信 IP、长度/NUL 边界、限流存储失败行为。
- 影响需求：F209；NFR 安全；量表 4、5、7。
- 影响：搜索可被通配符放大为全表扫描，AI 未配置时关键词搜索错误不可用，或关键词请求挤占问答额度；代理/DB 异常可能放行。
- 修复建议：新增独立 keyword scopes 的原子 IP/global limiter，复用可信代理/HMAC 模式但不检查模型、不占 ask scopes，异常 fail closed；1～100 字符且拒绝 NUL；转义 LIKE 元字符并显式 `ESCAPE '\\'`；tags 用参数化 `unnest`/EXISTS；增加并发、注入与通配符字面测试。
- 处置：open（目标 rev7）。

### NAV-004 — High — worker 归类的提交竞态会把“归类失败”升级为条目失败
- 证据：rev6 Task 4 在 completion transaction 前读取分类并调用 AI，然后直接把返回 id 写入最终 update；未检查 `categories_initialized`，也未处理分类在推理期间被删除/重拟。当前 `processItem` 外层 catch 会进入重试/最终 failed。
- 影响需求：F203；NFR 可靠性；量表 3、4、7。
- 影响：分类删除竞态触发 FK 错误后条目可能不再 completed，违反“归类失败不阻断完成”；未初始化时也会误跑。
- 修复建议：只在 initialized 且 web/github 且非人工时事务外推理；最终短事务内以 taxonomy version 和 `category_manual=false` 原子重验，候选消失/版本变化即写 NULL 或保留既有值并记录退化，绝不抛出到主处理失败路径；覆盖并发删除和人工改分类竞态。
- 处置：open（目标 rev7）。

### NAV-005 — High — 移除 daily 查询后未定义 F207 的等价可用性判定
- 证据：当前首页用 `dailyItems.length` 判断问答库是否为空；rev6 Task 10 删除 `pickDailyForNow`，只写复用 `AskExperience`，没有提供全类型 completed 内容存在性检查。导航目录只含 web/github，而问答仍覆盖 doc。
- 影响需求：F206、F207；量表 2、3、7。
- 影响：实现者可能用目录条目数代替问答语料数，导致只有 doc 时错误禁用问答，或移除既有 readiness 降级。
- 修复建议：新增/复用独立 `hasCompletedAskCorpus()`（包含 doc）并保留 `getPublicAskReadiness()`；只替换首页布局，不改 `/ask`、阈值、额度或结果行为；增加 doc-only 与模型不可用回归。
- 处置：open（目标 rev7）。

### NAV-006 — Medium — 分类 apply 缺少持久审计、幂等和并发版本合同
- 证据：F202 要求记录模式和应用变更，UI 要求重进恢复；rev6 仅返回瞬时 `ApplyResult`，无 run 表、idempotency key、分类版本或 stale preview 防护。
- 影响需求：F202；量表 4、8、10。
- 影响：响应丢失后重试可能重复新增；旧预览可覆盖新分类；无法追溯接受/忽略和真实状态。
- 修复建议：增加 `category_change_runs`（request_key 唯一、mode、base/applied version、accepted/ignored JSON、状态、计数、错误、时间）与 `app_settings.category_version`；apply 在行锁下校验 baseVersion 并幂等返回。
- 处置：open（目标 rev7）。

### NAV-007 — Medium — AI 建议接口边界和规模策略不完整
- 证据：rev6 `Diff` 只有含混的 `targetName/sourceCategoryId`；未规定 merge target id、server-derived count、候选 ID 白名单、prompt injection 隔离、数百条输入分批与输出上限。
- 影响需求：F202；NFR 性能/安全；量表 3、4、5、7。
- 影响：AI 可返回不可应用或越权引用；大库 prompt 超限；客户端难以可靠编辑 diff。
- 修复建议：使用判别联合 DTO 与 zod 严格解析，所有 source/target id 服务端白名单验证，计数仅从 DB 计算；web/github completed 数据按固定上限批量 map-reduce，内容作为不可信数据分隔，限制输出数量/名称长度。
- 处置：open（目标 rev7）。

### NAV-008 — Medium — favicon 交付路径与现有 CSP 不相容
- 证据：rev6 `SiteCard` 只写“favicon 域名”，无数据源、缓存、失败合同；当前 CSP `img-src 'self' data:` 会阻止直接远端 favicon。
- 影响需求：F205、Q5；UI spec §1.2、§4；量表 3、5、6、8。
- 影响：正式页会出现破图/CSP 错误，或为修复而引入未审查的第三方追踪与 SSRF。
- 修复建议：采用同源、按已收录 item id 寻址的 favicon route/cache；只从 DB 中 completed web/github 的 origin 派生 URL，复用 `safeFetch` 的逐跳 SSRF/超时/大小/MIME 限制，返回固定 fallback 且设缓存与请求合并；不得接收任意 URL。
- 处置：open（目标 rev7）。

### NAV-009 — Medium — F204 条目分类选择器没有落到现有条目详情合同
- 证据：需求指定“条目管理/详情页”；rev6 仅创建分类工作台和独立 PATCH route，未修改 `LibraryItemDto`、`getItemDetail`、`ItemDetail.tsx` 或 ETag 并发合同。
- 影响需求：F204；UI spec §6；量表 2、4、6、9。
- 影响：API 可能存在但管理员在实际条目工作流中不可发现，且分类更新可覆盖并发编辑。
- 修复建议：扩展详情 DTO/查询与 ETag，新增详情页 CategorySelector；PATCH 需要 If-Match、category id 存在校验并原子置 `category_manual=true`，返回新 ETag。
- 处置：open（目标 rev7）。

### NAV-010 — Medium — 已批准关键词 URL 状态和完整 UX 状态没有验证步骤
- 证据：UI spec 要求 `q` URL 同步、刷新/复制/前进后退、loading/empty/error/retry、reduced motion/transparency/contrast 与 1440×1000/390×844；rev6 Task 10 只覆盖输入、结果、清空和锚点。
- 影响需求：F206、F208、F209；UI spec §3、§7～8；量表 6、7。
- 影响：页面在刷新/导航、失败恢复、移动端或辅助偏好下偏离已批准交互。
- 修复建议：把 URL 作为提交态事实源，列出 popstate/refresh/error/retry/focus/aria-busy/aria-current/尺寸/偏好媒体查询的 Playwright 断言和截图证据。
- 处置：open（目标 rev7）。

### NAV-011 — Medium — 迁移、回滚与 PA-01 build 门禁不够可执行
- 证据：rev6 对 meta 写“对齐或手写”，未明确 0003 journal/snapshot；迁移测试只覆盖空库结构；build 只写普通命令并以注释提醒 PA-01。
- 影响需求：F201；M1 PA-01；量表 4、7、8、9。
- 影响：已有 M1 数据升级或生产 artifact 可能失败，schema drift 不被发现；build 可因环境里恰有 DATABASE_URL 而掩盖惰性回归。
- 修复建议：固定生成/校验 0003 journal+snapshot，备份后在 M1 fixture 上升级并验证既有 checks/embedding 数据；回滚采用前向兼容（代码先回滚、列表保留）；显式 `env -u DATABASE_URL corepack pnpm build` 与 production artifact 检查。
- 处置：open（目标 rev7）。

### NAV-012 — Medium — 数据访问一致性与观测验收缺口
- 证据：rev6 store helper 默认绑定全局 db，却由 apply 单事务调用；name 只 trim、slug 对中文可能为空且无稳定冲突规则；F202/F203 要求触发/命中/未分类/应用统计，计划未列结构化日志或断言。
- 影响需求：F201～F204；NFR 可观测；量表 4、7、8。
- 影响：所谓单事务可能被全局连接拆开；分类键不稳定；质量指标无法验收。
- 修复建议：store 接收 transaction/queryable；定义名称规范化、稳定唯一 slug/anchor；新增脱敏结构化事件和数据库/run 计数测试。
- 处置：open（目标 rev7）。

### M2 Cycle 1 修订处置（plan rev7）
- 计划修订：rev7（2026-08-11T01:28:00+08:00），唯一 canonical 文件原位修订，未创建版本副本。
- NAV-001 fixed：Task 6 仅短事务应用 taxonomy；Task 7 用 pg-boss + 持久 run/cursor 执行事务外 LLM，定义 partial/superseded/重启恢复。
- NAV-002 fixed：Global Invariants 与 Task 6 规定 AI merge/delete 遇人工条目整批 fail closed；独立 CRUD 删除保留 manual 标志。
- NAV-003 fixed：Task 9 增加独立 keyword scopes、可信 IP/HMAC、原子限流、异常 503、LIKE 元字符转义、tags unnest 与并发/0-AI 测试。
- NAV-004 fixed：Task 4 增加 initialized/version/manual 三门禁、事务内候选存在性复核及分类失败不进入 failRequest 的竞态测试。
- NAV-005 fixed：Task 10 增加包含 doc 的 `hasCompletedAskCorpus`，保留 readiness 与现有 ask 回归。
- NAV-006 fixed：Task 1/6/7 增加 category_version、category_change_runs、requestKey 幂等、baseVersion stale 防护与可恢复状态。
- NAV-007 fixed：Task 5 使用严格判别联合、ID 白名单、server-derived counts、40 条批次两阶段聚合、上限/环检测与不可信数据边界。
- NAV-008 fixed：Task 10 增加仅 item id 的同源 favicon route，复用 hardened fetch、MIME/字节/redirect/缓存/fallback 门禁，不放宽 CSP。
- NAV-009 fixed：Task 8 精确落到现有 detail DTO/API/ItemDetail/CategorySelector，并继承 If-Match/ETag 冲突合同。
- NAV-010 fixed：Task 11/12 增加 URL q 事实源、刷新/历史、全状态、abort、焦点/ARIA、批准尺寸与三类 reduced/contrast 偏好验证。
- NAV-011 fixed：Task 1/13 固定 0003 meta/journal、M1 数据升级/restore/前向兼容回滚与 `env -u DATABASE_URL` build 门禁。
- NAV-012 fixed：Task 2 规定 tx-bound store、NFKC/规范名/稳定 UUID slug；Task 13 加脱敏事件、500 条性能与计数证据。
- 修订后待从头复审计数：critical=0 / high=0 / medium=0 / low=0。

## M2 Cycle 2（从头复审：plan rev7）
- 时间：2026-08-11T01:40:00+08:00。
- 状态：findings_recorded，待窄修订与再次复审。
- 复审顺序：plan → requirements → decisions → approved UI → ledger；重新检查量表 1～10 与现有仓库边界。
- 修订前未解决：critical=0 / high=0 / medium=6 / low=0。

### NAV-013 — Medium — partial 重跑没有失败项持久化与可调用重试合同
- 证据：rev7 Task 7 只保存 failed_count/cursor；API 只有 run GET，但 Task 8 要显示 retry。cursor 已越过失败 item 后，既无法定位失败项，也没有 POST retry route。
- 影响需求：F202；UI spec §5.4；量表 4、6、8、9。
- 影响：UI 会承诺不可执行的重试，部分失败只能靠整库重跑或伪造成功。
- 修复建议：增加 `category_reclassify_failures(run_id,item_id,error_code,attempts)`；item 成功时删除、网络失败时 upsert；增加受保护的 `POST runs/[id]/retry`，只重试当前 taxonomy version 的失败项，持久 retry generation 并幂等发布。
- 处置：open（目标 rev8）。

### NAV-014 — Medium — 目录初载/失败未保证关键词框和底部问答继续存在
- 证据：rev7 Task 11 仍把 `getPublicDirectory` 作为 page 数据来源，未列 `loading.tsx`/错误隔离；RSC 查询抛错可能让整页 error boundary 替换掉搜索和 AskExperience。UI spec §4 明确目录失败时二者仍保留。
- 影响需求：F205～F207、F209；量表 3、6、7。
- 影响：数据库短暂失败会同时移除不依赖目录结果的搜索框与问答入口，违反批准恢复行为。
- 修复建议：页面 shell、标题行搜索与 AskExperience 独立渲染；目录数据放 Suspense/局部 error state，更新 public `loading.tsx`；失败用 role=alert + `router.refresh`，不触发整页错误。
- 处置：open（目标 rev8）。

### NAV-015 — Medium — “AI 输出中文/低置信未分类”只有全局口号，没有模块合同和证据
- 证据：rev7 Task 3 仅解析 category id，Task 5 仅限制 name 长度；未规定分类器不确定时的结构化信号，也未验证 AI 建议名称为中文。
- 影响需求：F202、F203；Global AI 中文约束；R1；量表 2、4、7。
- 影响：AI 可输出英文分类名，或在低置信时被迫选择一个合法 id，偏离“归不进→未分类”。
- 修复建议：分类器响应包含 `confidence`/`NONE`，固定阈值并测试边界；proposal prompt + 中文名称校验，失败做至多一次受约束重试，仍不合格即稳定错误且不落库。
- 处置：open（目标 rev8）。

### NAV-016 — Medium — 已批准的物理反馈、可中断交互与无人工延迟没有实施证据
- 证据：UI spec §7 要求 pointer-down 反馈、从当前值恢复、可中断滚动/面板/toast、禁止演示延迟；rev7 Task 12 只写键盘/ARIA/对比度，未复用现有 Pressable/MotionRegion/MaterialSurface 或列自动检查。
- 影响需求：F202、F206、F208、F209；量表 6、7、9。
- 影响：正式实现可能复制原型延迟或产生不可中断动画，未达到已批准交互规范。
- 修复建议：明确复用现有 UI primitives；对 pointer/cancel/reduced-motion/无 setTimeout 演示延迟增加 unit/e2e 断言。
- 处置：open（目标 rev8）。

### NAV-017 — Medium — 计划误称“现有 Lucide”，依赖清单不可执行
- 证据：rev7 Task 12 要用“现有 Lucide”，但 `package.json` 没有 `lucide-react`；UI spec 明确命令图标使用 Lucide。
- 影响需求：UI spec §1.2；量表 3、6、9。
- 影响：实施者要么临时手绘 SVG/字符，要么未计划地改依赖，均绕过 lockfile/audit 门禁。
- 修复建议：明确添加 pinned `lucide-react`，更新 pnpm-lock，使用必要的命名 import，并纳入 audit/build/bundle 检查。
- 处置：open（目标 rev8）。

### NAV-018 — Medium — delete diff 的自动条目“目标分类”缺失于 DTO
- 证据：rev7 `delete` 只有 sourceCategoryId；AppliedDiff 仅写 `autoDestination:'target'|'unclassified'`，却没有 target ref。需求/UI 允许删除类下自动条目转所选合并目标。
- 影响需求：F202；UI spec §5.2～5.3；量表 2、4、9。
- 影响：删除转目标不可序列化/验证，客户端和服务端会各自猜字段。
- 修复建议：将去向定义为判别联合 `unclassified | target(CategoryRef)`，merge/delete 通用；校验目标最终存在且不在同批删除集合，拓扑测试覆盖编辑后的目标。
- 处置：open（目标 rev8）。

### M2 Cycle 2 修订处置（plan rev8）
- 计划修订：rev8（2026-08-11T01:52:00+08:00）。
- NAV-013 fixed：schema 增加 failure 明细与 run generation；Task 7/8 增加受保护 retry POST、同 generation 幂等、版本门禁和只重试失败项的作业/测试。
- NAV-014 fixed：Task 11 增加稳定 page shell、局部 Suspense/error、`loading.tsx`、router.refresh 及搜索/问答不消失的 Playwright 证据。
- NAV-015 fixed：Task 3 增加 0～1 confidence、0.65 阈值与判别 outcome；Task 5 增加 AI 中文名称校验、一次受约束重试和稳定失败测试。
- NAV-016 fixed：Task 12 明确复用现有 Pressable/MotionRegion/MaterialSurface，加入 pointer cancel、可中断、三类偏好和禁止人工延迟的 unit/e2e。
- NAV-017 fixed：Tech Stack/Files/Task 12 明确 pinned lucide-react、lockfile、命名 import、许可维护核对与 prod audit。
- NAV-018 fixed：DTO 改为 `AutoDestination` 判别联合，Task 6 覆盖 delete→existing/new/renamed target 与同批删除拒绝。
- 修订后待从头复审：critical=0 / high=0 / medium=0 / low=0。

## M2 Cycle 3（从头复审：plan rev8）
- 时间：2026-08-11T02:00:00+08:00。
- 状态：findings_recorded，待窄修订与最终复审。
- 修订前未解决：critical=0 / high=0 / medium=3 / low=0。

### NAV-019 — Medium — retry 幂等键和 failure 计数仍无可持久实现
- 证据：rev8 Task 7 要“重复 retry 请求使用请求 UUID 幂等”，但 run/schema 没有保存该 UUID；failure upsert 与 failed_count 同时更新，未说明重复失败不重复计数；人工修改后不再 eligible 的 failure 行也没有收敛规则。
- 影响需求：F202；UI spec §5.4；量表 4、7、8、9。
- 影响：响应丢失可重复递增 generation/发作业，崩溃重试可夸大失败数，人工已处理项可能永久卡住 partial。
- 修复建议：run 保存 `last_retry_request_key`；同 key 返回当前 generation，运行中不同 key 409；failed_count 从 failure 表派生或只在首次 insert 递增；retry 时人工/非 eligible/已删除项视为 resolved 并删除 failure。
- 处置：open（目标 rev9）。

### NAV-020 — Medium — 局部 Suspense 描述仍缺能保持搜索框的组件边界
- 证据：rev8 仍由单个客户端 `DirectoryView` 同时承担搜索和目录；如果其 initial directory props 来自 suspended server query，整个组件连搜索框一起等待。仅写“局部 Suspense”不足以实现 UI spec 的稳定标题行/搜索/问答。
- 影响需求：F205～F207、F209；UI spec §2～4；量表 3、6、9。
- 影响：实施者可能把 Suspense 放错层级，目录加载/失败时关键词框仍消失。
- 修复建议：拆出始终渲染的 `DirectoryShell/KeywordSearch` 客户端状态层与异步 `DirectoryData`；page 在 shell 内仅 suspend/catch 数据区域，问答是 sibling；明确 error/retry 数据流。
- 处置：open（目标 rev9）。

### NAV-021 — Medium — 依赖和 API 错误/envelope 仍留实施时猜测
- 证据：rev8 用 `<reviewed-pinned-version>` 占位；实际 registry 当前 `lucide-react=1.31.0`、ISC。Task 5 抛 `AI_OUTPUT_INVALID`，但稳定 admin errors 未列；public search 未固定响应 envelope。
- 影响需求：F202、F209；UI spec §1.2；量表 3、4、9、10。
- 影响：lockfile/许可门禁不可复现，客户端可能把合法解析失败误映射成上游错误，搜索 UI 需猜 JSON 结构。
- 修复建议：锁定已查询的 1.31.0/ISC；补齐 AI_OUTPUT_INVALID；固定 GET search 成功/错误 envelope 与 no-store。
- 处置：open（目标 rev9）。

### M2 Cycle 3 修订处置（plan rev9）
- 计划修订：rev9（2026-08-11T02:08:00+08:00）。
- NAV-019 fixed：run schema 增加 last_retry_request_key；Task 7 固定同 key/不同 key 行为、generation 0、failure 首次计数/校准和人工/非 eligible resolved_skipped 收敛测试。
- NAV-020 fixed：文件与 Task 11 拆成 DirectoryShell/KeywordSearch（稳定层）、DirectoryData（唯一异步边界）、DirectoryView（纯展示），AskExperience 为 sibling；明确默认/搜索替换数据流。
- NAV-021 fixed：锁定 registry 已查询的 `lucide-react@1.31.0`/ISC 与 exact install；补齐 `AI_OUTPUT_INVALID`；固定 search 成功和现有错误 envelope/no-store。
- 修订后待最终从头复审：critical=0 / high=0 / medium=0 / low=0。

## M2 Cycle 4（从头复审：plan rev9）
- 时间：2026-08-11T02:16:00+08:00。
- 状态：findings_recorded，待最后窄修订。
- 修订前未解决：critical=0 / high=0 / medium=1 / low=0。

### NAV-022 — Medium — 单个 last_retry_request_key 不能提供持久多请求幂等
- 证据：rev9 只在 run 保存最后一个 retry key。若 retry A 完成 partial、retry B 再完成 partial，迟到的 A 重放时已不等于 last key，会被当成新请求并发布 generation 3；Task 6 初始 key 也仍写无 generation 的旧格式。
- 影响需求：F202；UI spec §5.3～5.4；量表 4、7、8。
- 影响：网络乱序/历史重放可重复发起付费重分类，破坏幂等承诺和进度计数。
- 修复建议：用 append-only `category_run_retry_requests(run_id,request_key,generation)` 唯一记录所有 retry key；同 key 永久返回原 generation；初始与 retry job 均统一 `<runId>:<generation>` singleton key。
- 处置：open（目标 rev10）。

### M2 Cycle 4 修订处置（plan rev10）
- 计划修订：rev10（2026-08-11T02:20:00+08:00）。
- NAV-022 fixed：schema/Task 1 增加 append-only retry request 表；Task 7 先查/插入 durable key，再分配 generation；Task 6/7 统一 generation 0/后续 generation singleton key，并保留不同 key 运行中 409。
- 修订后待最新完整复审：critical=0 / high=0 / medium=0 / low=0。

## M2 Cycle 5（最终完整复审：plan rev10）
- 时间：2026-08-11T02:27:00+08:00。
- 状态：发现最后一个一致性问题，执行允许范围内的最终窄修订。
- 修订前未解决：critical=0 / high=0 / medium=1 / low=0。

### NAV-023 — Medium — run.failed_count 与 failure 级联删除无法保持一致
- 证据：rev10 同时缓存 run.failed_count，并让 failure.item_id `ON DELETE CASCADE`。管理员删除一个失败 item 时，failure 行自动消失，但没有事务能同步另一个 run 行；“必须一致”的计划合同不可实现。
- 影响需求：F202；UI spec §5.4；量表 4、8。
- 影响：GET run 可长期显示虚假的 partial/失败数，违反“服务端真实状态”。
- 修复建议：移除 run 中缓存 failed_count；GET/status 完结都从 failure 表 `count(*)` 派生，partial 以存在性为准。其余成功计数保留缓存。
- 处置：open（目标 rev11）。

### M2 Cycle 5 修订处置与最新复审（plan rev11）
- 计划修订：rev11（2026-08-11T09:07:47+08:00）。
- NAV-023 fixed：run schema 移除 failed_count 缓存；Task 7 规定 GET/完结状态从 failure 表 count/exists 派生，级联删除、人工处理和成功重试均回到同一事实源。
- 最新从头复审顺序：rev11 plan → requirements → decisions → approved UI → ledger；并重新对照当前 schema/worker/public ask/admin guard/CSP/db client。
- 自动文本核对：rev11；Task 1～13 连续；F201～F209 追踪完整；manual/version/retry/fail-closed/LIKE escape/no-DATABASE_URL build 关键门禁均存在；旧 `failed_count`/`last_retry_request_key`/无 generation singleton 计划模式无匹配。
- 最新复审新增 Medium 以上 finding：0。
- 最终未解决：critical=0 / high=0 / medium=0 / low=0。

## M2 Acceptance Rubric（plan rev11）

| # | 项目 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | Scope | Pass | Goal/Global Invariants 与 F201～F209、单主分类、doc 排除、问答不变、无 hero/daily 展示一致；人工保护歧义采用显式 fail-closed 并列停止条件。 |
| 2 | Traceability | Pass | §3 对 F201～F209 全映射到 Task 1～13 和必需证据；Must/Should/Could 均覆盖。 |
| 3 | Architecture | Pass | taxonomy version、短事务 apply、事务外 LLM、pg-boss 可恢复重跑、RSC 局部边界、独立 search limiter 与 favicon 边界明确。 |
| 4 | Data and interfaces | Pass | 0003 schema/meta、FK/manual/version/run/failure/retry key；严格 Diff/AutoDestination、ETag、idempotency、stale/error/envelope 合同齐全。 |
| 5 | Security and privacy | Pass | admin session/Origin/CSRF/Content-Type/Zod；可信代理/HMAC/原子限流 fail closed；LIKE 转义+参数化；favicon SSRF/MIME/字节/CSP；日志脱敏。 |
| 6 | UX | Pass | C 工作台层级、搜索 URL/全状态、目录局部失败、底部问答、diff/确认/真实进度、键盘/焦点/触控/reduced preferences 均有任务。 |
| 7 | Quality | Pass | migration/unit/integration/e2e、并发/竞态/崩溃/幂等/注入/SSRF/doc-only/500 条性能与批准尺寸证据及明确门禁。 |
| 8 | Operations | Pass | pg_dump、M1→0003 升级、前向兼容回滚、publisher/worker 恢复、readiness/heartbeat、restore smoke、依赖 audit 和 artifact 校验。 |
| 9 | Execution | Pass | 13 个有序任务精确到路径、DTO、事务顺序、错误、测试和命令；新增依赖锁定 1.31.0，不留版本占位。 |
| 10 | Risk | Pass | manual/FK、favicon、模型上下文、性能和发布失败均有 stop condition；未保留未决 Medium 以上问题。 |

## M2 Codex Acceptance
- 结论：accepted（仅实施计划，不代表产品已实现或测试已通过）。
- 依据：5 个允许周期内收敛；NAV-001～NAV-023 均有证据和 fixed 处置；Critical/High/Medium/Low 未解决均为 0；rev11 最新完整复审无新增 Medium 以上 finding；量表 10/10 Pass。
- 边界：本阶段仅修改 `.workflow` 方案、台账、状态与交接产物，未实施、提交或部署产品代码。
- 工作流校验：2026-08-11T09:07:47+08:00 运行 `python3 /Users/apple/Downloads/new-shoucang/.codex/skills/project-delivery-workflow/scripts/validate_workflow.py /Users/apple/Downloads/new-shoucang/xm-daohang`，退出码 0，输出 `PASS: workflow stage=codex_accepted revision=11`。
