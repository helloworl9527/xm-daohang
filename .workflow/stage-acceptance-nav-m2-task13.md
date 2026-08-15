# 导航站增强 M2 阶段验收：Task 13 观测、性能、回归与发布门禁

- 日期：2026-08-13（Asia/Shanghai）
- 验收提交：`114c272c3a0bf9074060fe2cba256ca1d81f7e77`
- 父提交：`486cb2a12ff35a272c6268f5a8c6069a2698104c`
- 基准：`implementation-plan-nav-enhancement.md` rev11 Task 13 与 Global Invariants
- 结论：**通过（带环境残余限制）**。Task 13 的代码、数据库、性能、恢复与发布门禁证据充分，放行 M2 实施后最终独立审计。

## 独立环境

1. 在 detached worktree `/tmp/xm-task13-accept.QnnGRH` 固定验收上述提交，核对 HEAD、父提交与干净 tracked worktree；产品代码未修改。
2. 使用独立 PostgreSQL 16 实例 `127.0.0.1:55432/collection_system_test`，真实执行 4 个迁移；所有数据库测试均显式使用该连接串。
3. 本机没有 Docker CLI（`docker: command not found`）。因此未执行真实 Docker build、compose 或容器内 restore；本记录不得解释为容器恢复已验证。

## 正向证据

1. 观测定向测试 2 files / 6 tests PASS。七类结构化事件只允许 `mode/outcome/count/ms/version/errorCode` 等约定字段，未记录内容、IP 或 hash。
2. 性能 fixture 为 500 条 eligible web/github 与 50 条 completed doc：目录固定 2 次查询，完整返回 500 条 eligible 并排除 doc；关键词 25 次样本，本次全量回归实测 p95 `1.08ms`（此前独立定向轮 `1.22ms`），均低于 1s。F202 多批尾部归并用例通过，未漏尾批。
3. 分类恢复路径：`propose` 12/12、`reclassify` 13/13；覆盖 41 条 cursor 断点续跑、重复投递不重计、失败明细派生与 crash recovery。
4. readiness、worker heartbeat、graceful stop 由构建后 `deploy-smoke` 7/7 验证。
5. 使用原生 `pg_dump -Fc` / `pg_restore` 做等价恢复演练。恢复库中分类存在、人工条目仍指向该分类、embedding 非空、run 状态为 `completed`、`applied_version=7`；vector 扩展、4 个迁移和向量距离查询正常，恢复库随后删除。
6. `env -u DATABASE_URL corepack pnpm build` exit 0；standalone prune 输出 `Production artifact excludes 15 root devDependencies`。`tsc --noEmit` exit 0；lint 0 error、1 条既有 prototype warning；`audit --prod` 输出 `No known vulnerabilities found`；workflow validator 为 implementation rev11 PASS；备份/恢复脚本 `sh -n` PASS。
7. 生产 standalone Playwright desktop/mobile 完整 26/26 PASS。
8. 独立数据库全量 Vitest：66/66 files、420/420 tests PASS，exit 0。`settingsRoutes` 已按 Asia/Shanghai 当前业务日生成 fixture，测试 6/6 PASS；这是 M1 固定日期测试修正，不是放宽产品行为断言。
9. `git diff --check` exit 0；验收提交的 detached 产品工作树干净；结束前无残留 Vitest、Next、迁移或 pg_restore 进程。

## Fail-closed 反向验证

1. 给 `keyword_search_completed` 事件注入禁止字段 `query` 后，观测合同测试触发 AssertionError、exit 1；恢复后 6/6 PASS，证明脱敏门禁不是 fail-open。
2. 将目录查询人为加上 `limit 499` 后，500 条全量断言失败、exit 1；恢复后固定 2 queries 且完整 500 条通过，证明性能门禁不会以静默截断换取速度。

## 残余限制

- 原生 PostgreSQL dump/restore 已验证分类、run、items 归类关系和向量恢复；但由于验收机无 Docker CLI，真实 Dockerfile 构建、compose 启动及容器 restore smoke 未执行。该项留给最终审计或具备 Docker 的发布环境复核，不宣称容器链路已通过。

## 裁决

- 结构化观测脱敏、500+50 性能基准、F202 全量处理、恢复语义、全量测试及 PA-01 非数据库构建门禁均符合 rev11。
- **Task 13 通过；M2 全部阶段性实施验收完成，放行实施后最终独立审计。**
