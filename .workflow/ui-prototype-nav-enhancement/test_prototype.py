import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
SCREENSHOTS = ROOT / ".workflow" / "screenshots" / "nav-enhancement"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
URL = os.environ.get("PROTOTYPE_URL", "http://127.0.0.1:4177/")
CHROMIUM = Path.home() / "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"


def assert_no_overflow(page):
    metrics = page.evaluate("""() => ({
      doc: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      body: document.body.scrollWidth,
      offenders: [...document.querySelectorAll('body *')].map(el => {
        const r = el.getBoundingClientRect();
        return {tag: el.tagName, cls: el.className?.baseVal || el.className || '', left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width)};
      }).filter(x => x.right > innerWidth + 1 || x.left < -1).slice(0, 12)
    })""")
    assert metrics["doc"] <= metrics["viewport"] + 1, metrics
    assert metrics["body"] <= metrics["viewport"] + 1, metrics


def assert_controls_named(page):
    unnamed = page.evaluate("""() => [...document.querySelectorAll('button, a, input, select')]
      .filter(el => {
        const hidden = el.offsetParent === null;
        const named = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || '').trim();
        return !hidden && !named;
      }).map(el => el.outerHTML.slice(0, 160))""")
    assert unnamed == [], unnamed


def assert_no_fixed_overlap(page):
    boxes = page.evaluate("""() => {
      const box = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom}; };
      return {ask: box('.ask-dock'), controls: box('.prototype-bar')};
    }""")
    if boxes["ask"]:
        assert boxes["ask"]["b"] <= boxes["controls"]["t"] + 1, boxes


def public_checks(page, direction, mobile):
    page.goto(f"{URL}?surface=public&direction={direction}&state=default&lang=zh", wait_until="networkidle")
    expect(page.locator(".daily-card")).to_have_count(0)
    expect(page.get_by_text("把收藏，重新放回视野。")).to_have_count(0)
    expect(page.get_by_text("今日轮换")).to_have_count(0)
    expect(page.locator(".category-section")).to_have_count(6)
    expect(page.locator(".category-section").last).to_have_id("category-uncategorized")
    expect(page.locator("#category-reading .empty-category")).to_be_visible()
    expect(page.locator(".site-card")).to_have_count(10)
    assert page.locator(".site-card").first.get_attribute("target") == "_blank"
    assert page.locator(".site-card").first.get_attribute("rel") == "noopener nofollow"
    expect(page.locator(".ask-dock")).to_contain_text("回答仅来自收藏库")
    expect(page.locator(".ask-dock [data-ask-form] input")).to_be_visible()
    expect(page.locator("#directory-title")).to_have_text("目录")
    expect(page.get_by_text("ALL SAVES · WEB + GITHUB")).to_have_count(0)
    expect(page.get_by_text("固定分类 · 组内按名称排序 · 10 条原型数据")).to_have_count(0)
    expect(page.get_by_text("关键词找站点", exact=True)).to_have_count(0)
    expect(page.get_by_text("字面匹配 · web / GitHub · 不使用 AI", exact=True)).to_have_count(0)
    expect(page.locator("#keyword-input")).to_have_attribute("aria-label", "关键词找站点")
    expect(page.locator("[data-keyword-form]")).to_have_attribute("aria-label", "关键词找站点")
    expect(page.locator("[data-keyword-form] button[type=submit]")).to_have_attribute("aria-label", "搜索站点")
    expect(page.locator(".compact-search [data-ask-form]")).to_have_count(0)
    expect(page.locator(".ai-entry")).to_have_count(0)
    if not mobile:
        alignment = page.evaluate("""() => {
          const title = document.querySelector('#directory-title').getBoundingClientRect();
          const search = document.querySelector('.compact-search').getBoundingClientRect();
          return Math.abs((title.top + title.height / 2) - (search.top + search.height / 2));
        }""")
        assert alignment < 36, alignment
    assert_no_overflow(page)
    assert_controls_named(page)
    assert_no_fixed_overlap(page)

    if direction == "c":
        english = page.context.new_page()
        english.goto(f"{URL}?surface=public&direction=c&state=default&lang=en", wait_until="networkidle")
        expect(english.locator("#directory-title")).to_have_text("Directory")
        expect(english.get_by_text("ALL SAVES · WEB + GITHUB")).to_have_count(0)
        expect(english.get_by_text("Fixed categories · alphabetical within groups · 10 prototype items")).to_have_count(0)
        expect(english.get_by_text("Find a site by keyword", exact=True)).to_have_count(0)
        expect(english.get_by_text("Literal match · web / GitHub · no AI", exact=True)).to_have_count(0)
        expect(english.locator("#keyword-input")).to_have_attribute("aria-label", "Find a site by keyword")
        expect(english.locator("[data-keyword-form] button[type=submit]")).to_have_attribute("aria-label", "Find sites")
        assert_no_overflow(english)
        assert_controls_named(english)
        english.close()

    page.locator('[data-category-link="infra"]').click()
    expect(page.locator("#category-infra")).to_be_focused()
    assert page.locator('[data-category-link="infra"]').get_attribute("aria-current") == "location"

    page.locator(".ask-dock [data-ask-form] input").fill("如何做向量检索？")
    page.locator(".ask-dock [data-ask-form] button[type=submit]").click()
    expect(page.locator("#toast")).to_contain_text("沿用现有 AI 问答链路")

    page.locator("#keyword-input").fill("向量")
    expect(page.locator("[data-keyword-clear]")).to_be_visible()
    page.locator("[data-keyword-form]").press("Enter")
    expect(page.locator('[aria-busy="true"]')).to_be_visible()
    expect(page.get_by_role("heading", name="关键词结果")).to_be_visible(timeout=2000)
    expect(page.locator(".search-result-grid .site-card")).to_have_count(1)
    expect(page.locator(".search-result-shell")).to_contain_text("不调用 AI")
    page.locator("[data-keyword-clear]").last.click()
    expect(page.locator(".category-section")).to_have_count(6)

    page.locator("#keyword-input").fill("量子排版")
    page.locator("[data-keyword-form]").press("Enter")
    expect(page.get_by_role("heading", name="没有匹配的站点")).to_be_visible(timeout=2000)
    expect(page.locator(".search-result-shell")).to_contain_text("未调用 AI")
    page.locator("[data-keyword-clear]").last.click()

    page.select_option("#state-switcher", "keyword-input")
    expect(page.get_by_role("heading", name="输入完成，提交以查找站点")).to_be_visible()
    page.select_option("#state-switcher", "keyword-loading")
    expect(page.locator('[aria-busy="true"]')).to_be_visible()
    page.select_option("#state-switcher", "keyword-results")
    expect(page.locator(".search-result-grid .site-card")).to_have_count(1)
    page.select_option("#state-switcher", "keyword-empty")
    expect(page.get_by_role("heading", name="没有匹配的站点")).to_be_visible()
    page.select_option("#state-switcher", "directory-loading")
    expect(page.locator('[aria-busy="true"]')).to_be_visible()
    page.select_option("#state-switcher", "directory-empty")
    expect(page.get_by_role("heading", name="导航目录还是空的")).to_be_visible()
    page.select_option("#state-switcher", "directory-error")
    expect(page.get_by_role("alert")).to_be_visible()
    page.select_option("#state-switcher", "default")

    suffix = "mobile" if mobile else "desktop"
    page.goto(f"{URL}?surface=public&direction={direction}&state=default&lang=zh", wait_until="networkidle")
    page.evaluate("scrollTo(0, 0)")
    page.screenshot(path=str(SCREENSHOTS / f"public-{direction}-{suffix}.png"), full_page=True)
    if direction == "c":
        page.select_option("#state-switcher", "keyword-results")
        page.evaluate("scrollTo(0, 0)")
        page.screenshot(path=str(SCREENSHOTS / f"public-c-keyword-results-{suffix}.png"), full_page=True)


def admin_checks(page, direction, mobile):
    page.goto(f"{URL}?surface=admin&direction={direction}&state=default&lang=zh", wait_until="networkidle")
    expect(page.get_by_role("heading", name="维护固定分类与归属")).to_be_visible()
    expect(page.locator('[data-ai-start="supplement"]')).to_be_visible()
    expect(page.locator('[data-ai-start="replan"]')).to_be_visible()
    assert_controls_named(page)
    assert_no_overflow(page)

    page.locator('[data-ai-start="supplement"]').click()
    expect(page.get_by_role("heading", name="补充建议预览")).to_be_visible(timeout=2000)
    expect(page.locator(".diff-row")).to_have_count(2)
    expect(page.locator(".diff-type.add")).to_have_count(2)
    page.locator("[data-ai-reset]").click()

    page.locator('[data-ai-start="replan"]').click()
    expect(page.get_by_role("heading", name="全量类目 diff 预览")).to_be_visible(timeout=2000)
    expect(page.locator(".diff-row")).to_have_count(4)
    expect(page.locator(".manual-protection")).to_contain_text("category_manual=true")
    page.locator('[data-diff-toggle="delete-reading"]').click()
    page.locator('[data-diff-value="rename-ai"]').fill("AI 与模型工程")
    page.locator("[data-open-apply]").click()
    expect(page.locator("#apply-dialog")).to_be_visible()
    expect(page.locator("#apply-description")).to_contain_text("人工分类保持不动")
    page.locator("[data-rerun]").uncheck()
    page.locator("[data-confirm-apply]").click()
    expect(page.locator(".progress-track")).to_be_visible()
    expect(page.get_by_role("heading", name="分类建议已应用")).to_be_visible(timeout=2500)
    expect(page.locator(".result-panel")).to_contain_text("未重跑存量条目")

    page.locator('[data-assignment="0"]').select_option("design")
    expect(page.locator("#toast")).to_contain_text("后续 AI 不覆盖")

    page.locator('[data-delete="design"]').click()
    expect(page.locator("#delete-dialog")).to_be_visible()
    expect(page.locator("#delete-description")).to_contain_text("2 条内容将转入")
    page.locator("[data-confirm-delete]").click()
    expect(page.locator("#toast")).to_contain_text("转入未分类")
    expect(page.locator('[data-category-row="design"]')).to_have_count(0)

    page.select_option("#state-switcher", "ai-loading")
    expect(page.locator('[aria-busy="true"]')).to_be_visible()
    page.select_option("#state-switcher", "ai-preview")
    expect(page.locator(".diff-row")).to_have_count(4)
    page.select_option("#state-switcher", "ai-empty")
    expect(page.locator(".proposal-panel")).to_contain_text("没有发现需要补充")
    page.select_option("#state-switcher", "ai-error")
    expect(page.get_by_role("alert")).to_be_visible()
    page.select_option("#state-switcher", "default")

    suffix = "mobile" if mobile else "desktop"
    page.goto(f"{URL}?surface=admin&direction={direction}&state=default&lang=zh", wait_until="networkidle")
    page.evaluate("scrollTo(0, 0)")
    page.screenshot(path=str(SCREENSHOTS / f"admin-{direction}-{suffix}.png"), full_page=True)
    if direction == "c":
        page.select_option("#state-switcher", "ai-preview")
        page.evaluate("scrollTo(0, 0)")
        page.screenshot(path=str(SCREENSHOTS / f"admin-c-diff-{suffix}.png"), full_page=True)


def run():
    console_errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=str(CHROMIUM))
        for mobile, viewport in ((False, {"width": 1440, "height": 1000}), (True, {"width": 390, "height": 844})):
            for direction in ("a", "b", "c"):
                context = browser.new_context(viewport=viewport, reduced_motion="reduce" if mobile else "no-preference")
                page = context.new_page()
                page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
                page.on("pageerror", lambda exc: console_errors.append(str(exc)))
                public_checks(page, direction, mobile)
                admin_checks(page, direction, mobile)
                context.close()
        browser.close()
    assert console_errors == [], console_errors
    screenshots = len(list(SCREENSHOTS.glob("*.png")))
    assert screenshots == 16, screenshots
    print("PASS: selected C + A/B comparison; keyword/AI separation, F202a/F202b diff workflow, desktop/mobile states and accessibility")
    print(f"SCREENSHOTS: {screenshots} files in {SCREENSHOTS}")


if __name__ == "__main__":
    run()
