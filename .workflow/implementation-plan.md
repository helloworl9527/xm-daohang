# 收藏系统 Implementation Plan（实施计划 · Codex 修订 rev5）

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 按任务逐条实施。步骤用 `- [ ]` 复选框跟踪。
> **状态**：codex_review 修订稿。事实源：`.workflow/requirements.md`(v0.4 已确认) 与 `.workflow/ui-spec.md`(v0.4 已确认)。本计划不得开始正式产品实现。

**Goal:** 交付一个"公开展示端 + 登录管理端"的单管理员内容收藏与 AI 语义检索系统（Next.js 全栈 + 后台 worker + PostgreSQL/pgvector），支持网页/GitHub 抓取总结、语义 RAG 问答、公开限流、每日 3 条轮换与 Telegram bot。

**Architecture:** 同一 Next.js(App Router) 应用分 `/`(公开、无登录) 与 `/admin`(用户名+密码会话)；异步抓取/嵌入/定时重抓/Telegram bot 运行在独立 Node worker 进程，二者共享同一 PostgreSQL+pgvector；任务队列与定时用 pg-boss(基于 Postgres，免 Redis)；跨进程 TG 回执走数据库 outbox；LLM 与 Embedding 各自独立的 OpenAI 兼容客户端。几百条规模的向量查询使用带维度/版本过滤的精确扫描，先保证召回质量，不建 ANN 索引。

**Tech Stack:** Next.js 15 (App Router, TS, React 19)、PostgreSQL 16 + pgvector、Drizzle ORM + drizzle-kit、pg-boss(队列/cron)、grammY(Telegram)、openai SDK(可配置 baseURL)、undici(受控 HTTP 连接)、@mozilla/readability + jsdom(HTML)、pdfjs-dist(PDF)、argon2(密码哈希)、next-intl(i18n)、Zod(边界校验)、Vitest(单测/集成)、Playwright(e2e)、Docker Compose(app+worker+postgres+caddy)、Caddy(HTTPS 反代)。依赖写入 lockfile，实施/交付门禁包含 `pnpm audit --prod`；高危漏洞无法升级或缓解时停止交付并记录风险。

## Global Constraints
- 仅单管理员账号；公开端匿名只读 + 公开提问（不做注册/多用户）。
- 管理端登录 = 用户名 + 密码（**不启用 2FA/恢复码**）+ 登录失败限流 + 会话超时；`/admin` 全部页面与写接口服务端强制鉴权。
- 抓取仅公开内容（普通网页/文档 + GitHub 公开仓库）；抓取设超时/大小上限 + SSRF 防护（禁止内网/回环/链路本地地址）。
- LLM 与 Embedding **分别独立配置**（baseURL + API Key + 模型名），OpenAI 兼容；API Key 加密存储、不回显明文、日志脱敏。
- AI 总结固定中文，约 2–4 句；标签 3–5 个。检索严格限库内"完成"条目；无命中必须回答"收藏库中没有相关内容"，**不得引入库外知识/不得编造**。
- 公开提问限流双重叠加：单 IP 每日 + 全站每日，默认 `20 / 200`（管理端可改）；超限**不调用模型**；Telegram 白名单提问不受此限。
- 公开端每日展示随机 3 条"完成"条目，按"天"稳定，靠去重轮换尽量不重复（库存不足才重复）。
- 6 个核心色值固定：雾白 `#F5F7F4`、纯白 `#FFFFFF`、墨黑 `#17211D`、检索绿 `#087F6C`、来源蓝 `#265FAF`、信号珊瑚 `#D15A3C`。
- 公开提问输入栏必须撑满提问表单左列（`input.width==label.width`、`input.height==form.height`，右不越过提问按钮），桌面/移动一致（ui-spec §5.2）。
- 无障碍以 WCAG 2.1 AA 为参考目标（键盘可达、`:focus-visible`、44×44 触控、`aria-live` 异步反馈、纯图标按钮 `aria-label`）。
- 敏感值（密码、API Key、Token）绝不写入日志或前端持久缓存；问题原文与访客 IP 最小化留存。
- 所有外部抓取只能经过 `safeFetch`；所有管理页面/API 鉴权、CSRF、输入校验、公开限流与安全门禁均 fail closed：依赖异常或身份/IP 无法可信确定时不得继续敏感操作或调用模型。
- 外部网页正文、公开问题和模型输出均视为不可信数据；模型只生成受 schema 校验的归纳与已给定 hit ID，来源标题/链接由服务端数据库结果拼装。

## 实施级技术选择与停止条件

| 选择 | 替代项与理由 | 后果 / 失效条件 |
| --- | --- | --- |
| PostgreSQL + pgvector 精确余弦扫描 | ivfflat 在几百条且 `lists=100` 时召回不稳定；HNSW 此规模收益不足 | 以正/负语料记录 recall@10 与 P95；当完成向量达到 10,000 或精确查询 P95≥1s，再以同一基准评估 HNSW，未证明召回不下降不得切换 |
| pg-boss + DB outbox | Redis 队列增加部署组件；仅靠进程内回调会丢 TG 回执 | pg-boss API/版本的 singleton/retry 语义必须由集成测试确认；若无法满足持久化、重启恢复与幂等，停止并重新选队列 |
| Telegram long polling | webhook 需额外公网回调与 secret 验证 | 单 worker 持有 bot polling；多副本部署前必须改为 leader election 或 webhook，否则停止扩容 |
| OpenAI 兼容双客户端 | 厂商专用 SDK 会锁定供应商 | 保存 embedding 配置前必须实调探测维度；供应商不兼容标准 embeddings/chat 契约时明确报错，不猜测维度或静默降级 |
| HTML/text/PDF 轻量抓取 | 无头浏览器明确不在 v1；自写 PDF 解析风险高 | 未知 MIME、加密/超限 PDF、重 JS 页面进入失败+手动兜底，不扩张为通用文件解析器 |

`decisions.md` D-02～D-04 已在 Cycle 4 按本表既有结论同步为“已定稿”；只消除文档状态不一致，不改变用户已确认的产品行为、UI 或数据暴露边界。

---

## A. 需求追踪矩阵（Requirement → Task → 验证）

| 需求 | 说明 | 实现任务 | 主要验证 |
| --- | --- | --- | --- |
| F-01 | 管理端添加内容 | T14 | 集成测试：新链接入库"处理中"；重复去重；未登录 401 |
| F-02 | TG 添加内容 | T11,T20,T21 | 集成测试：白名单收链接→处理中→完成回执；重复/重试；非白名单不响应 |
| F-03 | 抓取+总结+嵌入管线 | T09,T10,T11,T12 | 单测：正文提取/GitHub 元信息/总结约束/嵌入；重试 3 次；指纹不变不更新 |
| F-04 | 管理端库管理 | T15,T16 | e2e：筛选/编辑总结(人工标记)/删除(连带向量)/手动重抓 |
| F-05 | 定时重抓 | T13 | 集成测试：cron 到期触发；内容变→更新；关→不触发 |
| F-06 | 公开提问检索 | T17,T18 | e2e：语义关联命中；无结果文案；超限不调用模型 |
| F-07 | TG 提问检索 | T21 | 集成测试：白名单问答；无命中文案；不受公开限流 |
| F-08 | 模型双配置 | T07,T08,T11 | 单测：独立客户端；Key 掩码；实测维度/质量门禁；版本化重建 |
| F-09 | 管理端认证与安全 | T05,T06,T24 | 集成测试：登录/锁定；双会话超时；守卫；改密撤销旧会话 |
| F-10 | 国际化中/英 | T19,T23,T24 | e2e：两端全部状态文案切换持久化；回退中文；AI 内容仍中文 |
| F-11 | 每日 3 条轮换 | T17,T23 | 单测：同日稳定；跨日去重轮换；<3 条；空库 UI 禁用提问 |
| F-12 | 公开提问限流 | T18 | 单测：单 IP 超限拒绝；全站超限拒绝；阈值改即时生效 |
| NFR-性能 | 见 requirements §2.13 | T04,T17,T18,T25 | 固定规模 DB/接口/端到端分位数证据 |
| NFR-安全 | HTTPS/SSRF/脱敏/CSRF | T01,T02,T05,T06,T09,T18,T25 | 日志、SSRF、鉴权/CSRF、限流并发、代理边界测试 |
| NFR-可观测 | 日志/指标 | T22 | 结构化日志字段与脱敏断言 |

## B. 文件结构地图（职责边界）

```text
收藏系统/
├─ docker-compose.yml            # app + worker + postgres(pgvector) + caddy
├─ Caddyfile                     # HTTPS 反代到 Next app
├─ .env.example                  # 环境变量名（不含真值）
├─ drizzle.config.ts
├─ package.json / tsconfig.json / next.config.ts
├─ src/
│  ├─ db/
│  │  ├─ schema.ts               # Drizzle 表定义（含 vector 列）
│  │  ├─ client.ts               # pg 连接池 + drizzle 实例
│  │  └─ migrations/             # drizzle-kit 生成 + 手写 pgvector/索引
│  ├─ lib/
│  │  ├─ config/settings.ts      # 读写 settings（模型/定时/限流/TG/语言），Key 加密
│  │  ├─ crypto/secretbox.ts     # API Key/Token 对称加密(AES-256-GCM)
│  │  ├─ ai/llm.ts               # 对话模型 OpenAI 兼容客户端
│  │  ├─ ai/embedding.ts         # 嵌入模型 OpenAI 兼容客户端
│  │  ├─ ai/summarize.ts         # 抓取内容→中文一段话总结+标签（受约束）
│  │  ├─ ai/answer.ts            # RAG 归纳（严格库内、无则明说）
│  │  ├─ fetch/urlGuard.ts       # SSRF 防护 + URL 标准化
│  │  ├─ fetch/webExtract.ts     # 网页/文档正文提取
│  │  ├─ fetch/github.ts         # GitHub README+元信息
│  │  ├─ fetch/fingerprint.ts    # 内容指纹
│  │  ├─ search/retrieve.ts      # 向量检索 Top10（仅完成条目）
│  │  ├─ items/dedupe.ts         # 链接标准化去重
│  │  ├─ items/daily.ts          # 每日 3 条轮换选择
│  │  ├─ ratelimit/publicAsk.ts  # 单IP+全站每日限流
│  │  ├─ http/clientIp.ts        # Caddy 信任边界 + IP 规范化/HMAC
│  │  ├─ auth/password.ts        # argon2 哈希/校验
│  │  ├─ auth/session.ts         # 会话创建/校验/过期
│  │  ├─ auth/loginThrottle.ts   # 登录失败限流/锁定
│  │  ├─ auth/guard.ts           # /admin 服务端守卫
│  │  ├─ queue/boss.ts           # pg-boss 单例
│  │  ├─ log/logger.ts           # 结构化日志 + 脱敏
│  │  └─ i18n/                   # next-intl 配置与字典 zh/en
│  ├─ app/
│  │  ├─ (public)/page.tsx       # 公开首页（每日3条 + 底部提问框）
│  │  ├─ (public)/ask/route.ts   # 公开提问 API（限流→检索→归纳）
│  │  ├─ admin/login/            # 登录页 + action
│  │  ├─ admin/(protected)/      # 添加/库管理/详情/设置页面
│  │  ├─ admin/api/              # /admin/api 管理接口（鉴权+CSRF）
│  │  └─ layout 与 i18n provider
│  └─ worker/
│     ├─ index.ts                # worker 进程入口：注册队列 + cron + 启动 bot
│     ├─ queue/requestPublisher.ts# processing outbox→pg-boss
│     ├─ jobs/processItem.ts     # 抓取+总结+嵌入（重试）
│     ├─ jobs/scheduledRefetch.ts# 定时重抓
│     ├─ bot/telegram.ts         # grammY bot（添加/提问）
│     └─ bot/receiptDispatcher.ts# TG receipt outbox 发送
├─ scripts/reset-admin-password.ts# 仅主机/容器权限的管理员密码恢复
└─ tests/
   ├─ unit/ … 集成/e2e(Playwright)
```

## C. 数据模型与迁移

**Task T03/T04 落地。核心表：**

```sql
-- items：收藏条目
CREATE TABLE items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url            text NOT NULL,
  url_canonical  text NOT NULL UNIQUE,          -- 标准化后用于去重
  type           text NOT NULL,                 -- 'web' | 'doc' | 'github'
  title          text,
  summary        text,                          -- 中文一段话总结
  summary_manual boolean NOT NULL DEFAULT false,-- 人工编辑标记（定时重抓不覆盖）
  tags           text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'processing', -- processing|completed|failed
  fail_reason    text,
  source         text NOT NULL,                 -- 'admin' | 'telegram'
  content_hash   text,                          -- 内容指纹
  embedding      vector,                        -- 无 typmod；实际维度由下列字段约束
  embedding_dim  integer,
  embedding_version integer,
  process_generation integer NOT NULL DEFAULT 0,-- 防旧作业覆盖新结果
  last_shown_on  date,                          -- 每日轮换去重
  shown_count    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_status_idx ON items(status);
CREATE INDEX items_retrievable_idx ON items(status, embedding_version, embedding_dim)
  WHERE embedding IS NOT NULL;

-- app_settings：单行配置（id=1），敏感字段加密存储
CREATE TABLE app_settings (
  id                int PRIMARY KEY DEFAULT 1,
  llm_base_url      text, llm_model text, llm_key_enc text,
  emb_base_url      text, emb_model text, emb_key_enc text,
  emb_dim            int,                       -- 连通性测试实测值，不猜默认值
  emb_version        int NOT NULL DEFAULT 0,
  search_min_cosine  real,                      -- 当前模型校准值
  emb_rebuild_status text NOT NULL DEFAULT 'unconfigured', -- unconfigured|building|ready|failed
  refetch_enabled   boolean NOT NULL DEFAULT false,
  refetch_interval_days int NOT NULL DEFAULT 30,
  refetch_last_run  timestamptz,
  ratelimit_enabled boolean NOT NULL DEFAULT true,
  ratelimit_ip_daily int NOT NULL DEFAULT 20,
  ratelimit_global_daily int NOT NULL DEFAULT 200,
  tg_token_enc      text, tg_allowed_ids bigint[] NOT NULL DEFAULT '{}',
  github_backoff_until timestamptz,               -- worker 内部公开 API 限流门禁
  default_locale    text NOT NULL DEFAULT 'zh',
  CHECK (id = 1)
);

-- admin_user：唯一管理员
CREATE TABLE admin_user (
  id            int PRIMARY KEY DEFAULT 1,
  username      text NOT NULL,
  password_hash text NOT NULL,       -- argon2id
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

-- sessions：会话（cookie 存 token，DB 存哈希）
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL
);

-- login_attempts：登录失败限流
CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  ip_hash    text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  success    boolean NOT NULL
);
CREATE INDEX login_attempts_lookup_idx ON login_attempts(ip_hash, at DESC);

-- ask_counters：公开提问限流计数（按天）
CREATE TABLE ask_counters (
  day        date NOT NULL,
  scope      text NOT NULL,   -- 'global' 或 'ip:<hash>'
  count      int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, scope)
);

-- 每日展示结果持久化，保证并发首访和同日数据变化下仍稳定
CREATE TABLE daily_selections (
  day date NOT NULL,
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY(day, rank), UNIQUE(day, item_id)
);

-- TG 跨进程完成/失败回执 outbox；chat_id 加密，payload 发送时由当前条目构建
CREATE TABLE telegram_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  process_generation integer NOT NULL,
  chat_id_hash text NOT NULL,                    -- HMAC，确定性去重，不用于发送
  chat_id_enc text NOT NULL,
  outcome text CHECK (outcome IN ('completed','failed')), -- waiting 时为 null
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','ready','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_by text,
  lease_until timestamptz,
  sent_at timestamptz,
  UNIQUE(item_id, process_generation, chat_id_hash)
);

-- 业务事务到 pg-boss 的投递 outbox，消除 commit 后 send 前崩溃窗口
CREATE TABLE processing_requests (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  process_generation integer NOT NULL,
  emb_version integer NOT NULL,
  attempt smallint NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 3),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','running','done','failed')),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  PRIMARY KEY(item_id, process_generation, attempt)
);

CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY,
  seen_at timestamptz NOT NULL,
  version text NOT NULL
);
```

> 迁移策略：手写迁移启用 `pgvector`，v1 不创建 ivfflat/HNSW。保存嵌入配置时由服务端调用模型并验证有限数值数组，以实测长度写 `emb_dim`；首次保存或模型/baseURL/实测维度变化时原子递增 `emb_version`、置 `emb_rebuild_status=building`，把相关条目按新 generation 重排队。检索只读当前 version+dim，且 rebuild 非 ready 时公开/TG 提问整体禁用，避免只搜到已重建子集；任一目标条目最终失败则状态 failed，管理员重试直至全部成功后才原子置 ready。IP 规范化后以 `HMAC-SHA256(IP_HASH_KEY, day || ip)` 写计数 scope，不存明文且跨日不可关联；旧计数按保留期清理。

**数据不变量与兼容性：** `status/source/type`、配置阈值/间隔、标签数量与输入长度均有 DB CHECK + Zod 双层校验；所有时间按 UTC 存储，限流/每日展示的业务日由显式 `APP_TIMEZONE=Asia/Shanghai` 计算。迁移先在备份副本执行并验证；破坏性迁移采用 expand/backfill/switch/contract，不把未经验证的 down migration 当作回滚手段。

**最小化保留：** 不持久化公开问题原文；ask_counters 保留 32 天、login_attempts 30 天、sent/failed TG receipts 与 done/failed processing requests 30 天、daily_selections 400 天，均由 worker 每日 singleton maintenance job 分批清理。清理不触碰 items、当前 session、waiting/ready/sending receipt 或未完成 request，并有边界日期测试。

## D.1 接口、安全与错误合同（所有任务共用）

- 路由唯一命名：公开 `POST /ask`；管理 API 全部位于 `/admin/api/**`；管理页面位于 `/admin/**`。route 文件路径必须与该 URL 一致，不再使用含糊的 `/api/...` 别名。
- 管理 server page 调用 `requireAdminPage()`，失败重定向 `/admin/login`；管理 route 调用 `requireAdminApi()`，失败返回 401。写 route 依次校验可信 session、`Origin/Host`、session 绑定的 CSRF token、`application/json`、Zod schema 和对象存在/当前状态；任一步失败立即返回且不得入队/写库。
- JSON 错误统一为 `{error:{code,message,retryable}}`，至少定义 `AUTH_REQUIRED/CSRF_INVALID/VALIDATION/CONFLICT/RATE_LIMITED/MODEL_UNAVAILABLE/UPSTREAM/INTERNAL`；敏感内部原因只写脱敏日志。管理/公开动态响应使用 `Cache-Control: no-store`。
- Caddy 删除客户端自带的 `X-Forwarded-For/X-Real-IP` 并写入单值真实来源；应用仅在直连地址属于 `TRUSTED_PROXY_CIDRS` 时读取该头，否则使用 socket peer。头含多个值、IP 非法或信任链不明时公开提问返回 503 且不调用模型。
- CSRF 使用 session 绑定随机 token + constant-time 校验，并叠加严格 Origin；cookie 为 `HttpOnly; Secure; SameSite=Lax; Path=/admin`。登录/登出/改密也遵守 Origin 与内容类型检查；改密要求当前密码并撤销除当前新会话外的全部旧会话。

---

## D. 任务分解（TDD，按可独立验证的小步推进）

> 约定：每个代码步骤先写失败测试→运行见失败→最小实现→运行见通过→提交。测试框架 Vitest（`pnpm test`），e2e 用 Playwright（`pnpm e2e`）。集成测试用一次性 Postgres（docker 或 testcontainers）。

### Task T01: 项目脚手架与基础配置
**Files:** Create `package.json`,`tsconfig.json`,`next.config.ts`,`.env.example`,`src/lib/log/logger.ts`,`src/app/globals.css`,`src/components/ui/Pressable.tsx`,`MotionRegion.tsx`,`MaterialSurface.tsx`; Test `tests/unit/logger.test.ts`,`tests/unit/uiPrimitives.test.tsx`
**Interfaces:** logger 先把 Error 转为 name/code/message allowlist，再递归清洗对象（循环安全、最大深度/数组/字符串长度）；敏感 key 值清空，URL 去 userinfo 与 key/token query。共享 UI primitives 实现 ui-spec §3 的 pointer-down、可中断临界阻尼、材质/focus 和 3 个偏好媒体查询，后续公开/管理组件不得各自另造行为。
- [ ] Step1 写失败测试：顶层/嵌套/数组/Error.cause/header/URL/query 中的 key/token/password/cookie 全不出现在序列化结果；循环对象不崩溃；普通字段保留。UI primitive 在 reduced motion/transparency/high contrast 下切换正确属性。
- [ ] Step2 运行 `pnpm vitest run tests/unit/logger.test.ts` 预期 FAIL。
- [ ] Step3 实现 sanitizer+JSON logger，以及只含既定 6 色/字体/动效合同的共享 primitives。
- [ ] Step4 运行测试预期 PASS。
- [ ] Step5 提交 `chore: scaffold next+ts, logger with redaction`。

### Task T02: SSRF 防护、受控 fetch 与 URL 标准化（安全基石）
**Files:** Create `src/lib/fetch/urlGuard.ts`,`src/lib/fetch/safeFetch.ts`; Test `tests/unit/urlGuard.test.ts`,`tests/integration/safeFetch.test.ts`
**Interfaces:** Produces `canonicalizeUrl(raw:string): string`；`resolvePublicTarget(url): Promise<{url,addresses}>`（仅 http/https，解析全部 A/AAAA，任一地址属于 loopback/private/link-local/reserved/multicast/unspecified/metadata 即拒绝）；`safeFetch(url,{maxBytes,timeoutMs,allowedMime}):Promise<BoundedResponse>`。
- [ ] Step1 写失败测试：标准化；IPv4/IPv6/整数/混合编码的私网与 `169.254.169.254` 全拒绝；公网域名可解析；DNS 返回公网+私网混合时拒绝。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现 URL/DNS 判定，再实现 `safeFetch`：undici 自定义 `lookup` 只能返回本次已审查 IP；`redirect:'manual'`，最多 5 跳，每跳重新解析/固定；拒绝 HTTPS→HTTP 降级；流式累计字节，超限立刻 abort；全链路总超时。
- [ ] Step4 集成测试恶意服务：公网首跳→私网 redirect 拒绝；校验后 DNS 改绑不影响已固定连接；redirect loop/第 6 跳/超限 body/错误 MIME 均 fail closed；正常 2 跳公网成功。运行全套预期 PASS。
- [ ] Step5 提交 `feat: SSRF guard and URL canonicalization`。

### Task T03: 数据库连接与 schema（Drizzle）
**Files:** Create `src/db/schema.ts`,`src/db/client.ts`,`drizzle.config.ts`; Test `tests/integration/schema.test.ts`
**Interfaces:** Produces Drizzle 表对象 `items, appSettings, adminUser, sessions, loginAttempts, askCounters, dailySelections, processingRequests, telegramReceipts, workerHeartbeats`；`db` 实例。
- [ ] Step1 写失败集成测试：迁移后可 `insert` 一条 items 并读回，`url_canonical` 唯一约束生效（重复插入报错）。
- [ ] Step2 运行预期 FAIL（表不存在）。
- [ ] Step3 定义 schema（含 `vector` 自定义列类型）、生成迁移、连接池。
- [ ] Step4 运行预期 PASS。
- [ ] Step5 提交 `feat: db schema and drizzle client`。

### Task T04: pgvector 扩展与精确向量扫描
**Files:** Create `src/db/migrations/0001_pgvector.sql`; Test `tests/integration/pgvector.test.ts`
**Interfaces:** 依赖 T03；启用 `CREATE EXTENSION vector`；无 typmod vector + version/dim 精确余弦扫描，不建 ANN。
- [ ] Step1 写失败测试：不同维度/版本可存；查询显式过滤当前 version+dim 后，用 `embedding <=> $1` 排序正确且不触发维度错误。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 写扩展、约束和普通过滤索引迁移；`ANALYZE`。
- [ ] Step4 以 100/500/1000 条 fixture 跑精确查询 explain/时延与 recall@10 基线，记录到 `implementation-report.md`；运行预期 PASS。
- [ ] Step5 提交 `feat: enable pgvector exact cosine search`。

### Task T05: 密码哈希与会话
**Files:** Create `src/lib/auth/password.ts`,`src/lib/auth/session.ts`; Test `tests/unit/password.test.ts`,`tests/integration/session.test.ts`
**Interfaces:** Produces password hash/verify；session token 仅 cookie，DB 存 SHA-256；session 同时维护 7 天 absolute expiry 与 24 小时 idle expiry，滑动只更新 idle/last_seen 且不得越过 absolute。
- 密码初始化/改密共用 `validatePassword(username,password)`：12–128 Unicode 字符、不得等于用户名；允许粘贴/密码管理器，不设字符种类组合规则；错误响应与日志绝不包含密码。
- [ ] Step1 写失败测试：hash/verify；密码 11/12/128/129 边界、Unicode、等于用户名；idle/absolute 任一过期无效；滑动不越过 absolute；并发刷新单调；销毁后无效。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现 argon2 + 会话表读写。
- [ ] Step4 运行预期 PASS。
- [ ] Step5 提交 `feat: password hashing and db sessions`。

### Task T06: 登录限流、登录动作与 /admin 守卫
**Files:** Create `src/lib/auth/loginThrottle.ts`,`src/lib/auth/guard.ts`,`src/app/admin/login/page.tsx`,`src/app/admin/login/actions.ts`; Test `tests/integration/login.test.ts`
**Interfaces:** Produces `recordAttempt(ipHash,success)`；`isLockedOut`；两类 guard；登录 IP 使用独立 `LOGIN_IP_HASH_KEY` HMAC；登录成功写受限 cookie并执行 T05 idle/absolute 过期。清理由 T25 maintenance 注册。
- [ ] Step1 写失败测试：正确凭证→建会话+cookie；错误密码→计失败且不建会话；连续 5 次失败→`isLockedOut` 返回 locked；未登录调用受保护接口→401/redirect。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现原子限流查询、登录 action、页面/API 两类 guard、退出和滑动/绝对过期；middleware 只做早期跳转优化，安全判定仍在服务端数据/API 边界执行。登录 UI 消费 T01 primitives 覆盖 ui-spec §3/§6.1。
- [ ] Step4 运行预期 PASS（含 UI 文案：ui-spec §6.1 失败/锁定态）。
- [ ] Step5 提交 `feat: admin login with throttle and route guard`。

### Task T07: 密钥加密与设置读写
**Files:** Create `src/lib/crypto/secretbox.ts`,`src/lib/config/settings.ts`; Test `tests/unit/secretbox.test.ts`,`tests/integration/settings.test.ts`
**Interfaces:** Produces `encryptSecret(plain):string`/`decryptSecret(enc):string`(AES-256-GCM，密钥来自 `APP_ENCRYPTION_KEY` 环境变量)；`getSettings():Promise<Settings>`(返回 Key 掩码后的 DTO 供前端)；`getDecryptedSecret(field):Promise<string|null>`(仅服务端内部用)；`updateSettings(patch)`（写入时加密 Key，未提供则保留旧值）。
- [ ] Step1 写失败测试：加密后≠明文，解密还原；`getSettings` 返回 `llmKeyMasked:'sk-…abcd'` 且不含明文；`updateSettings` 不清空未变更的 Key。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现 GCM 加解密与设置 DTO/更新。
- [ ] Step4 运行预期 PASS。
- [ ] Step5 提交 `feat: encrypted secrets and settings service`。

### Task T08: 模型配置服务/API/UI + 维度探测 + 版本化重建
**Files:** Create `src/app/admin/(protected)/settings/models/page.tsx`,`ModelSettingsForm.tsx`,`src/app/admin/api/settings/models/route.ts`,`src/app/admin/api/settings/models/test/route.ts`; Test `tests/integration/modelSettings.test.ts`,`tests/e2e/admin-models.spec.ts`
**Interfaces:** embedding test/live save 除维度外，以固定中文正负 fixture 计算相似度分离并导出当前 `search_min_cosine`；正负无可用间隔则配置测试失败，不激活该模型。`PUT` 必须服务端重跑 probe+校准；identity 变化时 `emb_version+1`、置 building 并创建 T11 requests；全部成功才 ready。
- [ ] Step1 写失败集成测试：掩码/旧配置保护；1024 维实测；空/NaN/维度漂移拒绝；正负 fixture 不可分拒绝；可分时保存模型专属 cutoff；identity 变化只递增一次版本并覆盖所有 completed 条目。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现服务和两个管理 route（走 D.1 管线）；测试草稿 secret 只活在本次请求内且不记录日志。
- [ ] Step4 实现两组独立表单与重建进度/禁用提示（default/testing/saving/saved/error/disabled），跑集成+e2e 预期 PASS。
- [ ] Step5 提交 `feat: model settings with connectivity test and vector rebuild`。

### Task T09: 有界网页/文档正文提取 + GitHub 抓取 + 指纹
**Files:** Create `src/lib/fetch/webExtract.ts`,`src/lib/fetch/github.ts`,`src/lib/fetch/fingerprint.ts`; Test `tests/unit/webExtract.test.ts`,`tests/unit/github.test.ts`
**Interfaces:** 所有网络访问只消费 `safeFetch`。HTML 用 readability+jsdom；`text/plain` 解码；PDF 校验 MIME+魔数后用 pdfjs-dist，≤2MB、≤100 页、禁止加密。GitHub URL 只解析 owner/repo，从固定 `https://api.github.com` 获取公开 repo 数据；响应必须 `private=false`，否则拒绝，确保即使配置 PAT 也不抓私有仓库。403/429 且 `X-RateLimit-Remaining=0`、`Retry-After` 或 `X-RateLimit-Reset` 表示限流，抛 `GITHUB_RATE_LIMITED{retryAt}`；retryAt 优先响应头，否则指数退避（上限 1h）并加 jitter，不归类为通用抓取失败。可选 `GITHUB_PUBLIC_API_TOKEN` 仅来自环境变量、只用于这些公开 API 请求，不进入管理 UI/DB/日志。
- [ ] Step1 写失败测试：HTML/text/PDF 边界；公开 GitHub 元信息组合；`private=true` 即使有 PAT 也拒绝；未认证 60/h 的 403+remaining=0、429+Retry-After/reset 均映射 `GITHUB_RATE_LIMITED` 与确定范围内 jitter；普通 403 不误判；Token 不出日志；指纹稳定。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现三个提取模块；禁止提取器自行 `fetch`；清除脚本/样式并限制解析后字符数，错误仅返回脱敏分类码。
- [ ] Step4 运行预期 PASS。
- [ ] Step5 提交 `feat: content fetchers and fingerprint`。

### Task T10: LLM/Embedding 客户端 + 受约束总结
**Files:** Create `src/lib/ai/llm.ts`,`src/lib/ai/embedding.ts`,`src/lib/ai/summarize.ts`; Test `tests/unit/summarize.test.ts`
**Interfaces:** Consumes 设置。`summarize` 以 Zod+中文/句数规则校验结构化输出；首次不合格时最多再发一次“仅修正格式/语言”的受约束请求，仍不合格抛 `UPSTREAM_INVALID_OUTPUT` 交 T11 重试，禁止本地猜译。`embed` 校验有限数值与当前维度。
- [ ] Step1 写失败测试：首次英文/超长、第二次合格→仅保存第二次；两次不合格→抛稳定错误且不保存；标签 3–5；embed 维度/NaN 错误拒绝。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现客户端与总结约束（含 JSON 解析容错与长度/语言校验）。
- [ ] Step4 运行预期 PASS。
- [ ] Step5 提交 `feat: llm/embedding clients and constrained summarize`。

### Task T11: pg-boss 队列与 processItem 作业（代际幂等 + outbox）
**Files:** Create `src/lib/queue/boss.ts`,`src/worker/queue/requestPublisher.ts`,`src/worker/jobs/processItem.ts`,`src/lib/items/dedupe.ts`,`src/lib/items/processing.ts`; Test `tests/integration/processItem.test.ts`
**Interfaces:** `requestProcessing` 在业务事务中锁 item、递增 generation、置 processing、写 attempt=0 pending request；TG 同时以 chat HMAC 唯一键写 waiting receipt。publisher 领取 pending，以 singleton key 投递后标 queued；handler 开始时用条件更新把唯一 request 从 pending/queued 原子 claim 为 running，重复 job 直接 no-op。handler `retryLimit:0` 并自身捕获错误：attempt<3 时事务中新建下一 attempt；attempt=3 才置 item failed、receipt.outcome=failed/ready。成功在 generation+embVersion 匹配时提交 completed、receipt.outcome=completed/ready。重建协调器锁 settings，只有目标版本 request 全 done 且无 failed/processing 才置 ready，否则 failed/building。总尝试≤4。
- [ ] Step1 写失败集成测试：新条目完成；首次+3 次均失败后才 failed；业务 commit 后 publisher 前崩溃可恢复；send 后标 queued 前崩溃时只有一个 handler claim/一次模型调用；旧 generation/embVersion 不能覆盖；删除后 no-op；receipt outcome 原子更新；重建部分/失败时不 ready、全部成功才 ready。
- [ ] Step2 运行预期 FAIL。
- [ ] Step3 实现 publisher、处理状态机、去重与两个 outbox；内容 hash 未变时保留 summary/tags/embedding（但新 embVersion 重建不能跳过 embedding）；人工总结仅保留 summary，内容变化仍可更新 title/tags/embedding；对 pg-boss singleton 行为跑真实版本集成测试。
- [ ] Step4 运行预期 PASS。
- [ ] Step5 提交 `feat: processing queue with retry, dedupe, idempotency`。

### Task T12: 手动重抓入口（服务函数）
**Files:** Create `src/lib/items/refetch.ts`; Test `tests/integration/refetch.test.ts`
**Interfaces:** Produces `manualRefetch(itemId)` 调用 `requestProcessing`；processing 中拒绝重复；失败/完成可创建新 generation。
- [ ] Step1 写失败测试：completed 条目重抓→转 processing 并入队；processing 条目重抓→拒绝（不重复排队）。
- [ ] Step2 运行预期 FAIL。 - [ ] Step3 实现。 - [ ] Step4 PASS。 - [ ] Step5 提交 `feat: manual refetch`。

### Task T13: 定时重抓（pg-boss cron）
**Files:** Create `src/worker/jobs/scheduledRefetch.ts`; Test `tests/integration/scheduledRefetch.test.ts`
**Interfaces:** pg-boss cron 固定 singleton key；事务锁 settings 并声明轮次，记录 `snapshot_at=now()`；以 `(created_at,id)` keyset 遍历快照内 completed+failed，processing 跳过。非 GitHub 项照常排队；GitHub 项未配置 PAT 时最多安排 50 个/rolling hour，其余分散到下一窗口。任一 T09 `GITHUB_RATE_LIMITED.retryAt` 以 `GREATEST` 原子更新 DB 中 `app_settings.github_backoff_until`；T11 publisher/handler 和本轮后续 GitHub request 均读取该持久门禁并延至 reset+jitter，普通网页/文档不受影响；到期后恢复。单条冲突/失败记录后继续。
- [ ] Step1 写失败测试：双 worker 仅一轮；三种 item 状态；快照隔离；未到期/disabled；无 PAT 的前 50 个分散、第 51 个 defer、收到 rate-limit 后所有后续 GitHub 项延至 retryAt、普通网页不延迟、reset 后恢复；PAT 仅提高预算不放开 private repo；崩溃恢复不重复 generation。
- [ ] Step2 FAIL → Step3 实现 → Step4 PASS → Step5 提交 `feat: scheduled refetch cron`。

### Task T14: 管理端添加内容（页面 + 写接口）
**Files:** Create `src/app/admin/(protected)/layout.tsx`,`AdminNav.tsx`,`src/app/admin/(protected)/add/page.tsx`,`AddItemForm.tsx`,`src/app/admin/api/items/route.ts`; Test `tests/integration/addItem.test.ts`,`tests/e2e/admin-add.spec.ts`
**Interfaces:** `POST /admin/api/items {url}` 走 D.1 管线→safe URL 预检→去重→事务建条目→`requestProcessing`；响应 201/200 duplicate，包含条目 ID 与稳定 error code。
- [ ] Step1 写失败测试：登录后提交新链接→201 + 条目 processing；重复→提示已收藏不新建；非法 URL→400；未登录→401；缺模型配置→阻断并引导（ui-spec §6.2）。
- [ ] Step2 FAIL → Step3 实现 service+route 并跑集成 PASS → Step4 实现 protected layout/nav 与 AddItemForm 全状态，消费 T01 primitives，重复项提供详情/重抓入口，跑 e2e PASS → Step5 提交。

### Task T15: 收藏库列表与筛选
**Files:** Create `src/app/admin/(protected)/library/page.tsx`,`LibraryFilters.tsx`,`LibraryList.tsx`,`src/app/admin/api/items/route.ts`(GET); Test `tests/integration/library.test.ts`,`tests/e2e/admin-library.spec.ts`
**Interfaces:** `GET /admin/api/items?q&tag&status&cursor`：鉴权、参数 schema、稳定排序+游标分页；只返回列表 DTO，不返回 embedding/secret/internal stack。
- [ ] Step1 写失败测试：按 tag 过滤只返含该标签；关键词匹配标题/总结；空筛选返回全部。
- [ ] Step2 FAIL → Step3 实现 query+route 并跑集成 PASS → Step4 实现 filters/list 的 loading/empty/filter-empty/error/retry 与移动端布局，跑 e2e PASS → Step5 提交。

### Task T16: 条目详情——编辑总结/删除/手动重抓
**Files:** Create `src/app/admin/(protected)/library/[id]/page.tsx`,`ItemDetail.tsx`,`SummaryEditor.tsx`,`DeleteItemDialog.tsx`,`src/app/admin/api/items/[id]/route.ts`,`src/app/admin/api/items/[id]/refetch/route.ts`; Test `tests/integration/itemDetail.test.ts`,`tests/e2e/admin-detail.spec.ts`
**Interfaces:** `GET/PATCH/DELETE /admin/api/items/:id` 与 `POST .../:id/refetch`；PATCH 只接受 summary 且以 `updated_at`/etag 做乐观并发；DELETE 与 worker/daily selection FK 行为明确；refetch 调用 T12。全部走 D.1。
- [ ] Step1 写失败测试：编辑总结→保存并标人工编辑；删除→条目消失且不再出现在检索(T17)；重抓→转 processing；processing 时重抓按钮禁用。
- [ ] Step2 FAIL → Step3 实现 service/routes 并跑集成 PASS → Step4 以 T01 primitives 实现详情、草稿保留、冲突恢复、处理/失败态、焦点圈定与返回、`aria-live`，跑 e2e PASS → Step5 提交。

### Task T17: 语义检索 + 每日 3 条轮换
**Files:** Create `src/lib/search/retrieve.ts`,`src/lib/items/daily.ts`; Test `tests/integration/retrieve.test.ts`,`tests/unit/daily.test.ts`
**Interfaces:** `retrieve(query)` 只扫描 completed+非空+当前 version/dim，按 `score desc,id` 排序，过滤低于 app_settings 当前模型校准 cutoff 后最多 10 条；settings/rebuild 非 ready 时 fail closed。`pickDaily(day)` 在 advisory lock 事务中持久化 day/rank。
- [ ] Step1 写失败测试：正 fixture 的 recall@10 达目标；无关负 fixture 全低于阈值并返回空；版本/维度/status 隔离；两个并发首访得到完全同组同序；同日新增不改变；删除选中项后在锁内确定性补位；跨日尽量不重复；<3 正常。
- [ ] Step2 FAIL → Step3 实现 → Step4 PASS → Step5 提交 `feat: semantic retrieve and daily rotation`。

### Task T18: 公开提问 API（原子限流 → 检索 → 归纳）
**Files:** Create `src/lib/http/clientIp.ts`,`src/lib/ratelimit/publicAsk.ts`,`src/lib/ai/answer.ts`,`src/app/(public)/ask/route.ts`; Test `tests/integration/publicAsk.test.ts`,`tests/unit/answer.test.ts`
**Interfaces:** `getPublicAskReadiness()` 只读 app_settings，要求 LLM/Embedding 配置完整、`emb_rebuild_status='ready'`、当前 dim/version/cutoff 有效，不发任何模型请求。`POST /ask` 顺序：输入 schema→readiness 快检→可信 IP→`consumePublicAsk`。限流事务锁 settings 后先复核同一 readiness，不 ready/检查异常立即回滚并返回 `MODEL_UNAVAILABLE`（503、no-store），不得创建/递增 counter；ready 才按 global→IP 固定顺序锁行、判定并同时 +1。事务提交后才允许 embedding；无 hits 不调用 LLM；问题不落库/日志。
- [ ] Step1 写失败测试：unconfigured/building/failed、缺 LLM/emb 字段、DB 检查失败均返回 MODEL_UNAVAILABLE，counter 前后不变且 embedding/LLM=0；快检后配置并发切为 building 时事务复核仍不计数；ready 下并发 `limit+N` 成功数严格≤阈值且两计数一致；伪造/多值头、DB 限流失败均 fail closed；阈值即时生效；输入>500 拒绝。
- [ ] Step2 FAIL → Step3 实现 DB-only readiness、事务内复核、client IP、原子计数与回答 schema/引用 ID 白名单 → Step4 跑并发/竞态/注入集成测试 PASS → Step5 提交。

### Task T19: 国际化中/英（两端）
**Files:** Create `src/lib/i18n/config.ts`,`request.ts`,`LocaleSwitcher.tsx`,`messages/zh.json`,`messages/en.json`; Test `tests/integration/i18n.test.ts`,`tests/e2e/i18n.spec.ts`
**Interfaces:** cookie 是 SSR/两端共享的 canonical 偏好，localStorage 仅镜像且不得覆盖更新的 cookie；缺失键回退中文。静态扫描所有 page/component 可见文案，除 AI 内容/用户内容外不得存在未登记字面量。
- [ ] Step1 写失败测试：公开端切 en 后管理端一致且刷新持久；缺失键回退中文；两端所有 default/loading/empty/error/disabled/permission 文案通过 key 扫描；AI 内容仍中文。
- [ ] Step2 FAIL → Step3 实现完整字典、切换与 SSR hydration 一致性 → Step4 Chromium/Firefox/WebKit e2e PASS → Step5 提交。

### Task T20: Telegram bot——添加
**Files:** Create `src/worker/bot/telegram.ts`,`src/worker/bot/receiptDispatcher.ts`; Test `tests/integration/tgAdd.test.ts`,`tests/integration/tgReceipt.test.ts`
**Interfaces:** 白名单消息先解析命令，再提取最多 10 个去重 URL 并逐条处理/即时回执。`requestProcessing` 写 `chat_id_hash=HMAC(TG_ID_HASH_KEY,chatId)` + 随机密文，outcome 初始 null；结果事务填 outcome 并置 ready。dispatcher 原子领取并写 leased_by/lease_until；超时回收、429 退避、成功 sent。Telegram `sendMessage` 无 idempotency key，因此交付语义为 at-least-once：内部唯一逻辑 receipt，但发送成功后标记前崩溃可能产生一条重复，这是明确的 Low 残余风险。
- [ ] Step1 写失败测试：1/10/11 个 URL 的逐条行为；重复 URL；非白名单；completed/failed outcome；相同 chat 随机密文不同但 hash 唯一；两 dispatcher 不并发领取；lease 回收；429；发送前崩溃恢复；发送后崩溃允许至多一条可识别重复并记录指标。
- [ ] Step2 FAIL → Step3 实现 bot adapter + 持久 dispatcher → Step4 运行重启/并发集成测试 PASS → Step5 提交。

### Task T21: Telegram bot——提问
**Files:** Modify `src/worker/bot/telegram.ts`; Test `tests/integration/tgAsk.test.ts`
**Interfaces:** 解析优先级：`/refetch <shortId>`/`/retry <shortId>`→含 URL 添加→其他非空文本提问。shortId 只在白名单内解析，未知 ID 返回统一“未找到”且不泄露条目；命令调用 T12。TG 提问在 emb rebuild 非 ready 时明确暂不可用；其余共用 retrieve/answer，**不经过公开限流**。
- [ ] Step1 写失败测试：白名单命中/无命中；非白名单不响应；refetch/retry 成功、处理中冲突、未知 ID；确认不走公开计数；重建中不调用模型。
- [ ] Step2 FAIL → Step3 实现 → Step4 PASS → Step5 提交 `feat: telegram ask`。

### Task T22: 结构化日志与埋点接入
**Files:** Modify `src/app/admin/api/items/route.ts`,`src/worker/jobs/processItem.ts`,`src/app/(public)/ask/route.ts`,`src/app/admin/login/actions.ts`,`src/worker/bot/telegram.ts`,`src/worker/bot/receiptDispatcher.ts`; Test `tests/integration/observability.test.ts`
**Interfaces:** 记录事件：`item_added{source,deduped}`,`item_processed{ok,retries,ms}`,`public_ask{hit,empty,limited}`,`tg_ask`,`tg_receipt{outcome,duplicate_possible}`,`login{ok}`；禁止 question、明文 IP/chat ID、URL 敏感 query 和 secret；全部经 T01 sanitizer。
- [ ] Step1 写失败测试：逐一触发 add/process/ask/login/TG/上游 error，扫描序列化日志不含嵌套 IP/Key/Token/cookie/chat ID/question/敏感 URL query，且保留允许的事件维度。
- [ ] Step2 FAIL → Step3 接入 → Step4 PASS → Step5 提交 `feat: structured logging/metrics events`。

### Task T23: 公开端页面与固定提问框（含输入栏撑满 + 状态）
**Files:** Create `src/app/(public)/page.tsx`,`src/app/(public)/_components/AskBar.tsx`,`ResultPanel.tsx`; Test `tests/e2e/public.spec.ts`
**Interfaces:** Consumes `pickDaily`,`/ask` 与 T01 shared primitives。实现 ui-spec §5：每日 3 条、固定提问框几何、全状态、中英、6 色、焦点抬升、3 个偏好媒体查询；最小 320px 与 iOS visual viewport 退化策略。
- [ ] Step1 写失败 e2e：用 API fixture 驱动真实命中/无结果/超限/错误，不使用“火星/上限”字符串分支；桌面/移动断言 `input.width==label.width && input.height==form.height && input.right<=button.left`；空库/模型重建禁用；键盘、`aria-live`、iOS visual viewport/安全区、焦点不被固定栏遮挡。
- [ ] Step2 FAIL → Step3 实现 → Step4 Chromium/Firefox/WebKit 跑 1440×1000、390×844、320×568，含 reduced motion/transparency/high contrast，无溢出/遮挡/控制台错误 → Step5 提交。

### Task T24: 管理端设置面板（定时/限流/安全/TG/语言）与最终整合
**Files:** Create `src/app/admin/(protected)/settings/page.tsx`,`SettingsNav.tsx`,`RefetchPanel.tsx`,`RateLimitPanel.tsx`,`SecurityPanel.tsx`,`TelegramPanel.tsx`,`LocalePanel.tsx`,`src/app/admin/api/settings/{refetch,rate-limit,security,telegram,locale}/route.ts`; Test `tests/integration/settingsRoutes.test.ts`,`tests/e2e/admin-settings.spec.ts`
**Interfaces:** 每个 route 独立 Zod schema + D.1 管线；阈值/间隔有上下界；TG Token/chat IDs 掩码；安全改密需当前密码并轮换会话。UI 消费 T01 shared primitives，每组覆盖 default/saving/saved/error/disabled，permission 由服务端 guard 保证。
- [ ] Step1 写失败 e2e：改限流阈值→保存→公开提问按新阈值限流；关定时→不触发；改密码→旧会话策略生效；TG 白名单外不响应。
- [ ] Step2 FAIL → Step3 逐个实现并验证 routes → Step4 实现各 panel；三浏览器验证限流、定时、改密、TG 白名单、完整中英、pointer-down/focus/material 与 3 个偏好媒体查询 → Step5 提交。

### Task T25: 部署编排（Docker Compose + Caddy HTTPS）与初始化
**Files:** Create `docker-compose.yml`,`Caddyfile`,`.env.example`,`scripts/init-admin.ts`,`scripts/reset-admin-password.ts`,`scripts/backup.sh`,`scripts/restore-smoke.sh`,`src/app/api/health/{live,ready}/route.ts`,`src/worker/jobs/maintenance.ts`; Test `tests/integration/deploy-smoke.test.ts`,`tests/integration/adminRecovery.test.ts`,`tests/integration/retention.test.ts`
**Interfaces:** 四服务 app/worker/postgres/caddy；Caddy 强制 HTTPS、覆盖客户端转发头；live 不探依赖，ready 检查 DB/migration；worker 定期 heartbeat 并在 SIGTERM 停止领新作业、等待 lease 后退出。初始化幂等且密码只从交互 stdin/secret file 读取。
app/worker 只在 internal network 暴露端口，宿主机仅发布 Caddy 80/443；APP_ENCRYPTION_KEY、IP_HASH_KEY、LOGIN_IP_HASH_KEY、TG_ID_HASH_KEY 不进入 DB dump，要求独立离线备份、权限 0600 和轮换 runbook。
- 密码恢复只允许拥有主机/容器执行权限的运维者运行 `docker compose run --rm app pnpm reset-admin-password`；脚本不暴露 HTTP 路由，交互读取 username/new password（或权限 0600 secret file），复用 T05 强密码校验和 argon2id，在单事务内更新唯一管理员哈希并删除 `sessions` 全表。失败整笔回滚；日志只记录 `admin_password_reset{ok}`，不含用户名/密码；执行后所有旧 cookie 必须 401/重定向，管理员用新密码重新登录。
- [ ] Step1 写失败冒烟/恢复测试：起栈/health/heartbeat；init-admin 强密码；reset 错用户/弱密码/DB 失败不改哈希且不删 session，成功后新密码有效、旧密码无效、所有旧 session 失效、无 Web/API 入口且日志无敏感值；宿主端口/伪造 XFF；worker 恢复；DB+密钥恢复；retention 边界。
- [ ] Step2 FAIL → Step3 编排、健康、优雅停机、初始化、密码恢复、备份恢复 runbook → Step4 在临时 compose 全量运行并保存命令/退出码/耗时证据 → Step5 提交。

---

## E. 测试策略
- 单元：纯函数（urlGuard、fingerprint、summarize 约束、daily、ratelimit、secretbox、logger）。
- 集成：真实一次性 PostgreSQL+pgvector+pg-boss；LLM/Embedding/网络/TG 用可控 adapter。必须覆盖锁竞争、事务回滚、outbox 崩溃恢复、worker 重启、generation/version 隔离、SSRF 重定向/rebinding 与可信代理 IP。
- e2e：Playwright Chromium/Firefox/WebKit 跑公开问答与管理关键流、i18n、1440×1000/390×844/320×568、3 个偏好媒体查询及无障碍关键断言；浏览器最新版+前一大版本由 CI 镜像版本矩阵或交付前人工矩阵记录补证。
- 验收映射：每个 F-xx 至少一条测试（见追踪矩阵）；ui-spec 各状态对应 e2e 断言。
- 质量门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm e2e`、`pnpm audit --prod`、compose smoke/restore 均保存新鲜输出。100/500/1000 条固定 fixture 下：所有必召回正样本进入 Top10、所有明确负样本无命中；首页 P95<1.5s、添加回执 P95<1s、向量查询+排序 P95<2s。含第三方的问答 P95<8s 与单条处理“数十秒”是观测目标，单独记录供应商耗时；硬门禁不达标则停止交付，观测目标不达标需显式记录外部归因和用户接受风险。

## F. 上线与回滚
- 上线：Caddy 自动签发 HTTPS；`drizzle-kit migrate` 先行；`init-admin` 建管理员；worker 与 app 同镜像不同入口。
- 数据库迁移：向前迁移幂等；`emb_dim` 变更走"重建向量"流程（T08）。
- 回滚：镜像按 Git Tag 回退；数据库只采用向前兼容的 expand/backfill/switch/contract。旧镜像仅在 schema 兼容矩阵通过时回切；不执行未经 restore drill 的破坏性 down migration。变更前 `pg_dump`。
- 备份：文档化定时 `pg_dump`；加密/HMAC 环境密钥单独离线备份，不与 DB dump 同库存放；定期 restore drill 同时验证解密与登录/检索。
- 管理员密码恢复：无 2FA/恢复码是已确认取舍；忘记密码时必须取得主机/容器权限，停止对外分享终端输出，按 T25 runbook 运行一次性重置命令。脚本成功后强制撤销全部旧会话；不得直接写明文密码、临时开放无鉴权重置 API，或复用旧 session。

## G. 可观测性
- 结构化 JSON 日志（脱敏）；关键事件见 T22；worker 作业耗时/重试计数；限流命中计数。
- 健康检查：app `/api/health/live`、`/api/health/ready`，worker heartbeat，ready 中 DB/migration ping。

## H. 安全
- `/admin` 页面/API 分别强制 `requireAdminPage/Api`；写接口校验 session+Origin+CSRF+schema；cookie httpOnly+Secure+SameSite=Lax。
- SSRF 防护(T02) 是唯一网络出口，覆盖逐跳重定向、全地址拒绝与 DNS 固定；抓取总超时 15s、响应≤2MB。
- 密码 argon2id；API Key/TG Token AES-256-GCM 加密(密钥来自 env)，前端只见掩码；日志脱敏。
- 公开提问强制同事务双重限流；可信 IP 失败/DB 失败均关闭；输入≤500；答案 schema+引用白名单，严格库内。
- 已记录并接受：库内容通过公开问答对外可见（requirements §0.3）。

## I. 依赖
next, react, drizzle-orm, drizzle-kit, postgres(pg), pgvector, pg-boss, grammY, openai, undici, @mozilla/readability, jsdom, pdfjs-dist, ipaddr.js, argon2, next-intl, zod, vitest, @playwright/test。实际版本与完整性哈希以 `pnpm-lock.yaml` 为准，实施前核对 Node/Next/pg-boss/pgvector 支持矩阵。

## J. 非目标（本计划不做）
飞书 bot、Agent(MCP/API) 接入、多用户、私有/登录内容抓取、无头浏览器渲染、公开端全量浏览、原生 App、英文 AI 总结。

## K. 自检（对照 spec）
- 覆盖：以 A 节矩阵为准；F-01～F-12 无缺项，NFR 性能/安全/可观测分别映射到 T04/T17/T18/T25、T01/T02/T05/T06/T09/T18/T25、T22。
- 占位扫描：任务不需要逐行产品代码；必须精确到路径、接口、状态、事务/失败合同与可观察断言。T08/T14–T16/T24 已按 service/route/UI 分段，不允许实施者自行改变已确认交互。
- 类型一致性：`requestProcessing`/`retrieve`/`answer`/`consumePublicAsk`/`requireAdminPage`/`requireAdminApi`/`getDecryptedSecret` 在定义与消费任务间命名一致。
- 重点问题处置：TG 回执=T11/T20 持久 outbox；小规模向量=精确扫描+召回基准；维度=保存时实测+版本重建；公开限流=可信 IP+同事务双锁；SSRF=逐跳+固定 IP；CRUD/UI=精确合同而非逐行实现。
