# 导航站增强 M2 阶段验收：Task 10 公开目录、favicon 与问答可用性

- 日期：2026-08-12（Asia/Shanghai）
- 验收提交：`7b125ce3e95483fefe2c298c712be37f3487dad6`
- 父提交：`2219c098f5eef4858f3b1de6de27356b04aab9a6`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 10 与 Global Invariants
- 结论：**通过**。公开目录、favicon SSRF 边界与 doc-only 问答可用性符合合同；放行 Task 11。

## 独立环境

1. 在 detached worktree `/tmp/xm-task10-accept.OPikLy` 固定验收上述提交，父链与提交题目核对一致；使用独立依赖目录，未复用或 prune 主工作树依赖。
2. 使用独立 PostgreSQL 16.14 实例 `127.0.0.1:55432/collection_system_test`；真实执行 4 个迁移成功，未使用实施工程师默认实例。

## 正向证据

1. Task 10 联合定向为 6 files / 26 tests PASS：目录、favicon route/loader、safeFetch、publicCorpus 与问答可用性均覆盖。
2. `getPublicDirectory` 固定两次查询：返回空分类；只收 completed web/github；分类按 `sort,name,id`、站点按 `title,url,id`；未分类组始终位于末尾；faviconPath 固定为同源 `/favicon/<UUID>`。真实 PostgreSQL 同时证明 doc/processing 排除及 doc-only 目录为空。
3. favicon route 仅接受 path UUID，不读取 query URL/host。loader 先以 `$1` 查询 completed web/github，再从数据库 URL 的 origin 派生 `/favicon.ico`；非 eligible 零 fetch。
4. favicon 网络读取复用 `safeFetch`：每跳重新解析全部 A/AAAA 并固定已审查地址；跨 origin 不转发请求头；内网重定向、HTTPS 降级、循环/第六跳、错误 MIME、Content-Length/流式超限与总超时均 fail closed。限制为 128 KiB、5 秒，只允许 PNG/JPEG/GIF/WebP/ICO，明确拒绝 SVG/HTML。
5. 同 key 三个并发请求只查询/抓取一次；成功缓存 7 天，失败缓存 1 小时。失败及非 eligible 统一返回本地 PNG 404、public cache 与 `nosniff`，响应不包含上游 URL、host 或异常详情。
6. `hasCompletedAskCorpus` 只检查任意 completed item，包含 doc；首页独立组合该结果与 `getPublicAskReadiness`，不依赖 daily/目录是否为空。doc-only 时 ask corpus 为 true 且目录所有组为空。
7. `tsc --noEmit` exit 0；lint 为 0 error、1 条批准原型既有 warning；`git diff --check` exit 0；workflow validator 输出 `PASS: workflow stage=implementation revision=11`。
8. Next.js build 与 standalone prune exit 0，生成 `/favicon/[id]`；产物门禁两次确认 `Production artifact excludes 15 root devDependencies`，deploy-smoke 7/7 PASS。
9. 完整回归为 59/60 files、399/400 tests；唯一失败仍是 `settingsRoutes` 固定期待业务日 `2026-08-09`，实际为 `2026-08-12`，与本提交无关。

## Fail-closed 反向验证

以下临时变异均只修改产品实现、不修改测试；对应命名用例均为 Vitest `AssertionError`、exit 1，恢复后联合定向重新 26/26：

1. 把未分类组移到首位：末组合同断言红。
2. 把分类排序反转为 `sort/name/id desc`：真实顺序与 SQL 合同断言红。
3. 让 favicon route 采用 query `url`：item-id-only 行为与架构断言均红。
4. 把 `image/svg+xml` 加入 MIME 白名单：raster-only 门禁红。
5. 把问答空库判定退回 `dailyItems.length===0`：NAV-005 独立 corpus 门禁红。

## 裁决

- 公开目录排序/过滤/规模合同、favicon SSRF 与内容边界、缓存/不泄漏行为、doc-only 问答可用性均有独立正向和反向证据。
- **Task 10 通过，放行 Task 11。**
