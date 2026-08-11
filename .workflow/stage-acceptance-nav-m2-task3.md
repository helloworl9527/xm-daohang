# 导航站增强 M2 阶段验收：Task 3 单条分类器

- 日期：2026-08-11（Asia/Shanghai）
- 初验提交：`270ae160e30b660f92cb73b84b7dec259d8bd7b1`
- 返工复验提交：`160499c1242b00622c17ac815630824f37e4479d`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 3 与 Global Invariants
- 结论：**通过**。prompt-injection 隔离门禁 R1 已闭环，Task 3 可放行并继续 Task 4。

## 独立复验环境

1. 仅验收稳定提交的 detached worktree `/tmp/xm-160499c-accept.MNVhcV`，不以动态工作区裁决。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432`、同名数据库 `collection_system_test`，与实施工程师默认实例物理隔离并满足数据库名安全守卫。

## 正向复跑证据

1. Task 1-3 联合定向：4 files / 45 tests 通过，其中 classify 为 1 file / 18 tests。
2. `tsc --noEmit` 退出 0；`eslint .` 退出 0，为 0 error、1 条已批准 UI 原型既有 warning；`git diff --check` 退出 0。
3. workflow validator 退出 0，输出 `PASS: workflow stage=implementation revision=11`。
4. 四态合同保持分离：候选且 confidence >= 0.65 为 `selected`；`null`/`NONE`、低置信或无候选为可靠 `unclassified`；未知 ID、非法/超长/strict 违规输出为 `invalid_output`；模型异常为 `upstream_error`。所有分支均不向 worker 抛出。
5. 其余覆盖包括无候选零模型调用、单个完整 JSON fence、4 KiB UTF-8 字节上限、候选白名单、固定 system 提示、结构化 user JSON、仅 outcome 脱敏日志及 logger 异常隔离。

## R1 闭环与反向验证

初验时，把恶意 tags 或候选分类名复制进 system 后，命名注入测试仍 exit 0，故退回。返工后确认：

1. fixture 同时包含恶意 title、summary、每个 tag 及两个恶意候选分类名；测试断言 system message 等于固定模板，并逐一断言所有不可信值不在 system 中。
2. user message 经 `JSON.parse` 后必须精确等于 `{item: injected, categories: injectedCategories}`，证明所有不可信值保留在结构化数据边界内。
3. 反证 A/B：分别仅把 `input.title`、`input.summary` 追加到 system，两次命名注入测试均因固定模板等值断言失败，1 failed、exit 1。
4. 反证 C：隔离变异仅把 `input.tags.join(",")` 追加到 system，同一测试因固定模板等值断言失败，1 failed、exit 1。
5. 反证 D：隔离变异仅把 `input.categories[0].name` 追加到 system，同一测试因固定模板等值断言失败，1 failed、exit 1。
6. 四个变异 diff 都仅含目标泄漏，失败均为 Vitest `AssertionError`，不是语法、依赖或启动错误。证据目录：`/tmp/xm-160499c-reverse.Rbe3SC`。
7. 初验已独立确认中和无候选短路、strict schema、候选白名单、0.65 边界及 4 KiB 上限时，各自命名测试均 assertion failure、exit 1；返工未修改产品模块或这些既有门禁。

## 完整回归归因

1. 完整回归为 44/46 files、301/303 tests。
2. 失败仍仅为未构建 `.next/standalone/node_modules` 的 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 固定期望 `2026-08-09`、当前业务日 `2026-08-11`。
3. R1 只修改分类测试与 workflow 文档，未修改上述失败用例或其产品路径；两项确属既有构建前置/历史日期用例，不是本批引入。

## 非阻断说明

- 计划 Task 13 规定最终结构化事件名为 `category_classified`；本模块当前使用 `category_classification`。Task 3 文本只要求脱敏 outcome 日志，最终事件名可在 Task 4/13 接线时统一，本次不据此新增阻断项。
