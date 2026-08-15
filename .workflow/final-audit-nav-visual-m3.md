# M3 · Ink & Signal 前端视觉重设计 —— Claude 独立最终审计（计划阶段）

- 审计角色：Claude 最终审计员（独立会话，不复用 Codex 结论）
- 时间：2026-08-13
- 阶段：`codex_accepted` → 本审计 → `user_decision`
- 事实源：`docs/implementation-plan.md`（rev5）、`docs/visual-redesign-proposal.md`、`docs/preview/`（3 份已批准原型）、`.workflow/review-ledger.md`（M3 章节 INK-001～013）
- 基线 HEAD：`114c272c3a0bf9074060fe2cba256ca1d81f7e77`（= 当前 HEAD，尚未开始实施）
- 审计性质：**计划前（pre-implementation）审计**。结论是否授权进入实施，不代表产品代码已实现或测试已运行。

---

## 结论：Conditional Go（有条件通过 → 交用户 go/no-go）

计划 rev5 质量高、内部一致、可执行，零破坏性边界与安全/隔离/fail-closed 门禁写成了可机械核对的合同。我独立复核了计划对真实代码的全部关键事实主张，均属实。**无未解决的 Critical/High/Medium 缺陷。** 仅存少量非阻塞残余项与需用户知情的假设（见下）。不声称本方案绝对无风险：这是计划层审批，全部验证证据为前瞻性（prospective），须在实施时真实执行并通过。

---

## 一、独立验证（新鲜证据，非引用 Codex）

| 主张 | 我的核验 | 结果 |
|---|---|---|
| 公开目录 SQL 仅 `web/github` | `src/lib/items/publicCorpus.ts:44` `and items.type in ('web','github')` | ✅ 属实 |
| 关键词搜索同样排除 doc | `src/lib/search/keyword.ts` 复用 `searchPublicCorpus`（同一受限查询） | ✅ 属实 |
| 问答语料包含 doc | `src/lib/search/retrieve.ts:91` `where status='completed'`（无 type 限制） | ✅ 隔离方向正确 |
| `--color-ink` 命名冲突真实存在 | `globals.css:4` `--color-ink: #17211D`（≠ proposal 的 #17181a） | ✅ 计划改用 `--ink-*` 隔离是正确取舍 |
| 依赖可用且不新增 | jsdom 26.1.0、typescript 5.9.2（direct devDep）、lucide-react 1.31.0、next 15.5.23、react 19.1.1 | ✅ 与计划锁定一致 |
| 受迁移组件/测试均存在 | public `_components/*`、admin layout/AdminNav/library/*、全部引用的 integration/e2e/unit 测试路径 | ✅ 存在 |
| 8 个 E2E DB spec 与文件清单一致 | `grep -l DATABASE_URL tests/e2e/*.spec.ts` 恰为 8 个（含 admin-detail） | ✅ 计数吻合 |
| 鉴权/登出边界 | `logoutAction`（server action）与 `requireAdminPage()` 均存在并被 layout 使用 | ✅ 属实 |
| 零破坏 base 门禁 | `git merge-base --is-ancestor base HEAD` 成功；HEAD==base，受限路径无 diff | ✅ 未预先实施 |
| 原型与 proposal 一致性 | 原型仅用 `--ink-*`；无 近期添加/stars/worker 状态 | ✅ 与计划排除项一致 |

## 二、五个交接重点的独立判断

1. **零破坏性 diff（INK-001）**：修复到位。固定 `M3_BASE_HEAD..HEAD` + 工作区双 `git diff --exit-code`，覆盖 route/items/search/schema/migrations，pathspec 引用正确，基线非祖先则 fail-closed。已消除“提交后工作区为空造成假阴性”的漏洞。
2. **discovery reducer 竞态（INK-002/013）**：现真实架构确为「搜索 URL 驱动 + 问答本地状态」，与计划前提吻合。计划的单 reducer `{mode,draft,keywordResult,askResult,activeRequest}` + 递增 request id + 双 AbortController + 明确 URL 回写时机（仅进入/前进后退/keyword 提交）+ 「仅当前 mode & 当前 request id 响应可落地」+ 请求期 `MODEL_UNAVAILABLE→unavailable`、`RATE_LIMITED→limited` 独立映射，是自洽且被 `publicDiscoveryModes.test.tsx` 锁定的可实现合同。竞态面收敛充分。
3. **legacy class 合同（INK-011/012）**：方案用仓库已装 jsdom CSSOM 提取 CSS selector、direct typescript compiler API 提取 TSX 静态 className，断言当前集合为 base 超集且自带「删除即失败」fixture，不新增依赖。可执行、可重复。**局限（见残余项）**：只保护名称存在，不防同名 class 的视觉声明被改坏。
4. **测试库 fail-closed（INK-003/008/009）**：唯一 helper `tests/e2e/testDatabase.ts` 精确校验协议+本机 host+`/collection_system_test`，webServer/Pool/迁移前统一断言，负向测试覆盖生产库名/远程 host/空值，扫描仅一个连接串字面量，`reuseExistingServer:false`。异常/依赖缺失时 fail-closed（先抛错），不会静默通过。8 个 DB spec 全覆盖。
5. **API/鉴权/doc 隔离未被 DOM 迁移弱化（INK-007）**：接口不变由「固定 base 双 diff + 既有集成测试（auth/CSRF/ETag/If-Match/no-store/error code/status/schema）」双重锁定；logout 复用 server action、session 不下放客户端；公开 doc 隔离有 SQL + 测试证据。

## 三、残余问题与已接受假设（均非阻塞）

| 编号 | 级别 | 说明 | 建议 |
|---|---|---|---|
| AR-M3-01 | 假设/Low | `prefers-reduced-transparency` 在 Chromium 无法真实模拟，依赖 CSS 合约测试 + 人工 Safari 检查 | 发布前在 Safari/WebKit 做一次人工核验 |
| AR-M3-02 | 假设/Low | legacy class 合同仅保证「名称保留」，不防同名 class 视觉声明被改坏；此类回归只能靠 Playwright/截图矩阵捕获 | 依赖三视口 E2E + 视觉矩阵人工评审兜底 |
| PI-M3-01 | Low | 全部验证证据为前瞻性；HEAD==base，尚未运行任何测试/构建 | 实施时必须真实执行并通过：双 diff 门禁、token/class/message/DB guard 合同、三视口全量 E2E、`pnpm build`、doc 隔离回归 |
| PI-M3-02 | Cosmetic | 动态模板 class 只保证保留「静态前缀」，纯动态无前缀的边角可能逃逸 guard | 实施时确保迁移的动态 class 保留静态前缀（计划已要求） |

无 Critical / High / Medium。无需在进入实施前强制修订的项。

## 四、审计边界声明

- 本审计为只读，未修改 `implementation-plan.md`、`visual-redesign-proposal.md`、原型或任何产品源码。
- 仅写入本文件，并为阶段转换更新 `.workflow/state.json` 与 `.workflow/handoff.md`。
- 不推进、不改变、不关闭 M2 未决发布决策。
- 本结论不构成「绝对无风险」保证；发布最终取决于实施阶段前瞻性门禁的真实通过与用户 go/no-go。
