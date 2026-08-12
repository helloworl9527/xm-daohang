# 导航站增强 M2 阶段验收：Task 12 i18n、AdminNav、Lucide 与无障碍

- 日期：2026-08-12（Asia/Shanghai）
- 验收提交：`24b9ef8f17eddd1140c0b3de779e953c5e50f505`
- 父提交：`db5bab76fa6425e4bc728787eaefd8318c6e6b00`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 12 与 Global Invariants
- 结论：**退回**。移动分类工作台在目标 390px 屏幕被导航最小宽度撑到 461 CSS px，违反“无页面级横向溢出”；现有 Playwright 无溢出断言在离开分类页后才执行，门禁 fail-open。不放行 Task 13。

## 独立环境

1. 在 detached worktree `/tmp/xm-task12-accept.93QHyD` 固定验收上述提交，核对 HEAD、父提交与干净 tracked worktree；未修改产品代码。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432/collection_system_test`，真实执行 4 个迁移；E2E 连接串只在 detached worktree 临时改为 55432，结束后恢复。

## 已通过证据

1. Task 12 定向 4 files / 21 tests PASS：`task12Contracts`、`uiPrimitives`、`directoryShell`、`categoryWorkbench`。
2. zh/en 各 321 个叶子键，双向差集为空；公开首页废弃键合同通过。Lucide manifest、lock importer、lock package 与已安装元数据均为精确 `1.31.0`，许可证 ISC，仓库为官方 `lucide-icons/lucide`；检查范围均为命名 import，无手绘 SVG/字符图标。
3. `corepack pnpm audit --prod` 输出 `No known vulnerabilities found`；`tsc --noEmit` exit 0；lint 为 0 error、1 条既有原型 warning；`git diff --check` exit 0；workflow validator 为 implementation rev11 PASS。
4. `env -u DATABASE_URL corepack pnpm build` 与 standalone prune exit 0，产物门禁输出 `Production artifact excludes 15 root devDependencies`。
5. 生产 standalone Playwright public + admin 在现有 desktop/mobile 两项目为 14/14 PASS；四张截图均亲自查看为有效非空 PNG。此结果不能覆盖下述移动分类页阻断项。

## Fail-closed 反向验证

以下临时变异只改产品实现、不改测试，均由对应命名用例拦截为 Vitest `AssertionError`、exit 1；恢复后定向重新 21/21：

1. 关键词提交从 `input.current.value` 退回只读 React `draft`：`submits the latest DOM value when Enter races a controlled state update` 红。
2. `Pressable` 的 `pointerCancel` 不再调用清理：`starts and clears pointer-down feedback immediately` 红，残留 `data-pressed=true`。

## 阻断证据

1. 在真实 Chromium、设备屏幕 390px、独立生产 server 的 `/admin/categories` 直接量测：`screen.width=390`、`innerWidth=461`、`documentElement.scrollWidth=461`，目标屏幕被内容撑宽 71px。以 `scrollWidth <= screen.width` 作页面级门禁时 exit 1。
2. 新鲜移动截图 `.workflow/screenshots/nav-enhancement/task12-admin-accessibility-mobile.png` 为 1383px 物理宽；DPR 3 后是 461 CSS px。相同项目的公开页截图为 1170px，即 390 CSS px，证明不是截图工具统一尺寸差异，而是分类页自身扩宽。
3. 根因定位到 `src/app/globals.css:1472`：移动 `.admin-nav` 设四个 `minmax(104px, 1fr)` 自动列并横向滚动，网格最小内容宽 416px；其父 grid item 未允许收缩，最终把 `.admin-sidebar`、`.category-page` 与文档一起撑到 461px。
4. 现有 `tests/e2e/admin-categories.spec.ts:174` 的无溢出断言在第 156 行已经 `page.goto(/admin/library/<id>)` 后才执行，只验证条目详情页，不验证截图所在的分类工作台。因此报告声称的分类页“无页面级横向溢出”无有效门禁，属于 fail-open。
5. 固定语言切换器在 full-page 截图中接近正文；独立矩形量测显示与人工保护横幅仍有 7px 间隔，未据此追加不实缺陷。

## 返工要求

1. 修复移动 AdminNav/父 grid item 的最小宽度传播，确保 390px 屏幕下 `/admin/categories` 的页面宽度不超过屏幕宽；允许导航容器内部横向滚动，但不得扩大页面 viewport/layout width。
2. 将页面级无溢出断言放在分类工作台仍处于当前页时执行，并以设备屏幕/明确 390px 目标宽度为边界，不能仅用已被内容撑大的 `innerWidth` 自比较；desktop 与 mobile 都须覆盖。
3. 返工后复跑 public + admin 双视口、Task 12 定向、typecheck/lint/build/audit/validator 与完整回归，并提供变异该修复后对应命名门禁 exit 1 的证据。

## 裁决

- **Task 12 退回，不放行 Task 13。**
