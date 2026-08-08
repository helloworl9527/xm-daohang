const state = {
  surface: new URLSearchParams(location.search).get("surface") || "public",
  mode: new URLSearchParams(location.search).get("mode") || "original",
  pageState: "default",
  authenticated: false,
  adminRoute: "add",
  settingsTab: "models",
  selectedId: 1,
  language: "zh",
  question: "",
  items: [
    {
      id: 1,
      title: "pgvector：PostgreSQL 向量检索实践",
      url: "https://github.com/pgvector/pgvector",
      summary:
        "在 PostgreSQL 中存储与检索向量的扩展，涵盖精确和近似近邻查询、索引选择及混合检索实践。",
      tags: ["PostgreSQL", "向量检索", "GitHub"],
      status: "complete",
      source: "管理端",
      updated: "今天 18:42",
      manual: false,
    },
    {
      id: 2,
      title: "面向公开网页的安全抓取清单",
      url: "https://example.com/safe-fetching",
      summary:
        "从请求超时、响应体积限制、地址解析和内网阻断等方面，整理轻量抓取服务需要落实的安全边界。",
      tags: ["安全", "抓取"],
      status: "processing",
      source: "Telegram",
      updated: "今天 18:37",
      manual: false,
    },
    {
      id: 3,
      title: "为小型知识库设计可靠的检索增强流程",
      url: "https://example.com/retrieval-notes",
      summary:
        "从内容清洗、分块、嵌入一致性与来源引用出发，说明小规模知识库如何保持检索质量与回答边界。",
      tags: ["RAG", "检索", "AI"],
      status: "complete",
      source: "管理端",
      updated: "昨天",
      manual: false,
    },
    {
      id: 4,
      title: "损坏的文档链接",
      url: "https://example.com/missing.pdf",
      summary: "尚未生成总结。",
      tags: ["文档"],
      status: "failed",
      source: "管理端",
      updated: "昨天",
      manual: false,
      reason: "目标站点返回 403，自动重试 3 次后仍失败。",
    },
    {
      id: 5,
      title: "Next.js 中的服务端鉴权边界",
      url: "https://example.com/next-auth-boundaries",
      summary:
        "梳理受保护路由、服务端会话校验与写接口授权，强调公开页面和管理能力应在服务端边界上彻底分开。",
      tags: ["Next.js", "安全", "鉴权"],
      status: "complete",
      source: "Telegram",
      updated: "前天",
      manual: false,
    },
  ],
};
const I = {
  library: "library",
  ask: "message-circle-question",
  admin: "lock-keyhole",
  add: "plus",
  settings: "settings-2",
  external: "external-link",
  search: "search",
  edit: "pencil",
  retry: "refresh-cw",
  trash: "trash-2",
  alert: "triangle-alert",
  empty: "archive-x",
  clock: "loader-circle",
  limit: "gauge",
  send: "arrow-up",
  model: "cpu",
  calendar: "calendar-clock",
  shield: "shield-check",
  bot: "bot",
  language: "languages",
  close: "x",
  rate: "chart-no-axes-column-increasing",
};
const icon = (n) =>
  `<i class="icon" data-lucide="${I[n] || n}" aria-hidden="true"></i>`;
const labels = {
  zh: {
    hero: "今天，重新遇见 3 条收藏。",
    sub: "每天从已完成的收藏中轮换 3 条。也可以直接向整个收藏库提问。",
    ask: "向收藏库提问…",
    send: "提问",
    daily: "今日轮换",
    admin: "管理端",
  },
  en: {
    hero: "Meet 3 saved ideas again today.",
    sub: "Three completed items rotate daily. Ask the entire collection whenever you need more.",
    ask: "Ask the collection…",
    send: "Ask",
    daily: "Today’s rotation",
    admin: "Admin",
  },
};
const today = new Date();
const todayText = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
  .format(today)
  .replaceAll("/", ".");
const dayOfYear = Math.floor(
  (today - new Date(today.getFullYear(), 0, 0)) / 86400000,
);
function setUrl() {
  const p = new URLSearchParams({ surface: state.surface });
  p.set("mode", state.mode);
  if (state.surface === "admin") {
    p.set("route", state.authenticated ? state.adminRoute : "login");
    if (state.adminRoute === "settings") p.set("tab", state.settingsTab);
  }
  history.replaceState(null, "", `?${p}`);
}
function toast(msg) {
  const e = document.querySelector("#toast");
  e.textContent = msg;
  e.hidden = false;
  if (state.mode === "apple") {
    springIn(e, 0, 8);
    navigator.vibrate?.(8);
  }
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (e.hidden = true), 2800);
}
const springFrames = new WeakMap();
function stopSpring(el) {
  const frame = springFrames.get(el);
  if (frame) cancelAnimationFrame(frame);
  springFrames.delete(el);
  el.style.removeProperty("transform");
  el.style.removeProperty("opacity");
}
function springIn(el, delay = 0, distance = 12) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  stopSpring(el);
  el.dataset.spring = "true";
  let displacement = 1;
  let velocity = 0;
  let last = performance.now();
  const start = last + delay;
  const omega = (2 * Math.PI) / 0.4;
  const step = (now) => {
    if (now < start) {
      springFrames.set(el, requestAnimationFrame(step));
      return;
    }
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const acceleration = -2 * omega * velocity - omega * omega * displacement;
    velocity += acceleration * dt;
    displacement += velocity * dt;
    el.style.transform = `translateY(${distance * displacement}px) scale(${1 - 0.018 * displacement})`;
    el.style.opacity = String(Math.max(0, 1 - displacement));
    if (Math.abs(displacement) < 0.002 && Math.abs(velocity) < 0.02) {
      stopSpring(el);
      return;
    }
    springFrames.set(el, requestAnimationFrame(step));
  };
  springFrames.set(el, requestAnimationFrame(step));
}
function enhanceCurrentView() {
  const primary = document.querySelectorAll(
    ".answer, .state-view, .inspector, .auth-card",
  );
  primary.forEach((el) => springIn(el));
  document
    .querySelectorAll(".public-card, .source, .item-card")
    .forEach((el, index) => springIn(el, Math.min(index * 45, 180), 9));
}
function render() {
  document.body.dataset.surface = state.surface;
  document.body.dataset.mode = state.mode;
  document.querySelector("#app").innerHTML =
    state.surface === "public" ? publicView() : adminView();
  document
    .querySelectorAll("[data-surface-button]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.surfaceButton === state.surface),
      ),
    );
  document
    .querySelectorAll("[data-mode-button]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(b.dataset.modeButton === state.mode),
      ),
    );
  fillStateSwitcher();
  setUrl();
  if (window.lucide) lucide.createIcons();
  if (state.mode === "apple") enhanceCurrentView();
}
function fillStateSwitcher() {
  const el = document.querySelector("#state-switcher");
  const options =
    state.surface === "public"
      ? [
          ["default", "默认"],
          ["loading", "加载"],
          ["result", "结果"],
          ["empty", "空库"],
          ["noresult", "无结果"],
          ["limited", "超限"],
          ["error", "错误"],
        ]
      : [
          ["default", "默认"],
          ["loading", "加载"],
          ["empty", "空"],
          ["error", "失败"],
          ["disabled", "禁用"],
          ["locked", "锁定"],
        ];
  el.innerHTML = options
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === state.pageState ? "selected" : ""}>${l}</option>`,
    )
    .join("");
}

function publicHeader() {
  const t = labels[state.language];
  return `<header class="public-header"><a class="brand" href="?surface=public&mode=${state.mode}" data-go-public><span class="brand-mark">${icon("library")}</span><span>藏舟</span></a><div class="public-header-actions"><a class="admin-link" href="?surface=admin&route=login&mode=${state.mode}" data-go-admin>${icon("admin")}<span>${t.admin}</span></a><div class="lang-switch" role="group" aria-label="语言"><button type="button" data-language="zh" class="${state.language === "zh" ? "active" : ""}" aria-pressed="${state.language === "zh"}">中</button><button type="button" data-language="en" class="${state.language === "en" ? "active" : ""}" aria-pressed="${state.language === "en"}">EN</button></div></div></header>`;
}
function dailyCards() {
  return state.items
    .filter((x) => x.status === "complete")
    .slice(0, 3)
    .map(
      (x, i) =>
        `<a class="public-card" href="${x.url}" target="_blank" rel="noreferrer"><span class="card-no">${String(i + 1).padStart(2, "0")} / 03</span><div><h2>${x.title}</h2><p>${x.summary}</p><div class="tag-row">${x.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div></div><span class="external">查看原始链接 ${icon("external")}</span></a>`,
    )
    .join("");
}
function publicIntro() {
  const t = labels[state.language];
  return `<section class="public-intro"><div><p class="eyebrow">${t.daily} · ${todayText}</p><h1>${t.hero}</h1><p class="muted">${t.sub}</p></div><div class="day-stamp">DAY ${dayOfYear}<br>原型数据 · 当日稳定</div></section>`;
}
function publicState() {
  const map = {
    empty: [
      icon("empty"),
      "收藏库还没有可展示内容",
      "站主添加并处理完成内容后，会在这里开始每日轮换。",
      '<a class="button" href="?surface=admin&route=login" data-go-admin>站主登录</a>',
    ],
    noresult: [
      icon("empty"),
      "收藏库中没有相关内容",
      "换一种问法。回答不会引用库外知识。",
      "",
    ],
    limited: [
      icon("limit"),
      "今日提问已达上限，请稍后再来",
      "本次请求不会调用模型。每日额度重置后可再次提问。",
      "",
    ],
    error: [
      icon("alert"),
      "暂时无法完成提问",
      "服务没有返回结果。保留问题后重新尝试。",
      '<button class="button" data-reset-state>重新尝试</button>',
    ],
  };
  if (state.pageState === "loading")
    return `<section class="state-view" aria-label="正在加载"><div class="skeleton"><span></span><span></span><span></span><span></span></div></section>`;
  const x = map[state.pageState];
  return `<section class="state-view"><div><span class="state-icon">${x[0]}</span><h2>${x[1]}</h2><p class="muted">${x[2]}</p>${x[3]}</div></section>`;
}
function resultBlock() {
  const hits = state.items.filter((x) => x.status === "complete").slice(0, 3);
  return `<section class="result-wrap" aria-labelledby="answer-title"><article class="answer"><p class="eyebrow">仅基于 3 条库内来源</p><h2 id="answer-title">可以用 PostgreSQL 内建向量能力承载小型知识库，并把抓取安全作为入库前置边界。</h2><p>收藏内容建议把元数据与嵌入统一保存在 PostgreSQL，通过 pgvector 完成近邻检索；抓取阶段先限制超时、响应体积并阻断内网地址，再将清洗后的内容用于总结与索引。</p><p class="muted">原型回答，仅展示公开问答的信息结构。</p></article><div class="sources" aria-label="命中来源 Top 10">${hits.map((x, i) => `<a class="source" href="${x.url}" target="_blank" rel="noreferrer"><small>来源 ${String(i + 1).padStart(2, "0")} / TOP 10</small><h3>${x.title}</h3><p class="muted">${x.summary}</p></a>`).join("")}</div></section>`;
}
function questionDock() {
  const t = labels[state.language],
    disabled = state.pageState === "empty" || state.pageState === "loading";
  return `<aside class="question-dock" aria-label="公开提问"><form id="question-form" class="question-form" novalidate><label><span class="sr-only">${t.ask}</span><input name="question" autocomplete="off" maxlength="500" placeholder="${t.ask}" value="${state.question}" ${disabled ? "disabled" : ""}></label><button class="button" type="submit" aria-label="${state.pageState === "loading" ? "检索中" : t.send}" ${disabled ? "disabled" : ""}>${icon("send")}<span>${state.pageState === "loading" ? "检索中…" : t.send}</span></button></form><div class="question-meta"><span>回答仅来自收藏库 · 最多 10 条来源</span><span>原型额度 12 / 20</span></div></aside>`;
}
function publicView() {
  let core;
  if (state.pageState === "default")
    core = `${publicIntro()}<section class="daily-grid" aria-label="今日 3 条收藏">${dailyCards()}</section>`;
  else if (state.pageState === "result")
    core = `${publicIntro()}${resultBlock()}<section class="daily-grid" aria-label="今日 3 条收藏">${dailyCards()}</section>`;
  else core = `${publicIntro()}${publicState()}`;
  return `<div class="public-shell variant-c">${publicHeader()}<main id="main" class="public-main">${core}</main>${questionDock()}</div>`;
}

function adminLogin() {
  const locked = state.pageState === "locked";
  return `<div class="auth-shell"><aside class="auth-aside"><a class="brand" href="?surface=public" data-go-public><span class="brand-mark">${icon("library")}</span><span>藏舟</span></a><div><p class="eyebrow">Admin / 管理端</p><h1>维护内容，也维护公开边界。</h1><p>管理端只供站主使用。公开访客无需登录，且无法访问这里的全量列表和配置。</p></div></aside><main id="main" class="auth-main"><section class="auth-card"><p class="eyebrow">受保护区域 · 原型</p><h2>登录管理端</h2><p class="muted">用户名 + 密码。连续失败会触发临时锁定。</p>${locked ? '<div class="lock-notice" role="alert"><strong>登录尝试过多</strong><br>请 14 分 32 秒后再试。</div>' : ""}<form id="login-form" novalidate><label class="field"><span>用户名</span><input name="username" autocomplete="username" spellcheck="false" value="owner" ${locked ? "disabled" : ""}></label><label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" value="prototype" ${locked ? "disabled" : ""}></label><p id="login-error" class="field-error" hidden>用户名或密码不正确。失败次数已记录。</p><button class="button" type="submit" ${locked ? "disabled" : ""}>登录管理端</button></form></section></main></div>`;
}
function adminShell(content) {
  const nav = [
    ["add", "add", "添加内容"],
    ["library", "library", "收藏库"],
    ["settings", "settings", "设置"],
  ];
  return `<div class="admin-shell"><aside class="sidebar"><a class="brand" href="?surface=admin&route=add" data-admin-route="add"><span class="brand-mark">${icon("library")}</span><span>藏舟管理</span></a><nav class="nav" aria-label="管理导航">${nav.map(([r, ic, l]) => `<a href="?surface=admin&route=${r}" data-admin-route="${r}" class="${state.adminRoute === r ? "active" : ""}" ${state.adminRoute === r ? 'aria-current="page"' : ""}>${icon(ic)}<span>${l}</span></a>`).join("")}</nav><div class="sidebar-foot"><p class="demo">原型数据</p><a class="admin-link" href="?surface=public" data-go-public>${icon("external")} 查看公开端</a></div></aside><main id="main" class="admin-main">${content}</main></div>`;
}
function pageHead(k, t, d, a = "") {
  return `<header class="page-head"><div><p class="eyebrow">${k}</p><h1>${t}</h1><p class="muted">${d}</p></div>${a ? `<div class="actions">${a}</div>` : ""}</header>`;
}
function adminGeneric() {
  const map = {
      loading: [icon("clock"), "正在载入…", "请稍候。"],
      empty: [icon("empty"), "这里还没有内容", "添加第一个公开链接开始收藏。"],
      error: [icon("alert"), "暂时无法载入", "检查网络后重新尝试。"],
      disabled: [
        icon("model"),
        "需要先配置模型",
        "添加与公开提问都需要可用的对话和嵌入模型。",
      ],
    },
    x = map[state.pageState];
  return `<section class="state-view"><div><span class="state-icon">${x[0]}</span><h2>${x[1]}</h2><p class="muted">${x[2]}</p>${state.pageState === "disabled" ? '<button class="button" data-admin-route="settings">前往模型设置</button>' : ""}</div></section>`;
}
function adminAdd() {
  if (state.pageState !== "default")
    return adminShell(
      pageHead(
        "内容 / 收集",
        "添加内容",
        "仅支持公开网页、文档和 GitHub 仓库。",
      ) + adminGeneric(),
    );
  return adminShell(
    pageHead(
      "内容 / 收集",
      "添加内容",
      "提交后立即返回，抓取、总结和嵌入由后台 worker 处理。",
    ) +
      `<div class="add-layout"><section class="panel"><div class="panel-head"><div><h2>新建收藏</h2><p class="muted">一次添加 1 个链接</p></div><span class="demo">仅原型演示</span></div><div class="panel-body"><form id="add-form" class="url-form" novalidate><label class="field"><span>公开链接</span><div class="url-row"><input name="url" type="url" autocomplete="off" placeholder="https://example.com/article…"><button class="button" type="submit">${icon("add")} 添加</button></div><p id="url-error" class="field-error" hidden>请输入以 http:// 或 https:// 开头的有效链接。</p></label></form></div></section><aside class="panel"><div class="panel-head"><h2>处理范围</h2></div><div class="panel-body"><p><strong>校验与去重</strong></p><p class="muted">已收藏链接不会重复入库。</p><p><strong>异步处理</strong></p><p class="muted">失败自动重试最多 3 次，仍失败可手动重抓。</p><p><strong>公开可检索</strong></p><p class="muted">完成条目可能通过公开问答返回。</p></div></aside></div>`,
  );
}
const statusLabel = (s) =>
  ({ complete: "完成", processing: "处理中", failed: "失败" })[s];
function itemCard(x) {
  return `<button class="item-card ${x.id === state.selectedId ? "selected" : ""}" type="button" data-item="${x.id}" aria-label="查看 ${x.title}"><div><h3>${x.title}</h3><p>${x.summary}</p><div class="tag-row">${x.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div></div><span class="status ${x.status}">${statusLabel(x.status)}</span></button>`;
}
function inspector(x) {
  return `<aside class="inspector panel" aria-label="条目详情"><div class="panel-head"><div><p class="eyebrow">${x.source} · ${x.updated}</p><h2>${x.title}</h2></div></div><div class="panel-body"><span class="status ${x.status}">${statusLabel(x.status)}</span><a class="detail-link" href="${x.url}" target="_blank" rel="noreferrer">${x.url}</a>${x.status === "failed" ? `<div class="summary-box"><strong>失败原因</strong><p>${x.reason}</p></div>` : `<div class="summary-box"><p>${x.summary}</p>${x.manual ? '<span class="tag">人工编辑</span>' : ""}</div>`}<div class="tag-row">${x.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div><div class="actions" style="margin-top:20px"><button class="button secondary" data-action="edit">${icon("edit")} 编辑总结</button><button class="button secondary" data-action="refetch" ${x.status === "processing" ? "disabled" : ""}>${icon("retry")} 重新抓取</button><button class="button ghost icon-only" data-action="delete" aria-label="删除收藏">${icon("trash")}</button></div></div></aside>`;
}
function adminLibrary() {
  if (state.pageState !== "default")
    return adminShell(
      pageHead("内容 / 全量管理", "收藏库", "公开端不提供全量浏览。") +
        adminGeneric(),
    );
  const x =
    state.items.find((i) => i.id === state.selectedId) || state.items[0];
  return adminShell(
    pageHead(
      "内容 / 全量管理",
      "收藏库",
      `${state.items.length} 条原型数据。完成条目可参与每日展示与公开问答。`,
      `<button class="button" data-admin-route="add">${icon("add")} 添加内容</button>`,
    ) +
      `<form id="filter-form" class="filters"><label><span class="sr-only">关键词</span><input name="keyword" autocomplete="off" placeholder="按标题、链接或总结筛选…"></label><label><span class="sr-only">标签</span><select name="tag" aria-label="按标签筛选"><option value="">所有标签</option><option>安全</option><option>向量检索</option><option>RAG</option></select></label><button class="button secondary">应用筛选</button></form><div class="admin-grid"><section class="item-list" aria-label="收藏列表">${state.items.map(itemCard).join("")}</section>${inspector(x)}</div>`,
  );
}
function settingTabs() {
  const tabs = [
    ["models", "model", "模型"],
    ["schedule", "calendar", "定时重抓"],
    ["rate", "rate", "公开限流"],
    ["security", "shield", "安全"],
    ["telegram", "bot", "Telegram"],
    ["language", "language", "语言"],
  ];
  return `<nav class="settings-tabs" aria-label="设置分类">${tabs.map(([id, ic, l]) => `<button type="button" data-tab="${id}" class="${state.settingsTab === id ? "active" : ""}" aria-pressed="${state.settingsTab === id}">${icon(ic)} ${l}</button>`).join("")}</nav>`;
}
function modelFields(p, m) {
  return `<div class="form-grid"><label class="field"><span>Base URL</span><input type="url" name="${p}_url" autocomplete="off" spellcheck="false" value="https://api.example.com/v1"></label><label class="field"><span>模型名</span><input name="${p}_model" autocomplete="off" spellcheck="false" value="${m}"></label></div><label class="field"><span>API Key</span><input type="password" name="${p}_key" autocomplete="new-password" value="••••••••••••••••"></label>`;
}
function settingsContent() {
  if (state.settingsTab === "models")
    return `<form id="models-form" class="settings-form"><section class="model-group"><h3>对话模型</h3>${modelFields("chat", "gpt-4.1-mini")}</section><section class="model-group"><h3>嵌入模型</h3>${modelFields("embedding", "text-embedding-3-small")}</section><div class="actions"><button class="button secondary" type="button" data-action="test-models">测试连接</button><button class="button">保存模型配置</button></div></form>`;
  if (state.settingsTab === "schedule")
    return `<form id="schedule-form" class="settings-form"><div class="toggle-row"><div><strong>定时重新抓取</strong><p class="muted">统一周期检查全部条目。</p></div><label class="switch"><input type="checkbox" name="enabled" checked aria-label="启用定时重新抓取"><span></span></label></div><label class="field"><span>间隔天数</span><input name="days" type="number" inputmode="numeric" min="1" value="7"></label><p class="muted">上次：今天 03:00 · 下次预计：8 月 15 日 03:00</p><button class="button">保存重抓计划</button></form>`;
  if (state.settingsTab === "rate")
    return `<form id="rate-form" class="settings-form"><div class="toggle-row"><div><strong>公开提问限流</strong><p class="muted">超限请求不会调用模型。Telegram 私有提问不受影响。</p></div><label class="switch"><input type="checkbox" name="enabled" checked aria-label="启用公开提问限流"><span></span></label></div><div class="quota-grid"><label class="field quota"><span>单 IP 每日上限</span><input name="per_ip" type="number" inputmode="numeric" min="1" value="20"></label><label class="field quota"><span>全站每日上限</span><input name="global" type="number" inputmode="numeric" min="1" value="200"></label></div><p class="muted">今日已用：单 IP 12 / 20 · 全站 86 / 200</p><button class="button">保存限流配置</button></form>`;
  if (state.settingsTab === "security")
    return `<div class="settings-form"><form id="password-form" class="settings-form"><h3>修改密码</h3><label class="field"><span>当前密码</span><input type="password" name="current_password" autocomplete="current-password"></label><label class="field"><span>新密码</span><input type="password" name="new_password" autocomplete="new-password"></label><button class="button">更新密码</button></form><div class="toggle-row"><div><strong>当前会话</strong><p class="muted">此浏览器 · 18:53 建立</p></div><button class="button secondary" data-action="logout">退出登录</button></div></div>`;
  if (state.settingsTab === "telegram")
    return `<form id="telegram-form" class="settings-form"><label class="field"><span>Bot Token</span><input type="password" name="bot_token" autocomplete="new-password" value="••••••••••••••••"></label><label class="field"><span>用户 ID 白名单</span><input name="allowlist" autocomplete="off" spellcheck="false" value="123456789"></label><p class="muted">非白名单发送者不会收到响应。TG 提问不受公开端限流。</p><button class="button">保存 Telegram 设置</button></form>`;
  return `<form id="language-form" class="settings-form"><fieldset><legend>界面语言</legend><label class="toggle-row"><span><strong>中文</strong><br><small class="muted">默认语言</small></span><input type="radio" name="language" value="zh" ${state.language === "zh" ? "checked" : ""}></label><label class="toggle-row"><span><strong>English</strong><br><small class="muted">AI 总结仍固定中文</small></span><input type="radio" name="language" value="en" ${state.language === "en" ? "checked" : ""}></label></fieldset><button class="button">保存语言偏好</button></form>`;
}
function adminSettings() {
  if (state.pageState !== "default")
    return adminShell(
      pageHead("系统 / 配置", "设置", "管理公开端、处理管线与账户安全。") +
        adminGeneric(),
    );
  return adminShell(
    pageHead(
      "系统 / 配置",
      "设置",
      "管理公开提问费用边界、模型、任务和账户。",
    ) +
      `<div class="settings-layout">${settingTabs()}<section class="panel"><div class="panel-head"><h2>${{ models: "模型", schedule: "定时重抓", rate: "公开提问限流", security: "安全", telegram: "Telegram", language: "语言" }[state.settingsTab]}</h2><span class="demo">仅原型演示</span></div><div class="panel-body">${settingsContent()}</div></section></div>`,
  );
}
function adminView() {
  if (!state.authenticated) return adminLogin();
  return (
    { add: adminAdd, library: adminLibrary, settings: adminSettings }[
      state.adminRoute
    ] || adminAdd
  )();
}
function editSummary() {
  const x = state.items.find((i) => i.id === state.selectedId),
    body = document.querySelector(".inspector .panel-body");
  body.innerHTML = `<form id="summary-form" class="settings-form"><label class="field"><span>总结</span><textarea name="summary" required>${x.summary}</textarea></label><p class="muted">人工编辑后，定时重抓不会自动覆盖。</p><div class="actions"><button class="button secondary" type="button" data-action="cancel-edit">取消</button><button class="button">保存总结</button></div></form>`;
  body.querySelector("textarea").focus();
}

document.addEventListener("pointerdown", (e) => {
  if (state.mode !== "apple") return;
  const moving = e.target.closest("[data-spring]");
  if (moving) stopSpring(moving);
});
document.addEventListener("change", (e) => {
  if (
    state.mode === "apple" &&
    e.target.closest("#app") &&
    e.target.matches('input[type="checkbox"], input[type="radio"]')
  ) {
    navigator.vibrate?.(6);
  }
});
document.addEventListener("click", (e) => {
  const surface = e.target.closest("[data-surface-button]");
  if (surface) {
    state.surface = surface.dataset.surfaceButton;
    state.pageState = "default";
    if (state.surface === "admin") state.authenticated = false;
    render();
    return;
  }
  const mode = e.target.closest("[data-mode-button]");
  if (mode) {
    state.mode = mode.dataset.modeButton;
    render();
    return;
  }
  const lang = e.target.closest("[data-language]");
  if (lang) {
    state.language = lang.dataset.language;
    render();
    return;
  }
  if (e.target.closest("[data-go-admin]")) {
    e.preventDefault();
    state.surface = "admin";
    state.authenticated = false;
    state.pageState = "default";
    render();
    return;
  }
  if (e.target.closest("[data-go-public]")) {
    e.preventDefault();
    state.surface = "public";
    state.pageState = "default";
    render();
    return;
  }
  const route = e.target.closest("[data-admin-route]");
  if (route) {
    e.preventDefault();
    state.surface = "admin";
    state.authenticated = true;
    if (state.mode === "apple") navigator.vibrate?.(8);
    state.adminRoute = route.dataset.adminRoute;
    if (
      state.adminRoute === "settings" &&
      route.dataset.adminRoute === "settings"
    )
      state.settingsTab = state.settingsTab || "models";
    state.pageState = "default";
    render();
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    state.settingsTab = tab.dataset.tab;
    render();
    return;
  }
  const item = e.target.closest("[data-item]");
  if (item) {
    state.selectedId = Number(item.dataset.item);
    render();
    return;
  }
  if (e.target.closest("[data-reset-state]")) {
    state.pageState = "default";
    render();
    return;
  }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "edit") editSummary();
  if (action === "cancel-edit") render();
  if (action === "logout") {
    state.authenticated = false;
    render();
  }
  if (action === "refetch") {
    const x = state.items.find((i) => i.id === state.selectedId);
    x.status = "processing";
    render();
    toast("已加入重新抓取队列。");
    setTimeout(() => {
      x.status = "complete";
      render();
      toast("重新抓取完成，内容没有变化。");
    }, 1200);
  }
  if (action === "delete") {
    const d = document.querySelector("#confirm-dialog");
    d.showModal();
    d.addEventListener(
      "close",
      () => {
        if (d.returnValue === "confirm") {
          state.items = state.items.filter((i) => i.id !== state.selectedId);
          state.selectedId = state.items[0]?.id;
          render();
          toast("收藏已删除。");
        }
      },
      { once: true },
    );
  }
  if (action === "test-models") {
    const b = e.target.closest("button");
    b.disabled = true;
    b.textContent = "测试中…";
    setTimeout(() => {
      b.disabled = false;
      b.textContent = "测试连接";
      toast("对话模型与嵌入模型均可连接。");
    }, 900);
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "login-form") {
    if (f.elements.password.value === "wrong") {
      document.querySelector("#login-error").hidden = false;
      f.elements.username.focus();
      return;
    }
    state.authenticated = true;
    state.adminRoute = "add";
    state.pageState = "default";
    render();
    return;
  }
  if (f.id === "question-form") {
    const q = f.elements.question.value.trim();
    if (!q) {
      f.elements.question.focus();
      return;
    }
    state.question = q;
    if (state.mode === "apple") navigator.vibrate?.(6);
    state.pageState = "loading";
    render();
    setTimeout(() => {
      state.pageState = /火星|天气/.test(q)
        ? "noresult"
        : /上限|limit/.test(q)
          ? "limited"
          : "result";
      render();
    }, 850);
    return;
  }
  if (f.id === "add-form") {
    const input = f.elements.url,
      error = document.querySelector("#url-error");
    try {
      const u = new URL(input.value);
      if (!["http:", "https:"].includes(u.protocol)) throw Error();
    } catch {
      error.hidden = false;
      input.focus();
      return;
    }
    if (state.items.some((x) => x.url === input.value)) {
      toast("该链接已收藏。可在收藏库中重新抓取更新。");
      return;
    }
    const b = f.querySelector("button");
    b.disabled = true;
    b.textContent = "添加中…";
    setTimeout(() => {
      state.items.unshift({
        id: Date.now(),
        title: "正在读取链接…",
        url: input.value,
        summary: "内容正在抓取与总结。",
        tags: ["待生成"],
        status: "processing",
        source: "管理端",
        updated: "刚刚",
        manual: false,
      });
      input.value = "";
      b.disabled = false;
      b.innerHTML = `${icon("add")} 添加`;
      if (window.lucide) lucide.createIcons();
      toast("已加入，正在抓取总结中。");
    }, 650);
    return;
  }
  if (f.id === "filter-form") {
    const k = f.elements.keyword.value.trim().toLowerCase(),
      tag = f.elements.tag.value;
    document.querySelectorAll(".item-card").forEach((el, i) => {
      const x = state.items[i];
      el.hidden = Boolean(
        (k && !`${x.title} ${x.summary} ${x.url}`.toLowerCase().includes(k)) ||
        (tag && !x.tags.includes(tag)),
      );
    });
    toast("筛选结果已更新。");
    return;
  }
  if (f.id === "summary-form") {
    const x = state.items.find((i) => i.id === state.selectedId);
    x.summary = f.elements.summary.value.trim();
    x.manual = true;
    render();
    toast("总结已保存并标记为人工编辑。");
    return;
  }
  if (f.id === "language-form") {
    state.language = f.elements.language.value;
    toast(
      state.language === "en"
        ? "Language preference saved."
        : "语言偏好已保存。",
    );
    return;
  }
  toast("设置已保存到原型内存。");
});
document.querySelector("#state-switcher").addEventListener("change", (e) => {
  state.pageState = e.target.value;
  if (state.surface === "admin" && state.pageState === "locked") {
    state.authenticated = false;
  }
  render();
});
const initial = new URLSearchParams(location.search);
if (
  state.surface === "admin" &&
  initial.get("route") &&
  initial.get("route") !== "login"
) {
  state.authenticated = true;
  state.adminRoute = initial.get("route");
}
if (initial.get("tab")) state.settingsTab = initial.get("tab");
render();
