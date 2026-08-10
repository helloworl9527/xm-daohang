# 收藏系统 - 生产部署快速开始

**版本：v1.0.0** | **目标环境：Ubuntu 22.04 arm64（VPS）**

完整文档见 [`docs/PRODUCTION_CONTEXT.md`](docs/PRODUCTION_CONTEXT.md)。

---

## 前置要求

在 VPS 上需要：
- **Docker** + **Docker Compose**（`apt install docker.io docker-compose-plugin`）
- **Git**
- 一组 **OpenAI 兼容的模型 API**（对话 + 嵌入）

---

## 一键部署（VPS）

### 1. Clone 代码并切换到 v1.0.0
```bash
git clone <YOUR_REPO_URL> collection-system
cd collection-system
git checkout v1.0.0
```

### 2. 准备环境变量
```bash
cp .env.example .env
```

**编辑 `.env`，填写以下必需项**（其余保持默认或按需调整）：

```bash
# === 数据库 ===
DATABASE_URL=postgresql://collection_user:YOUR_DB_PASSWORD@postgres:5432/collection_db

# === 密钥（生成方法见下方） ===
APP_ENCRYPTION_KEY=<32字节hex>
IP_HASH_KEY=<32字节hex>
SESSION_SECRET=<32字节hex>
PROXY_SHARED_SECRET=<任意长度强密钥>

# === 模型 API（必需，填写你的真实 API） ===
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536

# === 时区与域名 ===
APP_TIMEZONE=Asia/Shanghai
DOMAIN=localhost:3000  # 或你的真实域名

# === Telegram（可选，不用可以留空） ===
TG_BOT_TOKEN=
TG_ALLOWED_IDS=

# === 限流（可选，保持默认即可） ===
PUBLIC_ASK_IP_LIMIT=20
PUBLIC_ASK_GLOBAL_LIMIT=200
```

**生成密钥（在 VPS 或本机执行）**：
```bash
# 生成 32 字节 hex（用于 APP_ENCRYPTION_KEY/IP_HASH_KEY/SESSION_SECRET）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 生成强随机密钥（用于 PROXY_SHARED_SECRET）
openssl rand -base64 32
```

### 3. 启动四服务（app + worker + postgres + caddy）
```bash
docker compose up -d --build --wait
```

**等待约 1-3 分钟**（首次构建镜像 + 启动）。

### 4. 查看镜像大小（闭合审计条件）
```bash
docker images | grep collection-system
```
**预期**：app 与 worker 各约 **300–325MiB**。请把实际 SIZE 记下来。

### 5. 初始化管理员（首次部署必需）
```bash
# 生成随机密码
PASSWORD=$(openssl rand -base64 16)
echo "管理员密码：$PASSWORD"  # 记下这个密码

# 初始化管理员（用户名：admin）
echo "$PASSWORD" | docker compose exec -T app node --experimental-strip-types scripts/init-admin.ts
```

### 6. 验证健康检查
```bash
# 查看服务状态
docker compose ps

# 验证 app live/ready
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)})" && echo "✓ app live"
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)})" && echo "✓ app ready"

# 验证 worker 心跳
docker compose exec -T worker node --experimental-strip-types scripts/check-worker-health.ts && echo "✓ worker healthy"

# 验证 postgres
docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' && echo "✓ postgres ready"

# 验证 Caddy
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile && echo "✓ caddy config valid"
```

**预期**：全部输出 `✓`。

### 7. 备份→恢复演练（验证灾难恢复）
```bash
# 执行备份
./scripts/backup.sh /tmp/collection-backups

# 恢复冒烟测试（非破坏性，在临时 DB 验证）
LATEST_BACKUP=$(ls -t /tmp/collection-backups/*.sql.gz | head -1)
echo "$PASSWORD" > /tmp/reset-secret.txt
chmod 600 /tmp/reset-secret.txt
./scripts/restore-smoke.sh "$LATEST_BACKUP" /tmp/reset-secret.txt
rm /tmp/reset-secret.txt

echo "✓ backup & restore verified"
```

### 8. 访问系统
- **公开端**：`http://localhost:3000`（或 `https://<DOMAIN>` 如果配置了真实域名）
- **管理端**：`http://localhost:3000/admin`
  - 用户名：`admin`
  - 密码：步骤 5 生成的密码

---

## 部署完成检查清单

完成以上步骤后，确认以下项并**把结果告知项目架构师**：

- [ ] `docker images` 显示的 **app 与 worker 镜像实际 SIZE**（如 `325MB` / `310MB`）
- [ ] 步骤 6 的 5 项健康检查**全部 ✓**
- [ ] 步骤 7 备份→恢复演练**通过**（输出 `✓ backup & restore verified`）
- [ ] 能访问公开端首页并看到"每日推荐"或空状态
- [ ] 能用 admin 登录管理端

**通过后**，审计意见可直接上调为 **go**，系统即为生产就绪。

---

## 常用运维命令

### 查看日志
```bash
docker compose logs -f app worker
```

### 停止服务
```bash
docker compose down
```

### 重启服务
```bash
docker compose restart app worker
```

### 添加测试内容（管理端或 Telegram）
- 管理端：登录后点"添加新项"，粘贴 URL；
- Telegram：如果配置了 Bot，私聊发 URL 即可。

### 重置管理员密码
```bash
NEW_PASSWORD=$(openssl rand -base64 16)
echo "新密码：$NEW_PASSWORD"
echo "$NEW_PASSWORD" | docker compose exec -T app node --experimental-strip-types scripts/reset-admin-password.ts
```

---

## 故障排查

| 症状 | 排查 |
|---|---|
| 容器启动失败 | `docker compose logs <service>` 查看错误 |
| 缺 DATABASE_URL | 检查 `.env` 的 `DATABASE_URL` |
| 缺模型 API Key | 检查 `.env` 的 `OPENAI_API_KEY` / `EMBEDDING_API_KEY` |
| 问答超限 | 查看 `PUBLIC_ASK_IP_LIMIT` / `PUBLIC_ASK_GLOBAL_LIMIT` |
| Telegram 不响应 | 检查 `TG_BOT_TOKEN` / `TG_ALLOWED_IDS` |

完整排查见 [`docs/PRODUCTION_CONTEXT.md`](docs/PRODUCTION_CONTEXT.md)。

---

**需要帮助？** 联系项目架构师或查阅 `docs/PRODUCTION_CONTEXT.md`。
