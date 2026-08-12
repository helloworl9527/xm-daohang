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

## R1 返工复验（历史中间记录，已被最终提交取代）

- 复验提交：`7ca0f1e0b12d790242ad6c1ea85bae844cee1b51`
- 父提交：`9c0388c9044354f9513946d3b39e7297dde41390`
- 历史中间裁决：当时的独立探针确认产品缺口已修复，但该提交自带的持久合同门禁仍不足；随后已被 `4f8a35d` 与最终 `3ebe35c` 取代，**不作为 Task 9 放行依据**。

### 环境与范围

1. 仅验收 detached worktree `/tmp/xm-7ca0f1e-accept.SzNVdt`，`HEAD` 与父链核对为上述完整 hash。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432/collection_system_test`，与实施工程师默认库物理隔离；复验后已停止该实例。
3. R1 产品 diff 仅改工作台 merge body、category API 错误映射与 retry 冲突标记；无迁移、依赖、队列或其他业务范围变更。

### 正向复跑

1. R1 直接 UI/API：2 files / 16 tests PASS；Task 8 联合：5 files / 47 tests PASS。所有临时反向变异恢复后又重跑 5 files / 47 tests PASS。
2. `tsc --noEmit` exit 0；`eslint .` exit 0，仅 `.workflow/ui-prototype-nav-enhancement/app.js:115` 已批准的 1 条既有 warning；提交范围 `git diff --check` exit 0。
3. workflow validator exit 0，输出 `PASS: workflow stage=implementation revision=11`。
4. 在隔离 worktree 安装物理 `node_modules` 后执行正式 `pnpm build`，Next.js 构建成功，产物门禁输出 `Production artifact excludes 15 root devDependencies`；随后 `deploy-smoke` 7/7 PASS。
5. Playwright 临时仅将数据库端口改为 55432，desktop/mobile 2/2 PASS。已亲自检查两张新生成截图：四型 diff、人工保护、确认入口、CRUD 与移动单列布局均可读，未见控件遮挡或水平溢出。
6. 完整 Vitest 首跑为 49/51 files、366/368 tests：除固定日期外，`deploy-smoke` 因验收初始为保护共享依赖而未执行 standalone prune，检测到 devDependencies。换用物理隔离依赖执行正式 build/prune 后，该文件 7/7 PASS，因此可归并为 50/51 files、367/368 tests；唯一产品无关失败仍为 `settingsRoutes` 固定期望 `2026-08-09`、实际业务日 `2026-08-11`。

### merge UI -> strict apply 合同

1. 稳定实现的 `acceptedDiff()` 对 merge 同时输出 proposal 语义 `target` 与管理员选定的 `autoDestination`。
2. 现有命名 UI 用例捕获完整 apply body 并断言顶层 `target`。临时删除该字段后，用例为 1 failed / 7 skipped，Vitest `AssertionError`、exit 1。
3. 为排除“UI body 与服务端 schema 各测各的”，独立临时探针把 UI 捕获的完整请求体直接交给真实 `applyCategoriesInputSchema.safeParse`：稳定实现 `success=true`；删除顶层 target 后 `success=false`，命名用例 AssertionError、exit 1。
4. 另一临时四型探针从工作台实际产生 add/rename/merge/delete body，整体通过 strict schema；rename/delete 未发现同类漏字段。API 用例另确认 accepted merge 缺 target 时 route 返回 `VALIDATION` 400。
5. Playwright 仍使用 apply route mock 验 UI 状态机；本次不把其单独当作真实 API 合同证据。合同结论来自上述 UI 真实产出体 -> strict schema 探针与 route 集成测试。

### retry 冲突映射

1. partial run 用新 key 首次 retry 返回 202；相同 key 重入返回相同 generation 且 retry request 行始终为 1。
2. run 进入 `reclassifying` 后使用不同新 key 返回 409；错误 code 继续为稳定 `VALIDATION`。非法 UUID 与不可重试终态仍映射 400。
3. 临时中和 `CategoryRunError` 的 conflict 标记后，命名 API 用例实际得到 400、期望 409，Vitest `AssertionError`、exit 1；门禁能阻断原失效实现。

### R1 裁决

- 两项初验阻断均有正向、跨边界与反向证据，未发现新的 Task 8 阻断项。
- 本中间裁决后续因“稳定提交本身缺四型持久 strict-schema 负矩阵”被要求继续加固；最终放行仅以下节 `3ebe35c` 复验为准。

## 最终合同加固复验

- 最终验收提交：`3ebe35cad548d1935cc49fecc7d841f611f49f76`
- 父提交：`4f8a35d3e50ed37f6b16c7faa6c0d0efc1b5da8c`；父链含产品修复 `7ca0f1e0b12d790242ad6c1ea85bae844cee1b51`
- 结论：**通过**。本节取代前节 `7ca0f1e` 作为 Task 8 的最终放行基准；Task 9 可继续。

### 独立环境与正向证据

1. 仅验收 detached worktree `/tmp/xm-3ebe35c-accept.3Jetro`，`HEAD=3ebe35cad548d1935cc49fecc7d841f611f49f76`、父提交为 `4f8a35d3e50ed37f6b16c7faa6c0d0efc1b5da8c`，无 tracked 改动。
2. 使用独立 PostgreSQL 16.14 `127.0.0.1:55432/collection_system_test`；复验后已停止实例。
3. 直接合同/API：2 files / 17 tests PASS；Task 8 扩展定向：5 files / 48 tests PASS。
4. `typecheck` exit 0；`lint` 为 0 error、1 条已批准原型既有 warning；提交范围 `git diff --check` exit 0；workflow validator 输出 `PASS: workflow stage=implementation revision=11`。
5. 物理隔离依赖下执行正式 `pnpm build`，Next.js 构建与 standalone prune 通过，产物门禁输出 `Production artifact excludes 15 root devDependencies`。
6. 完整回归：50/51 files、368/369 tests；唯一失败仍为 `settingsRoutes` 固定期望 `2026-08-09`、实际业务日 `2026-08-11`，最终提交只增加合同测试与报告校正，未触及该历史用例。
7. Playwright 仅在 detached worktree 临时把数据库端口改为 55432，desktop/mobile 2/2 PASS。亲自检查两张截图，四型 diff、人工保护、确认入口、CRUD 与移动单列布局均可读，未见遮挡或水平溢出。

### 四型 strict schema 边界

1. 命名 UI 合同用例从工作台真实产生 add/rename/merge/delete 四种 accepted body，将完整请求体交给真实 `applyCategoriesInputSchema.safeParse`；稳定提交为 `success=true`。
2. 同一前端产出体的内建负矩阵分别删除 `add.name`、`rename.name`、`merge.target`、`delete.autoDestination`，四个变体均得到 `safeParse=false`；不是 mock apply 的成功响应。
3. 独立反向验证中，在产品 `acceptedDiff()` 依次临时删除上述四字段，每次运行同一命名用例；四次均为 1 failed / 7 skipped，Vitest `AssertionError`、exit 1，失败点为完整 UI body 的 strict parse 从 true 变 false。
4. 真实 apply route API 另断言 accepted merge 缺顶层 target 返回 `VALIDATION` 400。因此前端产出、strict schema 和 route 失败映射三层均有门禁。
5. implementation report 已澄清：Playwright 的 propose/apply 为 route mock，只验 UI 状态机、requestKey 重试和错误展示；真实 CRUD/category PATCH 仍走后端，UI/apply 合同证据来自 strict schema 与 route API 测试。

### retry 三态与反向门禁

1. 独立命名 API 用例确认：partial run 首次 retry 返回 202，同 key 永久幂等返回相同 generation 且 request 行为 1；active `reclassifying` 使用新 key 返回 409；非法 body 返回 400。
2. 临时中和 active-run 的 conflict 标记后，专用 409 用例实际得到 400、期望 409，1 failed / 8 skipped，Vitest `AssertionError`、exit 1；同 key 幂等与非法 400 用例不再与冲突断言混在同一用例。

### 最终裁决

- 最终稳定提交将 mock 范围、四型跨边界合同、逐型负矩阵与 retry 三态都变成可复现门禁，所有临时变异恢复后 worktree 无 tracked 改动。
- **Task 8 最终通过，放行 Task 9。**
