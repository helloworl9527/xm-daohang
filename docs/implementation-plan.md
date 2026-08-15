# Ink & Signal 视觉重设计实施计划

**Plan revision:** 5

> **For agentic workers:** 按阶段顺序实施，每个阶段使用 checkbox 跟踪；每阶段完成后必须独立运行其测试与三视口验收，再进入下一阶段。

**目标：** 在不改变 API、DTO、路由和数据模型的前提下，将公开端与管理后台迁移到已确认的 Ink & Signal 暖白亮色视觉体系，并优化搜索、问答、目录和后台工作流的信息层级。

**架构：** 继续使用 Next.js 15.5 App Router、React 19、纯 CSS 和现有 Lucide 图标。先新增命名隔离的设计 tokens 与回归测试，再分公开端、后台壳与 Library、其余后台页面渐进应用；现有 class 名始终保留，新结构只追加修饰 class 和 ARIA 状态。

**技术栈：** TypeScript、React 19、Next.js 15.5、next-intl、Lucide React、纯 CSS、Vitest、Testing Library、Playwright。

## 全局约束

- 零破坏性迁移：保留现有 `--color-mist`、`--color-white`、`--color-ink`、`--color-search`、`--color-source`、`--color-signal`，不删除或重命名现有 class。
- 新 tokens 使用 `--ink-*` 前缀，避免与现有 `--color-ink` 同名冲突；组件按阶段选择性迁移，不在阶段 1 直接改变全站表现。
- 不引入 Tailwind、shadcn、MUI、Ant Design、CSS-in-JS、动画库或远程字体；当前需求不足以抵消依赖、构建和迁移成本。
- 不修改 `src/app/**/route.ts`、`src/lib/items/*.ts`、`src/lib/search/*.ts`、`src/db/schema.ts` 或迁移文件。
- 本里程碑开始前把已确认基线 `114c272c3a0bf9074060fe2cba256ca1d81f7e77` 记为 `M3_BASE_HEAD`；每阶段验收同时检查 `M3_BASE_HEAD..HEAD`（已提交改动）和工作区（未提交改动），不得只运行不含 commit range 的 `git diff`。
- `/search`、`/ask`、`/admin/api/**` 的方法、请求体、响应 DTO、错误码与缓存行为保持不变。
- 公开目录仍只展示 `web/github`；`doc` 仅在管理后台和语义问答中出现。
- 不新增“近期添加”接口、排序能力、GitHub stars/语言字段或 worker 状态接口；这些需要后端契约，明确排除。
- 所有新增可见文案同时加入 `src/messages/zh.json` 与 `src/messages/en.json`，并保持 key 集合完全一致。
- 全部图标来自已锁定版本的 `lucide-react@1.31.0`，不手写 SVG 或用文本符号替代图标。
- 所有阶段必须通过 `typecheck`、`lint`、相关 Vitest 和相关 Playwright；不得用截图代替语义和行为断言。
- 每阶段独立提交、独立部署、可通过回滚该阶段提交恢复；不夹带 API、数据库或无关重构。

### 跨阶段零破坏性门禁

- [ ] 在开始阶段 1 前执行并保存：`export M3_BASE_HEAD=114c272c3a0bf9074060fe2cba256ca1d81f7e77`，且 `git merge-base --is-ancestor "$M3_BASE_HEAD" HEAD` 必须成功；基线不匹配则停止实施并回到方案门禁确认，不得改用当前 HEAD 掩盖差异。
- [ ] 每阶段提交后及最终发布前都运行以下两组命令；任一命令产生输出或非零退出即停止交付：
  - `git diff --exit-code "$M3_BASE_HEAD"..HEAD -- ':(glob)src/app/**/route.ts' src/lib/items src/lib/search src/db/schema.ts src/db/migrations`
  - `git diff --exit-code -- ':(glob)src/app/**/route.ts' src/lib/items src/lib/search src/db/schema.ts src/db/migrations`
- [ ] 对不能仅靠文件路径证明的接口不变量运行现有契约测试：`tests/integration/keywordSearch.test.ts`、`tests/integration/publicAsk.test.ts`、`tests/integration/addItem.test.ts`、`tests/integration/library.test.ts`、`tests/integration/itemDetail.test.ts`、`tests/integration/settingsRoutes.test.ts`、`tests/integration/modelSettings.test.ts`、`tests/categories/api.test.ts`。这些测试须继续断言认证/授权与 CSRF fail-closed、请求 schema、状态码、错误 code、ETag/If-Match 和 `Cache-Control: no-store`。
- [ ] 公开数据隔离运行 `tests/integration/publicCorpus.test.ts`、`tests/categories/publicDirectory.test.ts` 与 `tests/e2e/public.spec.ts` 的 doc-only 场景，证明目录/关键词只返回 `web/github`，同时问答语料仍可包含 `doc`。
- [ ] `tests/unit/task12Contracts.test.ts` 继续作为中英文叶子 key 集合完全一致和 Lucide 版本锁定的门禁；新增文案不得依赖中文 fallback 掩盖英文缺项。
- [ ] `playwright.config.ts` 与所有会建表、删表、插入数据的 E2E fixture 统一从一个 fail-closed 测试数据库 helper 取连接串。helper 只接受 pathname 精确为 `/collection_system_test` 的本机 PostgreSQL URL，否则在迁移、webServer 启动或 seed 前抛错；禁止复用外部已启动服务（保留 `reuseExistingServer: false`），禁止使用调用者任意 `DATABASE_URL` 覆盖该保护。

---

## 阶段 1：设计系统基础与验收基线

### 交付目标

建立 Ink & Signal 的新增 CSS token、统一交互/可访问性规则和三视口 Playwright 基线。此阶段不重排页面 DOM，生产行为和页面信息架构保持原样。

### 文件清单

- **修改：** `src/app/globals.css`
- **修改：** `src/components/ui/Pressable.tsx`
- **修改：** `src/components/ui/MotionRegion.tsx`
- **修改：** `tests/unit/uiPrimitives.test.tsx`
- **修改：** `playwright.config.ts`
- **修改：** `tests/e2e/public.spec.ts`
- **修改：** `tests/e2e/i18n.spec.ts`
- **修改：** `tests/e2e/admin-add.spec.ts`
- **修改：** `tests/e2e/admin-library.spec.ts`
- **修改：** `tests/e2e/admin-detail.spec.ts`
- **修改：** `tests/e2e/admin-categories.spec.ts`
- **修改：** `tests/e2e/admin-settings.spec.ts`
- **修改：** `tests/e2e/admin-models.spec.ts`
- **新增：** `tests/e2e/testDatabase.ts`
- **新增：** `tests/unit/inkSignalContracts.test.ts`
- **新增：** `tests/unit/legacyClassContracts.test.ts`
- **新增：** `tests/unit/testDatabaseGuard.test.ts`
- **新增：** `tests/e2e/visual-foundations.spec.ts`

### 核心改动

- [ ] 在 `:root` 现有变量之后追加 `--ink-*` tokens，不覆盖旧变量：
  - 颜色：`--ink-canvas: #F6F5F2`、`--ink-surface: #FFFFFF`、`--ink-surface-muted: #EFEEE9`、`--ink-text: #17181A`、`--ink-text-muted: #686A70`、`--ink-line: #E4E2DC`、`--ink-accent: #E4573D`、`--ink-accent-hover: #C94732`、`--ink-accent-soft: #FBE8E3`、`--ink-success: #2E7D5B`、`--ink-warning: #B7791F`、`--ink-danger: #C53D3D`、`--ink-focus: #1669D3`。
  - 字体：`--ink-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`、`--ink-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace`；不加载远程字体，`letter-spacing: 0`。
  - 间距：`--ink-space-1: 0.25rem`、`--ink-space-2: 0.5rem`、`--ink-space-3: 0.75rem`、`--ink-space-4: 1rem`、`--ink-space-5: 1.5rem`、`--ink-space-6: 2rem`、`--ink-space-7: 3rem`、`--ink-space-8: 4rem`。
  - 表面：`--ink-radius-sm: 4px`、`--ink-radius-md: 8px`、`--ink-radius-pill: 999px`、`--ink-shadow-float: 0 12px 30px rgb(23 24 26 / 10%)`、`--ink-shadow-focus: 0 0 0 3px rgb(22 105 211 / 28%)`。
  - 动效：`--ink-motion-fast`、`--ink-motion-standard` 和统一 easing；时长控制在 120–400ms。
  - 层级：`--ink-z-content: 0`、`--ink-z-sticky: 20`、`--ink-z-locale: 50`、`--ink-z-drawer: 60`、`--ink-z-dialog: 80`、`--ink-z-skip: 100`。公开顶部栏/分类索引、设置 sticky nav、语言切换、移动抽屉、dialog、skip link 只使用这张表，不新增任意局部高值。
- [ ] 在 `globals.css` 末尾新增通用状态规则，仅作用于现有 `.pressable`、表单控件、链接和显式 opt-in 的 `.ink-interactive`：
  - hover 只改变颜色、边线或 2px 内的 transform，不改变盒模型尺寸。
  - active/pointer-down 使用现有 `data-pressed`，缩放不低于 `0.98`。
  - `:focus-visible` 使用 3px 高对比 focus ring，并保留 outline fallback。
  - disabled 对比度不低于 55%，保留可读标签和 `cursor: not-allowed`。
- [ ] 保持 `Pressable` 的即时 pointer-down 反馈和 cancel/leave 复位；补足 disabled 时不设置 pressed 状态，避免禁用按钮出现伪反馈。
- [ ] 保持 `MotionRegion` 的临界阻尼进入动画；确保动画只写 `transform`，且在 reduced motion 下不启动 `requestAnimationFrame`。
- [ ] 扩展媒体查询：
  - `prefers-reduced-motion: reduce` 禁止位移动画和骨架扫光，只保留静态或短 opacity 反馈。
  - `prefers-reduced-transparency: reduce` 将带 blur 的 opt-in 表面改为不透明背景并关闭 `backdrop-filter`。
  - `prefers-contrast: more` 提升边线和 focus ring 对比度。
- [ ] 新增 `tests/e2e/testDatabase.ts` 作为唯一 E2E 连接串事实源：导出固定 `TEST_DATABASE_URL` 和 `assertTestDatabaseUrl(url)`；断言协议为 PostgreSQL（`postgresql:`/`postgres:`）、hostname 仅本机 TCP 环回（`127.0.0.1`/`localhost`/`::1`）、pathname 精确 `/collection_system_test`，否则同步抛错。（rev6 架构师裁决：实际固定测试库为纯 TCP 环回 `postgresql://apple@127.0.0.1:5432/collection_system_test`，不使用 Unix socket 形式；原 rev5『本机 socket 可接受形式』措辞为冗余，收窄为仅 TCP 环回，安全姿态只增不减、更 fail-closed。若未来确需 socket，须再次修订本计划，不得由实现静默放宽或缩窄合同。）`playwright.config.ts` 的 `webServer.env.DATABASE_URL` 和上述 8 个含 DB client/seed 的 spec 全部导入该常量并在创建 `Pool` 前调用断言；删除各文件重复连接串。`testDatabaseGuard.test.ts` 必须覆盖生产库名、远程 host、空值拒绝和固定测试 URL 通过，并扫描 `tests/e2e` 只存在一个 `postgresql://` 字面量。
- [ ] 在 `playwright.config.ts` 增加 `chromium-tablet` 项目，固定 viewport `1024 × 768`；保留现有 `chromium-desktop` 的 `1440 × 1000`；把当前基于 iPhone 13 device descriptor 的 mobile 项目显式覆盖为 `390 × 844`，并保留 Chromium、touch/mobile 行为。配置使用 `assertTestDatabaseUrl(TEST_DATABASE_URL)` 的返回值注入 webServer，启动前即完成精确库名断言。
- [ ] `inkSignalContracts.test.ts` 读取 CSS 源文件，逐值断言上述批准 token（不只检查名称）、旧 token 仍存在、圆角不超过规范、三个 accessibility media query 和固定 z-index token 表存在，并扫描受迁移组件不得出现表外 z-index 数字。
- [ ] `legacyClassContracts.test.ts` 以固定 `M3_BASE_HEAD` 读取 `src/app/globals.css` 与本计划文件清单内既有 TSX 的 git blob。CSS 复用仓库已安装的 `jsdom` CSSOM：把源码放入隔离 `<style>`，递归遍历 stylesheet 与 `CSSGroupingRule.cssRules`，从每条 `CSSStyleRule.selectorText` 提取 class selector；TSX 复用 direct devDependency `typescript` 的 compiler API 提取静态 `className` token。不得新增依赖、依赖 pnpm 传递包路径或用单个正则代替解析。断言当前集合分别是 baseline 的超集；动态模板 class 至少保留其静态前缀；测试内用删除一个已知 class 的 fixture 证明 matcher 会失败。该测试只保护名称存在，不阻止同名 class 的视觉声明迁移。
- [ ] `visual-foundations.spec.ts` 在 `/` 和 `/admin/login` 检查三视口无横向溢出、focus ring 可见、主要点击目标最小高度、系统字体未触发外部字体请求。

### 验收标准

- **1440px：** `/` 和 `/admin/login` 无横向滚动；基础控件 focus ring 完整，点击/按下不引起布局跳动。
- **1024px：** 新增 Playwright tablet 项目可独立运行；页面不误进入 390px 手机布局，工具栏和表单可用。
- **390px：** 所有主按钮至少 44px，高度和文本不溢出；安全区 padding 生效。
- **中英文：** 切换语言后控件高度稳定，最长英文标签不截断；现阶段不新增产品文案。
- **键盘焦点：** Tab 顺序与 DOM 顺序一致，skip link、语言切换、输入框和按钮均有 `focus-visible`。
- **状态：** Pressable 的 normal/hover/pressed/disabled/focus 均可区分；reduced motion 下无位移动画；reduced transparency 下无 blur 依赖。
- **自动验证：**
  - `corepack pnpm exec vitest run tests/unit/uiPrimitives.test.tsx tests/unit/inkSignalContracts.test.ts tests/unit/legacyClassContracts.test.ts tests/unit/testDatabaseGuard.test.ts`
  - `corepack pnpm typecheck`
  - `corepack pnpm lint`
  - `corepack pnpm exec playwright test tests/e2e/visual-foundations.spec.ts`

### 依赖关系

无前置依赖。阶段 2、3、4 都依赖此阶段提供 tokens、交互状态和 1024px 验收项目。

### 风险点

- `globals.css` 已有多个后追加样式块，选择器优先级可能盖过基础状态；新规则必须使用低特异性 `:where()` 或显式 opt-in，禁止 `!important` 扩散。
- proposed token 中的 `--color-ink` 与旧变量同名但值不同；本计划用 `--ink-text` 隔离，防止阶段 1 意外重绘全站。
- WebKit 才支持的 `prefers-reduced-transparency` 在 Chromium 中无法真实模拟；以 CSS 合约测试加人工 Safari 检查补足。
- 新增 tablet project 会增加完整 E2E 时间；阶段内只跑相关 spec，最终再跑全量三项目。

---

## 阶段 2：公开端 `/` 首页重构

### 交付目标

将关键词搜索和 AI 问答整合为一个首屏检索工作区，重排分类索引与内容卡片，并保持原有两个请求端点、URL 查询参数和公开目录数据结构不变。

### 文件清单

- **修改：** `src/app/(public)/page.tsx`
- **修改：** `src/app/(public)/loading.tsx`
- **修改：** `src/app/(public)/_components/DirectoryShell.tsx`
- **修改：** `src/app/(public)/_components/KeywordSearch.tsx`
- **修改：** `src/app/(public)/_components/AskBar.tsx`
- **修改：** `src/app/(public)/_components/ResultPanel.tsx`
- **修改：** `src/app/(public)/_components/DirectoryView.tsx`
- **修改：** `src/app/globals.css`
- **修改：** `src/messages/zh.json`
- **修改：** `src/messages/en.json`
- **修改：** `tests/unit/directoryShell.test.tsx`
- **修改：** `tests/unit/directoryView.test.tsx`
- **修改：** `tests/unit/publicAskAvailability.test.ts`
- **修改：** `tests/unit/task12Contracts.test.ts`
- **修改：** `tests/unit/publicDirectoryArchitecture.test.ts`
- **修改：** `tests/e2e/public.spec.ts`
- **新增：** `tests/unit/publicDiscoveryModes.test.tsx`

### 核心改动

- [ ] `page.tsx` 保留 Server Component 的 readiness 查询和 `Suspense` 数据边界；把 `disabledReason` 传入 `DirectoryShell`，不再在目录之后渲染独立浮动 Ask dock。
- [ ] `DirectoryShell` 升级为公开端检索编排器：
  - 使用显式 reducer 状态 `{mode, draft, keywordResult, askResult, activeRequest}`；`draft` 是唯一输入事实源，模式切换不清空输入，但每种模式的结果状态分别保存且只显示当前模式结果。
  - keyword 提交先对提交瞬间的 draft 做现有 NFKC/trim/控制字符/1–100 字符校验，再通过 `router.push("/?q=...")` 驱动 `POST /search`；只在进入页面、浏览器前进/后退或 keyword 提交确认后用 URL `q` 同步 draft，ask 模式输入期间的普通 render/响应不得被旧 URL 覆盖。
  - ask 提交对提交瞬间的 draft 做现有 trim/1–500 字符校验并复用 `AskExperience` 的 `POST /ask` 请求/响应合同；不得把问题写入 URL。响应期 `429` 或 `error.code === "RATE_LIMITED"` 映射 `limited`；`503` 或 `error.code === "MODEL_UNAVAILABLE"` 映射独立 `unavailable`（覆盖首屏 readiness 之后进入 rebuilding/failed 的竞态）；其他非 2xx/非法响应映射 `error`；200 且 sources 为空映射 `empty`，200 且 answer/sources 合法映射 `success`。不得改服务端 code/status/DTO。
  - 每次提交生成递增 request id，并为 `/search` 与 `/ask` 分别持有 `AbortController`。新提交取消同模式旧请求；模式切换取消离开模式的客户端请求并使其 request id 失效；只有当前 mode + 当前 request id 的响应可以落入状态。Abort 不显示错误，陈旧 success/error/limited 均不得覆盖当前模式。
  - ask loading 时可以切回 keyword；返回 ask 后显示 idle 或最近一次已完成结果，不显示已取消请求的结果。keyword URL 在 ask 模式因浏览器前进/后退变化时，仅更新保存的 keyword query/result；切回 keyword 时才把该 URL query 恢复到共同输入。
  - 模式使用有明确 label 的分段控件、`aria-pressed` 或 tabs 语义；键盘可左右移动并回到输入框。
- [ ] `KeywordSearch` 和 `AskExperience` 改为无请求所有权的受控视图：接收共同的 value/onChange/submit/state；网络请求、request id 与结果状态只归 `DirectoryShell` 所有。仅渲染当前模式所需按钮、帮助文本和字符上限；保留现有 form 可访问名称、字段名和请求格式。`disabledReason` 由 `page.tsx` 继续传入：ask 模式可被选择，但输入/提交 fail-closed 禁用并在同一工作区显示原因；keyword 始终不受模型 readiness 影响。
- [ ] `ResultPanel` 从页面底部浮层改为输入区下方的正常文档流工作区；成功、空、限流、模型不可用、上游错误保持独立语义，引用来源继续使用现有响应字段。`publicDiscoveryModes.test.tsx` 必须覆盖初始 disabledReason 和请求期 `MODEL_UNAVAILABLE` 两条不可用路径，并断言后者不误报限流/通用错误。
- [ ] 顶部 `.public-header` 改为暖白 sticky 工具栏：品牌左置，分类锚点、语言切换和管理入口清晰分组；不增加“近期添加”等无数据支持入口。
- [ ] `DirectoryView` 将现有分类索引改为桌面左侧 sticky 文本索引：
  - 1440px 为 `180–220px` 索引 + 内容网格。
  - 1024px 可保持窄侧栏 + 2 列卡片。
  - 390px 变为横向滚动标签栏 + 单列卡片。
  - 保留空分类和未分类末尾规则；`aria-current="location"` 同步视觉状态。
- [ ] `SiteLink` 在不改 `SiteCard` DTO 的前提下用单一纯函数安全推导展示类型。该函数只在 `try/catch` 内解析 `new URL(site.url)`，仅接受 `http:`/`https:`；hostname 小写并去除单个 `www.` 后等于 `github.com` 且 path 至少有非空 `owner/repo` 两段时才返回 GitHub 展示元数据。解析失败、非 HTTP(S)、非 GitHub 或 path 不完整一律回退 web，使用安全的原字符串/占位 hostname，绝不抛错或构造新的导航 URL：
  - 所有卡片保留 `.directory-card`，追加 `.directory-card--web` 或 `.directory-card--github`。
  - 网页使用 favicon/Globe，显示域名、标题、两行摘要和标签。
  - GitHub 使用 Lucide `Github`，从 URL path 显示 `owner/repo`，显示 `GitHub` 类型徽标。
  - 不展示 stars、语言、更新时间等当前 DTO 不具备的字段。
- [ ] `loading.tsx` 与搜索骨架使用真实卡片相同的固定网格轨道、最小高度和摘要行占位；不使用会改变布局的 shimmer。
- [ ] 中英文字典新增检索模式、类型徽标、工作区标题和状态文案；保持既有 error code 到 UI 状态的映射；`task12Contracts` 对两份字典递归叶子 key 集合做严格相等断言。
- [ ] CSS 采用 `--ink-*` tokens，保留所有现有公开端 class；新布局只追加 `.public-discovery-*`、mode 和 card modifier class。

### 验收标准

- **1440px：** 首屏同时看见品牌、统一检索工作区和第一组目录内容；左侧索引 sticky，内容为稳定 3 列；页面底部不再有覆盖内容的 Ask dock。
- **1024px：** 索引和 2 列卡片均可用，搜索/问答控件不换成不可读的窄按钮；滚动时 sticky 元素不互相遮挡。
- **390px：** 分类索引横向可滚动，卡片单列；虚拟键盘出现时输入和提交按钮可见，无 fixed dock 遮挡结果。
- **中英文：** 模式 label、占位符、错误、空状态和 GitHub 类型标签均翻译；英文长文案换行但不改变控件命中区域。
- **键盘焦点：** Tab 顺序为工具栏 → 模式 → 输入 → 提交 → 分类 →卡片；分类跳转后目标标题获得焦点；清除搜索后焦点回输入框。
- **空/加载/错误：** 覆盖空目录、空分类、搜索无结果、目录读取失败、搜索失败、问答无来源、限流、模型不可用和问答上游失败；输入工作区始终留在原位。
- **数据契约：** 网络断言只出现现有 `POST /search` 和 `POST /ask`；请求 JSON 与当前相同，公开卡片不读取新增字段。
- **自动验证：**
  - `corepack pnpm exec vitest run tests/unit/directoryShell.test.tsx tests/unit/directoryView.test.tsx tests/unit/publicAskAvailability.test.ts tests/unit/publicDiscoveryModes.test.tsx tests/unit/task12Contracts.test.ts tests/unit/publicDirectoryArchitecture.test.ts tests/integration/keywordSearch.test.ts tests/integration/publicAsk.test.ts tests/integration/publicCorpus.test.ts tests/categories/publicDirectory.test.ts`
  - `corepack pnpm typecheck && corepack pnpm lint`
  - `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-desktop`
  - `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-tablet`
  - `corepack pnpm exec playwright test tests/e2e/public.spec.ts --project=chromium-mobile`

### 依赖关系

依赖阶段 1。与阶段 3 没有代码依赖，可在阶段 1 验收后分别开发，但合并时按阶段编号顺序。

### 风险点

- 搜索状态目前由 URL 驱动，问答状态是本地状态；合并输入时最容易出现 mode 切换后误发请求、丢 draft 或陈旧响应覆盖新状态，必须以状态机测试锁定。
- `AskExperience` 当前包含 `visualViewport` 和 vibration；移除 fixed dock 后应删除只服务于键盘 dock 的状态，保留振动需确认非关键反馈且失败不影响提交。
- 分类索引 sticky 与全局语言切换/顶部栏可能叠层冲突；需统一 sticky offset 和 z-index，而不是逐组件随意加高值。
- GitHub 类型由 URL 推导；必须捕获非法 URL 并回退为 web，不能因展示逻辑抛错中断整个目录。
- 原架构测试断言 `<AskExperience>` 位于 `page.tsx`；组件归属变化时要改为行为契约，避免测试绑定内部实现。

---

## 阶段 3：管理后台壳与 Library

### 交付目标

将管理端改造成 240px 固定侧栏/移动抽屉工作台，并把收藏库改为紧凑、可扫描的行卡片；现有筛选、游标分页和详情链接完全保留。

### 文件清单

- **修改：** `src/app/admin/(protected)/layout.tsx`
- **修改：** `src/app/admin/(protected)/AdminNav.tsx`
- **修改：** `src/app/admin/(protected)/library/LibraryView.tsx`
- **修改：** `src/app/admin/(protected)/library/LibraryFilters.tsx`
- **修改：** `src/app/admin/(protected)/library/LibraryList.tsx`
- **修改：** `src/app/globals.css`
- **修改：** `src/messages/zh.json`
- **修改：** `src/messages/en.json`
- **修改：** `tests/unit/libraryList.test.tsx`
- **修改：** `tests/unit/task12Contracts.test.ts`
- **修改：** `tests/e2e/admin-library.spec.ts`
- **新增：** `tests/unit/adminNav.test.tsx`
- **新增：** `tests/unit/libraryFilters.test.tsx`
- **新增：** `tests/e2e/admin-shell.spec.ts`

### 核心改动

- [ ] `layout.tsx` 保留 `requireAdminPage()` 服务端鉴权，建立 admin chrome 容器和内容滚动边界；不把 session 或 CSRF 数据下放给纯导航组件。
- [ ] `AdminNav` 保留 `.admin-sidebar`、`.admin-brand`、`.admin-nav`，追加三组语义结构和标题：
  - 收藏库：添加收藏 `/admin`、全部收藏 `/admin/library`。
  - 整理：分类工作台 `/admin/categories`。
  - 系统：模型与嵌入 `/admin/settings/models`、运行设置 `/admin/settings`。
  - 使用 `usePathname()` 设置 `aria-current="page"`；`/admin/library/[id]` 仍高亮全部收藏，模型页不会同时高亮运行设置。
- [ ] 侧栏底部呈现现有语言切换和退出登录。语言仍只有根布局中的一份 `LocaleSwitcher` 状态；退出使用既有 `logoutAction` server action，不新增 API，不复制 session/token 到客户端。登出表单继续依赖既有 same-origin server-action 边界，成功销毁服务端 session、清 cookie 并跳转 `/admin/login`；失败不得在客户端假装退出。
- [ ] 桌面侧栏固定为 240px、视口高度 100%，主内容独立自然滚动；不在侧栏显示伪造的 worker 在线状态。
- [ ] 移动端增加 `.admin-mobile-bar` 和抽屉开关：使用 Lucide `Menu`/`X`；关闭时导航使用 `inert` + `aria-hidden`（或等价的卸载策略）确保不可聚焦；打开时保存触发器、focus 移入首个可操作项、Tab/Shift+Tab 循环在抽屉内，Escape/遮罩/导航链接关闭并把 focus 返回仍连接的触发器，背景内容 inert、背景滚动锁定；组件卸载时恢复 `overflow`/inert，路由变化不得遗留锁定。
- [ ] 语言切换继续复用根布局的 `LocaleSwitcher`，仅调整其在 admin chrome 内的定位/外观；本阶段不复制第二份语言状态。
- [ ] `LibraryFilters` 保留 `q/tags/status` 字段和提交/清除回调，重排为一行 filter rail；390px 时垂直堆叠。标签仍以逗号输入，不改变查询序列化。
- [ ] `LibraryList` 每个 `<li>` 保留 `.library-item`，内部改为三段：
  - 类型区：Lucide `Globe2`、`Github`、`FileText` 与本地化类型文本，直接使用已有 `item.type`。
  - 主信息区：标题、原 URL、两行摘要、失败原因。
  - 元数据区：带图标的状态、标签、来源、更新时间、详情入口。
  - 状态使用颜色 + Lucide 图标 + 文本，不只依赖颜色。
- [ ] 详情入口保持 `/admin/library/[id]`；原 URL 仍是新窗口外链。不要用包裹整个卡片的 `<a>` 造成嵌套链接，可用显式详情链接或无嵌套的 stretched-link 技术。
- [ ] `LibraryView` 保留 fetch、filters、`nextCursor` 和“加载更多”逻辑；重做加载骨架、空列表、无匹配、网络错误和 loading-more 状态，使占位尺寸与行卡片一致。
- [ ] CSS 迁移到 `--ink-*`，桌面内容最大 1280px；普通列表行仅用细边线/表面色，默认不加浮动阴影。

### 验收标准

- **1440px：** 240px 侧栏保持固定，三组导航层级清楚；Library 行卡片信息可在一屏扫描，筛选和“添加收藏”主动作可见。
- **1024px：** 侧栏不挤压内容至溢出；筛选可以两行排布；列表元数据列保持对齐，不出现横向滚动。
- **390px：** 显示顶部栏 + 抽屉而非常驻侧栏；抽屉不超过视口、可 Escape/遮罩关闭；筛选和列表单列，长 URL 可换行。
- **中英文：** 三组导航、类型、状态和筛选文案双语齐全；英文 `Embedding & models` 等长标签不会盖住图标。
- **键盘焦点：** 抽屉 focus return、当前页 `aria-current`、筛选提交/清除、外链和详情链接顺序合理；加载更多可由 Enter/Space 触发。
- **空/加载/错误：** 空库、筛选无结果、首次加载、加载更多、列表读取失败、failed item 都有稳定布局和可恢复动作。
- **数据契约：** `queryFor()` 输出、`GET /admin/api/items` 参数、cursor 合并和 `LibraryItemDto` 不变；不新增排序或批量 API。
- **自动验证：**
  - `corepack pnpm exec vitest run tests/unit/adminNav.test.tsx tests/unit/libraryFilters.test.tsx tests/unit/libraryList.test.tsx tests/unit/task12Contracts.test.ts tests/unit/adminGuard.test.ts tests/integration/login.test.ts tests/integration/library.test.ts`
  - `corepack pnpm typecheck && corepack pnpm lint`
  - `corepack pnpm exec playwright test tests/e2e/admin-shell.spec.ts tests/e2e/admin-library.spec.ts --project=chromium-desktop`
  - `corepack pnpm exec playwright test tests/e2e/admin-shell.spec.ts tests/e2e/admin-library.spec.ts --project=chromium-tablet`
  - `corepack pnpm exec playwright test tests/e2e/admin-shell.spec.ts tests/e2e/admin-library.spec.ts --project=chromium-mobile`

### 依赖关系

依赖阶段 1；不依赖阶段 2。阶段 4 依赖此阶段的 admin chrome 和通用后台表面规则。

### 风险点

- `AdminNav` 是 Client Component，当前页判断必须正确处理 `/admin` 与 `/admin/settings/models` 的前缀冲突，使用显式 matcher 而不是简单 `startsWith("/admin")`。
- 移动抽屉需要焦点和滚动管理；不得用只改变 `display` 的实现造成焦点落在隐藏导航中。
- 根级 `.locale-switcher` 当前 fixed；后台抽屉打开时可能覆盖关闭按钮，需要在 admin shell 中规定层级和移动端位置。
- 列表卡片包含外链和详情链接，整卡点击设计容易形成无效嵌套交互；计划明确保留两个独立可访问链接。
- E2E 使用真实测试数据库并会清表；只能连接 `collection_system_test`，不得指向生产数据库。

---

## 阶段 4：详情、表单与其余后台页面

### 交付目标

把详情、添加、登录、分类工作台和设置页统一到后台壳与设计 tokens，完成整个管理端视觉迁移；不更改其异步任务、表单提交或设置保存逻辑。

### 文件清单

- **修改：** `src/app/admin/login/page.tsx`
- **修改：** `src/app/admin/login/LoginForm.tsx`
- **修改：** `src/app/admin/(protected)/add/AddItemForm.tsx`
- **修改：** `src/app/admin/(protected)/library/[id]/ItemDetail.tsx`
- **修改：** `src/app/admin/(protected)/library/[id]/SummaryEditor.tsx`
- **修改：** `src/app/admin/(protected)/library/[id]/CategorySelector.tsx`
- **修改：** `src/app/admin/(protected)/library/[id]/DeleteItemDialog.tsx`
- **修改：** `src/app/admin/(protected)/categories/page.tsx`
- **修改：** `src/app/admin/(protected)/categories/_components/CategoryWorkbench.tsx`
- **修改：** `src/app/admin/(protected)/settings/page.tsx`
- **修改：** `src/app/admin/(protected)/settings/SettingsNav.tsx`
- **修改：** `src/app/admin/(protected)/settings/models/page.tsx`
- **修改：** `src/app/admin/(protected)/settings/models/ModelSettingsForm.tsx`
- **修改：** `src/app/admin/(protected)/settings/LocalePanel.tsx`
- **修改：** `src/app/admin/(protected)/settings/RateLimitPanel.tsx`
- **修改：** `src/app/admin/(protected)/settings/RefetchPanel.tsx`
- **修改：** `src/app/admin/(protected)/settings/SecurityPanel.tsx`
- **修改：** `src/app/admin/(protected)/settings/TelegramPanel.tsx`
- **修改：** `src/app/globals.css`
- **修改：** `src/messages/zh.json`
- **修改：** `src/messages/en.json`
- **修改：** `tests/unit/loginPage.test.tsx`
- **修改：** `tests/unit/addItemForm.test.tsx`
- **修改：** `tests/unit/itemDetail.test.tsx`
- **修改：** `tests/unit/categoryWorkbench.test.tsx`
- **修改：** `tests/unit/modelSettingsForm.test.tsx`
- **修改：** `tests/e2e/admin-add.spec.ts`
- **修改：** `tests/e2e/admin-detail.spec.ts`
- **修改：** `tests/e2e/admin-categories.spec.ts`
- **修改：** `tests/e2e/admin-settings.spec.ts`
- **修改：** `tests/e2e/admin-models.spec.ts`

### 核心改动

- [ ] 登录页采用与公开端一致的暖白画布、单一紧凑登录表面和明确 focus/error 状态；认证 server action、限流提示和跳转不变。
- [ ] `AddItemForm` 保留单 URL 输入、模型未配置提示和 `POST /admin/api/items`：
  - 输入后仅通过 URL 后缀/hostname 给出“可能是网页/GitHub/文档”的视觉提示，不作为请求字段或校验来源。
  - 提交成功只显示服务器已经确认的 `processing`/deduped 状态和详情链接；不伪造抓取、摘要、向量、分类百分比。
  - busy、duplicate、模型未配置、网络错误均就地显示，输入内容在失败时保留。
- [ ] `ItemDetail` 使用主列 + 元数据侧栏：
  - 主列包含标题/原链接、摘要编辑、标签、分类选择。
  - 侧栏包含状态、类型、来源、创建/更新时间、重抓和删除。
  - 保留 ETag/If-Match 并发控制、manual summary/category 保护、重抓状态和删除后跳转。
- [ ] `DeleteItemDialog` 和分类确认 dialog 统一使用浮层 shadow、实色 surface、scrim 与 source-anchored focus；打开时 focus 限定，关闭后返回触发器，Escape 行为一致。
- [ ] 分类工作台保持现有提案、diff、人工分类保护、reclassification run 和 retry 状态机；只重排为主工作区 + sticky 概览，并用 accent/警告/危险语义区分 add/rename/merge/delete。
- [ ] 设置页保持一个页面内的 settings anchor nav；各 panel 改为无嵌套卡片的全宽 section + 分隔线。模型页和设置页共享表单、字段、保存/测试反馈样式。
- [ ] 所有 form 控件统一 label、helper、error、success、disabled 和 fieldset 间距；数值输入、select、checkbox/toggle 使用原生语义，不把二元设置改成文本按钮。
- [ ] 将后台剩余硬编码旧色值逐段替换为 `--ink-*` 引用，但保留旧变量定义和所有现有 class；只删除确定无引用且由本阶段新增规则完全覆盖的声明，不删除 class block。
- [ ] 更新双语文案仅用于新增类型提示、区块标题和状态说明；安全、模型、Telegram 等现有字段含义不变。

### 验收标准

- **1440px：** 详情页主列/侧栏比例约 2:1，操作不会散落；分类概览 sticky；设置 section 易扫描且没有卡片套卡片。
- **1024px：** 详情侧栏可转为顶部/底部全宽区域，表单 label 和按钮不挤压；分类 diff 与设置字段不横向溢出。
- **390px：** 所有页面单列；dialog 在安全区内可滚动；危险操作按钮不与取消按钮错位；软键盘下可见当前字段错误。
- **中英文：** 登录、添加、详情、分类、模型、定时任务、限流、安全、Telegram、语言所有可见文案双语一致；长错误文本不遮挡后续控件。
- **键盘焦点：** 登录、添加、编辑、设置可仅键盘完成；dialog 有 focus trap/return；类别 decision、checkbox、select 具有可见 focus 和正确 label。
- **空/加载/错误：** 详情首次加载/不存在/网络错误、摘要保存冲突、重抓失败、添加重复/模型未配置、分类无建议/部分失败、模型测试失败、设置保存失败均有稳定状态。
- **数据契约：** 所有现有 request body、CSRF header、ETag header、API 路径和 redirect 不变；无 schema/migration diff。
- **自动验证：**
  - `corepack pnpm exec vitest run tests/unit/loginPage.test.tsx tests/unit/addItemForm.test.tsx tests/unit/itemDetail.test.tsx tests/unit/categoryWorkbench.test.tsx tests/unit/modelSettingsForm.test.tsx tests/integration/addItem.test.ts tests/integration/itemDetail.test.ts tests/integration/settingsRoutes.test.ts tests/integration/modelSettings.test.ts tests/categories/api.test.ts`
  - `corepack pnpm typecheck && corepack pnpm lint`
  - `corepack pnpm exec playwright test tests/e2e/admin-add.spec.ts tests/e2e/admin-detail.spec.ts tests/e2e/admin-categories.spec.ts tests/e2e/admin-settings.spec.ts tests/e2e/admin-models.spec.ts --project=chromium-desktop`
  - `corepack pnpm exec playwright test tests/e2e/admin-add.spec.ts tests/e2e/admin-detail.spec.ts tests/e2e/admin-categories.spec.ts tests/e2e/admin-settings.spec.ts tests/e2e/admin-models.spec.ts --project=chromium-tablet`
  - `corepack pnpm exec playwright test tests/e2e/admin-add.spec.ts tests/e2e/admin-detail.spec.ts tests/e2e/admin-categories.spec.ts tests/e2e/admin-settings.spec.ts tests/e2e/admin-models.spec.ts --project=chromium-mobile`

### 依赖关系

依赖阶段 1 和阶段 3；不依赖阶段 2 的公开端组件。建议在阶段 2、3 均合并后执行，以便最终统一回归。

### 风险点

- `CategoryWorkbench.tsx` 体积大、状态多，禁止为视觉重构重写状态机；只调整 DOM 分组、class 和 Lucide 图标，行为测试必须先保持通过。
- 详情写操作依赖 ETag 与 CSRF，移动 DOM 时不得把 form/button 移到丢失 token 或 handler 的边界外。
- 添加处理是后台异步任务，前端只有 `processing/completed/failed`，不可用假进度时间线误导用户。
- 设置页同时包含敏感 secret、checkbox、数值和异步测试状态；视觉统一不能把 masked key 当普通 placeholder 暴露，也不能启用 rebuilding 时应禁用的操作。
- 大量 CSS 后追加可能形成重复声明；本轮优先作用域清晰和零破坏，不做全文件重排或无关压缩。

---

## 最终集成与发布门槛

### 回归命令

- [ ] 为测试数据库应用迁移：
  - `DATABASE_URL="$(node --experimental-strip-types -e "import('./tests/e2e/testDatabase.ts').then(m => process.stdout.write(m.assertTestDatabaseUrl(m.TEST_DATABASE_URL)))")" corepack pnpm db:migrate`
- [ ] 运行完整静态与单元/集成测试：
  - `DATABASE_URL="$(node --experimental-strip-types -e "import('./tests/e2e/testDatabase.ts').then(m => process.stdout.write(m.assertTestDatabaseUrl(m.TEST_DATABASE_URL)))")" APP_TIMEZONE=Asia/Shanghai corepack pnpm test`
  - `corepack pnpm typecheck`
  - `corepack pnpm lint`
- [ ] 运行三视口全量 E2E：
  - `corepack pnpm exec playwright test --project=chromium-desktop`
  - `corepack pnpm exec playwright test --project=chromium-tablet`
  - `corepack pnpm exec playwright test --project=chromium-mobile`
- [ ] 验证生产构建：
  - `corepack pnpm build`

### 视觉验收矩阵

每阶段截图只作为辅助证据，统一保存到 `.workflow/screenshots/ink-signal/<phase>/`，至少覆盖：

| 页面/状态 | 1440px | 1024px | 390px | 中文 | English | 键盘 |
| --- | --- | --- | --- | --- | --- | --- |
| 公开目录默认/空/错误 | 必测 | 必测 | 必测 | 必测 | 必测 | 必测 |
| 关键词 loading/empty/success/error | 必测 | 必测 | 必测 | 必测 | 必测 | 必测 |
| 问答 disabled/loading/empty/success/limited/error | 必测 | 必测 | 必测 | 必测 | 必测 | 必测 |
| Admin 壳/抽屉/当前页 | 必测 | 必测 | 必测 | 必测 | 必测 | 必测 |
| Library loading/empty/filtered/failed item | 必测 | 必测 | 必测 | 必测 | 必测 | 必测 |
| 详情/添加/分类/设置/登录 | 必测 | 必测 | 必测 | 必测 | 必测 | 必测 |

### 发布前不变量

- 上文“跨阶段零破坏性门禁”的 commit-range 与工作区两组 `git diff --exit-code` 均退出 0；不得用 shell 未引用的 `src/app/**/route.ts` glob，也不得用只检查工作区的命令替代。
- `package.json` 的 runtime dependencies 不增加。
- 中英文 message key contract 测试通过。
- API 契约测试通过：`POST /search`、`POST /ask`、`/admin/api/**` 的认证/授权、CSRF、method、request/response DTO、错误 code/status、ETag/If-Match 与 no-store 行为均与基线一致。
- E2E 数据库 helper 在非 `/collection_system_test` URL 下必须先于迁移/启动/清表失败；全量 E2E 的所有 DB client 均使用该 helper，代码扫描无第二个连接串。
- 所有视口 `document.documentElement.scrollWidth <= window.innerWidth`。
- 浏览器控制台无未处理错误，外部网络请求不因字体、图标或视觉资产增加。
- CSP 不增加 `unsafe-inline`、远程字体源或额外图片域名。

## 建议提交边界

1. `feat(ui): add ink and signal design tokens`
2. `feat(public): redesign discovery and directory experience`
3. `feat(admin): redesign navigation and library workspace`
4. `feat(admin): align detail forms and settings workspace`

每个提交必须包含对应测试，不把下一阶段的半成品选择器或隐藏 DOM 提前合入。
