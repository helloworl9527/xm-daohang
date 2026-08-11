const params = new URLSearchParams(location.search);

const state = {
  surface: params.get("surface") || "public",
  direction: params.get("direction") || "c",
  pageState: params.get("state") || "default",
  language: params.get("lang") || "zh",
  keywordQuery: "",
  keywordPhase: "default",
  aiMode: null,
  aiPhase: "idle",
  aiDiffs: [],
  rerunAutomatic: true,
  pendingDelete: null,
  categories: [
    { id: "ai", zh: "AI 与开发", en: "AI & Development", count: 3 },
    { id: "design", zh: "设计工具", en: "Design Tools", count: 2 },
    { id: "productivity", zh: "效率与协作", en: "Productivity", count: 2 },
    { id: "infra", zh: "数据与基础设施", en: "Data & Infrastructure", count: 2 },
    { id: "reading", zh: "阅读与知识", en: "Reading & Knowledge", count: 0 },
    { id: "uncategorized", zh: "未分类", en: "Uncategorized", count: 1, system: true },
  ],
  sites: [
    { category: "ai", title: "Anthropic Docs", domain: "docs.anthropic.com", summary: "Anthropic 模型与 API 的官方文档，覆盖提示设计、工具调用与生产环境接入。", tags: ["AI", "API"] },
    { category: "ai", title: "LangChain", domain: "langchain.com", summary: "用于构建语言模型应用的开发框架，提供检索、工具与工作流编排组件。", tags: ["AI", "框架"] },
    { category: "ai", title: "OpenAI Platform", domain: "platform.openai.com", summary: "OpenAI API 官方平台，集中提供模型文档、用量管理与开发指南。", tags: ["AI", "API"] },
    { category: "design", title: "Figma", domain: "figma.com", summary: "面向产品团队的协作设计工具，支持界面设计、原型与设计系统管理。", tags: ["设计", "协作"] },
    { category: "design", title: "Mobbin", domain: "mobbin.com", summary: "按产品与交互模式整理的移动端和网页界面参考库，便于检索真实产品案例。", tags: ["灵感", "UI"] },
    { category: "productivity", title: "Linear", domain: "linear.app", summary: "为软件团队设计的任务与项目管理工具，强调快速录入、键盘操作和清晰状态。", tags: ["项目管理", "团队"] },
    { category: "productivity", title: "Notion", domain: "notion.so", summary: "集文档、知识库与轻量数据库于一体的协作空间。", tags: ["知识库", "协作"] },
    { category: "infra", title: "PostgreSQL", domain: "postgresql.org", summary: "成熟的开源关系型数据库，支持向量检索、事务、扩展和丰富查询能力。", tags: ["数据库", "向量检索"] },
    { category: "infra", title: "Vercel", domain: "vercel.com", summary: "面向前端应用的部署平台，提供持续部署、边缘网络和运行观测能力。", tags: ["部署", "前端"] },
    { category: "uncategorized", title: "Small Web Notes", domain: "example.com", summary: "尚未找到可靠匹配分类的网页笔记，等待管理员人工归类。", tags: ["待整理"] },
  ],
};

const copy = {
  zh: {
    brand: "藏舟", admin: "管理端",
    directory: "目录", catalog: "分类索引",
    keywordLabel: "关键词找站点", keywordPlaceholder: "按标题、总结或标签查找站点…", keywordAction: "搜索站点",
    clear: "清空关键词",
    askPlaceholder: "向收藏库提问…", ask: "AI 提问", askTip: "回答仅来自收藏库 · 最多 10 条来源", quota: "原型额度 12 / 20",
    open: "查看原始链接", emptyGroup: "该分类暂时没有网站，标题仍保留。", prototype: "原型演示数据",
    loading: "正在整理导航目录", loadingDetail: "分类和站点卡片载入后会在原位显示。", empty: "导航目录还是空的",
    emptyDetail: "web 与 GitHub 内容处理完成后会出现在这里；文档不会进入目录。", error: "导航目录暂时不可用",
    errorDetail: "关键词框和 AI 问答仍可使用。请稍后重新载入目录。", retry: "重新载入",
    resultTitle: "关键词结果", resultMeta: (query, count) => `“${query}” · ${count} 个字面匹配`, noResult: "没有匹配的站点",
    noResultDetail: (query) => `标题、总结和标签中都没有“${query}”。未调用 AI。`, searching: "正在匹配目录条目…",
  },
  en: {
    brand: "Cangzhou", admin: "Admin",
    directory: "Directory", catalog: "Category index",
    keywordLabel: "Find a site by keyword", keywordPlaceholder: "Match title, summary, or tags…", keywordAction: "Find sites",
    clear: "Clear keyword",
    askPlaceholder: "Ask the collection…", ask: "Ask AI", askTip: "Answers only use the collection · Up to 10 sources", quota: "Prototype quota 12 / 20",
    open: "Open original", emptyGroup: "No sites in this category yet. The heading remains visible.", prototype: "Prototype demo data",
    loading: "Organizing the directory", loadingDetail: "Categories and cards will appear in place.", empty: "The directory is empty",
    emptyDetail: "Completed web and GitHub items appear here. Documents remain excluded.", error: "The directory is unavailable",
    errorDetail: "Keyword lookup and AI Q&A remain available. Please reload the directory later.", retry: "Try again",
    resultTitle: "Keyword results", resultMeta: (query, count) => `“${query}” · ${count} literal matches`, noResult: "No matching sites",
    noResultDetail: (query) => `No title, summary, or tag contains “${query}”. AI was not called.`, searching: "Matching directory items…",
  },
};

const t = () => copy[state.language];
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const categoryName = (category) => category[state.language] || category.zh;

function setUrl() {
  history.replaceState(null, "", `?${new URLSearchParams({ surface: state.surface, direction: state.direction, state: state.pageState, lang: state.language })}`);
}

function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.hidden = false;
  el.animate([{ opacity: 0, transform: "translate(-50%, 8px) scale(.98)" }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2400);
}

function header() {
  const c = t();
  return `<header class="site-header"><a class="brand" href="#" data-home><span class="brand-mark">${icon("library")}</span><strong>${c.brand}</strong></a><div class="header-actions"><a class="header-link" href="#" data-go-admin aria-label="${c.admin}">${icon("lock-keyhole")}<span>${c.admin}</span></a><div class="lang-switch" role="group" aria-label="Language"><button type="button" data-language="zh" aria-pressed="${state.language === "zh"}">中</button><button type="button" data-language="en" aria-pressed="${state.language === "en"}">EN</button></div></div></header>`;
}

function categoryNav() {
  return `<nav class="category-nav" aria-label="${t().catalog}"><strong>${t().catalog}</strong>${state.categories.map((category) => `<a href="#category-${category.id}" data-category-link="${category.id}">${escapeHtml(categoryName(category))}<span>${String(category.count).padStart(2, "0")}</span></a>`).join("")}</nav>`;
}

function siteCard(site) {
  const first = site.title.slice(0, 1).toUpperCase();
  return `<a class="site-card" href="https://${site.domain}" target="_blank" rel="noopener nofollow" data-site-card><span class="favicon" aria-hidden="true" title="${escapeHtml(site.domain)} favicon 回退">${escapeHtml(first)}</span><span class="site-copy"><h3>${escapeHtml(site.title)}</h3><p lang="zh-CN">${escapeHtml(site.summary)}</p><span class="tags">${site.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</span></span><span class="external-icon" aria-label="${t().open}">${icon("arrow-up-right")}</span></a>`;
}

function regularDirectory() {
  return `<div class="directory-shell">${categoryNav()}<div class="directory-content">${state.categories.map((category) => {
    const sites = state.sites.filter((site) => site.category === category.id).sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return `<section class="category-section" id="category-${category.id}" tabindex="-1" aria-labelledby="heading-${category.id}"><div class="category-heading"><h2 id="heading-${category.id}">${escapeHtml(categoryName(category))}</h2><span>${String(sites.length).padStart(2, "0")} SITES</span></div>${sites.length ? `<div class="site-grid">${sites.map(siteCard).join("")}</div>` : `<div class="empty-category">${icon("archive")} ${t().emptyGroup}</div>`}</section>`;
  }).join("")}</div></div>`;
}

function keywordView() {
  const presets = { "keyword-input": ["向量", "input"], "keyword-loading": ["向量", "loading"], "keyword-results": ["向量", "results"], "keyword-empty": ["量子排版", "empty"] };
  const [query, phase] = presets[state.pageState] || [state.keywordQuery, state.keywordPhase];
  const normalized = query.trim().toLocaleLowerCase();
  const results = normalized ? state.sites.filter((site) => [site.title, site.summary, ...site.tags].join(" ").toLocaleLowerCase().includes(normalized)) : [];
  return { query, phase, results };
}

function keywordSearch() {
  const c = t();
  const { query, phase } = keywordView();
  return `<div class="compact-search"><form class="compact-keyword-form" data-keyword-form role="search" aria-label="${c.keywordLabel}"><input id="keyword-input" name="keyword" autocomplete="off" aria-label="${c.keywordLabel}" value="${escapeHtml(query)}" placeholder="${c.keywordPlaceholder}" data-keyword-input />${query ? `<button type="button" class="keyword-clear" data-keyword-clear aria-label="${c.clear}">${icon("x")}</button>` : ""}<button class="button icon-button" type="submit" aria-label="${c.keywordAction}">${icon("search")}</button></form></div>`;
}

function directoryBody() {
  const c = t();
  if (state.pageState === "directory-loading") return `<div class="state-panel" aria-busy="true"><div>${icon("loader-circle")}<h2>${c.loading}</h2><p>${c.loadingDetail}</p><div class="site-grid" aria-hidden="true"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div></div></div>`;
  if (state.pageState === "directory-empty" || state.pageState === "directory-error") {
    const error = state.pageState === "directory-error";
    return `<div class="state-panel" ${error ? 'role="alert"' : ""}><div>${icon(error ? "wifi-off" : "folder-open")}<h2>${error ? c.error : c.empty}</h2><p>${error ? c.errorDetail : c.emptyDetail}</p>${error ? `<button class="button" type="button" data-retry>${icon("refresh-cw")} ${c.retry}</button>` : ""}</div></div>`;
  }
  const { query, phase, results } = keywordView();
  if (phase === "default" || !query) return regularDirectory();
  if (phase === "input") return `<div class="search-guidance"><div>${icon("corner-down-left")}<h2>输入完成，提交以查找站点</h2><p>搜索只匹配公开导航目录的标题、中文总结和标签，不生成答案。</p></div></div>`;
  if (phase === "loading") return `<div class="search-result-shell" aria-busy="true"><div class="search-result-heading"><div><p class="eyebrow">LITERAL MATCH</p><h2>${c.searching}</h2></div><span>不调用 AI</span></div><div class="site-grid"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div></div>`;
  if (phase === "empty" || results.length === 0) return `<div class="search-result-shell"><div class="search-result-heading"><div><p class="eyebrow">NO MATCH</p><h2>${c.noResult}</h2><p>${c.noResultDetail(escapeHtml(query))}</p></div><button class="button secondary" data-keyword-clear>${icon("x")} ${c.clear}</button></div><div class="empty-category">${icon("search-x")} 无匹配结果；常规分类目录暂时收起。</div></div>`;
  return `<div class="search-result-shell"><div class="search-result-heading"><div><p class="eyebrow">LITERAL MATCH</p><h2>${c.resultTitle}</h2><p>${c.resultMeta(escapeHtml(query), results.length)} · 结果复用导航卡片 · 不调用 AI</p></div><button class="button secondary" data-keyword-clear>${icon("x")} ${c.clear}</button></div><div class="site-grid search-result-grid">${results.map(siteCard).join("")}</div></div>`;
}

function askDock() {
  const c = t();
  return `<aside class="ask-dock" aria-label="AI 问答入口"><div class="ask-mode-label">${icon("sparkles")} AI 问答</div><form class="ask-form" data-ask-form><label class="ask-input-wrap">${icon("message-circle-question")}<span class="sr-only">${c.askPlaceholder}</span><input name="question" autocomplete="off" aria-label="${c.askPlaceholder}" placeholder="${c.askPlaceholder}" /></label><button class="button" type="submit" aria-label="${c.ask}">${icon("arrow-up")}<span>${c.ask}</span></button></form><div class="ask-meta"><span>${c.askTip}</span><span>${c.quota}</span></div></aside>`;
}

function publicView() {
  const c = t();
  return `${header()}<main id="main" class="public-main"><section class="directory-region" aria-labelledby="directory-title"><div class="section-kicker directory-toolbar"><h1 id="directory-title">${c.directory}</h1>${keywordSearch()}</div>${directoryBody()}</section></main>${askDock()}`;
}

function adminSidebar() {
  return `<aside class="admin-sidebar"><a class="brand admin-brand" href="#" data-go-public aria-label="查看公开端"><span class="brand-mark">${icon("library")}</span><strong>藏舟管理</strong></a><nav class="admin-nav" aria-label="管理导航"><a href="#" aria-label="添加内容">${icon("plus")}<span>添加内容</span></a><a href="#" aria-label="收藏库">${icon("library")}<span>收藏库</span></a><a href="#" class="active" aria-current="page" aria-label="分类管理">${icon("folders")}<span>分类管理</span></a><a href="#" aria-label="设置">${icon("settings-2")}<span>设置</span></a></nav><p class="admin-meta">原型数据<br />单管理员 · 单主分类</p></aside>`;
}

function makeDiffs(mode) {
  if (mode === "supplement") return [
    { id: "add-observability", type: "新增", tone: "add", from: "—", value: "可观测性", detail: "8 条自动归类内容形成新主题", accepted: true },
    { id: "add-security", type: "新增", tone: "add", from: "—", value: "安全与隐私", detail: "5 条自动归类内容形成新主题", accepted: true },
  ];
  return [
    { id: "rename-ai", type: "改名", tone: "rename", from: "AI 与开发", value: "AI 工程", detail: "3 条自动 + 1 条人工；人工条目保留原归属", accepted: true },
    { id: "merge-design", type: "合并", tone: "merge", from: "设计工具", value: "效率与协作", detail: "2 条自动条目；0 条人工条目", route: "target", accepted: true },
    { id: "delete-reading", type: "删除", tone: "delete", from: "阅读与知识", value: "未分类", detail: "0 条自动条目；1 条人工条目受保护", route: "uncategorized", accepted: false },
    { id: "add-research", type: "新增", tone: "add", from: "—", value: "研究与阅读", detail: "建议覆盖 6 条自动条目", accepted: true },
  ];
}

function workflowPhase() {
  const presets = { "ai-loading": "loading", "ai-error": "error", "ai-empty": "empty", "ai-preview": "preview", "ai-result": "result" };
  return presets[state.pageState] || state.aiPhase;
}

function diffRow(diff) {
  return `<article class="diff-row ${diff.accepted ? "accepted" : "ignored"}" data-diff-row="${diff.id}"><div class="diff-type ${diff.tone}">${diff.type}</div><div class="diff-main"><div class="diff-change"><span>${escapeHtml(diff.from)}</span>${icon("arrow-right")}<label><span class="sr-only">${diff.type}后的分类</span><input name="diff-${diff.id}" autocomplete="off" value="${escapeHtml(diff.value)}" data-diff-value="${diff.id}" ${diff.accepted ? "" : "disabled"} /></label></div><p>${escapeHtml(diff.detail)}</p>${["merge", "delete"].includes(diff.tone) ? `<label class="migration-choice">自动条目处理<select name="route-${diff.id}" data-diff-route="${diff.id}" ${diff.accepted ? "" : "disabled"}><option value="target" ${diff.route === "target" ? "selected" : ""}>移至建议目标</option><option value="uncategorized" ${diff.route === "uncategorized" ? "selected" : ""}>转入未分类</option></select></label>` : ""}</div><button type="button" class="diff-decision" data-diff-toggle="${diff.id}" aria-pressed="${diff.accepted}">${icon(diff.accepted ? "check" : "minus")} ${diff.accepted ? "接受" : "忽略"}</button></article>`;
}

function proposalPanel() {
  const phase = workflowPhase();
  if (phase === "loading") return `<div class="proposal-panel" aria-busy="true"><div class="notice">${icon("loader-circle")} AI 正在读取 web / GitHub 中文总结与标签，生成临时建议…</div><div class="skeleton" style="height:220px"></div></div>`;
  if (phase === "error") return `<div class="proposal-panel" role="alert"><div class="notice danger-text">${icon("triangle-alert")} AI 建议生成失败。既有分类和人工分类未改变；手动 CRUD 仍可用。</div><button class="button secondary" data-ai-start="supplement">重试补充建议</button></div>`;
  if (phase === "empty") return `<div class="proposal-panel"><div class="notice">${icon("inbox")} AI 没有发现需要补充的新分类。未产生 diff，也不会写库。</div><button class="button secondary" data-ai-reset>返回</button></div>`;
  if (phase === "progress") return `<div class="proposal-panel" aria-busy="true"><div class="progress-heading"><div><p class="eyebrow">APPLYING DIFF</p><h3>正在应用 3 项分类变更…</h3><p>人工分类保持不动；${state.rerunAutomatic ? "随后重跑 9 条自动分类内容" : "不重跑存量条目"}。</p></div><strong>62%</strong></div><div class="progress-track"><span></span></div><p class="progress-detail">已更新分类 2 / 3 · 自动条目 5 / 9</p></div>`;
  if (phase === "result") return `<div class="proposal-panel result-panel" role="status"><div class="result-icon">${icon("circle-check-big")}</div><div><p class="eyebrow">APPLIED</p><h3>分类建议已应用</h3><p>新增 1、改名 1、合并 1、忽略 1；3 条人工分类保持不动。${state.rerunAutomatic ? "9 条自动内容重跑完成，1 条进入未分类。" : "未重跑存量条目。"}</p><div class="result-stats"><span><strong>3</strong> 已接受</span><span><strong>1</strong> 已忽略</span><span><strong>0</strong> 失败</span></div></div><button class="button secondary" data-ai-reset>完成</button></div>`;
  if (phase === "preview") {
    if (!state.aiDiffs.length) state.aiDiffs = makeDiffs(state.aiMode || "replan");
    const accepted = state.aiDiffs.filter((item) => item.accepted).length;
    return `<div class="proposal-panel diff-panel"><div class="diff-header"><div><span class="mode-badge">${state.aiMode === "supplement" ? "F202a · 增量" : "F202b · 全量重拟"}</span><h3>${state.aiMode === "supplement" ? "补充建议预览" : "全量类目 diff 预览"}</h3><p>${state.aiMode === "supplement" ? "只建议新增分类，现有分类不变。" : "逐项接受、忽略或编辑；应用前不会写库。"}</p></div><button class="button secondary" data-ai-reset>放弃预览</button></div><div class="manual-protection">${icon("shield-check")} <strong>人工分类保护已开启</strong><span>3 条 <code>category_manual=true</code> 的条目不会被改动</span></div><div class="diff-list">${state.aiDiffs.map(diffRow).join("")}</div><div class="diff-footer"><p>已接受 <strong>${accepted}</strong> / ${state.aiDiffs.length} 项 · 全部忽略也不会修改现有分类</p><button class="button" data-open-apply ${accepted ? "" : "disabled"}>${icon("check-check")} 预览应用范围</button></div></div>`;
  }
  return `<div class="proposal-panel workflow-launch"><div class="workflow-intro"><div><p class="eyebrow">REGENERATE SAFELY</p><h3>AI 建议不会直接覆盖分类</h3><p>选择一种方式生成临时 diff，再逐项审核和应用。</p></div><span class="manual-protection compact">${icon("shield-check")} 人工分类始终保护</span></div><div class="workflow-actions"><article><span class="workflow-icon">${icon("list-plus")}</span><h4>补充建议</h4><p>仅建议遗漏的新分类，不改名、不合并、不删除。适合日常低风险维护。</p><button class="button secondary" data-ai-start="supplement">F202a · 生成增量建议</button></article><article class="high-impact"><span class="workflow-icon">${icon("git-compare-arrows")}</span><h4>全量重拟</h4><p>可建议新增、改名、合并和删除。适合类目明显失衡时重新整理。</p><button class="button" data-ai-start="replan">F202b · 生成全量 diff</button></article></div><p class="history-line">${icon("history")} 最近应用：2026-08-03 · 补充建议 · 接受 1 / 忽略 1</p></div>`;
}

function categoryTable() {
  return `<div class="category-table">${state.categories.map((category) => `<div class="category-row" data-category-row="${category.id}"><strong>${escapeHtml(category.zh)}</strong><span>${category.count} 条内容</span><div class="row-actions">${category.system ? `<span title="系统分组">${icon("lock")}</span>` : `<button type="button" title="重命名" aria-label="重命名 ${escapeHtml(category.zh)}" data-rename="${category.id}">${icon("pencil")}</button><button type="button" title="删除" aria-label="删除 ${escapeHtml(category.zh)}" data-delete="${category.id}">${icon("trash-2")}</button>`}</div></div>`).join("")}</div>`;
}

function assignmentList() {
  return `<div class="assignment-list">${state.sites.slice(0, 4).map((site, index) => `<label class="assignment-row"><span><strong>${escapeHtml(site.title)}</strong><small>${site.domain} · ${index === 0 ? "人工分类" : "AI 自动分类"}</small></span><select name="assignment-${index}" aria-label="${escapeHtml(site.title)} 的分类" data-assignment="${index}">${state.categories.map((category) => `<option value="${category.id}" ${site.category === category.id ? "selected" : ""}>${escapeHtml(category.zh)}</option>`).join("")}</select></label>`).join("")}</div>`;
}

function adminView() {
  return `<div class="admin-shell">${adminSidebar()}<main id="main" class="admin-workspace"><header class="admin-heading"><div><p class="eyebrow">内容 / 分类管理</p><h1>维护固定分类与归属</h1><p>AI 只生成可审核 diff；人工分类永远不被自动覆盖。</p></div><button class="button secondary" data-go-public>${icon("external-link")} 查看公开端</button></header><div class="admin-layout"><div><section class="admin-section" aria-labelledby="proposal-title"><div class="admin-section-title"><div><h2 id="proposal-title">AI 分类建议</h2><p>补充建议与全量重拟都必须预览后应用</p></div></div>${proposalPanel()}</section><section class="admin-section" aria-labelledby="categories-title"><div class="admin-section-title"><div><h2 id="categories-title">固定分类</h2><p>删除分类会把其下条目转入未分类</p></div><button class="button secondary" data-add-category>${icon("plus")} 新增</button></div>${categoryTable()}</section><section class="admin-section" aria-labelledby="assignment-title"><div class="admin-section-title"><div><h2 id="assignment-title">条目分类</h2><p>人工选择会保留，后续 AI 不覆盖</p></div></div>${assignmentList()}</section></div><aside class="admin-aside"><section class="summary-box"><h2>目录概况</h2><dl><dt>固定分类</dt><dd>${state.categories.filter((x) => !x.system).length}</dd><dt>已归类</dt><dd>9</dd><dt>未分类</dt><dd>1</dd><dt>人工分类保护</dt><dd>3</dd><dt>不进目录的文档</dt><dd>3</dd></dl></section><p class="prototype-label">${icon("flask-conical")} 所有数量、AI 建议和保存反馈均为原型演示数据。</p></aside></div></main></div>`;
}

function fillControls() {
  document.body.dataset.surface = state.surface;
  document.body.dataset.direction = state.direction;
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-surface]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.surface === state.surface)));
  document.querySelectorAll("[data-direction]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.direction === state.direction)));
  const options = state.surface === "public"
    ? [["default", "默认目录"], ["keyword-input", "关键词·输入中"], ["keyword-loading", "关键词·加载"], ["keyword-results", "关键词·结果"], ["keyword-empty", "关键词·无结果"], ["directory-loading", "目录·加载"], ["directory-empty", "目录·空"], ["directory-error", "目录·失败"]]
    : [["default", "AI 动作入口"], ["ai-loading", "AI 生成中"], ["ai-preview", "全量 diff"], ["ai-result", "应用结果"], ["ai-empty", "无建议"], ["ai-error", "AI 失败"]];
  document.querySelector("#state-switcher").innerHTML = options.map(([value, label]) => `<option value="${value}" ${state.pageState === value ? "selected" : ""}>${label}</option>`).join("");
}

function render() {
  document.querySelector("#app").innerHTML = state.surface === "public" ? publicView() : adminView();
  fillControls();
  setUrl();
  window.lucide?.createIcons();
}

function startAi(mode) {
  state.aiMode = mode;
  state.aiDiffs = [];
  state.aiPhase = "loading";
  state.pageState = "default";
  render();
  setTimeout(() => { state.aiPhase = "preview"; state.aiDiffs = makeDiffs(mode); render(); }, 560);
}

function runKeyword(query) {
  state.pageState = "default";
  state.keywordQuery = query.trim();
  if (!state.keywordQuery) { state.keywordPhase = "default"; render(); return; }
  state.keywordPhase = "loading";
  render();
  setTimeout(() => {
    const normalized = state.keywordQuery.toLocaleLowerCase();
    const matched = state.sites.some((site) => [site.title, site.summary, ...site.tags].join(" ").toLocaleLowerCase().includes(normalized));
    state.keywordPhase = matched ? "results" : "empty";
    render();
  }, 480);
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.dataset.surface) { state.surface = target.dataset.surface; state.pageState = "default"; render(); return; }
  if (target.dataset.direction) { state.direction = target.dataset.direction; render(); return; }
  if (target.dataset.language) { state.language = target.dataset.language; render(); return; }
  if (target.matches("[data-go-admin]")) { event.preventDefault(); state.surface = "admin"; state.pageState = "default"; render(); return; }
  if (target.matches("[data-go-public], [data-home]")) { event.preventDefault(); state.surface = "public"; state.pageState = "default"; render(); return; }
  if (target.dataset.categoryLink) {
    event.preventDefault();
    const section = document.querySelector(`#category-${CSS.escape(target.dataset.categoryLink)}`);
    section?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    section?.focus({ preventScroll: true });
    section?.classList.remove("flash");
    requestAnimationFrame(() => section?.classList.add("flash"));
    document.querySelectorAll("[data-category-link]").forEach((link) => link.removeAttribute("aria-current"));
    target.setAttribute("aria-current", "location");
    return;
  }
  if (target.matches("[data-retry]")) { state.pageState = "directory-loading"; render(); setTimeout(() => { state.pageState = "default"; render(); toast("已重新载入原型数据"); }, 560); return; }
  if (target.matches("[data-keyword-clear]")) { state.pageState = "default"; state.keywordQuery = ""; state.keywordPhase = "default"; render(); document.querySelector("#keyword-input")?.focus(); return; }
  if (target.dataset.aiStart) { startAi(target.dataset.aiStart); return; }
  if (target.matches("[data-ai-reset]")) { state.pageState = "default"; state.aiMode = null; state.aiPhase = "idle"; state.aiDiffs = []; render(); return; }
  if (target.dataset.diffToggle) {
    const diff = state.aiDiffs.find((item) => item.id === target.dataset.diffToggle);
    diff.accepted = !diff.accepted;
    render();
    return;
  }
  if (target.matches("[data-open-apply]")) {
    const accepted = state.aiDiffs.filter((item) => item.accepted).length;
    document.querySelector("#apply-description").textContent = `将应用 ${accepted} 项、忽略 ${state.aiDiffs.length - accepted} 项；3 条人工分类保持不动。`;
    document.querySelector("[data-rerun]").checked = state.rerunAutomatic;
    document.querySelector("#apply-dialog").showModal();
    return;
  }
  if (target.matches("[data-add-category]")) { state.categories.splice(-1, 0, { id: `new-${Date.now()}`, zh: "新分类", en: "New category", count: 0 }); render(); toast("已新增分类（原型反馈）"); return; }
  if (target.dataset.rename) {
    const category = state.categories.find((item) => item.id === target.dataset.rename);
    const value = prompt("重命名分类", category.zh);
    if (value?.trim()) { category.zh = value.trim(); render(); toast("分类名称已更新（原型反馈）"); }
    return;
  }
  if (target.dataset.delete) {
    const category = state.categories.find((item) => item.id === target.dataset.delete);
    state.pendingDelete = category.id;
    document.querySelector("#delete-title").textContent = `删除「${category.zh}」？`;
    document.querySelector("#delete-description").textContent = `该分类下的 ${category.count} 条内容将转入「未分类」，公开导航会同步更新。此操作无法撤销。`;
    document.querySelector("#delete-dialog").showModal();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-keyword-input]")) {
    state.pageState = "default";
    state.keywordQuery = event.target.value;
    state.keywordPhase = state.keywordQuery ? "input" : "default";
    const form = event.target.closest("form");
    form.querySelector("[data-keyword-clear]")?.remove();
    if (state.keywordQuery) event.target.insertAdjacentHTML("afterend", `<button type="button" class="keyword-clear" data-keyword-clear aria-label="${t().clear}">${icon("x")}</button>`);
    window.lucide?.createIcons();
  }
  if (event.target.dataset.diffValue) {
    const diff = state.aiDiffs.find((item) => item.id === event.target.dataset.diffValue);
    diff.value = event.target.value;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "state-switcher") {
    state.pageState = event.target.value;
    if (state.pageState === "ai-preview") { state.aiMode = "replan"; state.aiDiffs = makeDiffs("replan"); }
    render();
    return;
  }
  if (event.target.dataset.diffRoute) state.aiDiffs.find((item) => item.id === event.target.dataset.diffRoute).route = event.target.value;
  if (event.target.dataset.assignment !== undefined) { state.sites[Number(event.target.dataset.assignment)].category = event.target.value; toast("分类已手动保存，后续 AI 不覆盖（原型反馈）"); }
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("[data-keyword-form]")) { event.preventDefault(); runKeyword(event.target.querySelector("input").value); return; }
  if (event.target.matches("[data-ask-form]")) {
    event.preventDefault();
    const input = event.target.querySelector("input");
    if (!input.value.trim()) { input.focus(); toast("请输入问题"); return; }
    toast("沿用现有 AI 问答链路：返回中文答案与来源（原型未调用模型）");
  }
});

document.querySelector("#delete-dialog").addEventListener("close", (event) => {
  if (event.target.returnValue !== "confirm" || !state.pendingDelete) return;
  const category = state.categories.find((item) => item.id === state.pendingDelete);
  state.sites.forEach((site) => { if (site.category === state.pendingDelete) site.category = "uncategorized"; });
  state.categories = state.categories.filter((item) => item.id !== state.pendingDelete);
  state.categories.find((item) => item.id === "uncategorized").count += category.count;
  state.pendingDelete = null;
  render();
  toast(`已删除「${category.zh}」，${category.count} 条内容转入未分类（原型反馈）`);
});

document.querySelector("#apply-dialog").addEventListener("close", (event) => {
  if (event.target.returnValue !== "confirm") return;
  state.rerunAutomatic = event.target.querySelector("[data-rerun]").checked;
  state.pageState = "default";
  state.aiPhase = "progress";
  render();
  setTimeout(() => { state.aiPhase = "result"; render(); }, 760);
});

render();
