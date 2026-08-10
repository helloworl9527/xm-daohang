# 阶段验收⑥：T20–T21

- 日期：2026-08-09
- 基准：`.workflow/implementation-plan.md` rev5、`.workflow/ui-spec.md` §7
- 提交：`f0125c8`、`f6a2877`、`e2be9ec`
- 结论：**退回**

## 阻断返工项

### R12：完成回执未对常见中文多句总结截取第一句

requirements F-02 要求收藏完成后主动回复“一句话总结”，ui-spec §7 的完成文案合同为：

```text
✅ 已收藏
{标题}
{一句话总结}
{原链接}
```

`src/worker/bot/receiptDispatcher.ts:17-21` 的 `firstSentence` 使用 `^.*?[。！？!?](?:\s|$)`；它只在句末标点后紧跟空白或字符串结束时匹配。项目生成的中文 2–4 句总结通常写作 `第一句。第二句。`，句号后没有空格，因此匹配失败并回退为完整 summary。

独立真实 dispatcher 探针向完成条目写入：

```text
第一句介绍主题。第二句补充细节。第三句给出结论。
```

期望发送：

```text
✅ 已收藏
多句总结
第一句介绍主题。
https://example.com/multi-sentence
```

实际发送包含完整三句。定向探针 5 tests 中 4 通过、1 失败，退出 1。

期望结果：在第一个中文/英文句末标点处截断并保留标点，不要求后续空白；覆盖无空格中文多句、带空格英文多句、无句末标点和 null/空总结，确保 Telegram 完成回执只含一句话且符合消息约定。

## 已通过证据

### 白名单与 T20 添加

- `handleTelegramMessage` 在任何命令/URL/提问解析前查询 `tg_allowed_ids`。独立探针对非白名单发送添加链接、`/refetch` 命令和自然语言提问：send、URL 校验、retrieve、answer、refetch 均为 0 次，items 与 `ask_counters` 均为空。
- 白名单添加逐 URL 调用 `assertPublicUrl`，规范化后以 `url_canonical` 唯一约束和 `ON CONFLICT DO NOTHING` 去重；新条目与 processing request、Telegram receipt 在同一事务写入。原生测试确认每消息最多处理 10 个去重 URL，11 个时只创建 10 条并发送上限提示；立即回执文案为 `已加入，正在抓取总结中。`。
- chat ID 只持久化 HMAC 与 AES-GCM 随机密文；独立 key 使用 `TG_ID_HASH_KEY`，同 chat hash 稳定、密文随机且不含明文。

### Receipt outbox 与 dispatcher

- claim SQL 使用单条 CTE `FOR UPDATE SKIP LOCKED` 原子置 `sending`、写 `leased_by/lease_until` 并递增 attempts；原生并发测试两个 worker 仅一个 send。
- expired lease 可恢复；发送后标记 sent 前崩溃的下一次发送返回 `duplicatePossible=true`，符合已接受 AR-001。
- 429 将 receipt 持久恢复为 ready、清 lease，并按 `retry_after` 写 `next_attempt_at`；到期前不发送、到期后成功。
- `outcome is not null` 是 claim 前置条件。独立与原生探针均确认 `ready + null outcome` 不 claim、不 send，fail closed。

### T21 私有提问与命令

- 解析顺序为精确 `/refetch|/retry <8hex>` → 畸形处理命令统一未找到 → URL 添加 → 其它非空文本提问。畸形命令不进入 retrieve。
- 8 位短 ID 查询最多 2 行，只在恰好一条时返回。独立构造两个相同前缀 UUID：统一回复 `未找到该条目。`，refetch=0、processing request=0，不泄露歧义信息。
- 提问先执行 DB-only readiness；rebuild 未 ready 时 retrieve/answer=0。命中调用共享 retrieve+answer，来源由服务端 hits 拼装且最多 10 条；无命中固定回复 `收藏库中没有相关内容。`，answer/LLM=0。
- 独立私有无命中探针与原生有命中测试均确认 `ask_counters` 始终为空，Telegram 不调用公开限流。

### 密钥、日志与依赖

- Bot Token 仅在 `startTelegramBot` 服务端通过 `getDecryptedSecret("telegramToken")` 解密后传给 grammY；设置 DTO 只返回 masked 字段。Telegram 新增代码没有 logger/console 调用，不记录 question、chat ID、Token 或上游文本。
- 测试全部使用依赖注入的 send/retrieve/answer/transport mock，没有连接真实 Telegram 网络。
- `grammy@1.38.3` 本机包元数据许可证为 MIT；`pnpm audit --prod` 无已知漏洞。

## 全量门禁

- `pnpm install --frozen-lockfile`：退出 0。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- `pnpm test`：36/36 files、228/228 tests 通过，退出 0。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- 独立 `pnpm build`：Next.js 15.5.23 production build 退出 0。
- `pnpm e2e`：真实 `next build + next start`，desktop/mobile 10/10 通过。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `git diff --check`：退出 0。

## 操作边界

临时验收探针已删除；未修改产品代码，未自行放行 T22。工作树中既有截图与前序验收文件未回退。

---

## R12 复验（2026-08-09）

- 返工提交：`7e0e61f`
- 复验结论：**通过（R12 闭环）**

### 独立 dispatcher 探针

提交将截断规则改为在第一组连续句末标点 `[。！？!?.…]+` 处结束并保留整组，且先 trim；空值或纯空白使用固定占位。

独立真实 PostgreSQL + dispatcher 探针对每个 summary 写入 item/ready receipt 并捕获 transport 文本，共 9/9 tests 通过：

- `第一句介绍主题。第二句补充细节。第三句结束。` → `第一句介绍主题。`
- `Foo. Bar.` → `Foo.`
- 无句末标点 → 保留完整文本。
- `null`、纯空白 → `内容已完成处理。`
- `第一句……第二句！？第三句。` → `第一句……`
- `Wait... Next.` → `Wait...`
- `真的吗？！后面还有内容。` → `真的吗？！`
- 混合连续标点 `结束！？!...后续` → 完整保留第一组 `结束！？!...`，不截半。

### 无回归门禁

- 提交只修改 `firstSentence`、receipt 回归测试及进度证据；dispatcher claim/lease/429/AR-001、白名单与私有问答产品路径未改动。
- `pnpm install --frozen-lockfile`：退出 0。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- `pnpm test`：36/36 files、233/233 tests 通过，退出 0；dispatcher 并发领取、lease 恢复、429 退避、ready+null outcome、duplicatePossible、白名单、命令与问答套件均通过。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- 独立 `pnpm build`：Next.js 15.5.23 production build 退出 0。
- `pnpm e2e`：真实 `next build + next start`，desktop/mobile 10/10 通过。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `git diff --check`：退出 0。

本次只更新验收事实源，未修改产品代码；临时探针已删除，验收员未自行放行 T22。
