# 最终整体验收：T22–T25 与全局收尾

- 日期：2026-08-09
- 基准：`.workflow/implementation-plan.md` rev5、`.workflow/requirements.md` v0.4、`.workflow/ui-spec.md`
- 提交：`5435faa`、`f661ec7`、`cac18c3`、`782b5f1`、`f2d294c`
- 初验结论：**退回**
- R13 复验结论：**通过（整组实施完成）**

## 阻断返工项

### R13：最终 standalone 生产文件系统仍包含根项目 devDependency `typescript`

rev5 T25 与本轮明确验收标准要求生产镜像不含 devDependencies。`Dockerfile` 的 app target 原样复制 `/app/.next/standalone` 到最终文件系统；独立 `pnpm build` 后反向检查该目录确认：

```text
$ ls -ld .next/standalone/node_modules/typescript
.next/standalone/node_modules/typescript -> .pnpm/typescript@5.9.2/node_modules/typescript

$ du -sh .next/standalone/node_modules/.pnpm/typescript@5.9.2
9.1M

$ cd .next/standalone && node -e "require('typescript')"
typescript 5.9.2，可正常加载

$ test ! -e .next/standalone/node_modules/typescript
exit 1
```

`package.json` 明确把 `typescript: 5.9.2` 声明在 `devDependencies`。对照独立临时目录执行 `pnpm install --prod --ignore-scripts --frozen-lockfile --offline` 时，顶层 `node_modules/typescript` 不存在，说明这不是应用显式生产依赖，而是 build/standalone tracing 把已安装的 optional peer 带入了最终产物。Dockerfile 后续没有 prune/remove 步骤，因此 app 与继承它的 worker target 都会包含该包。

这也使 `.workflow/implementation-report.md` 中“最终镜像不复制开发依赖/生产不含 devDependencies”的陈述不准确。Docker 本机不可用不影响此项判定，因为被复制源目录和 COPY 路径均可直接复现。

期望结果：最终 app/worker 文件系统中不存在任何根项目 devDependency 的可加载包，至少增加对全部 `devDependencies` 的负向镜像/最终文件系统检查；修正 tracing/prune 后复跑 standalone app、worker、迁移和管理员脚本，并同步修正实施报告的产物大小与结论。

## 已通过证据

### T22 结构化观测与脱敏

- 事件调用点符合 rev5 字段合同：`item_added{source,deduped}`、`item_processed{ok,retries,ms}`、`public_ask{hit,empty,limited}`、`tg_ask{hit,ok}`、`tg_receipt{outcome,duplicate_possible}`、`login{ok}`。
- 全源码扫描未发现业务代码把不可信上游 message/body/cause/stack、问题原文、IP、chat ID 或 secret 直接传入 logger；模型探针只记录 allowlist 字段。
- 独立临时反向探针把两个内嵌 URL、userinfo、多敏感 query、嵌套 authorization/cookie/password/sessionToken 放入 Error/字段，序列化结果不含任一秘密，同时保留普通 query/字段；探针通过。
- 原生 `observability.test.ts` 再次以真实 DB 触发 add/process/ask/login/TG/receipt，敏感串扫描通过。

### T23 公开首页

- 生产 E2E 实测每日三条、命中/loading/无命中/超限/retryable error、空库与 rebuild 禁用、AI 中文不随界面语言变化、键盘/aria-live、320px 及三种偏好媒体查询。
- 桌面与移动均断言 `input.width == label.width`、`input.height == form.height`、`input.right <= button.left`，无横向溢出、无 console/page error。
- 人工查看 `.workflow/screenshots/t23-public-chromium-desktop.png` 与 mobile 截图：桌面三列错落、移动单列、固定底栏、文本与控件无横向裁切；CSS 六个基础色变量、focus-within、reduced-motion/transparency/contrast 均存在。

### T24 管理设置

- DB 默认限流为单 IP 20/日、全站 200/日；route 返回当前业务日与全站已用量。
- 改密在同一事务验证当前密码、更新 Argon2id 哈希并删除全部 sessions，错误密码/弱密码不改变哈希或会话；成功响应撤销 cookie，E2E 验证旧密码失效、新密码有效。
- Telegram DTO 只返回 token mask 与 allowedIds；数据库存 AES-GCM 密文，留空 token 保留旧值；非白名单消息零响应/零检索。
- 五个设置 PUT route 均复用 `requireAdminWrite` 并使用 strict Zod schema、no-store。独立探针对每个 route 发送 `application/jsonp`、`text/plain`、`application/json; foo=bar`，全部返回 415；设置、管理员哈希、会话身份/绝对期限零变化。
- 桌面/移动设置截图人工检查通过；六组面板、保存/错误/禁用状态代码与中英资源存在，E2E 完成定时、限流、TG、语言、改密闭环。

### T25 部署与恢复（除 R13）

- Compose 静态核验为 postgres/app/worker/caddy 四服务，仅 Caddy 发布 80/443；backend 为 internal。
- Caddy 先剥离客户端 `X-Real-Client-IP/X-Proxy-Auth/X-Forwarded-For/X-Real-IP`，再注入单值真实地址和共享密钥，并设置 HSTS、nosniff、DENY frame、Referrer/Permissions 等响应头。
- `.env.example` 仅含配置名、非秘密默认/占位值；各 HMAC/加密/代理密钥独立列出，OBS-01 在 README 与部署手册中明确。
- live dependency-free，ready 实测 DB/migration；worker heartbeat、pg-boss 注册与 graceful stop 原生集成测试通过。另直接以最终 `.next/standalone/server.js` + `WORKER_MODE=1` 启动，3101 live=200，`worker_heartbeats` 写入 `final-acceptance-worker|0.1.0|true`，SIGINT 退出 0。
- reset-admin-password 的错误用户、弱密码、session delete 故障回滚和成功撤销全部会话均通过真实 DB 测试；日志只含 `admin_password_reset{ok}`。
- backup/restore shell 语法通过；脚本包含 custom-format、0600、临时库、pgvector/migration/admin/secret/vector query 验证与清理边界。

### Docker 环境与报告

- `docker version`、`docker images` 均真实返回 `command not found`。实施报告明确标为环境阻塞、明确区分 310–340MiB 估算与真实 SIZE，并给出 build/images/compose/backup/restore 复现命令，没有伪造 `docker images` 输出。
- standalone 61M、其 node_modules 55M、static 1.0M 的本地数据可复现；基础层加本地产物的估算方法有来源与区间说明。R13 修正后应重新计算区间。
- 报告对 DEV-001、DEV-002、AR-001、OBS-01、迁移、功能范围和 Docker 阻塞的其余陈述与代码/历史验收证据一致。

## 全套门禁

- `pnpm install --frozen-lockfile`：退出 0，锁文件无变化。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- PG16+pgvector `pnpm db:migrate`：退出 0；`pnpm db:migrate:prod` 退出 0。
- `pnpm test`：41/41 files、252/252 tests 通过；pgvector recall@10=1，P95 100/500/1000 行分别 0.426/0.435/0.991ms，计划为带过滤的 `Seq Scan + Sort`。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- 独立 `pnpm build`：Next.js 15.5.23 退出 0，`.next/standalone/server.js` 存在。
- `pnpm e2e`：生产 standalone server，Chromium desktop/mobile 22/22 通过。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `sh -n scripts/backup.sh scripts/restore-smoke.sh`、`git diff --check`：退出 0。

## 操作边界

临时验收探针已删除；未修改产品代码，未部署、未打 Tag、未推送、未标项目 complete。Docker/compose/真实 restore drill 因本机无 Docker 未伪造执行。

---

## R13 复验（2026-08-09）

- 返工提交：`3713c63`
- 复验结论：**通过（R13 闭环，整组实施完成）**

### 生产纯净度与反向门禁

- 新鲜 `pnpm build` 在 Next 构建完成后执行 `verify-production-artifact.mjs --prune`，输出 `Production artifact excludes 15 root devDependencies.`。
- 独立读取 `package.json` 并遍历全部 15 个根 devDependencies；逐项检查 `.next/standalone/node_modules/<name>` 与 `.next/standalone/node_modules/.pnpm/<encoded-name>@*`，15 项均为 `top=0,pnpm=0`，`checked=15 leaked=0`。E2E 再次构建、复制 static 后复查仍为 0。
- 独立恶意 fixture 三种形态均被拦截：顶层 `node_modules/typescript` 真实目录、仅 `.pnpm/typescript@5.9.2` 实体、以及 R13 旧产物的“顶层 symlink + `.pnpm` 实体”；三者均退出 1，stderr 为 `DEV_DEPENDENCIES_PRESENT:typescript`。门禁对真实泄漏 fail closed。
- prune 后整个 standalone `find -L ... -type l` 的断链计数为 0；app 与 worker 使用同一已核验文件系统，worker 仅继承并改变 ENV/CMD。

### 模拟最终镜像文件系统

- 按 Dockerfile COPY 合同把 standalone、static、迁移、运维脚本及必要源码组装到独立 `/tmp/collection-final-app.*`；`drizzle-orm` 使用 `cp -RL` 等价解引用后为真实目录，根路径 `isDirectory=true,isSymbolicLink=false`，内部 symlink=0，包名为 `drizzle-orm`。
- 模拟文件系统内直接运行生产 migrator 成功；随后严格按脚本名运行 `pnpm db:migrate:prod` 也成功，运行前后 15 项门禁均通过，没有自动回装依赖。
- 模拟文件系统内用 0600 credential files 执行 `pnpm reset-admin-password`：新密码验证为 true、旧密码为 false、两条既有 session 清为 0；stdout/stderr 扫描不含旧/新密码，只记录 `admin_password_reset{ok:true}` 与固定成功文案。运行后门禁仍通过。
- 同一模拟文件系统直启 app：`/api/health/live` 与 ready 均 200，SIGINT 退出 0。以 `WORKER_MODE=1` 直启 worker：live=200，`worker_heartbeats` 写入 `r13-final-worker|0.1.0|true`，SIGINT 退出 0。

### 体积与报告

- 独立 build/prune 后 `du -sh` 为 standalone 52M、node_modules 46M、static 1.0M；E2E 将 static 复制进 standalone 后为 53M/46M/1.0M，与报告的计量口径一致。
- 模拟最终文件系统内解引用的 `drizzle-orm` 为 16M。以基础层解压 240.2MiB + standalone/static 约 53M + drizzle-orm 约 16M + 少量脚本/元数据估算 300–325MiB，区间包含约 309MiB 的主要组成，方法合理。
- `docker version` 与 `docker images` 再次真实返回 `command not found`。修订报告仍明确这是环境阻塞，300–325MiB 是估算而非 `docker images` SIZE，并保留可执行复现命令，未伪造。
- `.workflow/implementation-report.md` 已如实记录原 R13 误带 TypeScript 与原报告断言不准确、修复机制、15/15 门禁、新测试数和更新后的体积口径。

### 无回归门禁

- `pnpm install --frozen-lockfile`：退出 0，锁文件无变化。
- `pnpm audit --prod`：退出 0，`No known vulnerabilities found`。
- PG16+pgvector `pnpm db:migrate` 与 `pnpm db:migrate:prod`：均退出 0。
- `pnpm test`：41/41 files、254/254 tests 通过；包含 deploy smoke 7/7、F-01～F-12 与 R1～R12/R11b 相关回归。pgvector recall@10=1，100/500/1000 行 P95 为 0.477/0.623/0.663ms。
- `pnpm typecheck`、`pnpm lint`：退出 0。
- 独立 `pnpm build`：退出 0，末尾生产门禁 15/15 通过。
- `pnpm e2e`：生产 standalone，Chromium desktop/mobile 22/22 通过。
- workflow validator：退出 0，`PASS: workflow stage=implementation revision=5`。
- `sh -n scripts/backup.sh scripts/restore-smoke.sh`、`git diff --check`：退出 0。

本次只更新验收事实源；未修改产品代码，未部署、未打 Tag、未推送、未标项目 complete。
