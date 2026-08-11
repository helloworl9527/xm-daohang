# 导航站增强 M2 阶段验收：Task 4 worker 集成归类

- 日期：2026-08-11（Asia/Shanghai）
- 验收提交：`885ff22458f8c57226f4ff9fceb68d7592dfa9fe`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 4 与 Global Invariants
- 结论：**退回**。worker 当前实现按 boolean `category_manual` 保护人工 NULL，但测试只覆盖人工选择正式分类，`category_manual=true/category_id=NULL` 的关键不变量门禁可 fail-open。

## 独立复跑证据

1. 仅验收稳定提交的 detached worktree `/tmp/xm-885ff22-accept.0xun8l`；使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432`、同名数据库 `collection_system_test`，未操作实施侧默认实例。
2. processItem 定向为 1 file / 18 tests 通过；Task 1-4 联合定向为 5 files / 63 tests 通过。
3. `tsc --noEmit` 退出 0；`eslint .` 退出 0，为 0 error、1 条已批准 UI 原型既有 warning；`git diff --check` 退出 0。
4. workflow validator 退出 0，输出 `PASS: workflow stage=implementation revision=11`。
5. 完整回归为 44/46 files、308/310 tests；失败仍仅为未构建 standalone 的 `PRODUCTION_NODE_MODULES_MISSING`，以及 `settingsRoutes` 固定 `2026-08-09`、当前业务日 `2026-08-11`。Task 4 未修改这两个用例或其产品路径，归因与实施报告一致。

## 已通过项

1. 分类只面向 initialized taxonomy 下的 web/github，初始人工条目跳过；taxonomy/classifier 错误被隔离为 skipped，处理仍 completed 且不进入 retry。
2. `selected` 应用候选；可靠 `unclassified` 写 NULL；`invalid_output`/`upstream_error` 保留旧分类。
3. completion transaction 内重验 taxonomy version、候选存在性与当前 manual，并保持 item、processing request、Telegram receipt 原子完成。
4. taxonomy snapshot 短事务结束后才调用 classifier；分类器挂起期间 completion transaction 尚未开始，LLM 不在数据库事务内。
5. `category_classified` 日志只记录 matched/unclassified/skipped 与稳定 reason，不含条目内容。

## 十项反向验证

在独立变异 worktree 中逐项中和 type、初始 manual、initialized、taxonomy 错误隔离、classifier 错误隔离、可靠 NULL、completion manual、version、候选存在性，以及把分类准备包入 `db.transaction`：

1. 十个对应命名测试均为 1 failed、exit 1，分别命中模型调用次数、completed/retrying、分类持久值、人工覆盖、version/candidate 结果或 transaction 调用次数断言。
2. 每个变异 diff 仅含目标门禁修改；失败均为 Vitest `AssertionError`，不是语法、依赖、迁移或启动错误。
3. 证据目录：`/tmp/xm-885ff22-reverse.sRPMSz`。

## 阻断返工项

### R1：人工选择 NULL 未纳入初始与 completion 并发门禁

- Global Invariant 明确：`category_manual=true` 表示人工选择，包括人工选择 NULL；worker 必须只依据 manual boolean 保护，不能以 `category_id` 是否非 NULL 推断。
- 现有初始人工 fixture 为 `{categoryManual:true, categoryId:<正式分类>}`，推理期间人工覆盖 fixture 同样写入非 NULL 分类；没有 `{categoryManual:true, categoryId:null}` 场景。
- 反证：隔离变异仅把初始保护从 `if (item.categoryManual)` 弱化为 `if (item.categoryManual && item.categoryId !== null)`，命名测试 `does not classify uninitialized, doc, or manually categorized items` 仍为 1 passed / 17 skipped、exit 0。该退化会把“人工选择未分类”的条目错误送入模型，门禁静默放行。
- 反证 diff 与日志：`/tmp/xm-885ff22-reverse.sRPMSz/manual_null.diff`、`manual_null.log`。
- 期望：增加初始 `{categoryManual:true, categoryId:null}` fixture，断言 loadTaxonomy/classify 均零调用且处理仍 completed；把上述保护弱化为依赖非 NULL categoryId 时测试必须 assertion failure、exit 1。
- 另增加推理挂起期间管理员写 `{categoryManual:true, categoryId:null}` 的并发 fixture，释放分类结果后断言仍为人工 NULL、不会被 selected 或 reliable NULL 路径覆盖，并记录 `manual_override`；中和 completion 的 manual 保护时必须 exit 1。
- 更新实施报告中“人工保护门禁”的覆盖描述后，提供新稳定提交复验。当前产品实现可保持不变，本次返工重点是补齐全局不变量的回归证明。

## 非阻断说明

- 完整回归的 standalone 构建前置与历史固定日期用例仍建议按既有记录另行处理，不阻断本批问题归因。
