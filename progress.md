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
