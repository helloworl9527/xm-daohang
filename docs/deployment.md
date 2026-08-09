# 部署与恢复手册

## 首次部署

1. 从 `.env.example` 创建权限为 `0600` 的 `.env`，替换所有占位值。各 HMAC/加密/代理密钥必须独立生成并至少包含 32 字节随机量。
2. `DATABASE_URL` 使用容器主机名 `postgres`，并与 `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD` 对应；URL 保留字符必须编码。
3. 执行 `docker compose build`。app 与 worker 均来自 Next standalone 多阶段镜像，最终阶段不复制开发依赖。
4. 执行 `docker compose up -d`。app 在启动服务器前使用 drizzle-orm migrator 应用前向迁移；worker 仅在 app ready 后启动。
5. 检查 `docker compose ps`、`/api/health/live` 与 `/api/health/ready`。worker 健康检查要求 `worker_heartbeats` 中本实例 45 秒内有心跳。

Caddy 会先删除请求中的 `X-Real-Client-IP`、`X-Proxy-Auth`、`X-Forwarded-For` 与 `X-Real-IP`，再写入单值客户端 IP 和 `PROXY_SHARED_SECRET`。应用仅在共享密钥常量时间比较通过后信任 `X-Real-Client-IP`。更换反向代理或部署多节点时，必须同步密钥和剥离规则；不得直接暴露 app 端口。

## 管理员初始化

凭据只允许来自交互终端或权限为 `0600` 的文件。推荐文件方式：

```bash
install -m 600 /dev/null ./admin-username.secret
install -m 600 /dev/null ./admin-password.secret
# 在不共享屏幕/终端输出的环境中写入用户名和强密码
docker compose run --rm \
  -e ADMIN_USERNAME_FILE=/run/admin-username \
  -e ADMIN_PASSWORD_FILE=/run/admin-password \
  -v "$PWD/admin-username.secret:/run/admin-username:ro" \
  -v "$PWD/admin-password.secret:/run/admin-password:ro" \
  app pnpm init-admin
rm -f ./admin-username.secret ./admin-password.secret
```

初始化幂等。已有管理员用户名不匹配时脚本失败，不会覆盖账号。

## 密码恢复

恢复操作没有 HTTP/API 入口，只能由有主机/容器执行权限的运维者运行。沿用上面的两个 `0600` 凭据文件，将最后的命令替换为：

```bash
app pnpm reset-admin-password
```

脚本在同一事务内更新 Argon2id 哈希并删除所有会话；任何一步失败都会整体回滚。成功后所有旧 Cookie 失效，必须用新密码重新登录。日志只记录 `admin_password_reset{ok}`，不记录用户名和密码。

## 备份与恢复演练

创建权限为 `0600` 的 PostgreSQL custom-format 备份：

```bash
scripts/backup.sh ./backups
```

数据库 dump 不包含 `.env` 中的 `APP_ENCRYPTION_KEY`、`IP_HASH_KEY`、`LOGIN_IP_HASH_KEY`、`TG_ID_HASH_KEY` 和 `PROXY_SHARED_SECRET`。这些密钥必须以 `0600` 权限单独离线备份，且不得与数据库 dump 存放在同一位置。缺少原 `APP_ENCRYPTION_KEY` 时，恢复后的模型 Key 和 Bot Token 无法解密。

用备份和当前管理员密码执行临时数据库恢复演练：

```bash
chmod 600 ./restore-admin-password.secret
scripts/restore-smoke.sh ./backups/collection-system-时间.dump ./restore-admin-password.secret
```

演练创建临时数据库，验证 pgvector/迁移记录、管理员密码、加密设置解密和向量查询，随后强制删除临时数据库。至少每月执行一次，并在迁移、密钥轮换或回滚前后额外执行。

## 密钥轮换

- `PROXY_SHARED_SECRET`：同时更新 Caddy 与 app/worker 环境后整体重启，切换期间不得暴露 app 端口。
- `IP_HASH_KEY`、`LOGIN_IP_HASH_KEY`、`TG_ID_HASH_KEY`：轮换会改变新记录的 HMAC；先保留审计证据，再在维护窗口更新并重启。公开限流会形成新的 IP scope。
- `APP_ENCRYPTION_KEY`：不能直接替换。必须先用旧密钥解密并以新密钥重加密所有模型 Key、Telegram Token 与未完成回执中的 chat ID；当前版本没有在线轮换器，轮换前应停止服务并编写/审计一次性迁移脚本。

## 回滚

应用镜像只在确认旧版本与当前 schema 兼容后回切。数据库迁移采用前向兼容的 expand/backfill/switch/contract；不得执行未经恢复演练的破坏性 down migration。回滚前先运行 `scripts/backup.sh`，回切后检查 app ready、worker 心跳、登录、解密设置和向量检索。

GitHub 可选 Token 只提升公开 API 配额。抓取器始终要求仓库元信息 `private=false`，不会使用 Token 读取私有仓库。

## 镜像大小复核

当前 Dockerfile 提供独立的 app 与 worker target。应在有 Docker daemon 的构建主机执行以下命令获取真实 `docker images` SIZE：

```bash
docker build --target app -t collection-system-app:local .
docker build --target worker -t collection-system-worker:local .
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' collection-system-app:local
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' collection-system-worker:local
```

构建上下文受 `.dockerignore` 限制；最终阶段只复制 Next standalone、静态资源、迁移/运维脚本，以及生产迁移所需的 `drizzle-orm` 包，不复制开发依赖或完整 `node_modules`。
