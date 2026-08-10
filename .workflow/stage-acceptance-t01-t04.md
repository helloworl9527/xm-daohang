# 阶段验收 01：T01-T04 基础设施组

- 日期：2026-08-08（Asia/Shanghai）
- 验收提交：`6c31ec0`、`f36242e`、`799018e`、`817205b`
- 基准：`implementation-plan.md` rev5、`requirements.md` v0.4、`ui-spec.md` v0.4
- 结论：初验**退回**；`80241eb` 返工后于 2026-08-09 **复验通过**。T05 放行由架构师决定。

## 正向复跑证据

1. PostgreSQL：服务端 `16.14`，测试库 `collection_system_test`，pgvector `0.8.6`。
2. 干净库迁移：先删除 `public`/`drizzle` schema，再运行
   `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm exec drizzle-kit migrate`，退出 0；两条迁移均登记。
3. `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm test`：退出 0，6 files / 43 tests 通过。
4. `pnpm typecheck`：退出 0；`pnpm lint`：退出 0；`pnpm audit --prod`：退出 0，无已知漏洞。
5. 数据库目录核验：10 张 rev5 canonical 表齐全；`items.embedding` 为无 typmod `vector`（`atttypmod=-1`）；`items_retrievable_idx` 为 `(status, embedding_version, embedding_dim) WHERE embedding IS NOT NULL` 的普通 B-tree；无 HNSW/IVFFlat。
6. T04 新鲜基准：100/500/1000 行 recall@10 均为 1；P95 分别为 0.459/0.435/0.673ms。EXPLAIN 均为带 `completed/version/dim/non-null` 过滤的 `Seq Scan + Sort`，符合小规模精确扫描预期。
7. T02 反向探针：私网/保留地址、混合 DNS、私网重定向、HTTPS 降级、重定向环/第 6 跳、MIME、全链路超时均被拒绝。临时真实 `undici` 分块服务探针确认 1,500 字节上限溢出返回 `FETCH_BODY_TOO_LARGE`，慢流在溢出后被关闭；不可解析主机配合已审核地址可完成两跳，证明连接使用逐跳固定 IP。临时测试文件验后删除，未进入产品树。
8. DEV-001：`0000_initial.sql` 首句为 `CREATE EXTENSION IF NOT EXISTS vector`，含 `embedding vector` 的 `items` 建表在后；T04 的 `0001_exact_vector_scan.sql` 只增加过滤索引与 `ANALYZE`。运行时目录与 rev5 列集合一致，未发现 DEV-001 引入额外列或检索语义变更。

## 返工项

### R1：日志脱敏对嵌入 Error.message 的 URL fail-open

- 代码证据：`src/lib/log/logger.ts:23` 只在字符串以 `http(s)://` 开头时清理 URL；`src/lib/log/logger.ts:45` 直接用该函数处理 `Error.message`。
- 反向命令：

  ```sh
  node --experimental-strip-types --input-type=module -e "import {serializeLog} from './src/lib/log/logger.ts'; const s=serializeLog(new Error('fetch https://u:p@example.com/a?token=SECRET_TOKEN&x=1 failed')); console.log(s); if (s.includes('SECRET_TOKEN') || s.includes('u:p')) process.exit(42)"
  ```

- 实际：退出 42，输出仍含 `u:p` 与 `SECRET_TOKEN`。
- 期望：Error allowlist 保持不变，但 message/cause message 中出现的 URL userinfo 和敏感 query 也必须脱敏；增加能先失败、修复后通过的回归测试。

### R2：向量元数据 CHECK 可被 SQL NULL 与伪报维度绕过

- 代码证据：`src/db/schema.ts:66`、`src/db/migrations/0000_initial.sql:88`。第二分支缺少元数据 `IS NOT NULL`，也未校验 `vector_dims(embedding)=embedding_dim`。
- 反向结果 A：插入 `embedding='[1,2]'` 且 `embedding_dim/embedding_version=NULL` 成功；CHECK 结果为 NULL，PostgreSQL 视为通过。
- 反向结果 B：插入实际 2 维向量、声明 `embedding_dim=3`、`embedding_version=99` 成功；随后按 T04 合同过滤 dim=3 并与 3 维查询向量执行 `<=>`，数据库报 `different vector dimensions 2 and 3`。
- 期望：数据库约束必须保证三项要么全 NULL，要么向量非空、dim/version 均非空且合法，并保证实际向量维度等于 `embedding_dim`；新增迁移与集成反向测试，证明两类非法行均以 CHECK violation 被拒绝，合法混合维度/版本及精确扫描仍通过。

## 复验要求

返工后重新执行干净库 `drizzle-kit migrate`、整套 `pnpm test`、`typecheck`、`lint`、`audit --prod`，并重跑以上两个反向用例。T05 仍由架构师另行放行。

---

## 2026-08-09 返工复验（提交 80241eb）

- 结论：**通过**。R1/R2 均已关闭；本结论不直接放行 T05。
- 历史迁移完整性：`817205b` 与 `80241eb` 中 `0000_initial.sql` 的 Git blob 均为 `234ef751...`，`0001_exact_vector_scan.sql` 均为 `d7433f2b...`；修复仅新增 `0002_embedding_constraints.sql`，未回改历史迁移。
- R1 原始反向命令：退出 0，输出 `{"name":"Error","message":"fetch https://example.com/a?x=1 failed"}`，不含 `u:p` 或 `SECRET_TOKEN`。
- R1 扩展反向探针：覆盖 URL 位于字符串中段、同一字符串多个 URL、HTTP 大小写、Error message、`token/api_key/password/authorization/secret/signature/code/credential/key` 多参数；所有机密与 userinfo 均消失，`ok/keep/view/x/safe` 普通参数保留。定向 logger 测试 6/6 通过。
- R2 干净库：删除 `public`/`drizzle` schema 后运行 `DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test pnpm db:migrate`，退出 0；迁移账本含 0000/0001/0002 三条。
- R2 系统目录：`items_embedding_metadata_check` 与 `items_embedding_dimension_check` 均存在且 `convalidated=true`。
- R2 反向插入：向量非空且元数据 NULL 被 `items_embedding_metadata_check` 以 SQLSTATE `23514` 拒绝；实际 2 维但声明 dim=3 被 `items_embedding_dimension_check` 以 `23514` 拒绝；合法 2 维向量/dim=2/version=99 可插入（事务后回滚）。
- 环境：PostgreSQL 16.14（Homebrew），pgvector 0.8.6。
- 无回归：`pnpm test` 退出 0（6 files / 47 tests）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod`、`drizzle-kit check` 均退出 0；workflow validator 输出 `PASS: workflow stage=implementation revision=5`。
