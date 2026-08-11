# 最终独立审计 · 导航站增强（M2）

- 里程碑：导航站增强（M2）
- 审计对象：`.workflow/implementation-plan-nav-enhancement.md` **rev11**（Codex 已验收）
- 审计角色：Claude 最终审计员（独立、只读；未参与需求/UI/方案/Codex 评审）
- 审计阶段：方案实施前（pre-implementation plan audit）
- 审计时间：2026-08-11
- 事实源：`requirements-nav-enhancement.md`（state/UI 记为 v0.6，正文含 v0.6 文案）、`ui-spec-nav-enhancement.md`（C 工作台，已批准）、`decisions.md`（M1 架构背景）、`review-ledger.md`（NAV-001～023）、真实代码库 `src/`
- 结论：**Conditional Go（有条件通过）**——无未解决 Critical/High/Medium；1 项需用户明确裁决的“已批准语义解释”，另有若干 Low 观察项。

---

## 1. 审计方法与新鲜证据

按 verification-before-completion，先独立读计划并对照 acceptance-rubric 形成判断，再读需求/UI/决策，最后读台账以降低锚定；关键假设逐一对照**真实代码**取证，不仅依赖台账自述：

| 验证点 | 计划/台账主张 | 独立取证结果 |
| --- | --- | --- |
| 工作流状态 | stage=codex_accepted, rev11 | `validate_workflow.py` → exit 0，`PASS: workflow stage=codex_accepted revision=11` ✓ |
| CSP 与 favicon 相容性 | 现有 CSP `img-src 'self' data:`，同源 favicon 路由无需放宽 | `src/middleware.ts:11` 确为 `img-src 'self' data:`；`/favicon/<id>` 属 self，无需改 CSP ✓ |
| favicon 复用 SSRF 加固 | 复用 safeFetch 逐跳校验/固定 IP/流限/MIME | `src/lib/fetch/safeFetch.ts`：`fixedLookup` 固定已解析地址、`maxRedirections:0`+手动逐跳 `MAX_REDIRECTS`+每跳 `resolveTarget`、`readBoundedBody` 按 `maxBytes` 流式截断、`allowedMime` 强校验 ✓ |
| 关键词限流 fail-closed | 复用 `getTrustedClientIp`，异常 503 不放行 | `src/lib/http/clientIp.ts:19` 代理密钥缺失/<32B/不等/含逗号均 `throw UntrustedProxyError` → fail-closed ✓ |
| 关键词独立于问答额度 | 独立 counter，不占 ask quota | 现仅 `src/lib/ratelimit/publicAsk.ts`（`consumePublicAsk`）；计划新建 `publicKeyword.ts` + `kw:global`/`kw:ip` scopes，隔离成立 ✓ |
| F209 无 AI/向量 | 只字面匹配，不 import retrieve/embedding/LLM | 现有 `src/lib/search/retrieve.ts` 为向量；计划新建独立 `keyword.ts`，Task 9 明确不 import 上述 ✓ |
| items schema 增量 | 0003 仅 additive；tags 为数组可 unnest | `src/db/schema.ts` items 无 category 字段、tags=`text[]`、type/status check 现存；migrations 仅 0000~0002，journal v7；0003 可由 `db:generate` 追加 ✓ |
| NAV-005 问答判空陷阱真实存在 | 现首页用 daily 数量判空，需改 `hasCompletedAskCorpus`（含 doc） | `src/app/(public)/page.tsx:28` 确为 `dailyItems.length === 0 ? disabledEmpty`，若仅 doc 会误禁问答——风险属实，计划 Task 10 修正 ✓ |
| lucide-react 缺失 | 需新增 pinned 1.31.0 | `package.json` 无 `lucide-react`，与 NAV-017 一致 ✓ |
| 每日轮换后端保留 | 仅撤展示，不拆后端 | `dailySelections` 表与 `pickDailyForNow` 均在，计划仅移除首页渲染 ✓ |

台账 5 轮收敛（NAV-001～023 全部 fixed，最终 0/0/0/0）与 rubric 10/10 的自述，均能被上述独立证据支持；未发现台账夸大或“静默通过”的门禁。

---

## 2. 残余问题清单

### FA-M2-01 —（需用户裁决）人工分类保护采用 fail-closed 阻断，改变了 F202b 的已批准工作流语义
- 严重级别：**Medium（语义/裁决项，非缺陷）**
- 证据：计划 Global Invariants 第 4/5 条、Task 6、§4 Stop Conditions；需求 §2.2 F202b 验收原文「…现有 `category_manual=true` 条目分类保持不变，被合并/删除类下的自动条目按所选规则转移」；schema `items.category_id … ON DELETE SET NULL`（单主分类）。
- 分析：在**已批准的单主分类 + FK SET NULL** 数据模型下，需求 F202b 的字面验收在“被合并/删除分类内仍存在人工条目”时**自相矛盾**——无法既删除该分类、又让人工条目的 `category_id` 保持指向它。计划的处置是：AI merge/delete 遇到 source 有人工条目时整批 `MANUAL_CATEGORY_CONFLICT` fail closed，要求管理员先在 F204 显式迁移人工条目（或在预览忽略该项）；独立 CRUD 删除属显式人工操作，可 SET NULL 但保留 `category_manual` 值。
- 我的独立判断：该处置**忠实于并强化**了 Q3 的更高阶意图「保留人工分类，AI 不覆盖」——它不弱化保护，反而杜绝了 AI 静默把人工条目移动/置空。但它**改变了 F202b 已批准的行为形态**：由「合并/删除自动进行、人工项原地不动」变为「存在人工冲突时阻断、强制管理员先手动迁移」。这是需求验收文本未描述的工作流增量。
- 影响：管理员在“重拟后应用”时可能遇到必须先手动迁移人工条目、否则无法应用整批 diff 的额外步骤；这是可用性/流程差异，不是数据安全弱化。
- 建议：**交用户明确裁决该解释**。计划已在 §4 与 handoff #1 主动标注此为停止条件，且未静默放宽保护——因此我按“交用户裁决、不改计划”处理，将其作为用户决策的首要确认项。若用户认可此保护性解释 → 可进入实施；若用户要求“合并/删除仍自动进行且人工项另行安置”的其它语义 → 应退回 Codex 修订，不由审计员改计划。
- 已接受假设：进入实施即视为用户接受“AI 破坏性 diff 遇人工条目→fail-closed 阻断并要求先手动迁移”为 F202b 的落地语义。

### FA-M2-02 —（Low）reclassify publisher 崩溃恢复的“扫描者”触发点未完全指定
- 严重级别：Low
- 证据：Task 6「发送失败保留可由 publisher 扫描恢复的 reclassifying run」；Task 7 依赖 pg-boss singleton 与持久 cursor，但未明确“扫描滞留 `reclassifying` run 并补发作业”的组件位置与触发节奏（worker 启动时？周期性？）。
- 影响：极端时序下（apply 提交后、pg-boss 发送前进程崩溃）某 run 可能停在 `reclassifying` 且无作业在跑，直到下一次触发扫描才恢复；分类结构已应用，仅“存量自动重跑”滞后。不影响 taxonomy 正确性与人工保护。
- 建议：实施阶段在 Task 7/13 明确恢复扫描的落点（如 worker 启动 + 心跳周期扫描 `status='reclassifying' AND applied_version=当前版本` 的 run 并按 singleton key 幂等补发），并加“apply 后 publish 前崩溃 → 重启后自动收敛”的集成测试（Task 6 已列 publisher crash 测试，需覆盖此补扫描路径）。

### FA-M2-03 —（Low）关键词字面搜索的规模退化无索引缓解，仅靠 p95 门禁与限流
- 严重级别：Low
- 证据：Task 9 使用前置通配 `ILIKE '%term%'` 与 tags `unnest…EXISTS`，无 trigram/GIN 索引计划；Task 13 将 p95 目标定为“本机集成环境 <1s、数百条”，超标则停止发布或用户接受。
- 影响：前置通配无法命中 btree 索引，实为顺序扫描；在承诺的“数百条”规模可接受，但若语料显著增长，关键词搜索延迟会线性退化。当前受公开限流保护，DoS 风险有限。
- 建议：保留为规模相关的已知风险；若未来语料超出“数百条”设计规模，评估 `pg_trgm` GIN 索引。当前范围内**不阻塞**。

### FA-M2-04 —（Cosmetic）需求文件头版本号 v0.5 与 state/UI 的 v0.6 不一致
- 严重级别：Cosmetic
- 证据：`requirements-nav-enhancement.md` 文件头 `版本：v0.5`，而 state.approvals 与 UI 均引用 v0.6 显示文案；正文 §2.6 已含「显示文案（v0.6…）」条目。
- 影响：无行为影响——v0.6 文案内容已在正文落实，仅头部标签滞后。计划 Global Invariant #1 已显式承认并选择不改该审批产物。
- 建议：无需在本阶段处理；若日后由需求负责人更新审批产物时顺带修正头部即可。审计员不修改审批产物。

---

## 3. 按 handoff 五项独立核查结论

1. **人工保护语义（focus #1）**：见 FA-M2-01。判断=忠实且更强的保护性解释，但改变 F202b 已批准工作流形态 → **交用户裁决**（不改计划，不静默放宽）。
2. **version / apply·retry 幂等 / failure 派生计数 / publisher 崩溃 / worker 事务边界**：**闭合**。`app_settings` 行锁 + `category_version` 递增；`request_key` 唯一幂等 apply；append-only `category_run_retry_requests(run,key,generation)` 提供多请求持久幂等（NAV-022 修复）；`run.failed_count` 已移除缓存、改由 failure 表 `count(*)`/`exists` 派生（NAV-023 修复）；worker 提交前重验 version + 候选存在性 + `category_manual=false`。唯一残余为 FA-M2-02(Low) 的扫描触发点。
3. **F209 可信代理/HMAC/独立 counter/LIKE 转义/tags unnest/DB fail-closed/0 AI**：**闭合**且有代码取证。`getTrustedClientIp` 本身 fail-closed；`escapeLikeLiteral` 处理 `\\ % _` + 显式 `ESCAPE '\\'`；tags 参数化 `unnest…EXISTS`；异常 503；不 import 向量/LLM/ask。
4. **favicon 同源、不接任意 URL、复用 SSRF/DNS/redirect/固定 IP/大小/MIME、不放宽 CSP**：**闭合**且有代码取证。路由仅收 UUID item id→校验 eligible→由已存 origin 派生，safeFetch 逐跳固定 IP+流限+MIME allowlist（排除 SVG/HTML，杜绝 SVG XSS），本地 fallback，CSP 无需改动。
5. **首页无 hero/daily、标题“目录”+右侧搜索、底部 AskExperience、doc-only 问答、局部失败、`env -u DATABASE_URL` build 不回归 PA-01**：**闭合**。`hasCompletedAskCorpus`（含 doc）修正了已取证的真实判空陷阱；`DirectoryData` 局部 Suspense/error 边界使目录失败不波及搜索框与问答；Task 13 保留 `env -u DATABASE_URL build` + `verify-production-artifact` 门禁。

---

## 4. Acceptance Rubric 独立复核（1～10）

| # | 项目 | 独立结论 | 备注 |
| --- | --- | --- | --- |
| 1 | Scope | Pass | F201～F209、单主分类、doc 排除、问答不变、无 hero/daily 一致；人工保护歧义见 FA-M2-01。 |
| 2 | Traceability | Pass | §3 矩阵 F201～F209 全映射 Task 1～13；Must/Should/Could 全覆盖。 |
| 3 | Architecture | Pass | 短事务 apply + 事务外 LLM + pg-boss 可恢复重跑 + RSC 局部边界 + 独立 limiter + favicon 边界，均与真实代码相容。 |
| 4 | Data & interfaces | Pass | 0003 additive、FK/manual/version/run/failure/retry；严格 Diff/AutoDestination、ETag、幂等、envelope 齐全。 |
| 5 | Security & privacy | Pass | 鉴权管线复用；限流/代理/favicon/LIKE/日志脱敏全部 fail-closed，已代码取证。 |
| 6 | UX | Pass | C 工作台层级、搜索 URL/全状态、目录局部失败、diff/确认/真实进度、键盘/焦点/触控/reduced 偏好齐备。 |
| 7 | Quality | Pass | migration/unit/integration/e2e、并发/竞态/崩溃/幂等/注入/SSRF/doc-only/500 条性能门禁明确。 |
| 8 | Operations | Pass | pg_dump、M1→0003 升级、前向兼容回滚、readiness/heartbeat、restore smoke、artifact 校验；FA-M2-02 为 Low 观察。 |
| 9 | Execution | Pass | 13 任务精确到路径/DTO/事务顺序/错误/测试/命令；依赖锁定 1.31.0，无版本占位。 |
| 10 | Risk | Pass | manual/FK、favicon、模型上下文、性能、发布失败均有 stop condition；FA-M2-01 已作为停止条件显式外露。 |

---

## 5. 已接受假设与风险

- **AR-M2-01（待用户确认）**：F202b 中“AI merge/delete 遇人工条目 → fail-closed 阻断、要求先手动迁移”作为落地语义（见 FA-M2-01）。用户进入实施即视为接受此解释。
- **AR-M2-02**：关键词字面搜索面向“数百条”设计规模；超规模的延迟退化为已知风险（FA-M2-03）。
- **AR-M2-03**：本审计为**实施前方案审计**，仅证明计划的可执行性与风险覆盖；不代表产品代码、测试、部署已完成或通过。真实测试/门禁证据须在实施阶段产出。
- 沿用 M1 已接受风险 AR-001（Telegram 主动回执 at-least-once 可能重复）——M2 不改动该链路。

---

## 6. 结论

**Conditional Go（有条件通过）。**

- 独立审计未发现未解决的 **Critical / High / Medium 缺陷**；Codex 的 0/0/0/0 与 10/10 Pass 结论在 High/Medium 层面与我的独立判断一致，且关键门禁均能被真实代码证据支持、未见“静默通过”。
- **通过条件（唯一必答项）**：用户须对 **FA-M2-01**（人工分类保护的 fail-closed 阻断解释）作出裁决。这是对两条相互冲突的已批准需求（单主分类 FK 模型 vs. F202b 字面验收）所做的保护性取舍，只有用户能权威确认其是否符合本意。
- FA-M2-02 / FA-M2-03 为 Low、FA-M2-04 为 Cosmetic，均不阻塞实施，建议在实施阶段消化或作为已知风险接受。
- 本方案**不存在绝对无风险**的声明；上述残余项与假设已如实列出。

下一步交由用户在“继续改进 / 接受风险，开始实施 / 暂停流程”三者中决定。
