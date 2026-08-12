# 导航站增强 M2 阶段验收：Task 11 公开 C 工作台首页组装

- 日期：2026-08-12（Asia/Shanghai）
- 验收提交：`0f407a265b5a9e9ef1092d8e755daf4ce0aebbb1`
- 父提交：`66e2ec98459e137f7e35c0d749e57bb557b44b67`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 11 与 Global Invariants
- 结论：**通过**。公开目录工作台、URL 关键词状态机、局部失败隔离、锚点/卡片安全与 doc-only 问答回归符合合同；放行 Task 12。

## 独立环境

1. 在 detached worktree `/tmp/xm-task11-accept.GIDV58` 固定验收上述提交，核对 HEAD、父提交与干净 tracked worktree；未修改产品代码。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432/collection_system_test`，真实执行 4 个迁移；Playwright 的数据库连接仅在 detached worktree 临时切到 55432，结束后恢复且 diff 为空。

## 正向证据

1. Task 11 定向为 5 files / 18 tests PASS：`publicDirectoryArchitecture`、`directoryShell`、`directoryView`、`faviconRoute`、`siteFavicon`。
2. 生产 standalone Playwright 在 Chromium desktop 1440x1000 与 mobile 两项目完整复跑 12/12 PASS：覆盖无 hero/daily/旧文案、标题与搜索几何、URL q 状态机、加载/结果/空/失败/清空、旧请求竞态、空分类与未分类末组、锚点焦点/aria-current、安全外链、favicon fallback、doc-only 问答、目录局部失败恢复、问答提交、reduced-motion/contrast、console/pageerror 与横向溢出。
3. 首轮完整 E2E 为 11/12：桌面首例在命名 H1 已通过 `toBeVisible` 后，同 locator 紧接的 `boundingBox()` 偶发返回 null；该桌面命名用例立即独立复跑 1/1，随后完整两项目复跑 12/12，未再复现。此非稳定门禁轮次未计为通过证据，最终以完整 12/12 轮次裁决。
4. 四张新鲜截图均亲自核验为有效非空 PNG：目录 desktop 1440x1153、mobile 1170x3312；关键词结果 desktop 1440x1000、mobile 1170x2007。页面主体、搜索结果、问答 dock 和移动排版均可辨识，无文本截断或横向溢出。
5. 额外按 390x844 精确视口量测：关键词表单宽 362px，搜索按钮 44x44，`documentElement.scrollWidth=390`；符合移动满宽、触控尺寸与无溢出要求。
6. `page.tsx` 架构门禁证明 DirectoryData 是唯一 suspend/catch `getPublicDirectory` 的 async child，AskExperience 为 shell sibling；URL q 是已提交事实源，active token/AbortController 阻止旧响应覆盖。
7. `tsc --noEmit` exit 0；lint 为 0 error、1 条既有原型 warning；`git diff --check` exit 0；workflow validator 输出 `PASS: workflow stage=implementation revision=11`。
8. `env -u DATABASE_URL corepack pnpm build` 与 standalone prune exit 0，产物门禁输出 `Production artifact excludes 15 root devDependencies`。
9. 完整回归为 62/63 files、408/409 tests；唯一失败仍为 `settingsRoutes` 固定期待业务日 `2026-08-09`，实际为 `2026-08-12`（因此当日计数期望 12、实际 0），与 Task 11 无关。

## Fail-closed 反向验证

以下临时变异均只修改产品实现、不修改测试；对应命名用例均为 Vitest `AssertionError`、exit 1，逐项恢复后定向重新 18/18：

1. 在首页重新引入 `pickDailyForNow`：禁止 daily 回归的架构门禁红。
2. 带 q 页面隐藏/移除 `DirectoryData`：目录仍须读取的合同门禁红。
3. 移除搜索 active token 竞态保护：旧慢响应不得覆盖新结果的命名用例红。
4. 把整卡外链 `rel="noopener nofollow"` 弱化为 `noreferrer`：安全/SEO 合同门禁红。
5. eligible favicon 上游失败改为返回 404：同尺寸首字母 fallback 合同门禁红。

## 裁决

- 首页架构隔离、URL 搜索状态、局部错误恢复、移动/无障碍与安全外链均有独立正向和反向证据。
- **Task 11 通过，放行 Task 12。**
