# 阶段验收④：T14–T16

- 日期：2026-08-09
- 基准：`.workflow/implementation-plan.md` rev5、`.workflow/ui-spec.md` §6.2/§6.3/§9
- 提交：`4e59bef`、`324593e`、`9ccab34`
- 结论：**退回**

## 阻断返工项

### R6：错误 Content-Type 可通过统一写门禁并执行删除

`src/lib/auth/guard.ts:78` 使用 `startsWith("application/json")`，会把 `application/jsonp` 等非 JSON 媒体类型判为合法。独立反向探针使用有效 session、CSRF、HTTPS Origin，对 DELETE 发送 `Content-Type: application/jsonp`：期望 415 且 item 保留；实际返回 204，item 数从 1 变为 0。

期望结果：按解析后的 media type 精确接受 `application/json`（允许合法参数如 charset），其它值一律在业务调用前拒绝；为 destructive route 增加不写库回归断言。

### R7：错误 scheme Origin 可通过严格 Origin 门禁并执行删除

`src/lib/auth/guard.ts:69` 只比较 `new URL(origin).host` 与 Host，没有比较 scheme/完整 origin。独立反向探针的请求目标为 `https://admin.example`，Origin 为 `http://admin.example`，其余 session/CSRF/Content-Type 均合法：期望 403 且 item 保留；实际返回 204，item 数从 1 变为 0。

期望结果：严格校验可信完整 origin（scheme + host + port），错误 origin 在任何业务写入前 fail closed；增加同 host 不同 scheme 的回归测试。

### R8：refetch 未解析/校验 JSON，畸形请求实际入队

rev5 D.1 要求写 route 依次通过 Content-Type、Zod schema 后才检查状态/写库。`src/app/admin/api/items/[id]/refetch/route.ts:11-18` 完全不读取 request body。独立反向探针以 `application/json` 发送正文 `not-json`：期望 400、item 保持 failed、request=0；实际返回 202、item 变 processing、processing request=1。

期望结果：refetch 对空对象合同执行 JSON 解析和 strict Zod 校验，畸形 JSON、数组、额外字段均拒绝且不递增 generation/不入队。DELETE 如保留 JSON body 合同，也应采用同一规则。

### R9：T15 集合 GET 路径偏离 rev5 合同

rev5 T15 明确定义 `GET /admin/api/items?q&tag&status&cursor`，D.1 规定路由唯一命名。当前集合 GET 位于 `src/app/admin/api/items/list/route.ts`，前端和测试均调用 `/admin/api/items/list`；`src/app/admin/api/items/route.ts` 只导出 POST。独立合同探针确认该模块不存在 GET 导出。

期望结果：集合读取落在 `GET /admin/api/items`，移除含糊的 `/list` 别名并同步前端/测试，保持 POST 同文件不同 method。

### R10：收藏库加载态不是 ui-spec 要求的列表骨架

ui-spec §6.3 明确“加载：列表骨架”。`src/app/admin/(protected)/library/LibraryView.tsx:100-102` 仅渲染一个“正在读取收藏库…”文本面板，`src/app/globals.css:290` 也只是普通状态块，没有列表骨架结构。

期望结果：加载态提供与列表行稳定尺寸对应的可访问骨架，同时保留 `role=status`/可读加载文案，避免加载完成时布局突变。

## 已通过证据

- 环境：本机 PostgreSQL 16.14、pgvector 0.8.6。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- 同一数据库执行 `pnpm test`：27 files / 153 tests 全通过，退出 0。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod`：均退出 0；audit 输出 `No known vulnerabilities found`。
- `pnpm e2e`：真实 `next build + next start`，desktop 1440x1000 / mobile 390 共 8/8 通过，退出 0；截图人工核验未见溢出或重叠，详情桌面双列、移动单列，筛选与操作在移动端完整可用。
- workflow validator：`PASS: workflow stage=implementation revision=5`。
- 现有反向门禁确认匿名、明显跨站 Origin、错误 CSRF、`text/plain`、PATCH 额外字段、缺 ETag 均拒绝；所有动态成功/错误响应代码路径设置 no-store。R6–R8 是现有用例未覆盖的 fail-open 边界。
- T14 新链接规范化后以 processing 入库并原子写 request；规范化重复不新建/不重复入队；非法/私网 URL 400；缺模型配置 409 且 UI 禁用并引导设置。
- T15 业务实现支持关键词、重复多标签、状态组合过滤和 `(updated_at,id)` 稳定游标；DTO 显式列白名单，测试确认不含 embedding、processGeneration、contentHash、urlCanonical、secret/stack。
- T16 PATCH 只接受 summary、置 `summary_manual=true`、ETag 冲突 409；DELETE 的 FK cascade 清除 item/向量所在行、daily selection、processing request、TG receipt；refetch 复用 T12 且 processing 重复调用 409。
- 详情 UI 的读取错误/重试、失败保存保留草稿、processing 禁用、`aria-live`、原生 dialog 二次确认、取消后焦点返回均由单测/e2e 和截图核验通过。新增产品代码没有 logger 调用，错误只返回稳定文案/错误码。

## 操作边界

临时反向测试文件已删除；未修改产品代码，未自行放行 T17。工作树中既有截图与前序验收文件未回退。

---

## R6–R10 复验（2026-08-09）

- 返工提交：`d3e1f25`、`958afb6`、`ce3b0b7`、`d9b256d`、`bd58faf`、`3ae7648`
- 复验结论：**退回（R6 仍有 fail-open；R7–R10 通过）**

### 仍需返工：R6 非法 Content-Type 参数被容错接受

独立数据库反向探针覆盖全部 6 个 `requireAdminWrite` handler，并对 DELETE 做持久化断言。`application/jsonp`、`text/plain`、缺少 Content-Type 均返回 415，`application/json;charset=utf-8` 合法通过；但以下非法参数用例仍绕过门禁：

```text
Content-Type: application/json; charset
期望：status=415, remaining=1
实际：status=204, remaining=0
```

探针共 22 项，21 通过、1 失败，退出 1。该请求真实删除了条目，不是仅状态码偏差。根因位于 `src/lib/auth/guard.ts:87-90`：Node `MIMEType` 会容错忽略无 `=value` 的裸参数，解析结果为 `essence=application/json`、空参数集合；实现只比较 `essence`，因而 fail open。独立运行时复核：

```text
{"input":"application/json; charset","essence":"application/json","params":[]}
{"input":"application/json; charset=utf-8","essence":"application/json","params":[["charset","utf-8"]]}
{"input":"application/jsonp","essence":"application/jsonp","params":[]}
```

期望结果：严格拒绝语法非法或被解析器丢弃的媒体类型参数；所有写路由必须在业务处理前返回 415。补充回归断言，至少证明 destructive route 的条目仍存在，并覆盖统一门禁的全部写 handler。

### 已闭环项

- **R7 通过**：HTTPS 目标下 HTTP Origin、跨端口、跨 host、缺失和畸形 Origin 均返回 403 且零写入；合法同源 DELETE 返回 204。`requireAdminWrite` 现同时检查协议、host/port、userinfo、path、query 和 fragment。
- **R8 通过**：refetch 与 DELETE 对畸形 JSON、`null`、数组和额外字段均返回 400；item 状态、`process_generation` 和 `processing_requests` 零变化，空对象合同使用 strict schema。
- **R9 通过**：`src/app/admin/api/items/route.ts` 同模块导出 GET/POST；活动源码与测试中的 `/admin/api/items/list` 路由引用为 0，旧 route 已删除。`src/lib/items/list` 等命中只是内部模块名，不是 API 别名。
- **R10 通过**：重新人工核验 `t15-admin-library-loading-desktop.png` 与 `t15-admin-library-loading-mobile.png`。加载态有 3 行与真实列表信息轨一致的稳定骨架；桌面双列、390px 移动端单列，无重叠或明显布局跳动。

### 无回归证据

- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0，迁移成功。
- 同一数据库执行 `pnpm test`：27/27 files、161/161 tests 通过，退出 0。
- `pnpm typecheck`、`pnpm lint`：均退出 0。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm e2e`：真实执行 `next build + next start`，desktop/mobile 共 8/8 通过，退出 0。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `git diff --check`：退出 0。临时验收探针已删除；未修改产品代码，未自行放行 T17。

---

## R6 三复（2026-08-09）

- 返工提交：`0068b51`
- 复验结论：**通过（R6–R10 全部闭环）**

### R6 独立反向探针

临时验收测试对 6 个 `requireAdminWrite` handler 执行 6×6 非法 Content-Type 矩阵：POST item、PATCH item、DELETE item、POST refetch、PUT models、POST models/test。下列输入在每个 handler 上均返回 415：

```text
application/json; charset
application/json; charset=
application/json; foo=bar
application/json; charset=utf-8; x=1
application/json;; charset=utf-8
Application/JSON; Charset
```

每一次调用后重新读取并比较完整 `items`、`processing_requests`（处理 outbox）与 `app_settings` 快照，均无变化；seed item 的 `process_generation=4` 保持不变。合法 `application/json`、`application/json; charset=utf-8`、`Application/JSON; Charset=UTF-8` 均穿过统一门禁。探针共 9 tests 全通过，退出 0；完成后临时测试文件已删除。

该探针完成了反向门禁证明：非法语法不仅获得 415，还在所有统一写入口业务执行前 fail closed；合法 media type 与单一 UTF-8 charset 不被误拒。

### R7–R10 与全量门禁

- `git diff 3ae7648..0068b51 --name-status` 仅包含 `src/lib/auth/guard.ts` 与 `tests/integration/itemDetail.test.ts`，R7–R10 产品实现未改动。
- 全仓搜索确认 6 个写 handler 继续统一调用 `requireAdminWrite`；活动源码/测试中 `/admin/api/items/list` 路由引用仍为 0。
- 全量测试中的 Origin 完整匹配、strict 空对象正文、generation/outbox 零变化、同模块 GET/POST、列表骨架组件与 E2E 继续通过。
- `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`：退出 0。
- `pnpm test`：27/27 files、162/162 tests 通过，退出 0。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- `pnpm e2e`：真实执行 `next build + next start`，desktop/mobile 共 8/8 通过，退出 0。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。

## 最终操作边界

本次只修改验收事实源，未修改产品代码。临时探针已删除；阶段放行由架构师执行，验收员未自行放行 T17。
