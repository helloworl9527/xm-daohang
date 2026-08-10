# 生产交接文档

**此文档描述拟上线版本的当前状态。每次生产发布前更新。**

## 版本信息
- **版本号**：v1.0.0
- **Git Tag**：v1.0.0（基于 commit `9b6a349`）
- **生成时间**：2026-08-09T20:00+08:00
- **适用环境**：Ubuntu 22.04 arm64（VPS）
- **发布状态**：待部署（代码已就绪，Docker 镜像实测与真实部署待用户在 VPS 执行）

## 系统目标
收藏系统——个人知识管理工具，通过 Telegram/管理端添加 URL，自动抓取正文、生成 AI 总结与向量、语义检索问答、每日轮换推荐。

**核心能力**：
- 多来源添加（Telegram 白名单、管理端、定时重抓）；
- 受控抓取（SSRF 防护、safeFetch 唯一出口、15s 超时 2MiB）；
- AI 总结与向量（对话模型 + 嵌入模型，支持 OpenAI 兼容 API）；
- 语义检索（pgvector 精确余弦、Top10）；
- 每日轮换（业务日+持久选择）；
- 公开限流（IP + 全站双层 fail-closed）；
- 中英双语。

## 技术栈
- **运行时**：Node.js 22.22（内建 type-stripping）
- **框架**：Next.js 15.5（App Router、standalone）
- **数据库**：PostgreSQL 16 + pgvector 0.8
- **队列**：pg-boss（持久作业、定时、outbox）
- **反向代理**：Caddy 2（HTTPS、可信 IP 剥离注入、响应头）
- **密码**：Argon2id；**加密**：AES-256-GCM；**会话**：双过期 httpOnly
- **编排**：Docker Compose（app + worker + postgres + caddy）

## 架构与数据流

```mermaid
graph TB
    User[用户] -->|HTTPS| Caddy
    TGUser[Telegram 白名单用户] -->|long polling| TGBot[Telegram Bot]
    Caddy -->|剥离+注入 X-Real-Client-IP<br/>+ X-Proxy-Auth| App
    App -->|SSR 公开端<br/>问答 API<br/>管理端| App
    App -->|session/CSRF| Admin[管理员]
    App -->|入队| Queue[pg-boss outbox]
    Worker -->|SKIP LOCKED 领取| Queue
    Worker -->|抓取/总结/向量| AI[LLM/Embedding API]
    Worker -->|写 items| DB[(PostgreSQL<br/>pgvector)]
    App -->|检索/限流| DB
    TGBot -->|入队添加/提问| App
    Worker -->|完成回执 dispatcher| TGBot
```

**关键数据流**：
1. **添加**：Telegram/管理端 → 去重 upsert `processing` → 入队 `fetch-and-summarize` → Worker 抓取 → 调 LLM 总结 → 调 Embedding 向量 → 写 `items` completed + 标签 → TG 回执。
2. **检索**：用户提问 → 公开限流（双层 fail-closed）→ Embedding 问题向量 → pgvector 余弦 Top10 → 调 LLM 归纳 + 服务端拼装来源 → 返回。
3. **每日轮换**：定时作业（业务日+时区）→ 随机选 3 条 `daily_selections` → 公开首页展示。

## 核心模块及入口

| 模块 | 路径 | 职责 |
|---|---|---|
| 公开端 | `src/app/(public)/page.tsx` | 每日 3 条 + 固定提问框 |
| 公开问答 | `src/app/api/ask/route.ts` | 限流 + 检索 + 归纳 |
| 管理端 | `src/app/admin/**` | 登录 + CRUD + 设置 |
| Telegram Bot | `src/worker/bot/` | 白名单添加/提问 + 回执 dispatcher |
| Worker | `src/worker/index.ts` | instrumentation 装载，pg-boss 处理/定时/维护 + outbox 轮询 |
| 抓取 | `src/lib/fetch/` | safeFetch 唯一出口 + web/doc/github 提取 |
| AI | `src/lib/ai/` | 总结 + 向量（OpenAI 兼容） |
| 检索 | `src/lib/retrieval/` | pgvector 精确余弦 |
| 限流 | `src/lib/rate-limit/` | IP + 全站双层 + 业务日 |
| 队列 | `src/lib/queue/` | pg-boss + outbox |
| 数据库 | `src/db/` | Drizzle ORM + schema + 惰性连接 |

## 数据库与迁移

**Schema 版本**：0002（3 条迁移）
- `0000_initial.sql`：启用 pgvector + 全部 v1 表（users/sessions/app_settings/items/tags/ask_counters/daily_selections/processing）
- `0001_exact_vector_scan.sql`：`items_retrievable_idx` + ANALYZE（精确扫描，不建 ANN 索引）
- `0002_embedding_constraints.sql`：embedding 非空 + `vector_dims(embedding)=embedding_dim` 约束

**迁移命令**（生产）：
```bash
# 方式一：drizzle-orm migrator（已集成进 app 容器）
docker compose exec -T app node --experimental-strip-types scripts/migrate-prod.ts

# 方式二：开发 drizzle-kit（本机）
DATABASE_URL=... pnpm db:migrate
```

## 外部依赖

| 服务 | 用途 | 必需 | 配置 |
|---|---|---|---|
| **对话模型（LLM）** | 生成总结、归纳答案 | ✅ | `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`（默认 `gpt-4o-mini`） |
| **嵌入模型（Embedding）** | 生成向量 | ✅ | `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL`（默认 `text-embedding-3-small`） / `EMBEDDING_DIM`（默认 1536） |
| **Telegram Bot** | 私有添加/提问 | ⚪️可选 | `TG_BOT_TOKEN`（加密存储）/ `TG_ALLOWED_IDS`（白名单，逗号分隔）|
| **GitHub** | 抓取公开仓库 README | ⚪️可选 | `GITHUB_TOKEN`（可选，仅提升配额，不解锁私有） |

**无外部依赖时行为**：
- 缺 LLM/Embedding：添加会失败并标记为可重试；
- 缺 Telegram：Telegram 功能不可用，管理端与公开端正常；
- 缺 GitHub Token：GitHub 仓库抓取受匿名配额限制（60/h）。

## 环境变量（关键）

**完整列表见 `.env.example`**。以下为关键变量（**生产部署前必须配置**）：

### 数据库
- `DATABASE_URL`：PostgreSQL 连接串（如 `postgresql://user:pass@postgres:5432/dbname`）

### 加密与密钥
- `APP_ENCRYPTION_KEY`：AES-256-GCM 主密钥（32 字节 hex，用于加密配置中的敏感值如 Bot Token）
- `IP_HASH_KEY`：IP 哈希密钥（32 字节 hex，用于限流计数器）
- `SESSION_SECRET`：会话签名密钥（32 字节 hex）
- `PROXY_SHARED_SECRET`：Caddy 与 app 共享密钥（用于可信 IP 校验，任意长度）

**生成方法**（本机）：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 模型 API
- `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`
- `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` / `EMBEDDING_DIM`

### 时区与限流
- `APP_TIMEZONE`：业务日时区（如 `Asia/Shanghai`，影响每日轮换与计数器重置）
- `PUBLIC_ASK_IP_LIMIT`：单 IP 每日提问上限（默认 20）
- `PUBLIC_ASK_GLOBAL_LIMIT`：全站每日提问上限（默认 200）

### Telegram（可选）
- `TG_BOT_TOKEN`：Bot Token（加密存储在 `app_settings.telegram_bot_config`）
- `TG_ALLOWED_IDS`：白名单 chat ID（逗号分隔，如 `123456,789012`）

### 其他
- `DOMAIN`：部署域名（如 `collection.example.com`，Caddy 用，占位时填 `localhost` 或 `:3000`）
- `NODE_ENV=production`（生产必须）
- `WORKER_MODE=1`（worker 容器必须，app 容器不设）

## 构建、测试与部署

### 本机开发（需 PostgreSQL 16 + pgvector）
```bash
# 安装依赖
corepack pnpm install --frozen-lockfile

# 迁移
DATABASE_URL=... pnpm db:migrate

# 测试（255 测试）
pnpm test

# 类型/Lint/审计
pnpm typecheck && pnpm lint && pnpm audit --prod

# 开发服务器
pnpm dev

# 生产构建
pnpm build
```

### Docker 生产镜像（在 VPS 执行）
```bash
# 构建 app 与 worker 镜像
docker build --target app -t collection-system-app:v1.0.0 .
docker build --target worker -t collection-system-worker:v1.0.0 .

# 查看镜像大小
docker images | grep collection-system
```

**预估大小**：app/worker 各约 **300–325MiB**（基于 `node:22-bookworm-slim` arm64 解压 240MiB + standalone 52M + drizzle-orm 16M）。

### 启动四服务编排
```bash
# 准备 .env（从 .env.example 复制并填写真实值）
cp .env.example .env
# 编辑 .env，填写 DATABASE_URL、各密钥、模型 API、DOMAIN 等

# 启动（后台 + 等待健康）
docker compose up -d --build --wait

# 查看状态
docker compose ps

# 健康检查
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)})"
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)})"
docker compose exec -T worker node --experimental-strip-types scripts/check-worker-health.ts
docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# 查看日志
docker compose logs -f app worker

# 停止
docker compose down
```

### 初次部署：初始化管理员
```bash
# 生成随机密码（16 字节 base64）
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"

# 初始化管理员（用户名 admin）
echo "YOUR_PASSWORD" > admin-password.txt
chmod 600 admin-password.txt
docker compose exec -T app node --experimental-strip-types scripts/init-admin.ts < admin-password.txt
rm admin-password.txt

# 或在容器内交互式
docker compose exec app node --experimental-strip-types scripts/init-admin.ts
```

### 重置管理员密码（L-AUD-02）
```bash
echo "NEW_PASSWORD" > reset-password.txt
chmod 600 reset-password.txt
docker compose exec -T app node --experimental-strip-types scripts/reset-admin-password.ts < reset-password.txt
rm reset-password.txt
```
**效果**：更新密码（Argon2id）+ 撤销所有会话（管理员需重新登录）。

## 健康检查与监控

### 健康端点
- **Live**：`GET /api/health/live` → 200（进程存活）
- **Ready**：`GET /api/health/ready` → 200（DB 可连接 + 队列可用）
- **Worker**：`scripts/check-worker-health.ts` 检查 pg-boss `__state__` 与最近心跳

### 日志
结构化 JSON 日志（stdout），包含：
- `level`（info/warn/error）
- `timestamp`
- `source`（app/worker）
- `event`（如 `item_added`、`public_ask`、`login_ok`）
- `context`（脱敏后的上下文，敏感值与不可信上游文本不入日志）

**查看日志**：
```bash
docker compose logs -f app worker | jq .
```

### 关键指标（建议采集）
- `item_added{source,deduped}`：添加来源与去重
- `item_processed{ok,retries,latency_ms}`：处理成功率与重试
- `public_ask{hit,empty,limited}`：问答命中/无结果/超限
- `tg_receipt{ok,duplicate_possible}`：TG 回执成功（AR-001 at-least-once，极端崩溃窗口可能重复，有指标）
- `login_ok`：管理员登录

## 备份与恢复

### 备份（定期执行）
```bash
# 使用提供的备份脚本
./scripts/backup.sh /path/to/backups
# 输出：/path/to/backups/backup-YYYYMMDD-HHMMSS.sql.gz
```
**内容**：完整 PostgreSQL dump（schema + data），gzip 压缩。

### 恢复演练
```bash
# 使用提供的恢复冒烟脚本（非破坏性，在临时 DB 验证）
./scripts/restore-smoke.sh /path/to/backup.sql.gz /path/to/reset-admin-password.secret
```
**效果**：创建临时数据库 → 恢复备份 → 验证表/数据/迁移 → 用提供密钥重置管理员 → 清理临时 DB。

### 生产恢复（灾难场景）
```bash
# 1. 停止服务
docker compose down

# 2. 恢复备份到生产 DB
gunzip < backup.sql.gz | docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB

# 3. 重启服务
docker compose up -d --wait

# 4. 验证健康
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)})"
```

## 故障排查

| 症状 | 可能原因 | 排查 |
|---|---|---|
| app/worker 启动失败 | 缺 DATABASE_URL 或连接失败 | `docker compose logs app` 查看错误；检查 `.env` DATABASE_URL；`docker compose exec postgres pg_isready` |
| 添加失败 | 缺 LLM/Embedding API Key | logs 查看 `item_processed` 错误；检查 `OPENAI_API_KEY` / `EMBEDDING_API_KEY` |
| 问答超限 | 达到 IP/全站限流上限 | 检查 `PUBLIC_ASK_IP_LIMIT` / `PUBLIC_ASK_GLOBAL_LIMIT`；查 `ask_counters` 表 |
| Telegram 不响应 | Bot Token 错误或非白名单 | 检查 `app_settings.telegram_bot_config` 加密值；检查 `TG_ALLOWED_IDS` |
| 每日轮换不更新 | 时区错误或定时作业未运行 | 检查 `APP_TIMEZONE`；`docker compose logs worker` 查看 `selectDailyItems` 定时作业 |
| Worker 无心跳 | worker 进程挂起或 pg-boss 故障 | `docker compose logs worker`；`scripts/check-worker-health.ts` |

## 已知问题与技术债

### 残余风险（已接受）
- **AR-001（Low）**：Telegram 完成回执至少一次语义（at-least-once）。极端崩溃窗口（发送成功但写回执状态前进程终止）可能导致一条总结重复发送。有 `duplicate_possible` 指标，不影响核心功能，用户已接受。

### 观察项
- **OBS-01**：GitHub 可选 Token 仅提升公开仓库配额（60→5000/h），不解锁私有仓库（产品强制 `private: false`）。

### 技术债（不阻断发布）
- 飞书 wiki 等重 JS 页面抓取会超时失败（v1 不做无头浏览器，按设计进入手动兜底路径）；
- VPN fake-IP DNS（`198.18.0.0/15`）环境下 SSRF 防护会先行拦截所有域名（正确 fail-closed 行为），部署环境应使用返回真实公网地址的 DNS。

## 安全边界

### 已实施防护
- **SSRF**：safeFetch 唯一出口 + 固定解析 IP + 同源转发限制 + 内网/保留地址黑名单；
- **认证**：Argon2id 密码 + 双过期会话（绝对 7d + 空闲 1d）+ httpOnly Secure SameSite=Lax；
- **CSRF**：全部变更操作校验 Origin 与 session；
- **输入校验**：Zod schema + 严格 `Content-Type: application/json` 正则；
- **限流**：公开问答 IP + 全站双层 fail-closed（关闭限流或缺/非法时区均拒绝）；
- **可信 IP**：Caddy 剥离客户端头 + 注入 `X-Real-Client-IP` + `X-Proxy-Auth` 共享密钥（常量时间校验）；
- **敏感值**：密钥/Token/不可信上游文本不入日志；加密配置用 AES-256-GCM；
- **生产纯净**：15/15 根 devDependencies 负向门禁 + 构建期/运行期双重 fail-closed 校验。

### 不在 v1.0 范围
- 无头浏览器抓取（重 JS 页面走手动兜底）；
- 多用户/多租户（单管理员）；
- GitHub 私有仓库（强制 `private: false`）；
- 自动化渗透测试/WAF（依赖 VPS 网络层防护）。

## 相比上一生产版本的变化
**这是首次生产发布（v1.0.0）**，无上一版本。

---

## 快速参考

### 一键启动（VPS 首次部署）
```bash
# 1. Clone 代码并切换到 v1.0.0
git clone <YOUR_REPO_URL> collection-system
cd collection-system
git checkout v1.0.0

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env，填写 DATABASE_URL、密钥、模型 API、DOMAIN 等

# 3. 启动四服务
docker compose up -d --build --wait

# 4. 初始化管理员
echo "YOUR_PASSWORD" | docker compose exec -T app node --experimental-strip-types scripts/init-admin.ts

# 5. 验证健康
docker compose ps
curl http://localhost:3000/api/health/ready

# 6. 访问
# 公开端：http://localhost:3000
# 管理端：http://localhost:3000/admin（用户名 admin）
```

### 访问入口
- **公开端**：`https://<DOMAIN>/`（每日 3 条 + 提问框）
- **管理端**：`https://<DOMAIN>/admin`（登录后 CRUD + 设置）
- **Telegram**：配置 Bot Token 与白名单后，私聊 Bot 发 URL 或提问

### 停止与清理
```bash
# 停止服务（保留数据卷）
docker compose down

# 停止并删除数据卷（⚠️ 删除数据库）
docker compose down -v
```

---

**文档维护**：每次生产发布前更新此文档，旧版本摘要归档到 `docs/production-releases/<version>.md`。完整代码历史以 Git commit/PR/GitHub Release 为事实源。
