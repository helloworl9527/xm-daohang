# M3 阶段 2 独立验收

- 验收时间：2026-08-14T10:43:09+08:00
- 验收角色：Codex 阶段验收员
- 基线：`114c272c3a0bf9074060fe2cba256ca1d81f7e77`
- 权威计划：`docs/implementation-plan.md` revision 6，阶段 2
- 裁决：**FAIL（退回）**
- 范围：公开首页 Ink & Signal 视觉应用

## 命令口径

派发消息列出的 `publicHome.test.tsx`、`keywordSearch.test.tsx`、`askExperience.test.tsx`、`siteLink.test.tsx`、`public-home.spec.ts` 均不在工作区，且 Playwright 无 `mobile` 项目。权威计划阶段 2 与 `.workflow/implementation-report.md` 均指定 10 文件 Vitest 集合、`tests/e2e/public.spec.ts` 以及 `chromium-desktop`/`chromium-tablet`/`chromium-mobile`。本次按权威计划执行，并保留上述派发文本偏差作为事实。

## 自动门禁实际结果

| 门禁 | 实际结果 |
| --- | --- |
| 阶段 2 计划 10 文件 Vitest 原命令 | **退出 1**；缺 `DATABASE_URL`，3 个数据库 suite fail closed，7 files / 24 tests 通过、40 skipped。 |
| 同一 Vitest 集合显式绑定 `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test APP_TIMEZONE=Asia/Shanghai` | **退出 1**；9 files 通过、`publicDirectory.test.ts` 2 项失败；总计 62/64 tests 通过。 |
| 阶段 1 contracts：`inkSignalContracts`、`legacyClassContracts`、`testDatabaseGuard` | 退出 0；3 files / 8 tests 通过。 |
| `corepack pnpm typecheck` | 退出 0；`tsc --noEmit` 通过。 |
| `corepack pnpm lint` | 退出 0；0 error、1 条既有 warning，位于 `.workflow/ui-prototype-nav-enhancement/app.js:115`。 |
| `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-desktop` | 退出 0；生产构建/产物校验/服务成功，6/6 tests 通过，用时 36.9s。 |
| `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-tablet` | **退出 1**；5/6 tests 通过。关键词失败状态点击清空后，5 秒内 URL 仍为 `/?q=fail`。 |
| tablet 失败用例单独复跑 | 退出 0；1/1 通过，用时 29.6s，证明该门禁存在非确定性，但不覆盖原列全命令失败。 |
| `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-mobile` | 退出 0；生产构建/产物校验/服务成功，6/6 tests 通过，用时 33.7s。 |

实施报告自报 `10 files / 63 tests` 与当前实际 64 tests 不一致。

## 退回项

### 1. 阶段 2 Vitest 门禁不可独立复现且测试数据未隔离（阻塞）

权威计划的原命令未声明测试库环境，干净 shell 会按设计报 `DATABASE_URL is required`。绑定固定 `collection_system_test` 后仍有两个行为断言失败：

```text
publicDirectory.test.ts:60
expected unclassified IDs:
  [a1000000-0000-4000-8000-000000000003]
received:
  [a1000000-0000-4000-8000-000000000003, b975c8fe-2c40-40cb-a2f1-32da5202846b]

publicDirectory.test.ts:82
expected every directory group to be empty, received false
```

`tests/categories/publicDirectory.test.ts:32-34` 只删除本文件 URL prefix，后续断言却假设整个公开语料库没有其他条目。工程师报告也明确依赖人工清除 E2E fixture 后才通过。当前测试库中的 E2E seed 会让同一计划命令失败，因此门禁不是可重复、自包含的自动验证。

期望返工：

- 在权威门禁或仓库测试入口中明确、机械地注入固定 `collection_system_test`，继续保持对生产库 fail closed。
- 让 `publicDirectory.test.ts` 自行隔离测试数据，或让断言只针对本测试创建的记录；不得依赖人工全库清空，也不得删除非本测试拥有的数据。
- 修复后从存在其他合法 test fixture 的测试库状态复跑，阶段 2 计划集合必须完整退出 0，并记录真实文件/测试数。

### 2. tablet URL 清除 E2E 不稳定（阻塞）

原列 tablet 全命令在 `keeps URL query as truth across loading, results, empty, failure, and clearing` 失败：

```text
Expected URL: not /q=/
Received: http://127.0.0.1:3100/?q=fail
Timeout: 5000ms
tests/e2e/public.spec.ts:54
```

单用例复跑通过，说明不是稳定的永久失败，但阶段计划设置 `retries: 0`，原命令必须具备确定性。该结果可能来自客户端 `router.push(pathname)` 的异步导航时序或测试等待边界；验收不以一次重跑掩盖首次失败。

期望返工：定位并消除清空动作/导航断言的竞态，确保 tablet 完整 6-test 项目在冷生产构建下稳定退出 0；补足能在旧 URL 未清除时可靠失败的回归证据。

## 已通过核验

### 零破坏与安全边界

- `git merge-base --is-ancestor 114c272c3a0bf9074060fe2cba256ca1d81f7e77 HEAD`：退出 0。
- API route、`src/lib/items`、`src/lib/search`、schema、migrations 的工作区 diff 与 `BASE..HEAD` diff 均为空。
- `package.json`、`pnpm-lock.yaml` 的工作区 diff 与 `BASE..HEAD` diff 均为空；无新增依赖。
- 六个旧 `--color-*` token 与基线逐值相同；`--color-ink: #17211D` 与 `--ink-text: #17181A` 隔离；无旧 token/class selector 删除。
- `tests/e2e` 仅一个 PostgreSQL URL 字面量；8 个 DB spec 均使用集中守卫。
- 中英文字典递归 key 集合合同通过；公开客户端仅请求现有 `/search` 与 `/ask`。

### SiteLink 与图标偏差

- `deriveSitePresentation` 只把完整 HTTP(S) `github.com/owner/repo` 推导为 GitHub，其余非法/非 HTTP(S)/不完整 URL 回退 web，导航仍使用原 `site.url`。
- 卡片保留 `.directory-card` 并追加 web/GitHub modifier，渲染类型徽标、域名/owner-repo、摘要和最多三个标签，不读取不存在的 stars/language 等字段。
- 独立运行时检查：`lucide-react@1.31.0` 的 `Github` 导出为 `undefined`，`GitFork` 导出存在；使用 `GitFork` 且保留本地化 `GitHub` 徽标的记录偏差可接受，不构成阻塞。

### 三视口截图

证据文件：

- `.workflow/screenshots/ink-signal/phase2-public-chromium-desktop.png`：1440x1104 full-page。左侧 sticky 索引、三列网格轨道、sticky header 均正常，无重叠或横向截断。
- `.workflow/screenshots/ink-signal/phase2-public-chromium-tablet.png`：1024x1104 full-page。左侧窄索引、两列网格轨道、header 正常，无重叠或横向截断。
- `.workflow/screenshots/ink-signal/phase2-public-chromium-mobile.png`：1170x3606 物理像素，对应 390px CSS viewport、deviceScaleFactor=3。横向分类索引、单列卡片和全宽搜索控件正常，无横向截断。

截图采用 `fullPage: true`，因此高度大于 1000/768/844 视口；宽度与三视口配置一致。三张均已逐张人工核验。

## 最终裁决

**FAIL（退回）**。产品视觉、SiteLink、阶段 1 contracts 与零破坏门禁通过，但阶段 2 权威 Vitest 集合无法在记录命令下复现且存在测试数据隔离缺陷，tablet 原列 Playwright 项目也实际 5/6。阶段 2 不得放行，不得推进阶段 3；验收员未修改产品代码、未提交 Git。
