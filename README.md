# 收藏系统

一个可自部署的单管理员内容收藏、语义检索与公开问答系统。

## 简介

收藏系统用于保存公开网页、文本/PDF 文档和公开 GitHub 仓库。后台 worker 会抓取正文、生成中文总结与标签并写入向量；公开端每日轮换展示三条收藏，并基于收藏库回答问题。管理端提供条目、模型、定时重抓、公开额度、Telegram 与安全设置。系统面向单机 VPS 和几百条内容的规模设计，数据库、队列与向量检索统一使用 PostgreSQL。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- Corepack 与 pnpm 11.20.0
- PostgreSQL 16 与 pgvector（本地开发）
- Docker Engine 与 Docker Compose v2（容器部署）

### 安装

```bash
git clone https://github.com/helloworl9527/xm-daohang.git
cd xm-daohang
corepack pnpm install --frozen-lockfile
```

### 配置

```bash
cp .env.example .env
chmod 600 .env
# 编辑 .env，替换所有 replace-with-* 值并填写实际站点与数据库配置
```

必须分别生成 `APP_ENCRYPTION_KEY`、`IP_HASH_KEY`、`LOGIN_IP_HASH_KEY`、`TG_ID_HASH_KEY` 和 `PROXY_SHARED_SECRET`，不得互相复用。`DATABASE_URL` 中的用户名、密码若含保留字符，必须进行 URL 编码。`GITHUB_PUBLIC_API_TOKEN` 可留空；它只提升公开 GitHub API 配额，抓取仍强制 `private=false`，不会解锁私有仓库。

### 运行

```bash
corepack pnpm dev       # 开发模式
corepack pnpm build     # 生产构建
corepack pnpm start     # 生产运行（需先完成迁移和管理员初始化）
```

本地数据库迁移使用：

```bash
DATABASE_URL=postgresql://用户名@127.0.0.1:5432/collection_system corepack pnpm db:migrate
```

## 功能特性

- 公开内容收藏：支持网页、文本、PDF 与公开 GitHub 仓库，执行 URL/SSRF/MIME/大小边界校验。
- 中文 AI 处理：生成 2–4 句中文总结、3–5 个标签和版本化向量。
- 收藏库管理：筛选、编辑人工总结、删除、手动及定时重抓。
- 语义问答：按实时阈值检索 Top 10 来源，无命中时不调用归纳模型、不编造答案。
- 每日轮换：按 `APP_TIMEZONE` 持久化每日最多三条内容。
- Telegram 私有入口：白名单用户可添加链接与提问，完成回执由持久 outbox 分发。
- 安全边界：Argon2id、会话双重过期、CSRF/Origin/Content-Type 校验、双层公开限流、敏感配置 AES-256-GCM 加密、结构化日志脱敏。
- 中英文界面：公开端和管理端支持语言切换，AI 总结与回答保持中文。

## 技术栈

- Next.js 15、React 19、TypeScript：全栈页面、管理 API 与公开 API。
- PostgreSQL 16、pgvector、Drizzle ORM：结构化数据、精确余弦检索与迁移。
- pg-boss：持久任务队列、定时任务和单例作业。
- grammY：Telegram long polling 与消息发送。
- OpenAI SDK：连接可配置的 OpenAI 兼容对话与嵌入服务。
- Zod、Argon2、undici、Readability、pdfjs-dist：边界校验、认证和受控内容提取。
- Vitest、Playwright、ESLint：单元/集成/端到端测试与静态检查。
- Docker Compose、Caddy：四服务编排、HTTPS 与可信客户端 IP 注入。

## 项目结构

```text
.
├── Caddyfile
├── Dockerfile
├── docker-compose.yml
├── docs/
├── scripts/                 # 初始化、改密、迁移、备份与恢复演练
├── src/
│   ├── app/                 # 公开端、管理端与健康检查
│   ├── db/                  # Schema、客户端与迁移
│   ├── lib/                 # 认证、抓取、AI、检索、限流等服务
│   ├── messages/            # 中英文字典
│   └── worker/              # 队列、定时任务与 Telegram
└── tests/
    ├── e2e/
    ├── integration/
    └── unit/
```

## 开发指南

先在专用 `collection_system_test` 数据库应用迁移，再运行测试。集成测试会清理测试表，不得把生产数据库 URL 传给测试命令。

```bash
DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test corepack pnpm db:migrate
DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test APP_TIMEZONE=Asia/Shanghai corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm e2e
corepack pnpm audit --prod
```

外部抓取必须走 `src/lib/fetch/safeFetch.ts`；结构化日志必须走 `src/lib/log/logger.ts`。不得记录问题原文、客户端 IP、Token、Cookie、上游响应正文或密钥。更多约束见 [开发基线](docs/development.md) 与 [部署手册](docs/deployment.md)。

## 部署

容器部署只向宿主机发布 Caddy 的 80/443 端口。app、worker 与 PostgreSQL 仅加入内部网络。首次启动：

```bash
docker compose build
docker compose up -d postgres
docker compose run --rm app node --experimental-strip-types scripts/migrate.ts
docker compose up -d
curl --fail https://你的域名/api/health/ready
```

管理员初始化、密码恢复、备份与恢复演练需要主机权限，具体命令及密钥备份/轮换要求见 [部署手册](docs/deployment.md)。不要把 `.env`、管理员凭据文件或密钥备份提交到 Git。当前配置是单 worker long polling；增加 worker 副本前必须先实现 leader election 或改用 Telegram webhook。

## 许可证

目前无法确认。仓库中没有 `LICENSE` 文件，也没有可核验的许可证声明。
