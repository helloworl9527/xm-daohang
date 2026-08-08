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
