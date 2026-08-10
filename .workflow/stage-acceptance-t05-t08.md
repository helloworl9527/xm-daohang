# 阶段验收 02：T05-T08 认证与配置组

- 日期：2026-08-09（Asia/Shanghai）
- 验收提交：`ca398ff`、`fb29dce`、`c7bbbbc`、`1e0167e`
- 基准：`implementation-plan.md` rev5
- 结论：初验**退回**；`3db0197` 返工后于 2026-08-09 **复验通过**。T09 放行由架构师决定。

## 正向复跑证据

1. 环境：PostgreSQL 16.14 + pgvector 0.8.6；删除 `public`/`drizzle` schema 后运行 `pnpm db:migrate`，退出 0。
2. `pnpm test`：退出 0，15 files / 77 tests 全部通过；T05/T06 的密码、会话、锁定、HMAC IP、页面/API guard 与 T07/T08 配置测试均真实连接测试库。
3. `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod`、workflow validator 均退出 0；生产审计无已知漏洞。
4. 新依赖许可：argon2/zod 为 MIT，openai/@playwright/test 为 Apache-2.0。
5. `pnpm e2e`：退出 0，执行真实 `next build + next start`；Chromium desktop 1440x1000 与 mobile 390 两项目均通过（2 passed，22.6s）。人工复核两张模型设置截图，未见遮挡、裁切或明文 Key；桌面截图因本次新鲜复跑产生 6 字节二进制差异。
6. T05/T06 反向核验：错误凭证写 64 字符 HMAC 而非明文 IP，5 次失败后正确密码仍被锁定；idle/absolute 任一到期拒绝且滑动不越 absolute；匿名 `/admin`、`/admin/settings/models` 均 307 到登录页，模型 GET/PUT/POST API 均 401。实际浏览器登录后的 `admin_session` 为 `HttpOnly=true; Secure=true; SameSite=Lax; Path=/admin`。
7. T07 反向核验：错误 AES key、GCM tag 篡改、畸形/非法 base64 密文分别返回 `SECRET_DECRYPT_FAILED`/`SECRET_FORMAT_INVALID`；数据库 tag 篡改后 `getSettings()` 拒绝。E2E 保存列为 `v1.*` 密文，明文 Key 搜索位置为 0；DTO/页面只出现掩码。省略 Key 更新时旧 Key 保留。
8. T08 反向核验：E2E live probe 实测并持久化 8 维，集成探针实测 1024 维；失败嵌入 probe 后旧配置整行、版本、阈值和旧 Key 保持不变。相同 identity 不增版，identity 变化单次增版并覆盖 completed 条目生成重建请求。两个写端点的错误 Origin、缺失/错误 CSRF、错误 Content-Type 均分别以 403/415 拒绝且配置零写入。CSP 使用逐请求 nonce，响应不含 `unsafe-inline`。

## 返工项

### R1：模型供应商回显草稿 API Key 时会进入日志

- rev5 依据：`implementation-plan.md:339` 要求“测试草稿 secret 只活在本次请求内且不记录日志”。
- 代码路径：`src/app/admin/api/settings/models/route.ts:45` 与 `.../test/route.ts:36` 将上游异常整体交给 logger；`src/lib/log/logger.ts:48` 保留 Error.message。R1 旧修复只清理 URL userinfo/query，不能识别错误正文中的草稿 Key。
- 独立恶意供应商探针：本机 HTTP 服务返回 OpenAI 兼容 401 JSON，`error.message` 为 `invalid credential sk-DRAFT-MUST-NOT-LOG-9876`；真实 openai SDK 产生错误后按当前 logger 序列化。
- 实际输出：

  ```json
  {"error":{"name":"Error","message":"401 invalid credential sk-DRAFT-MUST-NOT-LOG-9876"}}
  ```

  探针因发现 Key 退出 `42`，证明门禁 fail-open。
- 期望：模型 test/save 路由记录稳定、非敏感的错误分类/状态，不记录不可信上游 message/body/cause；或在日志调用处显式按本次草稿 secret 做可靠清洗。为两个路由增加恶意供应商回显 Key 的回归测试，证明 stdout/logger 及响应均无草稿 Key，同时仍返回统一 502 且不覆盖旧配置。

## 复验要求

修复后重跑恶意供应商日志探针、两条模型路由测试，以及全量 `pnpm test/typecheck/lint/audit --prod/e2e` 和 workflow validator。T09 仍由架构师另行放行。

---

## 2026-08-09 R3 返工复验（提交 3db0197）

- 结论：**通过**。R3 已关闭；本结论不直接放行 T09。
- 真实恶意上游：生产构建连接本机 OpenAI 兼容服务，服务以 401 回显 `sk-DRAFT-MUST-NOT-LOG-9876`。test/save 两个真实 HTTP 路由均返回统一 502，响应体无 Key/`invalid credential`，`app_settings` 行 MD5 前后相同。
- 真实生产日志各一条：

  ```json
  {"level":"error","event":"model_probe_failed","which":"llm","category":"upstream","httpStatus":401}
  ```

  程序化断言键集合仅为 `level/event/which/category/httpStatus`，无 Key、message、body、cause、stack 或其它上游文本。
- `getSafeHttpStatus` 独立边界：401/599 保留；99/600/NaN/字符串 status/无 status/null 均返回 undefined，不把非法或文本状态带入日志。
- 全源码扫描：产品 logger 调用仅剩两个模型路由，均只传固定事件、`llm|emb`、固定 category 和安全数值 status；未发现其它直接记录上游 Error/message/body/cause/stack 的产品路径。
- 无回归：干净 PG16.14 + pgvector 0.8.6 `pnpm db:migrate` 退出 0；`pnpm test` 为 15 files / 79 tests；typecheck、lint、`audit --prod`、workflow validator 均退出 0。
- 生产 E2E：重新执行 `next build + next start`，Chromium desktop 1440x1000 与 mobile 390 共 2 项通过（22.1s）；R3 无 UI 改动。
