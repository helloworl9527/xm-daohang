# 导航站增强 M2 阶段验收：Task 1 迁移与 schema

- 日期：2026-08-11（Asia/Shanghai）
- 验收提交：`c2d542f19d6912b6c41047cf4cb686140a3df3e3`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 1 与 Global Invariants
- 结论：初验**退回**；返工提交 `a5865de08d0e2770a32f2c988fe5acbb906c63b5` 于 2026-08-11 **复验通过**。Task 2 另行验收。

## 正向复跑证据

1. 在 detached worktree `/tmp/xm-daohang-c2d542f.BbloYJ` 核验 HEAD 为完整提交 hash；主工作区内容未作为本次判定依据。
2. `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test APP_TIMEZONE=Asia/Shanghai vitest run tests/categories/schema.test.ts tests/integration/migration-nav.test.ts`：2 files / 7 tests 通过。
3. `tsc --noEmit` 退出 0；`eslint .` 为 0 error、1 条已批准 UI 原型既有 warning；workflow validator 输出 `PASS: workflow stage=implementation revision=11`。
4. `drizzle-kit generate` 输出 `No schema changes, nothing to migrate`，迁移与 snapshot 一致。
5. `0003_categories.sql` destructive DDL 扫描无命中；`0000_initial.sql`、`0001_exact_vector_scan.sql`、`0002_embedding_constraints.sql` 的 parent/HEAD Git blob 分别完全一致：`234ef751...`、`d7433f2b...`、`2459c403...`。
6. 数据隔离反测：把测试 URL 指向 `postgres` 数据库时，suite 在重置 schema 前以 dedicated `collection_system_test` guard 拒绝并退出 1。
7. 正向数据库行为已覆盖：默认 initialized/version、nullable 自动分类、规范名唯一、稳定 slug、FK `ON DELETE SET NULL`，且 `category_manual=false/true` 均保持原值；M1 completed web 向量与 failed doc 行升级后保留，migrator 第二次运行不增加账本记录。

## 阻断返工项

### R1：旧 items checks 的 Task 1 门禁可 fail-open

- rev11 Task 1 要求 schema 测试证明旧 `type/status/embedding/tags` checks 仍生效，并要求 M1 -> M2 升级测试断言旧约束不变。
- 当前 `tests/categories/schema.test.ts:96` 只反测 `items_type_check`；`tests/integration/migration-nav.test.ts:79` 只反测 `items_embedding_dimension_check`。没有反测 `items_status_check`、`items_completed_tags_check` 和 `items_embedding_metadata_check`。
- 隔离反证目录：`/tmp/xm-c2d542f-gap.S9LwGc`。把 0000 中 `items_status_check` 与 `items_completed_tags_check` 改为 `CHECK (true)` 后，原定向 2 files / 7 tests 仍全部通过。
- 期望：在应用 0003 的升级路径上，对旧 type、status、embedding metadata、embedding dimension、completed tags 约束逐一执行非法写入并断言 SQLSTATE `23514` 与稳定 constraint 名。中和任一约束时，定向 suite 必须失败。更新实施报告的约束证据后，以新的 Task 1 绿色提交复验。

## 完整回归归因

- 新鲜完整回归：42/44 files、263/265 tests；只有以下两项失败。`c2d542f^..c2d542f` 未修改两项测试、对应产品路径或产物校验脚本，因此均非 Task 1 引入。
- `deploy-smoke`：`.next/standalone/node_modules` 未构建，`verify-production-artifact.mjs` 以 `PRODUCTION_NODE_MODULES_MISSING` fail closed。属于未执行 build 的前置产物缺失；Task 1 阶段不阻断，但必须在后续完整 build/发布门禁前关闭，不能记作完整回归通过。
- `settingsRoutes`：测试由 2026-08-09 的历史提交引入，并把 counter day 与期望固定为 `2026-08-09`；当前业务日为 `2026-08-11`，所以读到 day `2026-08-11`、count `0`。这是历史时间相关测试缺陷，不是产品回归。
- 建议单独立即修复日期用例：使用 fake timer 固定业务时间，或按测试时钟计算业务日后写入/断言，避免该用例每天持续红；修复应独立提交，不混入 Task 1 数据迁移语义。

## 并发时间线

- 动态工作区曾短暂出现 Task 2 TDD 红灯：`store.test.ts` 已落地但 `store.ts` 尚未存在，导致一次 TS2307。该现象不属于稳定 Task 1 提交；在 `c2d542f` 上 `typecheck` 已通过。本记录不以该动态窗口作为退回依据。

---

## 2026-08-11 R1 返工复验

- 验收提交：`a5865de08d0e2770a32f2c988fe5acbb906c63b5`，parent 为原 Task 1 提交 `c2d542f19d6912b6c41047cf4cb686140a3df3e3`；只修改升级测试与实施报告，不改变已验收 schema/migration/meta。
- R1 已关闭：M1 -> M2 升级后逐一对 `items_type_check`、`items_status_check`、`items_completed_tags_check`、`items_embedding_metadata_check`、`items_embedding_dimension_check` 执行非法写入，并断言 SQLSTATE `23514` 与稳定 constraint 名。
- 独立反向复验：在五个隔离副本中分别把上述最终约束中和为 `CHECK (true)`，五次 `migration-nav.test.ts` 均退出 1，失败原因均为非法写入 promise 意外 resolved；门禁现已 fail closed。
- 正向门禁：定向 2 files / 7 tests；`typecheck`；`lint` 0 error、1 条既有原型 warning；`git diff --check`；workflow validator，均通过。
- 完整回归在共享测试库空闲后复跑为 42/44 files、263/265 tests；失败仍只是不含 standalone 构建产物与历史固定日期两项。此前一次全量运行遭另一进程并发 reset 测试 schema 污染，出现关系丢失/迁移异常；协调停止并确认无活动连接后已复跑恢复，污染结果不作为提交判定依据。
