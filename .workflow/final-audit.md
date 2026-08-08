# Final Audit（Claude 最终审计员 · 独立只读审计）

- 审计对象：`implementation-plan.md` rev4（Codex 3 轮修订，Cycle 1–3）
- 交叉核对：`requirements.md` v0.4（已确认）、`ui-spec.md` v0.4（已确认）、`decisions.md`、`review-ledger.md`
- 审计方式：全新独立会话，只读；未修改任何计划/需求/决策/UI 文档
- 新鲜证据：本次重新运行 `python3 .claude/skills/project-delivery-workflow/scripts/validate_workflow.py .`，输出 `PASS: workflow stage=codex_accepted revision=4`（本次执行，非引用历史记录）

## 1. Acceptance Rubric 复核（独立判断，非照抄 Codex 结论）

| # | 项目 | 结论 | 独立核验依据 |
| --- | --- | --- | --- |
| 1 | Scope | Pass | Goal/Global Constraints/非目标(J) 与 requirements.md §0.1/§0.2/§0.3 逐条一致；F-01~F-12 均在 A 节矩阵出现，无遗漏、无越界（如未做多用户/私有仓库/无头浏览器）。 |
| 2 | Traceability | Pass | A 节 12 条需求均有任务号+验证方式；随机抽查 F-11（每日3条）→T17/T23，反查 T17 Step1 覆盖同日稳定/跨日轮换/并发/<3条，与 requirements §2.11 验收标准一一对应。 |
| 3 | Architecture | Pass | Architecture 段落、"实施级技术选择与停止条件"表格给出替代项/失效条件/停止条件（pgvector 精确扫描、pg-boss+outbox、long polling、双客户端、轻量抓取），并明示不改写 decisions.md 历史候选状态、交由本次审计裁决（第37行）——见第 6 节处理。 |
| 4 | Data and interfaces | Pass | C 节 schema 含 `process_generation`/`processing_requests`/`telegram_receipts`（含 lease 字段）/`daily_selections`/`ask_counters`，与 CR-006/007/014 的修复建议逐字对应；D.1 定义统一路由、错误 envelope、guard 顺序。 |
| 5 | Security and privacy | Pass（见第 3 节安全必查复核） | 见下方专项复核，未发现新的 Critical/High。 |
| 6 | UX | Pass | T01 共享 primitives、T23 §5.2 输入栏撑满几何断言、T19 全文案 key 扫描、三浏览器+320/390/1440，与 ui-spec §3/§5.2/§8/§9 逐条对齐。 |
| 7 | Quality | Pass | E 节已把 requirements §2.13 的具体 P95 数值（1.5s/1s/2s/8s）与正/负 fixture 通过标准写为硬门禁（对应修复 CR-022），并区分观测目标与硬门禁。 |
| 8 | Operations | Pass | F/G/T25 覆盖 live/ready、heartbeat、优雅停机、备份+独立密钥 restore drill、前向兼容回滚（对应修复 CR-018）。 |
| 9 | Execution | Pass | 25 个任务均给出精确文件路径、接口签名、失败测试断言、TDD 步骤；CRUD/UI 任务（T08/T14–T16/T24）已按 service/route/UI 三段拆分（对应修复 CR-008）。 |
| 10 | Risk | Pass，但发现 4 条新的独立审计 Low/Cosmetic 残余问题（见第 4 节），需用户裁决 | 技术选择表+AR-001 覆盖已知风险；但独立审计新发现的问题未被 Codex 台账记录，不能因 Codex 已 accepted 而自动视为已处置。 |

## 2. Codex Dispositions 抽样复核（降低锚定偏差）

对 review-ledger.md 中全部 23 条 finding（CR-001~CR-023 + AR-001）逐条与 rev4 计划正文比对，重点抽查以下 4 条高风险项的修复证据是否真实落地（而非仅采信"fixed"标签）：

- **CR-001（Critical, SSRF）**：rev4 T02 Step3/Step4 明确"undici 自定义 lookup 只能返回本次已审查 IP""redirect:'manual'，最多5跳，每跳重新解析/固定""拒绝 HTTPS→HTTP 降级"，并有"DNS 改绑不影响已固定连接"的集成测试断言——证据落地，非空话。**确认已修复。**
- **CR-004（High, 双限流原子性/可信IP）**：D.1 第259行明确 Caddy 删除客户端自带 XFF/X-Real-IP 并写入单值头，应用仅在直连地址属于 `TRUSTED_PROXY_CIDRS` 时读取，否则用 socket peer；T18 Interfaces 段描述"锁 app_settings，按 global 后 ip 固定顺序 upsert+FOR UPDATE"及 fail closed 断言（伪造/多值头、非可信代理、DB超时 embedding/LLM 调用数为0）。**确认已修复，且验证方式（并发屏障测试）具体可执行。**
- **CR-014（High, TG receipt schema）**：C 节 `telegram_receipts` 表已改为 `chat_id_hash` 唯一键（HMAC）+ `chat_id_enc` 仅存值、`outcome` 可空、`status`/`leased_by`/`lease_until` 字段齐全，与 finding 描述的缺陷一一对应修复。**确认已修复。**
- **CR-022（Medium, 性能基准无硬门槛）**：E 节末段已把 requirements §2.13 的具体数值写为硬门禁，并将"含第三方的问答 P95<8s"与"数十秒"标注为观测目标而非硬门槛，避免"记录了慢/低召回仍宣称通过"的漏洞。**确认已修复。**

抽样未发现"声称 fixed 但正文未落地"的情况。Codex 台账的处置记录基本可信。

## 3. 安全必查专项复核（权限/隔离/鉴权/门禁 fail-closed）

逐条核验计划中"声称通过"的门禁在异常/依赖缺失时是否会静默放行：

- **管理端鉴权边界**：`requireAdminPage`/`requireAdminApi` 明确失败即重定向/401；写路由顺序为 session→Origin/Host→CSRF→Content-Type→Zod→对象存在/状态，"任一步失败立即返回且不得入队/写库"（D.1 第257行）。**Fail-closed，未见静默通过路径。**
- **公开限流**：D.1/T18 明确"依赖异常或身份/IP无法可信确定时不得继续敏感操作或调用模型"；`ratelimit_enabled=false` 时不计数——这是**显式产品开关**而非异常静默放行，边界清晰。**Fail-closed 成立。**
- **SSRF 出口**：H 节"SSRF 防护(T02) 是唯一网络出口"，T09 Interfaces 明确"禁止提取器自行 fetch"，杜绝绕过唯一出口的隐藏路径。**Fail-closed 成立。**
- **向量重建门禁**：T17"settings/rebuild 非 ready 时公开/TG 提问整体禁用，避免只搜到已重建子集"——**Fail-closed 成立**，但见第 4 节 L-AUD-01（顺序问题，非静默通过，而是体验/资源浪费问题）。
- **数据隔离**：单管理员+公开匿名只读的边界在 requirements §0.3 已由用户明确接受"库内容可通过公开问答对外可见"；计划 H 节复述该接受声明，未越权扩大数据暴露面（例如未把 embedding/内部字段/secret 暴露给列表 DTO，T15 Interfaces 明确"只返回列表 DTO，不返回 embedding/secret/internal stack"）。**权限边界清晰。**
- **密钥与凭证**：API Key/TG Token AES-256-GCM 加密，`APP_ENCRYPTION_KEY`/`IP_HASH_KEY`/`LOGIN_IP_HASH_KEY`/`TG_ID_HASH_KEY` 明确"不进入 DB dump，要求独立离线备份"（T25），避免"备份即等于泄露全部解密材料"的常见陷阱。**成立。**

未发现安全门禁存在"异常时静默通过"的设计缺陷。

## 4. 独立审计新发现的残余问题（未见于 review-ledger.md，需用户裁决）

以下问题为本次独立审计新识别，Codex 台账未记录，因此不能视为已被验证器处置；严重级均为 Low 或 Cosmetic，不构成否决计划的理由，但按流程要求必须列出供用户选择"继续改进"或"接受风险"。

### L-AUD-01（Low）— 向量重建期间限流额度可能被无谓消耗
- **证据**：T18 Interfaces："`POST /ask` 必须先可信取 IP/消费额度，之后才允许 embedding"；而 emb_rebuild 非 ready 的 fail-closed 检查写在 T17 `retrieve()` 内部，即发生在限流已扣费**之后**。
- **影响**：模型重建期间（如更换 embedding 模型后的全量重建窗口），正常访客的每日提问额度会被消耗，却得不到可用回答，可能造成访客在重建结束前提前耗尽当日额度。
- **建议**：在消费限流前增加一次 `emb_rebuild_status` 快速检查（非 ready 直接返回 `MODEL_UNAVAILABLE` 且不计数），或将其记录为明确接受的运营行为并写入运维 runbook（提示重建通常短暂）。
- **严重级**：Low（不影响安全边界，只影响重建窗口内的用户体验/资源分配）。

### L-AUD-02（Low）— 管理员账号无密码恢复路径未写入运维文档
- **证据**：F-09/decisions.md D-01 明确"不启用 2FA/恢复码"为用户明确要求；T25 `init-admin` 描述"幂等"，但计划未说明忘记密码后的恢复流程（是否可重跑 init-admin 重置、是否需要直连数据库）。
- **影响**：唯一管理员一旦忘记密码，缺少书面运维步骤，可能导致部署方在故障时手忙脚乱或采取不安全的临时手段（如直接改库明文）。
- **建议**：在 F 节或 T25 增补一条"密码恢复 runbook"（例如：需要主机/容器访问权限执行一次性重置脚本，重置后强制撤销所有旧会话），作为已知产品取舍（无 2FA）的配套运维文档。
- **严重级**：Low（不改变已确认产品行为，只是运维文档缺口）。

### L-AUD-03（Low）— GitHub 未认证 API 限额未纳入错误处理
- **证据**：T09 Interfaces："GitHub 用户 URL 只解析 owner/repo，数据从固定 `https://api.github.com` 经 safeFetch 获取"；未提及未认证请求 60 次/小时的官方限额及超限响应（403 + `X-RateLimit-Remaining`）的分类处理。
- **影响**：若短时间内批量添加/定时重抓多个 GitHub 条目，可能被 GitHub 限流，导致连续失败且失败原因分类不准确（可能被归为通用"抓取失败"而非"上游限流"，影响重试退避策略的合理性）。
- **建议**：T09/T13 明确对 GitHub 403+限流响应的独立错误码与退避建议；如产品可接受，允许（非强制）配置个人访问令牌以提升限额，但需符合"仅抓公开内容"的既有边界。
- **严重级**：Low（规模为"几百条"且定时重抓有间隔天数，触发概率不高，但计划未显式处理）。

### L-AUD-04（Cosmetic）— ui-spec.md 文档状态文案与 state.json 批准记录不同步
- **证据**：`ui-spec.md` 第 1、234 行仍写"待确认界面""只有收到用户原文'确认界面'后才记录批准"，但 `state.json` 已记录 `ui.status=approved`（2026-08-08T20:25:30+08:00）。
- **影响**：不影响工作流状态机本身（批准记录的事实源是 state.json），但后续读者可能被 ui-spec.md 正文的"待确认"字样误导。
- **建议**：下次允许编辑 ui-spec.md 时（非本次审计员职权范围）同步更新状态行，或在 handoff 中明确批准记录以 state.json 为准。
- **严重级**：Cosmetic，不影响 go/no-go 判断。

## 5. 已接受假设（继承 + 本次复核确认仍然成立）

- **AR-001**（继承自 review-ledger.md）：Telegram `sendMessage` 无幂等键，发送成功后、标记 sent 前崩溃可能导致重复回执（at-least-once）。已有 `duplicate_possible` 指标缓解，用户尚未在本轮明确对该项追加确认（此前是 Codex 阶段的技术性接受，非用户原文"接受风险，开始实施"）。**本次连同 L-AUD-01~03 一并提交用户裁决。**
- **requirements §0.3**：公开问答会使全库内容对外可见，用户此前已在需求确认阶段明确接受，计划未扩大此风险边界。
- **无 2FA**：用户明确要求去掉，属产品既定决策，非本计划缺陷。

## 6. decisions.md 历史候选状态的处理

`decisions.md` D-02~D-04（数据库/模型接入层/TG 接入方式）文档状态仍标注"候选，未定稿"，但 implementation-plan.md 已直接使用其结论（PostgreSQL+pgvector、OpenAI 兼容双客户端、long polling）。计划第 37 行已自陈"`decisions.md` D-02～D-04 的历史文本仍标为候选……最终审计若认为这些选择需要用户额外裁决，应停在 `user_decision`"。

**独立审计判断**：这些技术选择均有实施级"选择/替代项/失效条件"表格支撑，且都是纯技术实现细节（数据库/模型客户端抽象/TG 轮询方式），不改变用户已确认的产品行为、UI 或数据暴露边界，属于技术选型层面而非需求变更。**不需要额外拦停要求用户重新裁决**；建议后续任一时机顺手把 decisions.md D-02~D-04 的状态行更新为"已定稿"以消除文档不一致（这是文档卫生问题，不阻塞实施）。

## 7. 结论与建议

- **Critical/High/Medium**：0（继承 Codex rev4 复核结果，本次独立抽样验证未发现虚假关闭）。
- **Low**：1 项继承（AR-001）+ 3 项新增（L-AUD-01~03，均为 Low）。
- **Cosmetic**：1 项（L-AUD-04，文档同步问题，不计入风险等级）。
- **推荐结论：conditional go**——技术方案本身已通过 3 轮 Codex 修订，10/10 验收量表通过，安全边界与 fail-closed 门禁经独立复核未发现漏洞；但本次审计新发现的 3 条 Low 级残余问题（尤其 L-AUD-01 涉及模型重建窗口的用户体验/资源分配，L-AUD-02 涉及无恢复路径的运维空白）此前从未被评审台账记录或被用户显式接受，按流程不能由审计员自行放行，需用户明确选择：
  1. **继续改进**：把本报告（尤其 L-AUD-01~03）交回 Codex 方案验证器做窄修订（预计不需要新的 review cycle 上限压力，属于小范围补丁）；或
  2. **接受风险，开始实施**：用户明确接受 AR-001 + L-AUD-01~03 全部残余风险后直接进入实施，实施工程师仍需在 `implementation-report.md` 中记录这些已知残余风险的最终处理方式；或
  3. **暂停流程**：如需更多时间考虑。

本报告不构成对 implementation-plan.md 的修改，也不构成"方案零风险"的声明。

---

# 附录：rev5 独立复核（Cycle 4 窄修订）

- 复核对象：`implementation-plan.md` rev5（Codex Cycle 4，基线为本报告第 1–7 节针对 rev4 的 L-AUD-01~04 + DOC-001）
- 触发：用户于 2026-08-08T22:22:21+08:00 原文选择"继续改进"，授权范围="修复 final-audit L-AUD-01/02/03 + L-AUD-04 与 decisions.md 文档同步"（`state.json.user_decision`）。
- 复核方式：全新独立会话，只读；未修改 implementation-plan.md/requirements.md/decisions.md/ui-spec.md。
- 新鲜证据：本次重新运行 `python3 .claude/skills/project-delivery-workflow/scripts/validate_workflow.py .`，输出 `PASS: workflow stage=codex_accepted revision=5`（本次执行）。

## A1. 逐项核验 Cycle 4 处置是否真实落地（而非仅采信 review-ledger 的"fixed"标签）

### L-AUD-01（向量重建期间限流额度被无谓消耗）→ 已修复，证据确凿
- rev5 T18 新增 `getPublicAskReadiness()`：只读 `app_settings`，要求 LLM/Embedding 配置完整、`emb_rebuild_status='ready'`、当前 dim/version/cutoff 有效，且**不发任何模型请求**。
- 请求顺序改为：输入 schema → readiness 快检 → 可信 IP → `consumePublicAsk`；限流事务锁 `settings` 行之后**再次复核同一 readiness**（防止"快检通过后、扣费前配置被切换"的竞态），不 ready 或检查异常时整笔回滚返回 `MODEL_UNAVAILABLE`（503、no-store），**不创建/不递增 counter**。
- T18 Step1 测试列表显式覆盖：`unconfigured/building/failed` 各态、缺字段、DB 检查失败均不计数且 embedding/LLM 调用数为 0；"快检后配置并发切为 building 时事务复核仍不计数"这一竞态场景也被单独列为测试项。
- **结论**：不仅解决了原始问题（重建期间不再无谓扣费），还补上了我未曾要求的竞态防护（事务内二次复核），修复质量高于最小要求。**确认已修复，无回归**（T17 `retrieve()` 内部原有的 rebuild 门禁未被移除，形成双重保险）。

### L-AUD-02（管理员密码恢复 runbook 缺失）→ 已修复，证据确凿
- rev5 F 节新增"管理员密码恢复"条目：明确无 2FA/恢复码是既定取舍，忘记密码必须取得主机/容器权限，按 T25 runbook 执行；脚本成功后强制撤销全部旧会话；明确禁止"直接写明文密码、临时开放无鉴权重置 API、复用旧 session"三类不安全做法。
- T25 新增 `scripts/reset-admin-password.ts`：仅能通过 `docker compose run --rm app pnpm reset-admin-password` 由主机/容器权限运维者执行，**不暴露 HTTP 路由**；交互式读取 username/new password 或权限 0600 secret file；复用 T05 的 12–128 字符强密码规则与 argon2id；在**单事务**内更新哈希并删除 `sessions` 全表，失败整笔回滚；日志仅记录 `admin_password_reset{ok}`（不含用户名/密码）。
- T25 Step1 测试新增 `tests/integration/adminRecovery.test.ts` 场景：错用户/弱密码/DB 失败时不改哈希且不删 session；成功后新密码有效、旧密码无效、所有旧 session 失效、无 Web/API 入口、日志无敏感值。
- **结论**：恢复路径明确、原子性有保障（同事务改密+清会话，失败回滚，不会出现"密码已改但旧会话未撤销"的中间态）。**确认已修复。**

### L-AUD-03（GitHub 未认证 API 限额无分类错误码/退避）→ 已修复，证据确凿，且未违反既有边界
- T09 新增：403/429 且 `X-RateLimit-Remaining=0` / `Retry-After` / `X-RateLimit-Reset` 时抛 `GITHUB_RATE_LIMITED{retryAt}`（响应头优先，否则指数退避、上限 1 小时、加 jitter），与普通 403（权限拒绝）区分，不误判为通用抓取失败。
- T09 明确"响应必须 `private=false`，否则拒绝，**确保即使配置 PAT 也不抓私有仓库**"——PAT 仅用于提升匿名 API 配额，不放开"抓私有仓库"的边界，与 requirements §0.2 非目标（不做私有仓库抓取）保持一致。
- T13 新增 `app_settings.github_backoff_until`：定时重抓时无 PAT 场景下每 rolling hour 最多安排 50 个 GitHub 项（低于官方 60/h 限额留有余量），超出部分推迟到下一窗口；收到限流后用 `GREATEST` 原子更新持久 backoff 时间，同轮及后续 GitHub 请求统一遵守，**非 GitHub 网页/文档条目不受影响**（即限流只隔离在 GitHub 抓取路径，不拖慢其余条目的定时重抓）。
- T09/T13 Step1 测试覆盖：`private=true` 即使有 PAT 也拒绝；未认证限流 403/429 的分类映射；前 50 个正常/第 51 个 defer；收到限流后续 GitHub 项延迟、网页不受影响；reset 后恢复；PAT 仅提高预算不放开 private repo；Token 不出日志。
- **结论**：修复质量高，且明确划清了"PAT 用于提升公开 API 配额"与"抓取私有内容"的边界，未违反非目标。**确认已修复**（关于 PAT 本身是否与"不做凭证/Token 管理"非目标存在文本层面的张力，见下方 A2 观察项——不作为阻断项，仅供用户知情）。

### L-AUD-04 / DOC-001（文档状态不同步）→ 已修复
- `ui-spec.md` 标题与状态说明已改为"已确认界面"，并注明用户原文确认时间与内容，正文（方向 C、Apple 增强、输入栏几何）未被改动，与 `state.json.approvals.ui` 一致。
- `decisions.md` 总状态与 D-02～D-04 均已标注"已定稿"，保留候选方案、理由、后果与失效条件，未引入新选型，与 implementation-plan.md 实际采用的结论（PostgreSQL+pgvector、OpenAI 兼容双客户端、long polling）对齐。
- **结论**：确认已修复，文档口径统一。

## A2. 新观察项（非阻断，供用户知情；不计入 Critical/High/Medium/Low 分级）

### OBS-01 — GitHub PAT 环境变量与"不做凭证/Token 管理"非目标的文本张力
- **证据**：requirements.md §0.2 非目标写"抓取需要登录 / 付费墙 / 私有 GitHub 仓库的内容（**不做凭证/Token 管理**）"；rev5 T09 新增"可选 `GITHUB_PUBLIC_API_TOKEN` 仅来自环境变量、只用于这些公开 API 请求，不进入管理 UI/DB/日志"。
- **分析**：两者意图不同——非目标条款针对的是"用凭证解锁私有/登录内容"，而新引入的 PAT 只是给**公开** GitHub API 提高匿名限额的运维旋钮，不出现在管理 UI、不落库、不解锁私有仓库（已有 `private=false` 硬校验兜底）。功能上不冲突，但字面上"Token"一词与非目标条款存在表面重叠，可能被后续读者误解为"引入了 Token 管理功能"。
- **建议**：这是可选的、纯环境变量层面的运维配置，不需要退回 Codex 修订；建议仅在 `implementation-report.md` 交付说明或 `.env.example` 注释中一句话说明"该 Token 仅用于提升公开 API 配额，不涉及私有仓库/登录内容抓取"，避免歧义。**不构成 Low 级缺陷，不影响 go/no-go。**

## A3. 回归检查

- **需求矩阵**：A 节 F-01～F-12 与 rev4 完全一致（逐行比对无差异、无删减、无新增需求行），仍 12/12 有任务+验证映射。
- **任务连续性**：T01～T25 编号连续，rev5 改动集中在 T09/T13/T18/T25/F 节/B 节文件列表（新增 `scripts/reset-admin-password.ts`）与 §27-37 技术选择表注记，未触及其余任务的接口签名或验证断言。
- **安全边界**：D.1 鉴权/CSRF/fail-closed 顺序、H 节安全汇总、T02 SSRF 出口未被改动；未发现因本轮修订放宽任何既有安全门禁。
- **确认无新增 Medium 以上 finding**：抽查 T09/T13/T18/T25/F 节改动点，未发现"看似修复实则遗留漏洞"的情况（例如未发现 readiness 快检可被绕过、密码恢复脚本未发现可远程触发的路径、GitHub 限流退避未发现死锁或无限重试风险）。
- **验收量表**：原 10/10 Pass 结论继续成立，Data/interfaces、Security/privacy、Operations、Risk 四项证据因本轮修订进一步加强（与 Codex Re-Acceptance 记录一致，且经本次独立抽查未发现虚报）。

## A4. rev5 结论

- **Critical/High/Medium**：0。
- **Low**：仅剩 1 项——AR-001（Telegram at-least-once 重复回执，技术性已知残余风险，缓解措施：`duplicate_possible` 指标）。L-AUD-01～03 均已确认修复关闭。
- **Cosmetic**：0（L-AUD-04、DOC-001 均已确认修复关闭）。
- **观察项**：OBS-01（GitHub PAT 环境变量的措辞澄清建议，非缺陷，不阻断）。
- **推荐结论：go**——相较 rev4 的 conditional go，本轮新发现的 3 条 Low 级问题均已在 rev5 中得到证据确凿、无回归的修复；文档一致性问题（ui-spec/decisions）已同步；未发现新的 Critical/High/Medium；安全边界与 fail-closed 门禁经再次专项复核仍然成立。**唯一残余风险为 AR-001（Telegram at-least-once），性质是外部 API（Telegram `sendMessage` 无幂等键）导致的技术性残余风险，无法通过本产品架构内的手段完全消除，只能缓解（已有指标）。**
- 按流程要求，"go"不等于零风险声明：AR-001 仍需用户在 `user_decision` 阶段以"接受风险，开始实施"的原文明确接受，才能进入 implementation 阶段；若用户认为 AR-001 仍不可接受，应选择"继续改进"并说明期望的进一步缓解方向（例如为 TG 回执增加去重可见提示，而非依赖发送方保证幂等）。

本附录同样不构成对 implementation-plan.md 的修改，也不构成"方案零风险"的声明。
