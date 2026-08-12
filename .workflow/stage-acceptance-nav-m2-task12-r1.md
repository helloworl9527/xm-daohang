# 导航站增强 M2 阶段验收：Task 12 R1 移动端溢出修复

- 日期：2026-08-12（Asia/Shanghai）
- 验收提交：`fd01d28a0f96e8176beb632fd7146f1642b652f1`
- 父提交：`9425a4a7c6035dc33fe274c925c717f53c5ddd2f`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 12 与 Global Invariants
- 结论：**通过**。移动分类工作台页面级溢出已收敛到屏幕宽度内，导航自身保留可访问横向滚动；放行 Task 13。

## 独立环境

1. 在 detached worktree `/tmp/xm-task12r1-accept.6HJMnD` 固定验收上述提交，核对 HEAD、父提交与干净 tracked worktree；产品代码未修改。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432/collection_system_test`，真实执行 4 个迁移；E2E 连接串仅临时改于 detached worktree，结束后恢复。

## 正向证据

1. Task 12 定向 4 files / 21 tests PASS：`task12Contracts`、`uiPrimitives`、`directoryShell`、`categoryWorkbench`。
2. 精确生产 server、设备屏幕 `390x844` 直达 `/admin/categories` 实测：`screenWidth=390`、`innerWidth=390`、`innerHeight=844`、`pageWidth=390`；`.admin-nav` `clientWidth=358`、`scrollWidth=436`，证明页面无溢出且导航内部横滚。
3. 新鲜移动分类截图为 `1170x8070` PNG（DPR 3，即 390 CSS px）；桌面截图为 `1440x1561`，未复现上一版 1383px 移动图的页面扩宽。
4. 生产 standalone Playwright public + admin 双视口完整 14/14 PASS；新增分类页几何门禁在跳转详情前执行，并断言 `screen=390`、`innerWidth=390`、`document.scrollWidth<=390`、`nav.scrollWidth>nav.clientWidth`。桌面导航用例同样通过。
5. `env -u DATABASE_URL corepack pnpm build` 与 standalone prune exit 0，产物门禁输出 `Production artifact excludes 15 root devDependencies`。
6. `tsc --noEmit` exit 0；lint 为 0 error、1 条既有原型 warning；`corepack pnpm audit --prod` 输出 `No known vulnerabilities found`；workflow validator 输出 `PASS: workflow stage=implementation revision=11`；`git diff --check` exit 0。
7. 完整回归为 63/64 files、414/415 tests；唯一失败仍为 `settingsRoutes` 固定期待业务日 `2026-08-09`，实际 `2026-08-12`、`usedGlobal=0`，与 R1 无关。

## Fail-closed 反向验证

1. 恢复旧 `.admin-nav` 四列 `minmax(104px,1fr)` grid，并移除本次 shell/sidebar `min-width:0`、`max-width:100vw`、`overflow:hidden` 约束后，使用同一精确 390x844 几何脚本观测 `screenWidth=390`、`innerWidth=461`、`pageWidth=461`、nav `clientWidth=428`/`scrollWidth=428`，脚本门禁 exit 1。恢复 R1 CSS 后正向几何再次通过。
2. 旧结构下导航不再产生内部滚动（`navScrollWidth=navClientWidth`），页面宽度错误承担了横滚；该反证与上轮阻断的 71px 扩宽一致。

## 裁决

- R1 已闭合页面宽度与导航滚动隔离，未改变桌面布局或分类业务行为。
- **Task 12 R1 通过，放行 Task 13。**
