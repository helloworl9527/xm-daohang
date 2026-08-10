# 阶段验收⑤：T17–T19

- 日期：2026-08-09
- 基准：`.workflow/implementation-plan.md` rev5、`.workflow/ui-spec.md`、已批准 DEV-002
- 提交：`fbd4c29`、`bdc15aa`、`a7d8401`、`fc12606`、`9b754b0`、`3d1d64c`、`8beb5ec`
- 结论：**退回**

## 阻断返工项

### R11：公开提问每日限流按 UTC 日计数，违反 APP_TIMEZONE 业务日不变量

rev5 C 节明确规定“限流/每日展示的业务日由显式 `APP_TIMEZONE=Asia/Shanghai` 计算”，`.env.example` 也声明业务日期与每日限额使用该 IANA 时区。但 `src/lib/ratelimit/publicAsk.ts:68-69` 的 `dayString` 直接执行 `now.toISOString().slice(0, 10)`，全仓产品源码没有读取 `APP_TIMEZONE`。

独立真实数据库反向探针设置 `APP_TIMEZONE=Asia/Shanghai`，在 `2026-08-09T16:30:00.000Z` 调用 `consumePublicAsk`；此时上海本地时间已是 2026-08-10 00:30。期望两个 counter 都归属 `2026-08-10`，实际均写入 `2026-08-09`：

```text
expected Set { "2026-08-10" }
received Set { "2026-08-09" }
Test Files 1 failed (1), Tests 1 failed (1), exit 1
```

运行时交叉验证同一时刻：`utc='2026-08-09'`、`Asia/Shanghai='2026-08-10'`。实际效果是默认部署的每日额度在上海时间 08:00 才换日，而不是本地零点；IP HMAC scope 也在错误日期边界轮换。

期望结果：使用经校验的 `APP_TIMEZONE` 计算业务日，并增加本地零点前后、UTC 跨日但本地未跨日、无效/缺失时区配置的 fail-closed 回归测试；`ask_counters.day` 与 IP HMAC 的 day 输入必须使用同一个业务日值。

## 已通过证据

### T17 检索与每日轮换

- 源码核验：检索 SQL 仅扫描 `completed`、非空 embedding、当前 `embedding_version`/`embedding_dim`，在 SQL 中应用实时 cosine cutoff，按 `score desc,id` 排序并 `limit 10`；rebuild/settings 未就绪时在 embedding 前 fail closed。
- 独立 cutoff 探针：正交无关向量在 cutoff 0.8 下返回空 hits，公开 handler 返回固定文案“收藏库中没有相关内容”，embedding 调用 1 次、LLM 调用 0 次。
- `pickDaily` 在按 day 的 advisory transaction lock 内持久化；原生集成测试确认并发首访同组同序、同日稳定、跨日优先未展示、少于 3 条返回实际数量、删除后补位。

### T18 与 DEV-002

- 独立安全探针 8/8 通过：环境共享密钥缺失、请求密钥缺失/错误、仅伪造 XFF、仅伪造 X-Real-IP、多值 X-Real-IP 均返回 403；每例 `ask_counters` 为空，embedding/retrieve 与 LLM 均为 0 次。
- `PROXY_SHARED_SECRET` 至少 32 字节才可用；匹配通过 `timingSafeEqual`，只接受单值、无首尾空白且可规范化的 `X-Real-Client-IP`。原始 IP 不入库，scope 使用独立 `IP_HASH_KEY` 的 HMAC。
- readiness 在可信 IP 与扣费前执行；限流事务锁 settings 并复核同一 readiness，之后按 global→IP 固定顺序锁行。独立 12 路同 IP 并发仅 3 次成功、9 次 429，global/IP 两个计数均为 3，模型各调用 3 次。
- 原生测试进一步覆盖不同 IP 的全站并发阈值、配置竞态、计数存储故障、阈值即时生效、输入 501 拒绝。无命中不调用 LLM；答案 schema 严格校验中文回答与命中 ID 白名单，来源 DTO 由服务端 hits 拼装。

### T19 与依赖

- cookie 是 SSR canonical locale；客户端 effect 只把当前 cookie locale 镜像到 localStorage。E2E 人为把 localStorage 改为 zh 后刷新，页面仍保持 cookie 的 en，并把 localStorage 修正回 en。
- `mergeWithChineseFallback` 递归合并缺失键；集成测试确认缺失/非法 locale 回退中文，TSX 静态扫描无未登记中文 UI 字面量。
- 人工核验 `.workflow/screenshots/t19-i18n-en-desktop.png` 与 `t19-i18n-en-mobile.png`：英文界面无重叠或横向溢出；条目标题、标签和 AI 总结仍为中文。
- `next-intl@4.13.5` 本机包元数据许可证为 MIT；`pnpm audit --prod` 无已知漏洞。

## 全量门禁

- `pnpm install --frozen-lockfile`：退出 0，`Already up to date`。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- 同一数据库执行 `pnpm test`：32/32 files、202/202 tests 通过，退出 0。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- 独立 `pnpm build`：Next.js 15.5.23 production build 退出 0。
- `pnpm e2e`：真实 `next build + next start`，desktop/mobile 共 10/10 通过，退出 0。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `git diff --check`：退出 0。

## 操作边界

两个临时验收探针均已删除；未修改产品代码，未自行放行 T20。工作树中既有截图和前序验收文件未回退。

---

## R11 复验（2026-08-09）

- 返工提交：`6d8de26`
- 复验结论：**退回（R11 主路径已修复，但限流关闭分支仍 fail open）**

### 已修复证据

独立真实数据库探针确认以下行为正确：

- `businessDay` 在 `APP_TIMEZONE=Asia/Shanghai` 下把 `2026-08-09T16:30:00Z` 计算为 `2026-08-10`。
- `consumePublicAsk` 写入的两个 `ask_counters.day` 均为 `2026-08-10`；IP scope 精确等于 `HMAC(IP_HASH_KEY, "2026-08-10\\0" + ip)`，不等于使用 UTC 日 `2026-08-09` 计算的 scope。
- 同一时刻调用 `pickDailyForNow`，`daily_selections.day` 为 `2026-08-10`，与限流完全一致。
- 上海零点前 `15:59:59.999Z` 归 08-09、零点 `16:00:00Z` 进位至 08-10；UTC 零点前后 `23:59:59.999Z` / `00:00:00Z` 均保持上海业务日 08-10，不误换日。
- 限流启用时，缺失或非法 `APP_TIMEZONE` 使 `consumePublicAsk` 抛出 `MODEL_UNAVAILABLE` 并回滚，counter 为 0；`pickDailyForNow` 抛出 `APP_TIMEZONE_INVALID`，daily selection 为 0。

### 仍需返工：限流关闭时绕过时区校验

`src/lib/ratelimit/publicAsk.ts:82-88` 在锁定并检查 settings 后，先判断 `!settings.ratelimit_enabled` 并直接 commit/返回 `{allowed:true}`；`businessDay(now)` 位于该早退之后。因此缺失/非法 `APP_TIMEZONE` 在限流关闭分支没有被校验。

独立反向探针分别使用缺失和 `Not/A-Timezone`，并设置 `ratelimit_enabled=false`：

```text
期望：consumePublicAsk rejects { code: "MODEL_UNAVAILABLE" }
实际：resolves { allowed: true }
```

进一步从真实公开 handler 入口探测：有效代理共享密钥、有效 IP、ready 模型配置、关闭限流、缺失 `APP_TIMEZONE`。期望 503 且 retrieve/LLM 均为 0；实际响应 200，并进入 retrieve。定向探针 7 tests 中 4 通过、3 失败，退出 1。

这违反本次明确验收标准“缺失/非法 APP_TIMEZONE → APP_TIMEZONE_INVALID、限流事务回滚、对外 MODEL_UNAVAILABLE、零计数零写入（fail-closed）”。虽然 counter 仍为 0，但请求被错误放行到检索阶段。

期望结果：无论 `ratelimit_enabled` 为 true 或 false，均在任何 allow/commit 早退之前严格计算并校验业务日；补充关闭限流下缺失/非法时区的 service 与公开 handler 回归断言，确认 503 且 embedding/retrieve/LLM 为 0。

### 无回归门禁

- `pnpm install --frozen-lockfile`：退出 0。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- `pnpm test`：33/33 files、210/210 tests 通过，退出 0。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod`：均退出 0；audit 无已知漏洞。
- 独立 `pnpm build`：退出 0。
- 生产 `pnpm e2e`：真实 `next build + next start`，desktop/mobile 10/10 通过。
- workflow validator：`PASS: workflow stage=implementation revision=5`。
- DEV-002、cutoff 空命中、双限流并发与 i18n 的原生测试/E2E 均保持通过；提交仅触及业务日、daily/ratelimit 调用与测试。

临时复验探针已删除；未修改产品代码，未自行放行 T20。

---

## R11b 三复（2026-08-09）

- 返工提交：`fdb8762`
- 复验结论：**通过（R11/R11b 全部闭环）**

### 独立反向证据

- 提交范围为 `src/lib/ratelimit/publicAsk.ts` 一行顺序调整及对应集成测试；`businessDay(now)` 已在 `ratelimit_enabled=false` 的 commit/return 之前执行。
- 临时真实数据库探针覆盖 disabled + 缺失时区、disabled + 非法时区：两例 `consumePublicAsk` 均拒绝并转换为 `MODEL_UNAVAILABLE`；公开 handler 均返回 503，retrieve/answer 调用均为 0。
- 每例调用前后完整比较 `app_settings`、`ask_counters`、`items`、`daily_selections` 快照，完全一致，确认 counter=0 且无隐性写入。
- disabled + `APP_TIMEZONE=Asia/Shanghai` 正常返回 `{allowed:true}`，完整数据库快照不变，counter=0。
- enabled + 合法时区仍将 `2026-08-09T16:30Z` 同时写入 `ask_counters.day=2026-08-10` 与 `daily_selections.day=2026-08-10`；enabled + 缺失/非法时区继续 `MODEL_UNAVAILABLE`、counter=0。
- 临时定向探针 6/6 tests 通过、退出 0，完成后已删除。

### 全量无回归

- `pnpm install --frozen-lockfile`：退出 0。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- `pnpm test`：33/33 files、213/213 tests 通过，退出 0；DEV-002、cutoff 空命中、双限流并发、业务日与 i18n 套件均通过。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- 独立 `pnpm build`：Next.js 15.5.23 production build 退出 0。
- `pnpm e2e`：真实 `next build + next start`，desktop/mobile 10/10 通过。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `git diff --check`：退出 0。

本次只更新验收事实源，未修改产品代码；阶段放行由架构师执行，验收员未自行放行 T20。
