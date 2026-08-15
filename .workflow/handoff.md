# Handoff

- Target role: `implementation_agent`（Codex 方案实施工程师）
- Milestone: 前端视觉重设计（M3 · Ink & Signal）
- Stage: `implementation`
- Active role: `implementation_agent`
- Plan revision: 5（唯一实施计划 docs/implementation-plan.md）
- Validation: 全部前置门禁通过（见下）
- Base HEAD: `114c272c3a0bf9074060fe2cba256ca1d81f7e77`（M3_BASE_HEAD）

## 门禁通过记录

- ✅ Codex 方案验证：4 轮收敛 rev5，INK-001~013 全 fixed，acceptance-rubric 10/10，未解决 Critical/High/Medium/Low=0。
- ✅ Claude 独立最终审计：conditional go（.workflow/final-audit-nav-visual-m3.md），无 Critical/High/Medium，残余非阻塞。
- ✅ 用户 go/no-go：原文『接受风险，开始实施』（2026-08-14），接受 AR-M3-01/AR-M3-02、PI-M3-01/PI-M3-02。

## 实施方式（分阶段 + 每阶段独立验收）

按 docs/implementation-plan.md 顺序实施 4 个阶段，逐阶段推进：
1. 阶段 1：设计系统基础与验收基线（--ink-* tokens、交互/a11y 规则、Playwright 三视口基线、契约测试）
2. 阶段 2：公开端 / 首页重构（检索工作区合并、分类索引、卡片差异化）
3. 阶段 3：管理后台壳与 Library（240px 侧栏/移动抽屉、紧凑行卡片）
4. 阶段 4：详情、表单与其余后台页面

每阶段：实施工程师完成后，由 Codex 阶段验收员独立复跑该阶段验收命令与三视口 E2E；通过才进入下一阶段。

## 实施必守约束（零破坏性 + PI-M3-01）

- 不修改 src/app/**/route.ts、src/lib/items/*.ts、src/lib/search/*.ts、src/db/schema.ts、迁移文件。
- 保留现有 class 与旧 tokens；新 tokens 用 --ink-* 前缀（与 --color-ink #17211D 隔离）。
- 不引入 Tailwind/shadcn/MUI/CSS-in-JS/动画库/远程字体；package.json runtime 依赖不变。
- 公开目录仍只展示 web/github，doc 不外泄。
- 新增可见文案同时进 zh.json 与 en.json，key 集合一致。
- 每阶段真实通过 typecheck + lint + 相关 Vitest + 相关 Playwright；最终跑全量三视口 E2E + build。
- E2E 只连 collection_system_test 测试库（fail-closed）。
- 先不提交 Git，等每阶段验收通过后由架构师统筹提交边界（4 个提交，见 plan）。

## Unresolved / 已接受残余项

- AR-M3-01：prefers-reduced-transparency 仅 WebKit 真支持，实施时需人工 Safari 核验一次。
- AR-M3-02：legacy class 合同仅保护类名存在，不保护视觉；视觉回归靠三视口 E2E。
- PI-M3-01：审计证据为前瞻性，实施必须真实通过全部门禁 + build + 三视口 E2E 才算数。
- PI-M3-02：Cosmetic（动态 class 静态前缀）。

## 不覆盖的历史

- M2（导航站增强）canonical 文件与其未决发布决策（release_pending，ENV-M2-DOCKER）原样保留，M3 不推进、不关闭。
- M1 历史文件不覆盖。

## Next action

Codex 方案实施工程师接管，从**阶段 1**开始实施：读取 state/handoff、docs/implementation-plan.md（阶段 1 章节）、docs/preview/ 原型，按阶段 1 文件清单与验收命令实施并自验，完成后报告改动摘要与每条验收命令实际结果，先不提交 Git，等待 Codex 阶段验收员独立复跑验收。
