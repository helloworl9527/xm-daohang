# 导航站增强 M2 阶段验收：Task 4 worker 集成归类

- 日期：2026-08-11（Asia/Shanghai）
- 初验提交：`885ff22458f8c57226f4ff9fceb68d7592dfa9fe`
- 返工复验提交：`1b33d8e3b4bd48bc7568b40fb059e1df1f3fb412`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 4 与 Global Invariants
- 结论：**通过**。人工选择 NULL 的初始与 completion 并发门禁 R1 已闭环，Task 4 可放行并继续 Task 5。

## 独立复验环境

1. 仅验收稳定提交的 detached worktree `/tmp/xm-1b33d8e-accept.cAtI9c`，不以动态工作区裁决。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432`、同名数据库 `collection_system_test`，与实施工程师默认实例物理隔离并满足数据库名安全守卫。

## 正向复跑证据

1. processItem 定向为 1 file / 20 tests 通过；Task 1-4 联合定向为 5 files / 65 tests 通过。
2. `tsc --noEmit` 退出 0；`eslint .` 退出 0，为 0 error、1 条已批准 UI 原型既有 warning；`git diff --check` 退出 0。
3. workflow validator 退出 0，输出 `PASS: workflow stage=implementation revision=11`。
4. 分类只面向 initialized taxonomy 下的 web/github；taxonomy/classifier 错误被隔离为 skipped，处理仍 completed 且不进入 retry。
5. `selected` 应用候选，可靠 `unclassified` 写 NULL，`invalid_output`/`upstream_error` 保留旧分类；completion transaction 内重验 taxonomy version、候选存在性与当前 manual，并保持 item、processing request、Telegram receipt 原子完成。
6. taxonomy snapshot 短事务结束后才调用 classifier；分类器挂起期间 completion transaction 尚未开始，LLM 不在数据库事务内。

## 原十项反向验证

初验已在独立变异 worktree 中逐项中和 type、初始 manual、initialized、taxonomy 错误隔离、classifier 错误隔离、可靠 NULL、completion manual、version、候选存在性，以及把分类准备包入 `db.transaction`：

1. 十个对应命名测试均为 1 failed、exit 1，分别命中模型调用次数、completed/retrying、分类持久值、人工覆盖、version/candidate 结果或 transaction 调用次数断言。
2. 每个变异 diff 仅含目标门禁修改；失败均为 Vitest `AssertionError`，不是语法、依赖、迁移或启动错误。
3. 初验证据目录：`/tmp/xm-885ff22-reverse.sRPMSz`。R1 未修改产品模块或这些既有门禁。

## R1 闭环与反向验证

初验时，把保护弱化为仅保护 manual 且 categoryId 非 NULL 后，人工保护命名测试仍 exit 0，故退回。返工后确认：

1. 新增初始 `{categoryManual:true, categoryId:null}` fixture；taxonomy 已初始化且存在自动候选，但 loadTaxonomy/classify 均零调用，处理 completed 后仍为人工 NULL。
2. 新增推理期间管理员写 `{categoryManual:true, categoryId:null}` 的并发 fixture；释放 selected 结果后仍保持人工 NULL，并记录 `category_classified/skipped/manual_override`。
3. 反证 A：仅把初始保护弱化为 `item.categoryManual && item.categoryId !== null`，新命名测试因 loadTaxonomy 被调用而 1 failed、exit 1。
4. 反证 B：同时中和 completion 的 `saved.categoryManual` 分支与最终 update 的 `categoryManual=false` 条件，推理期间人工 NULL 被自动候选覆盖，新命名测试命中持久值断言，1 failed、exit 1。
5. 两个变异 diff 仅含目标保护修改，失败均为 Vitest `AssertionError`。证据目录：`/tmp/xm-1b33d8e-reverse.AN1eaa`。

## 完整回归归因

1. 完整回归为 44/46 files、310/312 tests。
2. 失败仍仅为未构建 `.next/standalone/node_modules` 的 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 固定期望 `2026-08-09`、当前业务日 `2026-08-11`。
3. R1 只修改 processItem 集成测试与 workflow 文档，未修改上述失败用例或其产品路径；两项确属既有构建前置/历史日期用例，不是本批引入。

## 残余风险

- Task 4 范围内未发现剩余阻断项；完整回归的两项既有问题继续按既有记录另行处理。
