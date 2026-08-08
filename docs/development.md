# 开发基线

## 运行时

- Node.js 20 或更高版本
- pnpm 11.20.0（通过 Corepack 调用）

## 界面基础

全局样式只定义已批准的 6 个核心色值。按压、临界阻尼落位、材质表面和用户偏好退化由 `src/components/ui/` 中的共享组件提供，业务页面不应重复实现这些行为。

## 日志边界

所有结构化日志均应经 `src/lib/log/logger.ts` 输出。清洗器会移除密钥、Token、密码、Cookie、Authorization 头和 URL 中的敏感参数，并限制嵌套深度、数组与字符串长度。

## 外部网络边界

所有外部内容请求必须调用 `src/lib/fetch/safeFetch.ts` 导出的 `safeFetch`，不得在抓取器中直接调用 `fetch`、`undici.request` 或其他 HTTP 客户端。该出口会审查每一跳的全部 A/AAAA 地址，将实际连接固定到已审查 IP，并对协议降级、重定向上限、MIME、字节数和全链路超时关闭失败。

## 数据库

- 开发与集成验证使用 PostgreSQL 16 + pgvector。
- `DATABASE_URL` 为应用、worker 与迁移共用连接；未设置时数据库模块和 Drizzle 命令会报错退出。
- 初始迁移的第一条语句是 `CREATE EXTENSION IF NOT EXISTS vector`，保证无 typmod 的 `items.embedding` 列能在建表时解析。
- 集成测试只允许在名为 `collection_system_test` 的专用库中重建 `public`/`drizzle` schema，避免误伤其他数据库。

## 当前验证

```bash
corepack pnpm vitest run tests/unit/logger.test.ts tests/unit/uiPrimitives.test.tsx
corepack pnpm vitest run tests/unit/urlGuard.test.ts tests/integration/safeFetch.test.ts
DATABASE_URL=postgresql://apple@127.0.0.1:5432/collection_system_test corepack pnpm vitest run tests/integration/schema.test.ts
corepack pnpm typecheck
corepack pnpm lint
```
