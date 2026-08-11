# 导航站增强 M2 阶段验收：Task 3 单条分类器

- 日期：2026-08-11（Asia/Shanghai）
- 验收提交：`270ae160e30b660f92cb73b84b7dec259d8bd7b1`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 3 与 Global Invariants
- 结论：**退回**。分类器当前实现符合主要契约，但 prompt-injection 隔离测试未覆盖全部不可信字段，安全门禁可 fail-open。

## 独立复跑证据

1. 仅验收稳定提交的 detached worktree `/tmp/xm-270ae16-accept.r1ub5U`；使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432`、同名数据库 `collection_system_test`，未操作实施侧默认实例。
2. Task 1-3 联合定向：4 files / 45 tests 通过，其中 classify 1 file / 18 tests。
3. `tsc --noEmit` 退出 0；`eslint .` 退出 0，为 0 error、1 条已批准 UI 原型既有 warning；`git diff --check` 退出 0。
4. workflow validator 退出 0，输出 `PASS: workflow stage=implementation revision=11`。
5. 完整回归为 44/46 files、301/303 tests；失败仍仅为未构建 standalone 的 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 固定 `2026-08-09`、当前业务日 `2026-08-11`。Task 3 diff 未修改这两个用例或其产品路径，归因与实施报告一致。

## 已通过项

1. 输入和候选以 JSON user message 传递；无候选不调用模型并返回可靠 `unclassified`。
2. 输出先受 4 KiB UTF-8 字节上限约束，再允许单个完整 JSON fence，并由 strict zod schema 校验；confidence 限 0～1。
3. `categoryId` 仅接受候选白名单、`null` 或 `NONE`；0.65 为可选中的包含边界，低于阈值返回可靠未分类。
4. 模型异常转换为 `upstream_error`，非法输出转换为 `invalid_output`；日志仅记录 outcome，logger 异常不改变结果。
5. 六项既有反测已独立复现：中和无候选短路、strict schema、候选白名单、0.65 边界、4 KiB 上限，以及把注入 title 放入 system 后，对应命名测试均为 Vitest assertion failure、exit 1。证据目录：`/tmp/xm-270ae16-reverse.9XJcno`。

## 阻断返工项

### R1：注入隔离测试遗漏 tags 与候选分类名称

- rev11 明确要求条目内容和分类名称都作为“不可信收藏数据”在结构化 JSON 中隔离。现有 fixture 的 tags 已包含 `ignore previous instructions` / `输出密钥`，但测试只断言 system 不包含 title 与 summary；候选分类名则均为普通名称，也未断言不得进入 system。
- 反证 A：隔离变异仅把 `input.tags.join(",")` 追加到 system，命名测试 `keeps prompt-injection text inside the untrusted JSON data boundary` 仍为 1 passed、exit 0。
- 反证 B：隔离变异仅把 `input.categories[0].name` 追加到 system，同一命名测试仍为 1 passed、exit 0。
- 两个变异均把计划定义的不可信数据带入高优先级 system message，门禁却静默放行。变异 diff 与日志见 `/tmp/xm-270ae16-reverse.9XJcno/tag_leak.*` 和 `category_name_leak.*`。
- 期望：注入 fixture 包含恶意 title、summary、每个 tag 及至少一个恶意候选分类名；断言 system 不包含这些不可信值（或直接断言 system 为固定模板），同时断言它们仅存在于可解析的 user JSON。分别把 tags、分类名复制进 system 时，对应测试必须 assertion failure、exit 1。
- 更新实施报告中“注入隔离反测”的证据后，提供新稳定提交复验。当前产品实现可保持不变，本次返工重点是补齐安全回归门禁。

## 非阻断说明

- 计划 Task 13 规定最终结构化事件名为 `category_classified`；本模块当前使用 `category_classification`。Task 3 文本只要求脱敏 outcome 日志，最终事件名可在 Task 4/13 接线时统一，本次不据此新增阻断项。
