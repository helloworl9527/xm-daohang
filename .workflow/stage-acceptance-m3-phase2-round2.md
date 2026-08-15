# M3 阶段 2 第二轮独立验收

- 验收时间：2026-08-15T10:22:29+08:00
- 验收角色：Codex 阶段验收员
- 基线：`114c272c3a0bf9074060fe2cba256ca1d81f7e77`
- 权威计划：`docs/implementation-plan.md` revision 6，阶段 2
- 裁决：**PASS（原始 FAIL 经架构师事实源裁决更正）**
- 范围：公开首页 Ink & Signal 视觉应用返工

## 命令口径

- 按本轮任务派发的 10 路径 Vitest 命令，在干净 shell 中以 `env -u DATABASE_URL` 原样执行。
- 派发中的 `corebank pnpm` 为不可执行拼写，desktop Playwright 按同组其余命令与仓库工具链的明确意图使用 `corepack pnpm`。
- 为判断返工实现是否本身正确，另按当前权威计划阶段 2 的现存 10 文件集合复跑一次；该附加命令不替代派发原命令。

## 实际结果

| 门禁 | 实际结果 |
| --- | --- |
| 派发 10 路径 Vitest 原命令，`env -u DATABASE_URL` | 进程退出 0，但只发现并运行 **4 files / 11 tests**；6 个指定路径不存在且被 Vitest 静默忽略。未达到预期的 10 files / 65 tests。 |
| 权威计划当前现存 10 文件 Vitest 集合，`env -u DATABASE_URL` | 退出 0；**10 files / 65 tests** 全部通过。测试库中保留其他 E2E fixture，未人工清库。 |
| `corepack pnpm typecheck` | 退出 0；`tsc --noEmit` 通过。 |
| `corepack pnpm lint` | 退出 0；0 error、1 条既有 warning，位于 `.workflow/ui-prototype-nav-enhancement/app.js:115`。 |
| `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-desktop` | 退出 0；冷生产构建/产物校验/服务成功，6/6 tests 通过，用时 39.2s。 |
| `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-tablet` | 退出 0；冷生产构建/产物校验/服务成功，6/6 tests 通过，用时 36.6s。 |
| `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-mobile` | 退出 0；冷生产构建/产物校验/服务成功，6/6 tests 通过，用时 39.6s。 |

## 退回项

### 派发 Vitest 门禁对不存在路径 fail-open（阻塞）

本轮明确要求执行：

```text
tests/categories/publicDirectory.test.ts
tests/categories/publicHomePage.test.ts
tests/categories/publicHomeKeywordSearch.test.ts
tests/categories/publicHomeAsk.test.ts
tests/unit/publicHomeRoute.test.ts
tests/categories/siteLink.test.ts
tests/unit/inkSignalContracts.test.ts
tests/unit/legacyClassContracts.test.ts
tests/categories/directoryShell.test.tsx
tests/unit/testDatabaseGuard.test.ts
```

其中只有以下 4 个存在：

```text
tests/categories/publicDirectory.test.ts
tests/unit/inkSignalContracts.test.ts
tests/unit/legacyClassContracts.test.ts
tests/unit/testDatabaseGuard.test.ts
```

以下 6 个不存在：

```text
tests/categories/publicHomePage.test.ts
tests/categories/publicHomeKeywordSearch.test.ts
tests/categories/publicHomeAsk.test.ts
tests/unit/publicHomeRoute.test.ts
tests/categories/siteLink.test.ts
tests/categories/directoryShell.test.tsx
```

Vitest 对这些不存在的显式路径未报错，仍退出 0；实际输出为 `Test Files 4 passed (4)`、`Tests 11 passed (11)`。这会使门禁在漏跑大部分预期覆盖时静默放行，违反本轮“真实文件数/测试数与工程师自报一致”的明确验收标准。

期望结果：由架构师与实施工程师统一唯一命令事实源。若派发路径是最终合同，必须使 10 个路径真实存在并让原命令实际运行 10 files / 65 tests；若权威计划现存 10 文件集合才是最终合同，应修正派发/工作流命令并增加文件存在性或实际 file-count 断言，防止不存在路径再次被静默忽略。修正前不得把 4/11 的退出 0 记为门禁通过。

## 已通过核验

### 返工重点

- `vitest.config.ts` 从集中事实源导入固定 `TEST_DATABASE_URL` 并在 Vitest `test.env` 中强制注入；`env -u DATABASE_URL` 下，权威计划现存数据库测试可连接且仍由测试内 `collection_system_test` 断言 fail closed。
- `publicDirectory.test.ts` 仅删除自身 `directory-task10-*` 数据，只按自己返回的 category ID 和 URL prefix 断言；在其他合法 E2E fixture 存在时，现存计划集合仍 65/65 通过，未人工清库。
- `public.spec.ts` 使用 `Promise.all([page.waitForURL(..., 15s), clear.click()])` 等待 query 实际消失；tablet 冷构建完整项目本轮稳定 6/6。

### 零破坏与安全边界

- `git merge-base --is-ancestor 114c272c3a0bf9074060fe2cba256ca1d81f7e77 HEAD`：退出 0。
- API route、`src/lib/items`、`src/lib/search`、schema、migrations 的工作区 diff 与 `BASE..HEAD` diff 均为空。
- `package.json`、`pnpm-lock.yaml` 的工作区 diff 与 `BASE..HEAD` diff 均为空；`git diff --check` 通过。
- 六个旧 `--color-*` token 与基线逐值相同；`--color-ink: #17211D` 与 `--ink-text: #17181A` 隔离；无旧 token/class selector 删除。
- `tests/e2e` 只有一个 PostgreSQL URL 字面量；8 个 DB spec 均使用集中守卫。
- 中英文字典递归 key 集合合同通过；公开客户端仅请求现有 `/search` 与 `/ask`。

### 三视口截图

- `.workflow/screenshots/ink-signal/phase2-public-chromium-desktop.png`：1440px 宽，左侧索引、三列轨道、sticky header 正常，无横向截断或内容重叠。
- `.workflow/screenshots/ink-signal/phase2-public-chromium-tablet.png`：1024px 宽，左侧窄索引、两列轨道、sticky header 正常，无横向截断或内容重叠。
- `.workflow/screenshots/ink-signal/phase2-public-chromium-mobile.png`：1170 物理像素宽，对应 390px CSS viewport；横向索引、单列卡片与搜索控件正常，无横向截断或内容重叠。
- 三张均已逐张人工核验，焦点环可见。

## 原始裁决（已由架构师撤销）

**FAIL（退回）**。两项首轮返工已真实通过：测试数据隔离成立，tablet 冷构建完整 6/6 稳定通过；其余自动、零破坏、安全和截图门禁也通过。但本轮指定的 Vitest 原命令在 6 个文件不存在时静默只跑 4/11，未满足明确 file/test-count 标准，属于 fail-open 门禁，阶段 2 暂不放行。验收员未修改产品代码、未提交 Git、未推进阶段 3。

## 架构师裁决补充（2026-08-15）

- 事实源：`.workflow/review-ledger.md` 末尾「M3 阶段 2 门禁命令事实源裁决（架构师裁决）」。
- 权威命令：`docs/implementation-plan.md` revision 6 第 184 行的现存 10 文件 Vitest 集合是唯一合法的阶段 2 Vitest 门禁；本轮派发的 6 个不存在路径源于架构师任务描述错误，不构成实施合同。
- 有效证据：本报告已记录的权威计划命令实际结果为 `10 files / 65 tests` 全部通过，且测试库保留其他合法 E2E fixture、未人工清库；desktop、tablet、mobile 三个 Playwright 项目均为 `6/6`；typecheck、lint、零破坏、安全边界及三视口截图核验均通过。
- 原始 fail-open 观察仍保留，作为后续派发命令必须逐字复制事实源并核对实际 file count 的流程改进证据；它不再构成阶段 2 产品实现阻塞项。

## 最终有效裁决

**PASS（经架构师裁决确认）**。阶段 2 的权威计划自动门禁、零破坏与安全门禁、三视口截图均有独立复跑证据；两项首轮返工已真实通过。阶段 2 可放行进入阶段 3。验收员未修改产品代码、未提交 Git、未自行推进阶段 3。
