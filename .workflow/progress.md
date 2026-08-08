# 实施进度

## 2026-08-09：阶段验收返工 R1/R2

- 范围：仅修复 T01 日志内嵌 URL 脱敏 fail-open 与 T03/T04 embedding 元数据约束 fail-open；未进入 T05。
- 红灯：`pnpm vitest run tests/unit/logger.test.ts` 退出 1，新增 2 个日志用例失败；真实 PostgreSQL 上运行 `tests/integration/pgvector.test.ts` 退出 1，新增 2 个非法 embedding 插入均被数据库接受。
- R1：任意字符串位置的 HTTP(S) URL 均移除 userinfo，并删除 `token`、`key`、`secret`、`password`、`authorization` 等敏感 query 参数；Error 继续使用既定 allowlist，message/cause 经同一字符串清洗，stack 与其他可枚举字段不进入输出。
- R2：新增 `0002_embedding_constraints.sql` 前向迁移，严格要求 embedding 与 dim/version 全空或全合法，并校验 `vector_dims(embedding) = embedding_dim`；未修改既有迁移。
- 绿灯：日志定向测试 6/6；真实 PostgreSQL pgvector 定向测试 5/5，两类非法写入均以 SQLSTATE `23514` 拒绝；验收员原始日志反向命令退出 0。
- 全量验证：干净库迁移退出 0；`pnpm test` 为 6 files / 47 tests 通过；`pnpm typecheck`、`pnpm lint` 退出 0；`pnpm audit --prod` 报告无已知漏洞。
- 变更文件：`src/lib/log/logger.ts`、`tests/unit/logger.test.ts`、`src/db/schema.ts`、`tests/integration/pgvector.test.ts`、`src/db/migrations/0002_embedding_constraints.sql` 及 Drizzle migration metadata。
- 回滚：回退本次代码提交；数据库遵循批准的前向兼容策略，不执行破坏性 down migration。若应用代码需要回退，新约束可保留，不改变合法数据语义。
