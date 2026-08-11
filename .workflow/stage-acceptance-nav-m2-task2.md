# 导航站增强 M2 阶段验收：Task 2 分类 store

- 日期：2026-08-11（Asia/Shanghai）
- 验收提交：`1b9c418797b1d271462e6bd5c064ed7829c4ef1b`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 2 与 Global Invariants
- 结论：**退回**。当前实现静态上使用显式 queryable，但计划要求的“不回落全局 db”回归门禁可 fail-open。

## 正向复跑证据

1. 在 detached worktree `/tmp/xm-daohang-1b9c418.GHs7wk` 核验实际 Git 对象 hash；实施工程师最初消息中的长 hash `1b9c418115...` 不存在，本记录使用仓库实际唯一对象 `1b9c418797...`。
2. Task 1+2 联合定向测试：3 files / 18 tests 通过；其中 store 为 1 file / 11 tests。
3. `tsc --noEmit` 退出 0；`eslint .` 为 0 error、1 条已批准 UI 原型既有 warning；`git diff --check` 与 workflow validator 通过。
4. 代码与正向测试覆盖 NFKC/trim、1～80 字符与控制字符拒绝、稳定 UUID slug、sort/name/id 排序、并发规范名冲突、not-found/version 不变、create 初始化与版本、rename/delete 单次版本、delete 影响计数及 FK 保留 manual、删空不反初始化、事务回滚、overview eligible/manual/doc 口径。
5. 完整回归：43/45 files、274/276 tests；失败仍只是不含 standalone 构建产物与历史固定日期两项，未发现 Task 2 新增功能失败。

## 阻断返工项

### R1：tx-bound helper spy 只覆盖 create，lock/rename 可回落全局 db 而门禁仍绿

- rev11 Task 2 要求 `CategoryError` 与显式 queryable，并要求 apply 内所有 helper 使用传入 tx，由 spy 证明不回落全局 db。
- 当前 `tests/categories/store.test.ts:66` 只调用 `createCategoryRecord(tx, ...)`，且只 spy `db.insert`。它没有对 `lockCategoryState`、`renameCategoryRecord`、`advanceCategoryVersion` 的实际全局方法做零调用断言。
- 反证 A：隔离目录 `/tmp/xm-1b9c418-lock_helper.bMm0C8`，把 `lockCategoryState` 的 `queryable.insert/execute` 改为全局 `db.insert/execute` 后，store 11/11 仍通过。此时 `SELECT ... FOR UPDATE` 在独立自动提交连接上立即释放，不能保护调用者事务。
- 反证 B：隔离目录 `/tmp/xm-1b9c418-rename_helper.6micWN`，把 `renameCategoryRecord` 的 `queryable.update` 改为全局 `db.update` 后，store 11/11 仍通过；未来 apply 调用者回滚时，rename 可逃逸事务。
- 期望：对 `lockCategoryState`、`createCategoryRecord`、`renameCategoryRecord`、`advanceCategoryVersion` 逐一使用调用者 transaction，spy 对应全局 `db.insert/execute/update` 并断言零调用；注入调用者回滚后断言分类、settings 初始化/version 均无持久变化。至少增加一个并发探针证明 settings 行锁在调用者事务释放前确实阻塞第二个 taxonomy writer。中和任一 helper 为全局 db 时，store suite 必须失败。
- 更新实施报告中“所有 helper 均由 spy 证明”的证据后，提供新的 Task 1+2 稳定提交复验。

## 已确认非阻断项

- store 当前产品实现经静态核对确实把 queryable 传入所有 helper；本次退回针对计划明确要求但 fail-open 的回归门禁，不是已观察到的线上数据越界。
- `PRODUCTION_NODE_MODULES_MISSING` 与 `settingsRoutes` 固定 `2026-08-09` 仍分别属于未 build 的产物前置条件和历史时间相关测试缺陷；归因与修复建议见 Task 1 验收记录。
