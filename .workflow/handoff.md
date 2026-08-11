# Handoff

- Milestone: 导航站增强（M2）
- Target role: `implementation_agent`（Codex 方案实施工程师）
- Stage: `implementation`
- Active role: `implementation_agent`
- Plan revision: 11（Codex accepted，Claude 审计 conditional go）
- 用户决策: **接受风险，开始实施**（原文，2026-08-11）；已接受 AR-M2-01（FA-M2-01 fail-closed 语义）、AR-M2-02。

## 实施依据（canonical，必须逐字遵循，不得重设计）
- 已验收计划：`.workflow/implementation-plan-nav-enhancement.md` rev11（Task 1→N，含 Global Invariants、Files And Contracts、稳定错误码）
- 已确认需求：`.workflow/requirements-nav-enhancement.md`（v0.6）
- 已批准 UI：`.workflow/ui-spec-nav-enhancement.md`（C 工作台）
- 审查台账：`.workflow/review-ledger.md`（NAV-001～023）
- 审计：`.workflow/final-audit-nav-enhancement.md`（conditional go；AR-M2-01 已被用户接受）
- 代码库：`/Users/apple/Downloads/new-shoucang/xm-daohang`

## 交给 Codex 方案实施工程师的任务
按 rev11 计划**逐任务实施**（TDD、频繁提交），不得重新设计方案或改变已批准语义：
- 关键不变量：单主分类 + FK SET NULL；`category_manual=true` 人工保护；AI merge/delete 遇人工条目 **fail-closed（MANUAL_CATEGORY_CONFLICT）**（AR-M2-01，用户已接受）；F202 短事务 apply + pg-boss 事务外重跑、LLM 绝不入事务；worker 三门禁（initialized/version/manual）；F209 LIKE 字面转义 + 参数化 + 独立 fail-closed 限流 + 零 LLM/向量；同源受限 favicon 复用 safeFetch 且不放宽 CSP；F207 问答 doc-only 语料与 readiness 回归修正；公开首页无 hero/daily、标题「目录」+右侧关键词框+底部 AskExperience；build `env -u DATABASE_URL` 不回归 PA-01。
- 依赖新增仅限计划已批准的 `lucide-react@1.31.0`（更新 lockfile）。
- 每完成一批任务，交由 Codex 阶段验收员做阶段验收（stage-acceptance），疑难升级架构师裁决；不得自行放宽验收。
- 实施证据写入 `.workflow/implementation-report.md`（新建 M2 段，不覆盖 M1）。

## 门禁与边界
- 不改需求/UI/已验收计划的语义；如实施中发现计划确有阻断性缺陷，停下并上报架构师，不擅自改设计。
- 未经用户批准不部署、不打 Tag、不推送生产、不操作生产数据、不标项目 complete。
- 完成全部实施与阶段验收后，交回架构师协调实施后最终审计与用户发布决策。

## Next action
Codex 方案实施工程师读取上述 canonical 文件，从 Task 1 开始实施 M2 计划。
