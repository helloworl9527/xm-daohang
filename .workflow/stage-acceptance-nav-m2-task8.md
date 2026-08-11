# 导航站增强 M2 阶段验收：Task 8 管理端分类 API 与工作台 UI

- 日期：2026-08-11（Asia/Shanghai）
- 验收提交：`b7ae414bf643c05be8ce384bf6887193693177d0`
- 父提交：`f52517c3bcd2bfb67f918e86c56301b04fad817c`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 7-8 与 Global Invariants
- 结论：**退回**。存在一项会使 merge diff 无法通过真实 apply API 的 UI 合同缺口，以及一项 retry 冲突 HTTP 映射错误；不放行 Task 9。

## 独立验收环境

1. 在 detached worktree `/tmp/xm-b7ae414-accept.50GAJS` 验收指定稳定提交，`HEAD` 与父链均核对一致。
2. 数据库使用独立 PostgreSQL 实例 `127.0.0.1:55432` 与同名库 `collection_system_test`，与实施工程师默认实例物理隔离。
3. 验收后已恢复临时探针与 Playwright 端口配置，detached worktree 干净；55432 实例已停止。

## 正向复跑证据

1. Task 8 定向：`tests/categories/api.test.ts`、`reclassify.test.ts`、`integration/itemDetail.test.ts`、`unit/categoryWorkbench.test.tsx`、`unit/itemDetail.test.tsx`，共 5 files / 45 tests PASS。
2. `corepack pnpm typecheck` exit 0；`git diff --check f52517c..b7ae414` exit 0。
3. `next build` PASS，构建出 28 个动态 route，`/admin/categories` 正常生成。
4. 发现下述确定性阻断后未再把实施工程师自报的 Playwright 2/2、完整回归 365/366 或 6 项反向门禁当作本轮独立通过证据。

## R1：merge 工作台请求丢失 strict DTO 必需字段

### 独立反证

1. 临时在 `categoryWorkbench.test.tsx` 渲染只含一条 merge 的 full proposal，提交“接受 -> 应用”后检查真实 `fetch` body。
2. 实际 `accepted[0].target` 为 `undefined`，期望为 proposal 原始 `{kind:"existing", categoryId:...}`；Vitest `AssertionError`、exit 1。
3. 根因在 `CategoryWorkbench.tsx` 的 `acceptedDiff()`：merge/delete 共用返回分支只带 `sourceCategoryId` 与 `autoDestination`，没有保留 merge 的 `diff.target`。
4. 服务端 `applyCategoriesInputSchema` 对 accepted merge 明确要求 `target` 与 `autoDestination` 同时存在。因此当前 UI 的 merge 应用在真实 route 必然返回 `VALIDATION` 400，不可能得到报告中的 applied 结果。

### 假绿来源

- `tests/e2e/admin-categories.spec.ts` 在 L78-L96 完全拦截 `/admin/api/categories/apply`，不调用真实 apply route，且只收集 request body 中的 `requestKey`。
- 该 E2E 的 mock 无条件返回 completed 结果，所以无法检测 merge body 不符合 strict schema。`implementation-report.md` L320 把这一流程描述为“真实覆盖”不准确。

### 违反合同

- rev11 Task 8 L150/L153-L154 要求 Workbench 完整实现 diff 应用并由 E2E 覆盖 full 四型与真实应用流程。
- 当前用户可以预览和确认 merge，但实际永远无法应用，属于主流程阻断。

## R2：活动 reclassification 的新 retry key 返回 400，合同要求 409

### 独立反证

1. 在 API 集成探针中将 partial run 用 request key B 成功 retry，得到 202 并进入 `reclassifying`。
2. 同一 run 再用不同的新 key 请求 retry；实际 HTTP 400，期望 409，Vitest `AssertionError`、exit 1。
3. `requestCategoryRunRetry()` 在 `run.status === "reclassifying"` 时抛 `CategoryRunError("VALIDATION")`；`categoryApiError()` 把所有 `VALIDATION` 统一映射为 400，无法区分请求体校验失败与运行状态冲突。

### 违反合同

- rev11 Task 7 L141 明确规定：`reclassifying` 时新 key 返回 409。
- rev11 Task 8 L150 要求 stale/conflict 统一为 409 且保持稳定错误映射。

## 返工要求

1. `acceptedDiff()` 对 merge 必须保留 proposal 原始 `target`，并同时携带管理员选定的 `autoDestination`；add/rename/delete 合同不得回归。
2. 新增门禁验证四型 accepted body 均能通过 `applyCategoriesInputSchema`；至少一条 UI -> 真实 apply route/API 集成测试不得完全 mock apply 合同。
3. 为“活动 run 使用不同 retry key”定义独立稳定冲突 code 或等价可证明映射，HTTP 必须为 409；保留非法 body 的 400。
4. 两项新门禁均需反向验证：再次丢弃 merge target 或把活动 retry 冲突回落为 400 时，对应命名测试必须 exit 1。
5. 修正 implementation report 对 Playwright “真实覆盖”的表述；如仍保留 route mock，须明确其只验 UI 状态机，不得代替 UI/API 合同证据。

## 裁决

- Task 8 本轮退回，Task 9 不放行。
- 其余权限、CSRF、Content-Type、CRUD、人工 NULL、日志脱敏与 UI 视觉项未因此裁决为不通过，但本轮也不将实施自报当作独立通过证据；返工后应在稳定提交上重跑本批全部门禁。
