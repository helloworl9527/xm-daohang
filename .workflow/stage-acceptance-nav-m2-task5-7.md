# 导航站增强 M2 阶段验收：Task 5-7 propose/apply/reclassify

- 日期：2026-08-11（Asia/Shanghai）
- 初验提交：`f33617b201e0360ef198160dcb44622f67dc4c92`
- R1 返工复验提交：`99bb041b3952606f3c59f9a127e43d255ae6540c`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 5-7 与 Global Invariants
- 结论：**通过（R1）**。初验发现的 destructive source 并发人工保护 fail-open 已闭环；Task 5-7 放行，可继续 Task 8。

## 独立复验环境

1. 仅验收稳定提交 detached worktree `/tmp/xm-f33617b-accept.9xNb0O`，未以动态 main 工作区裁决。
2. 使用独立 PostgreSQL 实例 `127.0.0.1:55432`、同名数据库 `collection_system_test`，与实施工程师默认实例物理隔离。
3. 验收前核对 detached HEAD 等于指定完整 hash；功能提交 diff 不含迁移、新依赖或 API 路由。

## 正向复跑证据

1. Task 5-7 定向：3 files / 36 tests PASS。
2. Task 1-7 联合：8 files / 101 tests PASS。
3. `tsc --noEmit`、提交范围 `git diff --check`、workflow validator 均 exit 0；validator 输出 `PASS: workflow stage=implementation revision=11`。
4. `eslint .` exit 0：0 error、1 条已批准 UI 原型既有 warning（`.workflow/ui-prototype-nav-enhancement/app.js:115`）。
5. 完整回归：47/49 files、346/348 tests。仅失败为未构建 `.next/standalone/node_modules` 的 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 固定期望业务日 `2026-08-09`、实际 `2026-08-11`；两项均不在本提交变更面，工程师报告未夸大通过数。

## 声明门禁反向复验

在 detached worktree 中逐项中和后串行运行对应命名测试，恢复目标文件后再执行下一项：

1. themes 尾部、supplement add-only、strict schema、服务端计数四项均为 Vitest `AssertionError`、exit 1。
2. manual conflict、stale version、destructive `FOR UPDATE` 三项均为 Vitest `AssertionError`、exit 1。
3. reclassify manual/version/candidate、retry 重复发布、duplicate cursor、LLM 事务外、failure attempts 七项均为 Vitest `AssertionError`、exit 1。
4. request-key 幂等返回中和后命名测试稳定 exit 1，但实际失败类型为未捕获 `CategoryApplyError: STALE_TAXONOMY`，不是实施报告所称 `AssertionError`。门禁能阻断错误实现，报告对失败类型的表述不准确。
5. 所有有效变异均命中目标行为；未把语法、依赖、迁移或启动失败计作门禁证据。

## 阻断项 R1：destructive source 人工保护存在并发窗口

### 复现

1. 建立 source、target 与 `{category_manual:true, category_id:null}` 条目；taxonomy version 为 2。
2. 启动 source merge，并用现有 `afterImpactLock` 探针暂停在 destructive impact 查询及 `FOR UPDATE` 之后。
3. 另一连接把该人工 NULL 条目更新为 `{category_manual:true, category_id:source}`；更新立即成功，没有 `55P03`，说明当前锁集未覆盖“扫描后进入 source”的条目。
4. 释放 apply。实际返回 `status=completed, appliedVersion=3`，未抛 `MANUAL_CATEGORY_CONFLICT`；source 删除后 FK 又把该条目置回 `category_id=NULL`，`category_manual` 仍为 true。
5. 临时 fail-closed 命名探针期望整批拒绝，实际得到 `promise resolved`，Vitest `AssertionError`、exit 1。

### 违反合同

- rev11 Global Invariants L17-L19：人工选择（包括 NULL）不得被 AI diff 自动迁移；merge/delete source 只要仍有关联人工条目必须整批 `MANUAL_CATEGORY_CONFLICT` fail closed。
- rev11 Task 6 L129-L130：destructive source 人工影响须在同一短事务内可靠预计算/保护，自动迁移仅允许 `category_manual=false`。

### 返工要求

1. 在 destructive impact 扫描前锁住 source 分类行或采用等价、可证明能阻止并发 FK 赋值进入 source 的锁协议；保持 settings -> taxonomy/source -> items 的固定锁顺序，避免引入死锁。
2. 在锁保护下重验所有 destructive source 的 manual 关联；发现任一人工条目必须整批回滚并返回 `MANUAL_CATEGORY_CONFLICT`，不得依赖 FK `SET NULL` 静默完成。
3. 新增确定性并发测试：暂停在 impact 扫描后，将人工 NULL 条目并发赋到 source；测试必须证明该写入被锁阻断，或 apply 在写入提交后重验并整批拒绝。还应覆盖 merge 与 delete，验证 category/version/run/自动条目均无部分落库。
4. 对上述新门禁做反向变异；移除 source 锁或最终重验时，对应命名测试必须 AssertionError、exit 1。

## 裁决

- 初验时 Task 5 与 Task 7 的正向/既有反向证据未发现其他阻断项；合并批次曾因 Task 6 R1 整体退回，最终裁决由下述 R1 复验更新。
- 完整回归的 standalone 构建前置与固定日期用例继续作为历史问题单独修复，不能用于抵消本次人工保护 fail-open。

## R1 返工复验

### 环境与范围

1. 仅验收稳定提交 detached worktree `/tmp/xm-99bb041-accept.YdwYq7`，HEAD 核对为 `99bb041b3952606f3c59f9a127e43d255ae6540c`。
2. 使用独立 PostgreSQL 实例 `127.0.0.1:55432`、数据库 `collection_system_test`；复验结束后已停止该实例。
3. R1 功能 diff 只修改 `src/lib/categories/apply.ts`，并增加 apply 并发测试和修正 implementation report；未改 propose/reclassify、迁移、依赖或 API。

### 并发协议核验

1. apply 持 settings 锁后，先锁扫描时已位于 destructive source 的 items；随后按 category id 稳定顺序对 source categories 行 `FOR UPDATE`，再在该锁保护下重新扫描/锁 items 并重验 manual。
2. merge/delete 各覆盖“并发事务先把人工 NULL 赋入 source 并持 FK key-share”的时序：apply 被 source category 行锁阻塞；并发事务提交后，二次扫描捕获人工条目，apply 返回 `MANUAL_CATEGORY_CONFLICT`。
3. merge/delete 各覆盖 `afterImpactLock` 后赋值并提交的时序：赋值先于 source 行锁完成，二次扫描同样捕获并整批拒绝。
4. 四个用例均断言新增分类、destructive category、run、version 无部分落库；version 保持 2，人工条目保持 `category_manual=true` 且仍指向 source，没有被 FK 静默置 NULL。

### 正向与回归证据

1. apply 定向：1 file / 15 tests PASS；Task 5-7：3 files / 40 tests PASS；Task 1-7 联合：8 files / 105 tests PASS。
2. `tsc --noEmit`、提交范围 `git diff --check`、workflow validator 均 exit 0；validator 输出 `PASS: workflow stage=implementation revision=11`。
3. `eslint .` exit 0：0 error、1 条批准原型既有 warning。
4. 完整回归：47/49 files、350/352 tests。失败仍仅为未构建 standalone 的 `PRODUCTION_NODE_MODULES_MISSING` 与 `settingsRoutes` 固定 `2026-08-09`（实际 `2026-08-11`），不在 R1 变更面。
5. implementation report 已把 request-key 门禁中和结果准确更正为未捕获 `CategoryApplyError: STALE_TAXONOMY`，不再声称 15 项全部为 AssertionError。

### R1 反向验证

1. 移除 source categories 行 `FOR UPDATE` 后，merge/delete 两个“先持 FK 锁”命名用例均检测不到预期 category row-lock wait，超时失败并 exit 1；finally 释放并发事务后，变异 apply 实际错误完成，证明锁断言命中目标行为。
2. 中和锁保护下的 manual 二次重验后，merge/delete 两个 `afterImpactLock` 命名用例均错误返回 `completed, appliedVersion=3`，被 `rejects(MANUAL_CATEGORY_CONFLICT)` 捕获为 Vitest AssertionError，exit 1。
3. 两组变异后均恢复产品文件；未把语法、依赖、迁移或启动错误计作证据。

### R1 裁决

- 初验 R1 已关闭：扫描前已有、扫描后进入以及先持 FK 锁的人工条目均进入同一 fail-closed 协议；未发现新的 Task 5-7 阻断项。
- **Task 5-7 通过，放行 Task 8。**
