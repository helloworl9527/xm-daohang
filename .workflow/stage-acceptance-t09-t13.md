# 阶段验收③：T09–T13

- 日期：2026-08-09
- 基准：`.workflow/implementation-plan.md` rev5
- 提交：`6a71e25`、`4fb7077`、`0a22bea`、`a65ecf4`、`0cca3d5`
- 结论：初验退回；`7891cef` / `014c358` 返工后复验 **通过**

## 返工复验（2026-08-09）

- R4 / `7891cef`：独立临时探针 6 个总结用例通过。上轮英文主体反例连续返回两次后被拒，抛 `UPSTREAM_INVALID_OUTPUT` 且 `retryable=true`；正常中文含 PostgreSQL/pgvector/RAG 与纯中文均一次通过；Han/Latin 占比高于 50%、恰好 50%、低于 50% 三个边界分别按合同通过、通过、拒绝。未发生本地翻译或截断。
- R5 / `014c358`：独立数据库探针在 job queued 后才写入未来 30 分钟 backoff。GitHub job 返回 `deferred`，抓取调用 0 次；原 attempt=0 行恢复为 pending，`next_attempt_at` 精确等于 retryAt，未新增 attempt、未写错误码，item 保持 processing。相同 backoff 下 web 与 doc 各正常抓取一次并完成，attempt=0 标 done。
- 环境：PostgreSQL 16.14、pgvector 0.8.6。`pnpm db:migrate` 退出 0；全量 `pnpm test` 为 21 files / 127 tests；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 均退出 0，audit 无已知漏洞。
- `pnpm e2e` 真实执行 `next build + next start`，desktop 1440x1000 与 mobile 390 两项目 2/2 通过；workflow validator 输出 `PASS: workflow stage=implementation revision=5`。
- 临时复验文件已删除；未修改产品代码，未自行放行 T14。

## 初验阻断返工项（历史）

### R4 / T10：中文总结校验 fail-open

rev5 T10 要求总结为 2–4 句中文，首次非法最多修正一次，第二次仍非法时抛可重试稳定错误。初验提交中的 `src/lib/ai/summarize.ts:13` 只要求全文至少 4 个汉字，主体为英文的输出可通过。

临时反向验收用例让模型连续返回：

```json
{"summary":"This report covers database design 中文内容。It also explains vector search in detail。","tags":["database","vector","search"]}
```

期望：两次均非法，拒绝并抛 `UPSTREAM_INVALID_OUTPUT`、`retryable=true`。实际：第一次即解析成功并原样返回。定向 Vitest 退出 1，错误为 `promise resolved ... instead of rejecting`。

期望结果：中文判定能拒绝主体明显为非中文的总结，同时保留合理的英文技术名词；为该反例增加回归测试，仍保持最多一次修正、不本地翻译或截断。

### R5 / T13：已排队 GitHub handler 绕过持久 backoff

rev5 T13 明确要求 `T11 publisher/handler` 都读取 `app_settings.github_backoff_until`，在 reset 前延迟 GitHub 请求，网页/文档不受影响。初验提交仅在 `src/worker/queue/requestPublisher.ts:42` 检查门禁；当时 `src/worker/jobs/processItem.ts:43-68` claim 和 `:161` 外部抓取前均未检查。

临时数据库反向验收：设置未来 30 分钟的 `github_backoff_until`，构造已经是 `queued` 的 GitHub request，再调用 `processItemJob`。期望抓取器调用 0 次、条目保持 processing；实际抓取器调用 1 次且作业继续完成。定向 Vitest 退出 1，错误为 `expected spy to not be called ... actually been called 1 times`。

这覆盖 publisher 查询之后、handler 执行之前刚写入 backoff 的实际竞态窗口。期望结果：handler 在任何 GitHub 外部请求前 fail-closed 复查持久门禁并延迟/重排，且增加“已 queued 后新写 backoff”的回归测试。

## 已通过证据

- 环境：本机 PostgreSQL 16.14、pgvector 0.8.6、Node 23.11.0、pnpm 11.20.0。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0，迁移成功。
- 同一数据库执行 `pnpm test`：21 files / 123 tests 全通过，退出 0。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod`：均退出 0；audit 输出 `No known vulnerabilities found`。
- `pnpm e2e`：真实 `next build + next start`，desktop 1440x1000 与 mobile 390 两项目 2/2 通过，退出 0。
- workflow validator：`PASS: workflow stage=implementation revision=5`。
- T09 源码扫描：服务端抓取器未发现独立 `fetch`；网页与 GitHub 默认入口均调用 `safeFetch`。逐跳 SSRF/跨源请求头剥离、MIME/大小、PDF 魔数/加密异常/100 页、私有仓拒绝、限流映射和 SHA-256 指纹反向测试均在本次全量测试中通过。
- T11/T12/T13 既有集成测试覆盖四次总尝试、代际/版本/删除 no-op、并发 claim、receipt outcome 事务、人工总结保护、processing 重抓拒绝、到期/关闭/双 worker/50+1 预算/崩溃恢复；上述 R5 是既有覆盖遗漏的 queued-handler 窗口。
- 新增直接生产依赖许可：`@mozilla/readability` Apache-2.0、`jsdom` MIT、`pdfjs-dist` Apache-2.0、`pg-boss` MIT。

## 操作边界

临时反向测试文件已删除；未修改产品代码，未放行 T14。工作树原有截图和前序验收文件未回退。
