# 导航站增强 M2 阶段验收：Task 9 F209 关键词字面搜索

- 日期：2026-08-12（Asia/Shanghai）
- 初验提交：`54f8728527b5bdd3253bc1db016640850186e661`
- R1 复验提交：`c6549439ccb74152b1fcb93333bd7d7da28bc8db`
- R1 父提交：`f73df8db78ef764612c03b38399307957f716a6a`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 9 与 Global Invariants
- 当前结论：**通过**。R1 已关闭初验的输入合同、SiteCard/排序与并发限流门禁缺口；放行 Task 10。初验退回证据保留如下，R1 独立复验证据见文末。

## 独立环境

1. 仅验收 detached worktree `/tmp/xm-task9-accept.iEb5u2`，`HEAD` 与父链核对为上述 hash，验收后无 tracked 改动。
2. 使用独立 PostgreSQL 实例 `127.0.0.1:55432/collection_system_test`，亲自执行迁移成功；验收后已停止该实例。

## 已通过项与证据

1. Task 9 定向：5 files / 13 tests PASS。真实 PostgreSQL 覆盖 title/summary/tag 大小写命中、doc 与未完成排除、LIKE 元字符字面匹配和 SQL 注入样本。
2. SQL 文本固定使用 `$1` 与显式 ESCAPE，参数值为转义后 pattern；未将用户输入拼接进 SQL。
3. 关键词限流使用 `kw:global` / `kw:ip:<HMAC>`，缺密钥时拒绝；非可信代理返回 `SEARCH_UNAVAILABLE` 503，不执行搜索。
4. 产品四个 Task 9 模块不导入 AI、embedding、retrieve 或 ask handler。
5. 反向验证：中和 LIKE 转义、放行 doc、丢弃参数值、引入 embedding、把代理失败回落为伪 IP 时，对应命名用例均 Vitest `AssertionError`、exit 1。
6. `typecheck` exit 0；`lint` 为 0 error、1 条已批准原型既有 warning；`git diff --check` exit 0；workflow validator 输出 `PASS: workflow stage=implementation revision=11`。
7. 正式 `pnpm build` 与 standalone prune 通过，生成 `/search` dynamic route，产物门禁输出 `Production artifact excludes 15 root devDependencies`。

## R1：输入合同不符合 rev11

1. rev11 Task 9 L160 要求 query 做 NFKC + trim，接受 1-100 字符，拒绝 NUL/控制字符。
2. 当前 `querySchema` 仅为 `z.string().trim().min(2).max(100)`：未 NFKC，最小长度错设为 2，也未拒绝 NUL/控制字符。
3. 临时验收探针输入全角 `Ａ`，期望规范化为 `A`、HTTP 200 且 search 收到 `A`；实际 HTTP 400。
4. 输入字符 `a` 加 NUL，期望 HTTP 400 且 limit/search 均 0 次；实际 HTTP 200 并进入后续流程。两条探针 2/2 failed，Vitest `AssertionError`、exit 1。

## R2：返回 DTO 与排序合同缺失

1. rev11 Task 9 L162 要求结果包含 `id/title/url/summary/tags/categoryName/faviconPath`，通过 `left join categories` 取分类名，并按 `lower(coalesce(title,url)),id` 确定排序。
2. 当前 `SiteCard` 只有 `id/title/summary/url/tags/type`，SQL 无 categories join，无 `categoryName/faviconPath`，并按 `created_at desc,id desc` 排序。
3. 临时架构探针对实际 SQL 断言 join、两个 DTO 字段与确定排序；首个断言即失败，Vitest `AssertionError`、exit 1。

## R3：限流并发证明门禁缺失

1. rev11 Task 9 L164 明确要求并发屏障证明不超过 IP/global 上限，并验证关键词请求不改变 ask counters。
2. 当前 `publicKeywordRateLimit.test.ts` 只串行调用两次并验 IP 上限，没有并发屏障、global 并发上限断言，也没有事前/事后既有 ask scope 计数不变断言。
3. 实现的 settings 行锁、scope 固定顺序与 counter 行锁从代码上看可以串行化，但未经所需确定性并发门禁证明，不得仅凭静态推断放行。

## 返工要求

1. 建立唯一查询规范化函数：NFKC -> trim，按规范化后值检查 1-100 字符并拒绝 NUL/控制字符；成功 envelope 返回 normalized query。补空、1、100、101、NFKC、NUL 和控制字符正反测试。
2. `SiteCard` 与 SQL 补齐 `categoryName/faviconPath`、categories left join 及 `lower(coalesce(title,url)),id` 排序；保留 doc/非 completed 排除与全参数化。增加真实 DB 的 DTO 与确定排序断言。
3. 增加确定性并发屏障，分别证明同 IP 与多 IP 并发请求不超 IP/global 上限；预置 ask `global`/`ip:` counters，并发关键词消耗后断言其值不变。
4. 对上述三组门禁做反向变异：移除 NFKC/控制字符拒绝、删 DTO 字段/确定排序、弱化限流行锁或回落 ask scope 时，对应命名用例必须 exit 1。

## 裁决

- 现有 13/13 与已验安全反测为有效局部证据，但不能覆盖上述 rev11 明文缺口。
- **Task 9 退回，Task 10 不放行。**

## R1 独立复验：通过

### 隔离与正向证据

1. 唯一验收基准为 `c6549439ccb74152b1fcb93333bd7d7da28bc8db`，父提交 `f73df8db78ef764612c03b38399307957f716a6a`；在 detached worktree `/tmp/xm-task9-r1-accept.OKFtEh` 验收，产品 tracked 文件恢复无差异。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432/collection_system_test`；真实执行 4 个迁移成功，未使用实施工程师默认实例。
3. Task 9 定向为 5 files / 18 tests PASS。输入覆盖 NFKC、trim、1 字符、空值、101 字符、NUL/C0 控制字符；非法输入在代理、quota、search 前返回 400，依赖零调用。
4. 真实 PostgreSQL 覆盖完整 `SiteCard`：`id/title/url/summary/tags/categoryName/faviconPath`；SQL 使用 categories `LEFT JOIN`、同源 `/favicon/<id>`，并按 `lower(coalesce(title,url)),id` 确定排序。
5. 同 IP 8 并发、IP 上限 2 时仅 2 次允许；8 个不同 IP、global 上限 3 时仅 3 次允许。预置 ask `global`/`ip:existing` counters 前后保持 7/4，不读写 ask scopes。
6. `tsc --noEmit` exit 0；lint 为 0 error、1 条批准原型既有 warning；提交范围 `git diff --check` exit 0；workflow validator 输出 `PASS: workflow stage=implementation revision=11`。
7. `next build` 与 standalone prune exit 0，生成 `/search`，产物门禁输出 `Production artifact excludes 15 root devDependencies`；prune 后 `deploy-smoke` 7/7 PASS。
8. 完整回归为 55/56 files、386/387 tests；唯一失败仍是 `settingsRoutes` 固定期待 `2026-08-09`，实际业务日为 `2026-08-12`，与 Task 9 变更无关。

### Fail-closed 反向验证

以下临时变异均直接中和产品门禁而不修改测试；每项对应命名用例均为 Vitest `AssertionError`、exit 1，恢复后定向重新 18/18：

1. 移除 NFKC：全角 `Ａ` 不再归一为 `A`，规范化命名用例红。
2. 移除控制字符拒绝：`a\0` 错误返回 200，前置拒绝用例红。
3. 清空 `faviconPath`：完整 DTO 用例红。
4. 排序退回 `created_at desc,id desc`：确定排序用例红。
5. 分别移除 settings `FOR UPDATE` 与 counter `FOR UPDATE`：行锁协议命名用例各自红。
6. 移除 LIKE `%/_/\\` 转义：`%` 额外通配命中，用例红。
7. 放行 `doc`：eligible scope 用例红。
8. 可信代理失败回落伪 IP：应为 503 却返回 200，fail-closed 用例红。
9. 引入 embedding import：零 AI 架构门禁红。

### R1 裁决

- 初验 R1-R3 三项阻断均有正向行为与中和即红证据；既有字面匹配、参数化、eligible scope、代理 fail-closed、独立 kw quota 与零 AI 不变量保持。
- **Task 9 通过，放行 Task 10。**
