## 2026-08-08 - Task: T01 项目脚手架与基础配置

### What was done

- 建立 Next.js 15 + React 19 + TypeScript + Vitest 的 pnpm 项目基线，生成锁文件并显式允许已核验的构建脚本。
- 实现循环安全、有深度/数组/字符串上限的结构化日志清洗，包含 Error allowlist、敏感字段清空和 URL 用户信息/敏感 query 移除。
- 实现共享的按压、可中断临界阻尼落位与材质表面组件，落地 6 个已批准色值、可见焦点与三类用户偏好退化。
- 将 `sharp` 和 `postcss` 精确覆盖到已修复安全公告的版本；新增运行时、界面基础和日志边界开发文档。

### Testing

- 红灯：`corepack pnpm vitest run tests/unit/logger.test.ts` 退出 1，因 `src/lib/log/logger.ts` 尚不存在而失败。
- 红灯：`corepack pnpm vitest run tests/unit/uiPrimitives.test.tsx` 退出 1，因共享 UI primitive 尚不存在而失败。
- 绿灯：`corepack pnpm vitest run tests/unit/logger.test.ts tests/unit/uiPrimitives.test.tsx` 退出 0，2 个文件、8 个测试全部通过。
- `corepack pnpm typecheck` 退出 0。
- `corepack pnpm lint` 最终新鲜重跑退出 0，无 error/warning。
- `corepack pnpm audit --prod` 在 override 前退出 1（3 high / 2 moderate）；覆盖 `sharp@0.35.0` 与 `postcss@8.5.23` 后退出 0，无已知漏洞。

### Notes

- `.env.example`：声明业务日时区。
- `.gitignore`：忽略依赖、构建、本地环境与测试产物。
- `package.json`：定义运行时、脚本和 T01 直接依赖。
- `pnpm-lock.yaml`：锁定完整依赖树与完整性哈希。
- `pnpm-workspace.yaml`：显式允许构建依赖并覆盖有公告的传递版本。
- `tsconfig.json`、`next-env.d.ts`、`next.config.ts`、`vitest.config.ts`、`eslint.config.mjs`：建立 TypeScript、Next、Vitest 与 ESLint 配置。
- `src/lib/log/logger.ts`：新增日志清洗与 JSON logger。
- `src/components/ui/Pressable.tsx`：新增 pointer-down 按压反馈。
- `src/components/ui/MotionRegion.tsx`：新增可中断临界阻尼落位。
- `src/components/ui/MaterialSurface.tsx`：新增命名材质表面。
- `src/app/globals.css`：新增色彩、焦点、按压、材质和偏好退化合同。
- `tests/setup.ts`、`tests/unit/logger.test.ts`、`tests/unit/uiPrimitives.test.tsx`：新增测试设置与 T01 回归覆盖。
- `docs/development.md`：记录运行时、共享 UI 与日志边界。
- `progress.md`：追加本任务施工与验证证据。
- 回滚点：基线提交 `7a8fa58`；T01 提交后可执行 `git revert --no-edit "$(git log --format=%H --grep='^chore: scaffold next+ts, logger with redaction$' -1)"` 产生可审计回滚。

## 2026-08-08 - Task: T02 SSRF 防护、受控 fetch 与 URL 标准化

### What was done

- 实现 HTTP/HTTPS URL 解析与标准化，拒绝用户信息、非 HTTP 协议和缺失主机。
- 使用 `ipaddr.js` 审查直接 IP 与 DNS 返回的所有 A/AAAA 地址；任一回环、私网、链路本地、保留、组播、未指定或 metadata 地址使整个目标失败。
- 实现基于 `undici` 自定义 lookup 的受控出口，连接只使用当跳已审查 IP；手动处理最多 5 跳重定向，每跳重新审查。
- 对 HTTPS→HTTP 降级、循环/超限重定向、非 2xx、错误 MIME、Content-Length/流式字节超限和 DNS 在内的全链路超时实施 fail closed。
- 新增运行时依赖 `ipaddr.js@2.5.0` （MIT，IP 分类）与 `undici@6.28.0` （MIT，受控 HTTP 连接）；生产审计无已知漏洞。

### Testing

- 红灯：`corepack pnpm vitest run tests/unit/urlGuard.test.ts tests/integration/safeFetch.test.ts` 退出 1，两个安全模块尚不存在。
- 反向超时测试：将 DNS resolver 设为永不返回后，`--testTimeout=100` 初次退出 1，证明旧实现未覆盖 DNS 挂起；全链路竞态修复后同一用例退出 0。
- 绿灯：`corepack pnpm vitest run tests/unit/urlGuard.test.ts tests/integration/safeFetch.test.ts` 退出 0，2 个文件、29 个测试全部通过。
- `corepack pnpm typecheck` 退出 0。
- `corepack pnpm lint` 退出 0，无 error/warning。
- `corepack pnpm audit --prod` 退出 0，无已知漏洞。

### Notes

- `package.json`、`pnpm-lock.yaml`：锁定 T02 的 `ipaddr.js` 与 `undici` 依赖。
- `src/lib/fetch/urlGuard.ts`：新增 URL 标准化、DNS 解析和公网地址门禁。
- `src/lib/fetch/safeFetch.ts`：新增固定 IP 连接、逐跳重定向审查与有界响应读取。
- `tests/unit/urlGuard.test.ts`：覆盖 URL 与 IPv4/IPv6/DNS 地址边界。
- `tests/integration/safeFetch.test.ts`：覆盖重定向、固定地址、协议降级、MIME、体积与总超时。
- `docs/development.md`：增加唯一外部网络出口开发约束。
- `progress.md`：追加 T02 施工与验证证据。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: SSRF guard and URL canonicalization$' -1)"`。

## 2026-08-08 - Task: T03 数据库连接与 schema

### What was done

- 安装并启动本机 PostgreSQL 16.14，将官方 pgvector 0.8.6 源码按 PG16 `pg_config` 编译安装，建立专用 `collection_system_test` 数据库。
- 实现 Drizzle node-postgres 连接池与 10 张 canonical 表，包含无 typmod `vector` 自定义列、外键、唯一约束、状态/边界 CHECK 和基础索引。
- 使用 drizzle-kit 生成初始迁移，按架构裁决 DEV-001 把 `CREATE EXTENSION IF NOT EXISTS vector` 放在首句，之后才创建含 `embedding vector` 的 `items`。
- 新增运行时依赖 `drizzle-orm@0.45.2` （Apache-2.0）、`pg@8.22.0` （MIT），开发依赖 `drizzle-kit@0.31.10` （MIT）和 `@types/pg@8.21.0` （MIT）。

### Testing

- 红灯：`DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test corepack pnpm vitest run tests/integration/schema.test.ts` 退出 1，因 `@/db/client`/schema 尚不存在。
- 绿灯：同一命令退出 0，1 个文件、3 个真实 PostgreSQL 集成测试全部通过；已验证迁移、插入/读回和唯一约束 `23505`。
- `corepack pnpm typecheck` 与 `corepack pnpm lint` 在 schema 生成前的实现检查中均退出 0；任务提交前将再做新鲜整仓验证。

### Notes

- `.env.example`：增加无真实密钥的 `DATABASE_URL` 配置格式。
- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`：增加并锁定 Drizzle/PG 依赖、命令与供应链策略。
- `drizzle.config.ts`：新增 fail-closed 的 PostgreSQL 迁移配置。
- `src/db/client.ts`：新增 PostgreSQL 连接池与 Drizzle `db` 实例。
- `src/db/schema.ts`：新增 10 张表、无 typmod vector 类型及数据不变量。
- `src/db/migrations/0000_initial.sql`、`src/db/migrations/meta/*`：新增初始迁移与 Drizzle 生成元数据。
- `tests/integration/schema.test.ts`：新增专用测试库安全检查、迁移、读写和唯一约束集成覆盖。
- `vitest.config.ts`：数据库集成测试文件串行执行，避免共享测试库迁移冲突。
- `docs/development.md`：增加 PostgreSQL/pgvector 环境和测试库边界。
- `progress.md`：追加 T03 施工与验证证据。
- 已批准偏差 DEV-001：仅将 pgvector 扩展启用前移为初始迁移首句，不改变列、检索语义或产品行为；完成时还将记入 `.workflow/implementation-report.md`。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: db schema and drizzle client$' -1)"`。

## 2026-08-08 - Task: T04 pgvector 精确向量扫描

### What was done

- 新增 `items_retrievable_idx(status, embedding_version, embedding_dim) WHERE embedding IS NOT NULL` 普通部分 B-tree 索引，迁移后执行 `ANALYZE items`。
- 验证无 typmod vector 同时存放不同维度/版本，检索 SQL 先限定完成状态、当前版本和维度，再用 `<=>` 做余弦距离排序，不会对异维向量求距离。
- 确认库中不存在 HNSW/IVFFlat 索引；100/500/1000 条规模均执行精确 `Seq Scan + Sort`。

### Testing

- 红灯：`DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test corepack pnpm vitest run tests/integration/pgvector.test.ts` 退出 1，因 `items_retrievable_idx` 尚不存在；其余跨维度排序和基准已执行。
- 绿灯：同一命令退出 0，1 个文件、3 个真实 pgvector 集成测试全部通过。
- 基准：最终新鲜整仓运行中，100/500/1000 条的 recall@10 均为 `1.0`，P95 分别为 `0.931ms / 1.298ms / 1.485ms`，均低于计划的向量查询+排序 2s 硬门禁。
- `EXPLAIN` 显示三个规模均为 `Seq Scan on items` 后按 `<=>` 精确排序，过滤条件包含非空向量、completed、version=7、dim=8。

### Notes

- `src/db/schema.ts`：增加已批准的可检索条目部分索引定义。
- `src/db/migrations/0001_exact_vector_scan.sql`、`src/db/migrations/meta/*`：新增普通过滤索引与 `ANALYZE`。
- `tests/integration/pgvector.test.ts`：新增跨维度/版本、索引类型、召回与延迟基准。
- `docs/development.md`：增加精确检索的过滤顺序和禁止 ANN 边界。
- `progress.md`：追加 T04 施工与验证证据。
- DEV-001 实施结果：原 T04 扩展启用已收敛至 `0000_initial.sql` 首句；T04 的 `0001_exact_vector_scan.sql` 只承载过滤索引与统计信息，无数据模型或检索语义变化。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: enable pgvector exact cosine search$' -1)"`。

## 2026-08-09 - Task: T05 密码哈希与数据库会话

### What was done

- 实现 12–128 个 Unicode 字符且不得等于用户名的共享密码校验。
- 使用 argon2id 哈希密码；校验异常统一 fail closed，不泄露密码。
- 会话令牌使用 32 字节安全随机数，客户端持有原令牌，数据库仅存 SHA-256。
- 会话同时执行 24 小时 idle 与 7 天 absolute 过期；刷新由单条条件更新完成，以 `greatest/least` 保证并发刷新单调且不越过 absolute。
- 新增运行时依赖 `argon2@0.44.0`（MIT，密码哈希）；仅为该包开放 pnpm 安装脚本，真实 hash/verify 探针通过，生产审计无已知漏洞。

### Testing

- 红灯：`vitest run tests/unit/password.test.ts tests/integration/session.test.ts` 退出 1，两个认证模块不存在。
- 绿灯：同一命令连接真实 PostgreSQL 16 后退出 0，2 个文件、7 个测试通过。
- 覆盖：argon2id hash/verify、11/12/128/129 边界、Unicode、密码等于用户名、令牌哈希存储、idle/absolute 任一过期、并发刷新单调、absolute 封顶及销毁失效。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 均退出 0。

### Notes

- 变更：`src/lib/auth/password.ts`、`src/lib/auth/session.ts`、两份对应测试、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: password hashing and db sessions$' -1)"`。

## 2026-08-09 - Task: T06 登录限流、登录动作与管理守卫

### What was done

- 登录 IP 经规范化后使用独立 `LOGIN_IP_HASH_KEY` 做 HMAC-SHA256，数据库不存明文 IP；缺失/过短密钥或非法 IP 均 fail closed。
- 登录事务按 IP hash 获取 PostgreSQL advisory transaction lock；15 分钟窗口内连续 5 次失败后锁定，成功记录会重置连续失败序列。
- 未知用户名与错误密码共用统一响应，并以固定 argon2id dummy hash 缓解用户名枚举时序差异；成功记录与 session 创建在同一事务。
- 登录 cookie 固定 `HttpOnly; Secure; SameSite=Lax; Path=/admin`；页面守卫重定向登录，API 守卫返回统一 `AUTH_REQUIRED` 401 与 `no-store`。
- 登录/退出 server action 检查 Origin/Host 与表单 Content-Type；输入使用 Zod；登录页覆盖 default/loading/error/locked，消费 T01 primitives。
- 新增运行时依赖 `zod@4.1.5`（MIT，输入边界校验）；生产审计无已知漏洞。

### Testing

- 红灯：`vitest run tests/integration/login.test.ts tests/unit/loginPage.test.tsx` 退出 1，登录、限流、守卫和页面模块不存在。
- 绿灯：登录集成、页面状态与页面守卫共 3 个文件、6 个测试通过；真实 PostgreSQL 验证成功会话、错误不建会话、HMAC IP、5 次锁定、API 401 和页面重定向。
- `next build` 成功，确认 `/admin` 为动态受保护路由、`/admin/login` 可构建。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 均退出 0。

### Notes

- 环境：`.env.example` 新增无真实值的 `LOGIN_IP_HASH_KEY`；至少 32 字节。
- 工具链：忽略 Next 自动维护的 `next-env.d.ts`，避免构建后 ESLint 检查生成的 triple-slash 声明。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: admin login with throttle and route guard$' -1)"`。

## 2026-08-09 - Task: T07 密钥加密与设置读写

### What was done

- 实现 AES-256-GCM secretbox：32 字节 base64 环境密钥、随机 96-bit IV、认证标签、版本化 payload 与固定 AAD。
- 解密严格校验版本、段数、IV/tag 长度和 canonical base64url；格式、环境密钥或认证异常均 fail closed。
- 设置服务维护 `app_settings` 单行记录；DTO 只返回 Key 掩码，不返回明文或数据库密文。
- `getDecryptedSecret` 仅提供服务端字段白名单；LLM、Embedding、Telegram secret 相互隔离。
- `updateSettings` 只加密明确提供的新 Key，省略字段时保留旧密文。

### Testing

- 红灯：`vitest run tests/unit/secretbox.test.ts tests/integration/settings.test.ts` 退出 1，secretbox 与设置服务不存在。
- 绿灯：同一命令连接真实 PostgreSQL 后退出 0，2 个文件、5 个测试通过。
- 覆盖：随机密文与还原、tag 篡改、畸形 payload、错误密钥长度、DTO 掩码、明文/密文不外泄、旧 Key 保留及三类 secret 隔离。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 均退出 0。

### Notes

- 环境：`.env.example` 新增无真实值的 `APP_ENCRYPTION_KEY`，格式为 base64 编码的 32 字节密钥。
- 未新增第三方依赖，使用 Node.js `crypto` 权威实现。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: encrypted secrets and settings service$' -1)"`。

## 2026-08-09 - Task: T08 模型配置、实测维度与版本化重建

### What was done

- 实现 OpenAI 兼容 LLM/Embedding live probe；测试草稿只存在当前请求，保存前服务端强制重新探测。
- Embedding 单次请求使用固定中文查询、2 条正样本和 2 条负样本；严格校验返回数量、非空、有限值、同维度与非零范数，正负余弦无严格间隔时拒绝，cutoff 取模型实测间隔中点。
- 保存 embedding 时锁定 `app_settings`；baseURL/model/实测维度 identity 变化仅递增一次版本，以同一事务递增全部 completed 条目 generation 并写 pending `processing_requests`，状态置 `building`。
- 管理 API 按 session→Origin/Host→session 绑定 CSRF→JSON Content-Type→Zod→live probe 顺序 fail closed；统一 no-store 错误响应，敏感错误只经 logger allowlist。
- 实现对话/嵌入两组独立设置表单及 default/testing/saving/tested/saved/error/disabled 状态；Key 只显示掩码，重建中仅禁用 embedding 组。
- 增加每请求 nonce CSP；生产策略不含 `unsafe-inline`，浏览器资源同源；根 layout 动态读取请求头以确保 Next 脚本/样式获得 nonce。
- 新增 `openai@7.4.0`（Apache-2.0，OpenAI 兼容客户端）与开发依赖 `@playwright/test@1.62.1`（Apache-2.0，e2e）；生产审计无已知漏洞。

### Testing

- 红灯：`vitest run tests/integration/modelSettings.test.ts` 退出 1，模型配置服务不存在。
- 服务/API/UI 绿灯：2 个目标文件、12 个测试通过；覆盖 1024 维、空/NaN/漂移/不可分拒绝、失败保护旧配置、cutoff、单次增版、completed 全覆盖及 auth/origin/CSRF/content-type 反向门禁。
- CSP 反向探针先在静态/开发运行中捕获 inline style/script 阻断并使 e2e 退出 1；动态 nonce + 生产运行修复后，桌面 1440px 与移动 390px e2e 2/2 通过，控制台零 error，CSP 不含 `unsafe-inline`，浏览器请求来源集合仅为应用同源。
- 截图：`.workflow/screenshots/t08-model-settings-desktop.png` 与 `t08-model-settings-mobile.png`；人工核对无重叠、截断或外部资源。
- Web Interface Guidelines：补齐 autocomplete/spellcheck、明确测试/保存文案、离页草稿提醒、hover/tap、标题换行与安全区；复核无未解决发现。
- 全量 `pnpm test`：15 files / 77 tests 通过；Vitest 明确只收 unit/integration，e2e 独立由 `pnpm e2e` 执行。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod`、`pnpm db:migrate` 均退出 0；`pnpm e2e` 内含生产 `next build` 并通过。

### Notes

- e2e 使用本地 OpenAI 兼容 HTTP fixture 与专用 PostgreSQL 测试库，不访问真实模型供应商，不操作生产数据。
- 回滚：执行 `git revert --no-edit "$(git log --format=%H --grep='^feat: model settings with connectivity test and vector rebuild$' -1)"`。

## 2026-08-09 - R3 上游模型错误日志收敛

### What was done

- 模型测试与保存路由不再把不可信上游 `Error` 传入 logger，只记录固定事件、模型类型、错误分类和合法数值 HTTP 状态码。
- `getSafeHttpStatus` 仅接受 100–599 的整数，不会把上游 message/body/cause/stack 或字符串状态带入日志。
- 保持统一 502 响应与保存失败不覆盖旧配置的既有行为。

### Testing

- 红灯：真实路由边界模拟上游 401 在 `Error.message` 回显草稿 Key，2 个回归用例均捕获 logger 序列化结果中的 `sk-DRAFT-MUST-NOT-LOG-9876` 并失败。
- 绿灯：`vitest run tests/integration/modelSettings.test.ts` 退出 0，1 个文件、10 个测试通过；测试与保存路由的响应及日志均不含草稿 Key，且日志字段精确限定为 allowlist。
- 同类点排查：`src` 中产品 logger 调用仅余这两处，均已收敛；定向 `typecheck` 与 `lint` 退出 0。

## 2026-08-09 - Task: T09 有界内容提取、GitHub 抓取与指纹

### What was done

- HTML 通过 Readability + JSDOM 提取正文并移除 script/style/noscript/template；`text/plain` 使用严格 UTF-8 解码。
- PDF 同时校验 `application/pdf` 与 `%PDF-` 魔数，禁止加密文档，限制 2 MiB/100 页，使用 pdfjs-dist 提取文本；解析后内容有字符上限。
- GitHub 只解析 `https://github.com/{owner}/{repo}` 并访问固定 `api.github.com` API，组合 README/描述/topics/主要语言/star；API `private=true` 无条件拒绝。
- 403 remaining=0/429 映射为 `GITHUB_RATE_LIMITED{retryAt}`，优先 Retry-After/reset，否则使用最高 1h 的指数退避加有界 jitter；普通 403 不误分类。
- 可选 `GITHUB_PUBLIC_API_TOKEN` 仅作为固定公开 API 的 Authorization 请求头；safeFetch 跨源重定向自动丢弃请求头，错误与日志不携带 Token。
- 内容指纹对 Unicode 和空白做稳定规范化后计算 SHA-256。

### Testing

- 红灯：`vitest run tests/unit/webExtract.test.ts tests/unit/github.test.ts` 退出 1，两个待实现模块均不存在。
- 绿灯：T09 两个单测加 safeFetch 集成共 3 files / 19 tests 通过，含现场构造真实 PDF 走默认 pdfjs-dist 提取。
- `pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 均退出 0，生产依赖无已知漏洞。

### Notes

- 新增运行时依赖：`@mozilla/readability@0.6.0` (Apache-2.0，HTML 正文)、`jsdom@26.1.0` (MIT，DOM 解析)、`pdfjs-dist@4.10.38` (Apache-2.0，PDF 解析)；选定版本与项目 Node.js >=20 约束兼容。
- `GITHUB_PUBLIC_API_TOKEN` 只提高公开 API 配额，不解锁私有仓库，不进入 UI/DB/日志。
