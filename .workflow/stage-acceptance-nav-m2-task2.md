# 导航站增强 M2 阶段验收：Task 2 分类 store

- 日期：2026-08-11（Asia/Shanghai）
- 初验提交：`1b9c418797b1d271462e6bd5c064ed7829c4ef1b`
- 返工复验提交：`ba566c30f63573ca91555b878eaa6b745d242301`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 2 与 Global Invariants
- 结论：**通过**。初验 R1 的 tx-bound 门禁 fail-open 已闭环，Task 1+2 可放行并继续 Task 3。

## 独立复验环境

1. 仅验收稳定提交 `ba566c30...` 的 detached worktree `/tmp/xm-ba566c3-accept.5LSAtF`，不以动态工作区裁决。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432`，数据库名保持 `collection_system_test`，pgvector 0.8.6；与实施工程师默认 5432 实例物理隔离，同时满足测试的 `current_database()` fail-closed 守卫。
3. 实施侧共享实例未被本轮复验操作；独立实例查询确认当前数据库、端口与扩展版本分别为 `collection_system_test`、`55432`、`0.8.6`。

## 正向复跑证据

1. store 定向测试：1 file / 20 tests 通过；Task 1+2 联合定向：3 files / 27 tests 通过。
2. `tsc --noEmit` 退出 0；`eslint .` 退出 0，为 0 error、1 条已批准 UI 原型既有 warning；`git diff --check` 退出 0。
3. workflow validator 退出 0，输出 `PASS: workflow stage=implementation revision=11`。
4. 功能覆盖包括 NFKC/trim、1～80 字符及控制字符拒绝、稳定 UUID slug、sort/name/id 排序、并发规范名冲突、not-found/version 不变、create 初始化与版本、rename/delete 单次版本、delete 影响计数、FK SET NULL 保留 manual、删空不反初始化、事务回滚及 overview eligible/manual/doc 口径。

## R1 闭环与反向验证

初验时，把 `lockCategoryState` 或 `renameCategoryRecord` 改为全局 `db` 后 store 11/11 仍通过，故退回。返工后确认：

1. `lockCategoryState`、`advanceCategoryVersion`、`createCategoryRecord`、`renameCategoryRecord`、`listCategories`、`createCategory`、`renameCategory`、`deleteCategory`、`getCategoryOverview` 均有独立的调用者 transaction 测试，按实际路径 spy 全局 `db.transaction/insert/execute/update/delete/select` 并断言零调用。
2. 所有写路径在调用者事务回滚后进一步断言分类、settings initialized/version、item category/manual 均未持久变化。
3. 真实双事务行锁探针把第二个 writer 的 `lock_timeout` 设为 100ms；第一事务释放前第二事务得到 PostgreSQL `55P03`，释放后可重新取得锁。
4. 在十个独立变异 worktree 中逐一反测。九个 API 分别回落全局 `db` 时，对应命名测试均为 1 failed、exit 1；失败命中预期的全局方法 spy 或调用者回滚断言。仅把 `lockCategoryState` 的 `FOR UPDATE` 查询回落全局 `db.execute` 时，行锁测试因实际错误码为 `undefined`、期望 `55P03` 而 exit 1。
5. 每个变异 diff 仅含目标 queryable 替换，所有失败均为 Vitest assertion failure，不是依赖、语法、迁移或测试启动错误。证据目录：`/tmp/xm-ba566c3-reverse.bynLek`。

## 完整回归归因

1. 返工提交完整回归：43/45 files、283/285 tests；初验提交 `1b9c418797...` 在同一独立实例复跑为 43/45 files、274/276 tests。
2. 两次失败完全相同：`deploy-smoke` 因未构建 `.next/standalone/node_modules` 报 `PRODUCTION_NODE_MODULES_MISSING`；`settingsRoutes` 固定期望 `2026-08-09`，当前业务日 `2026-08-11`，实际 `usedGlobal=0`。
3. `1b9c418...` 到 `ba566c30...` 的变更仅涉及 workflow 文档与 `tests/categories/store.test.ts`，未修改上述两个失败用例或其产品路径。因此这两项确属既有构建前置/历史时间用例，不是 Task 2 返工引入；实施报告没有夸大为完整回归通过。
4. 日期用例会随时间持续红，建议单独修复为 fake timer 或依据测试时钟生成业务日 fixture；不阻断本批 Task 2 放行。

## 残余风险

- AI apply 尚未接入这些内部 helper，按计划依赖顺序留待 Task 6；Task 2 范围内未发现剩余阻断项。
