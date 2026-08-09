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

## 2026-08-09：T15 收藏库列表与筛选

- 红灯：路由集成测试因 `/admin/api/items/list` 不存在退出 1；组件测试因 `LibraryView` 不存在退出 1。
- 查询与边界：新增管理员鉴权 GET 路由，支持标题/总结/链接关键词、多标签交集、状态组合筛选以及 `updated_at,id` 稳定游标分页；响应仅显式映射展示 DTO，不返回 embedding、内部代际、canonical URL 或配置密文。
- 界面：实现 loading、空库、筛选无结果、失败/重试、加载更多状态；筛选写入 URL，桌面高密度列表与移动端单列均无溢出。
- 验证：真实 PostgreSQL 16 + pgvector 定向集成/单元测试 10/10；生产构建 Playwright 桌面/移动 2/2，正常筛选流程控制台零错误且无横向溢出；`pnpm typecheck`、`pnpm lint`、`git diff --check` 退出 0。
- 视觉证据：`.workflow/screenshots/t15-admin-library-desktop.png`、`.workflow/screenshots/t15-admin-library-mobile.png`。

## 2026-08-09：T16 条目详情编辑、重抓与删除

- 红灯：集成测试因 `/admin/api/items/[id]` 路由不存在退出 1；组件测试因 `ItemDetail` 不存在退出 1。
- API：新增鉴权 GET/PATCH/DELETE 详情管线与 POST refetch；PATCH 仅允许 summary，用数据库完整 `updated_at` 精度编码 ETag 实现乐观并发，成功后置 `summary_manual=true`；重抓复用 T12 事务且 processing 冲突返回 409；删除依靠既定 FK cascade 清理向量条目、处理 outbox、Telegram 回执与每日选择。
- UI：实现详情 loading/error/retry，人工总结编辑与失败草稿保留，processing 重抓禁用，原生 modal dialog 二次确认及关闭后焦点返回，保存/重抓/删除统一 `aria-live` 通知；桌面双列与移动单列均通过视觉核对。
- 安全与边界：所有写操作依次执行会话、Origin、CSRF、JSON Content-Type 与 schema 检查；详情 DTO 不返回 embedding、canonical URL、process generation、密文或 internal stack；无新增外部依赖与日志敏感文本。
- 新鲜全套验证：真实 PostgreSQL 16 + pgvector 下 `pnpm test` 27 files / 153 tests PASS（精确向量基准 100/500/1000 行 recall@10 均为 1）；`pnpm typecheck`、`pnpm lint`、`pnpm audit --prod` 退出 0（无已知漏洞）；`pnpm db:migrate` 成功；生产构建 Playwright 8/8 PASS；Web Interface Guidelines 新鲜规范复核通过。
- 视觉证据：`.workflow/screenshots/t16-admin-detail-desktop.png`、`.workflow/screenshots/t16-admin-detail-mobile.png`。
