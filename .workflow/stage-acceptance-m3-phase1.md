# M3 阶段 1 独立验收

- 首次验收时间：2026-08-14T09:29:35+08:00
- rev6 复验时间：2026-08-14T09:46:52+08:00
- rev6 第三轮验收时间：2026-08-14T09:55:02+08:00
- 验收角色：Codex 阶段验收员
- 基线：`114c272c3a0bf9074060fe2cba256ca1d81f7e77`
- 最新裁决：**PASS（通过）**
- 范围：Ink & Signal 设计系统基础与验收基线

## 原计划门禁复跑

| 门禁 | 实际结果 |
| --- | --- |
| `corepack pnpm exec vitest run tests/unit/uiPrimitives.test.tsx tests/unit/inkSignalContracts.test.ts tests/unit/legacyClassContracts.test.ts tests/unit/testDatabaseGuard.test.ts` | 退出 0；4 个文件、14/14 tests 通过。 |
| `corepack pnpm typecheck` | 退出 0；`tsc --noEmit` 通过。 |
| `corepack pnpm lint` | 退出 0；0 error、1 warning。warning 位于既有 `.workflow/ui-prototype-nav-enhancement/app.js:115`。 |
| `corepack pnpm exec playwright test tests/e2e/visual-foundations.spec.ts` | 退出 0；生产构建/启动成功，desktop/tablet/mobile 上 `/` 与 `/admin/login` 共 6/6 tests 通过，用时 37.9s。 |

截图位于 `.workflow/screenshots/ink-signal/phase-1/`。逐张核验 6 张 PNG：desktop 为 1440x1000、tablet 为 1024x768；mobile 因 iPhone descriptor 的 deviceScaleFactor=3 输出 1170x2532，对应 CSS viewport 390x844。未见横向截断、内容重叠或焦点环不可见。

## 零破坏与安全反向门禁

- `git merge-base --is-ancestor 114c272c3a0bf9074060fe2cba256ca1d81f7e77 HEAD`：退出 0。
- 工作区受限路径 diff：`git diff -- 'src/app/**/route.ts' src/lib/items src/lib/search src/db/schema.ts src/db/migrations` 无输出。
- 基线受限路径 diff：`git diff 114c272c3a0bf9074060fe2cba256ca1d81f7e77..HEAD -- ...` 无输出。
- `package.json`、`pnpm-lock.yaml` 的工作区 diff 与 `BASE..HEAD` diff 均无输出；未新增依赖清单或第三方运行时依赖。
- 产品源文件只修改 `globals.css`、`Pressable.tsx`、`MotionRegion.tsx`；页面 TSX 与消息字典无 diff，未重排页面 DOM、未改产品文案。
- 六个旧 palette token 基线与当前值逐一相同；`--color-ink: #17211D` 保留，新增 `--ink-text: #17181A`，未覆盖旧 token；CSS diff 无 custom property 或 class selector 删除。
- E2E 源码仅存在一个 PostgreSQL URL 字面量；8 个 DB spec 均在 `Pool` 创建前使用集中守卫结果。
- fail-closed 反向探针：空值、生产库名、远程 host、MySQL URL 共 4/4 被同步拒绝；固定 `collection_system_test` URL 被接受。

## 退回项

### 1. 动态禁用后仍残留 pressed 状态（阻塞）

计划硬要求：Pressable disabled 时不设置 `data-pressed`。现有测试只覆盖“初始即 disabled”，未覆盖“pointer-down 后由父级切换 disabled”。独立临时测试实际失败：

```tsx
const view = render(<Pressable>Ask</Pressable>);
const button = screen.getByRole("button", { name: "Ask" });
fireEvent.pointerDown(button);
expect(button).toHaveAttribute("data-pressed", "true");
view.rerender(<Pressable disabled>Ask</Pressable>);
expect(button).not.toHaveAttribute("data-pressed");
```

实际结果：退出 1，收到 `data-pressed="true"`。原因可定位到 `Pressable.tsx` 渲染属性只依据内部 `pressed`，未以 `disabled` 屏蔽或复位。

期望返工：无论按钮初始 disabled，还是按下过程中动态变为 disabled，DOM 均不得保留/新增 `data-pressed`；把上述动态切换场景加入正式 `uiPrimitives.test.tsx`，并复跑阶段 1 全部门禁。

### 2. 本机 socket 合同未兑现（阻塞）

权威计划要求 `assertTestDatabaseUrl` 接受“hostname 仅 `127.0.0.1`/`localhost`/本机 socket 可接受形式”。当前实现只接受 `127.0.0.1`、`localhost`、`::1`，对 `postgresql:///collection_system_test` 及 percent-encoded Unix socket host 均报 `E2E database host must be local`。

期望返工：按计划明确一种受支持的本机 socket URL 形式并加入正向单测，同时继续精确限制数据库名为 `/collection_system_test`；若项目决定不支持 socket，需由架构师修改权威计划后再验收，不可由实现静默缩窄合同。

## 结论

原列自动命令与多数零破坏门禁均通过，但两项硬合同未满足，故阶段 1 不予放行，不得推进阶段 2。临时反向测试文件已删除，未修改产品代码，未提交 Git。

---

## rev6 返工后完整复验

### 已解决/已裁决项

- Pressable 动态 disabled：**已解决**。`data-pressed={pressed && !disabled ? "true" : undefined}` 在渲染层同步屏蔽，`useEffect` 后续清理内部状态；正式 rerender 回归通过。
- Unix socket：**由架构师在权威计划 rev6 裁决关闭**。`docs/implementation-plan.md:88` 已收窄为只接受本机 TCP 环回，并明确 socket 必须拒绝；当前 socket 负向用例通过。

### rev6 自动门禁复跑

| 门禁 | 2026-08-14 实际结果 |
| --- | --- |
| `corepack pnpm exec vitest run tests/unit/uiPrimitives.test.tsx tests/unit/inkSignalContracts.test.ts tests/unit/legacyClassContracts.test.ts tests/unit/testDatabaseGuard.test.ts` | 退出 0；4 个文件、**15/15** tests 通过（新增动态 disabled rerender 回归后实际总数为 15）。 |
| `corepack pnpm typecheck` | 退出 0；`tsc --noEmit` 通过。 |
| `corepack pnpm lint` | 退出 0；0 error、1 条既有 warning，仍位于 `.workflow/ui-prototype-nav-enhancement/app.js:115`。 |
| `corepack pnpm exec playwright test tests/e2e/visual-foundations.spec.ts` | 退出 0；生产构建、产物校验、服务启动成功；desktop/tablet/mobile 上 `/` 与 `/admin/login` 共 6/6 tests 通过，用时 34.5s。 |

本次生成的 6 张截图已逐张核验：三视口均无内容重叠或横向截断，focus ring 可见，mobile PNG 的 1170x2532 物理像素对应 390x844 CSS viewport。

### rev6 零破坏与安全反向门禁

- 基线祖先门禁退出 0。
- API route、`src/lib/items`、`src/lib/search`、schema、migrations 的工作区 diff 与 `BASE..HEAD` diff 均为空。
- `package.json`、`pnpm-lock.yaml` 的工作区 diff 与 `BASE..HEAD` diff 均为空；无新增依赖清单。
- 六个旧 `--color-*` token 与基线逐值相同；`--color-ink: #17211D` 与 `--ink-text: #17181A` 隔离；CSS 无旧 token/class selector 删除。
- 页面 TSX 与消息字典无 diff；未重排页面 DOM、未改产品文案。
- `tests/e2e` 仅有一个 PostgreSQL URL 字面量；8 个 DB spec 均使用集中守卫结果后才创建 `Pool`。
- fail-closed 负向探针均成功拦截：空值、Unix socket、生产库名、远程 host、MySQL URL。

### rev6 新阻塞项：IPv6 TCP 环回 `::1` 被错误拒绝

权威计划 rev6 第 88 行明确允许三种 hostname：`127.0.0.1`、`localhost`、`::1`。当前实现检查：

```ts
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
  throw new Error("E2E database host must be local");
}
```

Node WHATWG URL 对合法 IPv6 URL `postgresql://apple@[::1]:5432/collection_system_test` 返回的 `parsed.hostname` 为 `[::1]`。独立直接调用结果：

```text
ACCEPTED as required: postgresql://apple@127.0.0.1:5432/collection_system_test
ACCEPTED as required: postgresql://apple@localhost:5432/collection_system_test
REJECTED but required: postgresql://apple@[::1]:5432/collection_system_test
  => E2E database host must be local
```

反向探针进程退出 1。现有 `testDatabaseGuard.test.ts` 只正向覆盖固定的 `127.0.0.1` URL，未逐一覆盖 rev6 允许表，因此 15/15 产生漏检。

期望返工：规范化或显式接受 WHATWG URL 返回的 IPv6 loopback hostname，并在 `testDatabaseGuard.test.ts` 中分别正向覆盖 `127.0.0.1`、`localhost`、`[::1]`，继续负向拒绝 socket、远程 host、生产库名、空值和非 PostgreSQL 协议。

### rev6 裁决

**FAIL（退回）**。Pressable 修复与其余自动/零破坏门禁通过，但 rev6 明文允许的 IPv6 TCP 环回实际被拒绝，测试又未覆盖允许表，证据不足以放行阶段 1。不得推进阶段 2；未修改产品代码，未提交 Git。

---

## rev6 第三轮完整独立验收

### 返工核验

- `Pressable.tsx` 保持渲染层 `pressed && !disabled` 屏蔽和 `useEffect` 状态清理；动态 disabled rerender 回归存在并通过。
- `testDatabase.ts` 先以 `parsed.hostname.replace(/^\[|\]$/g, "")` 去除 IPv6 方括号，再按 `127.0.0.1`/`localhost`/`::1` 白名单验证。
- `testDatabaseGuard.test.ts` 已逐一正向覆盖固定 `127.0.0.1`、`localhost` 和 `[::1]`，并负向覆盖 Unix socket。

### 自动门禁

| 门禁 | 第三轮实际结果 |
| --- | --- |
| `corepack pnpm exec vitest run tests/unit/uiPrimitives.test.tsx tests/unit/inkSignalContracts.test.ts tests/unit/legacyClassContracts.test.ts tests/unit/testDatabaseGuard.test.ts` | 退出 0；4 个文件、15/15 tests 通过。 |
| `corepack pnpm typecheck` | 退出 0；`tsc --noEmit` 通过。 |
| `corepack pnpm lint` | 退出 0；0 error、1 条既有 warning，位于 `.workflow/ui-prototype-nav-enhancement/app.js:115`。 |
| `corepack pnpm exec playwright test tests/e2e/visual-foundations.spec.ts` | 退出 0；生产构建、产物校验、服务启动成功；三项目在 `/` 与 `/admin/login` 共 6/6 tests 通过，用时 35.1s。 |

本轮 6 张截图已逐张核验：1440x1000、1024x768 与 390x844 CSS viewport 均无内容重叠、横向截断或不可见焦点环；mobile PNG 为 deviceScaleFactor=3 的 1170x2532 物理像素。

### 零破坏与安全反向门禁

- `git merge-base --is-ancestor 114c272c3a0bf9074060fe2cba256ca1d81f7e77 HEAD`：退出 0。
- API route、items/search library、schema、migrations 的工作区 diff 与 `BASE..HEAD` diff 均为空。
- `package.json`、`pnpm-lock.yaml` 的工作区 diff 与 `BASE..HEAD` diff 均为空；无新增依赖清单。
- 六个旧 palette token 与基线逐值一致；`--color-ink: #17211D` 保留且与 `--ink-text: #17181A` 隔离；无旧 token/class selector 删除。
- 页面 TSX 与消息字典无 diff；未重排页面 DOM、未改产品文案。
- `tests/e2e` 只有一个 PostgreSQL URL 字面量；8 个 DB spec 均在创建 `Pool` 前使用集中守卫结果。

独立 Node 直接探针退出 0：

```text
ACCEPTED: postgresql://apple@127.0.0.1:5432/collection_system_test
ACCEPTED: postgresql://apple@localhost:5432/collection_system_test
ACCEPTED: postgresql://apple@[::1]:5432/collection_system_test
BLOCKED: undefined
BLOCKED: postgresql:///collection_system_test?host=%2Fvar%2Frun%2Fpostgresql
BLOCKED: postgresql://apple@127.0.0.1:5432/collection_system
BLOCKED: postgresql://apple@db.example:5432/collection_system_test
BLOCKED: mysql://apple@127.0.0.1:3306/collection_system_test
TCP positive 3/3; negative 5/5
```

### 最终裁决

**PASS（通过）**。前两轮阻塞项均已修复或经 rev6 权威计划裁决后兑现；全部自动门禁、三视口截图核验、零破坏门禁与 fail-closed 反向探针通过。阶段 1 可放行进入阶段 2。验收员未修改产品代码、未提交 Git。
