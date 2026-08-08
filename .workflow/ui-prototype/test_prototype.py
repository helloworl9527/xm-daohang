from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
SHOTS = Path(__file__).resolve().parents[1] / "screenshots"
SHOTS.mkdir(exist_ok=True)


def assert_layout(page, label, public=False):
    page.wait_for_timeout(550)
    assert not page.evaluate(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
    ), f"{label}: horizontal overflow"
    clipped = page.evaluate(
        """[...document.querySelectorAll('button')]
          .filter(el => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 2)
          .map(el => el.textContent.trim())"""
    )
    assert not clipped, f"{label}: clipped buttons {clipped}"
    unlabeled = page.evaluate(
        """[...document.querySelectorAll('input, textarea, select')]
          .filter(el => el.offsetParent !== null && !el.labels?.length && !el.getAttribute('aria-label'))
          .map(el => el.name || el.id || el.tagName)"""
    )
    assert not unlabeled, f"{label}: unlabeled controls {unlabeled}"
    if public:
        boxes = page.evaluate(
            """(() => {
              const dock = document.querySelector('.question-dock').getBoundingClientRect();
              const bar = document.querySelector('.prototype-bar').getBoundingClientRect();
              const form = document.querySelector('.question-form').getBoundingClientRect();
              const label = document.querySelector('.question-form label').getBoundingClientRect();
              const input = document.querySelector('.question-form input').getBoundingClientRect();
              const button = document.querySelector('.question-form button').getBoundingClientRect();
              return {dockBottom: dock.bottom, barTop: bar.top, form, label, input, button};
            })()"""
        )
        assert boxes["dockBottom"] <= boxes["barTop"], f"{label}: fixed bars overlap"
        assert abs(boxes["input"]["width"] - boxes["label"]["width"]) < 1, boxes
        assert abs(boxes["input"]["height"] - boxes["form"]["height"]) < 1, boxes
        assert abs(boxes["input"]["x"] - boxes["form"]["x"]) < 1, boxes
        assert boxes["input"]["right"] <= boxes["button"]["x"], boxes
        text = page.locator("main").inner_text()
        for forbidden in ("API Key", "失败原因", "处理中", "用户 ID 白名单"):
            assert forbidden not in text, f"{label}: leaks admin text {forbidden}"


def signature(page):
    return page.evaluate(
        """(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10);
          };
          const css = getComputedStyle(document.documentElement);
          return {
            intro: rect('.public-intro'), grid: rect('.daily-grid'), dock: rect('.question-dock'),
            colors: ['--bg','--surface','--ink','--accent','--accent2','--signal'].map(x => css.getPropertyValue(x).trim())
          };
        })()"""
    )


def compare_original_apple(browser):
    signatures = {}
    for mode in ("original", "apple"):
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.goto(f"{BASE}/?surface=public&mode={mode}")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(650)
        signatures[mode] = signature(page)
        page.close()
    assert signatures["original"] == signatures["apple"], signatures


def key_flow(browser, mode):
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(f"{BASE}/?surface=public&mode={mode}")
    page.wait_for_load_state("networkidle")
    expect(page.locator(".public-card")).to_have_count(3)
    ask = page.get_by_role("textbox", name="向收藏库提问…")
    ask.fill("PostgreSQL 如何做语义检索？")
    page.get_by_role("button", name="提问").click()
    expect(page.get_by_text("仅基于 3 条库内来源")).to_be_visible(timeout=3000)
    expect(page.locator(".source")).to_have_count(3)
    page.get_by_role("textbox", name="向收藏库提问…").fill("火星天气")
    page.get_by_role("button", name="提问").click()
    expect(page.get_by_role("heading", name="收藏库中没有相关内容")).to_be_visible(timeout=3000)
    page.locator("#state-switcher").select_option("limited")
    expect(page.get_by_role("heading", name="今日提问已达上限，请稍后再来")).to_be_visible()
    assert_layout(page, f"public-{mode}", public=True)

    page.goto(f"{BASE}/?surface=admin&route=login&mode={mode}")
    page.get_by_label("密码").fill("wrong")
    page.get_by_role("button", name="登录管理端").click()
    expect(page.get_by_text("用户名或密码不正确。失败次数已记录。")).to_be_visible()
    page.get_by_label("密码").fill("prototype")
    page.get_by_role("button", name="登录管理端").click()
    expect(page.get_by_role("heading", name="添加内容")).to_be_visible()
    page.get_by_label("公开链接").fill("https://example.com/new")
    page.get_by_role("button", name="添加", exact=True).click()
    expect(page.get_by_text("已加入，正在抓取总结中。")).to_be_visible(timeout=3000)
    page.get_by_role("link", name="收藏库").click()
    page.get_by_role("button", name="查看 pgvector：PostgreSQL 向量检索实践").click()
    page.get_by_role("button", name="编辑总结").click()
    page.get_by_label("总结").fill("人工调整后的 Apple 对照原型总结。")
    page.get_by_role("button", name="保存总结").click()
    expect(page.get_by_text("人工编辑", exact=True)).to_be_visible()
    page.get_by_role("link", name="设置").click()
    page.get_by_role("button", name="公开限流").click()
    expect(page.get_by_label("单 IP 每日上限")).to_have_value("20")
    expect(page.get_by_label("全站每日上限")).to_have_value("200")
    page.get_by_role("button", name="模型").click()
    page.get_by_role("button", name="测试连接").click()
    expect(page.get_by_text("对话模型与嵌入模型均可连接。")).to_be_visible(timeout=3000)
    assert_layout(page, f"admin-{mode}")
    assert not errors, f"{mode} browser errors: {errors}"
    page.close()


def capture(browser):
    views = [
        ("public-home", "?surface=public", None),
        ("public-result", "?surface=public", "ask"),
        ("admin-login", "?surface=admin&route=login", None),
        ("admin-library", "?surface=admin&route=library", None),
        ("admin-rate", "?surface=admin&route=settings&tab=rate", None),
    ]
    for mode in ("original", "apple"):
        for device, viewport in (("desktop", {"width": 1440, "height": 1000}), ("mobile", {"width": 390, "height": 844})):
            for name, query, action in views:
                page = browser.new_page(viewport=viewport)
                page.goto(f"{BASE}/{query}&mode={mode}")
                page.wait_for_load_state("networkidle")
                if action == "ask":
                    page.get_by_role("textbox", name="向收藏库提问…").fill("如何设计安全的检索系统？")
                    page.get_by_role("button", name="提问").click()
                    expect(page.get_by_text("仅基于 3 条库内来源")).to_be_visible(timeout=3000)
                assert_layout(page, f"{name}-{mode}-{device}", public=name.startswith("public"))
                page.screenshot(path=str(SHOTS / f"{name}-{mode}-{device}.png"), full_page=True)
                page.close()


def reduced_motion_check(browser):
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.goto(f"{BASE}/?surface=public&mode=apple")
    page.wait_for_load_state("networkidle")
    assert page.locator("[data-spring=true]").count() == 0
    context.close()


def apple_behavior_check(browser):
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(f"{BASE}/?surface=public&mode=apple", wait_until="domcontentloaded")
    expect(page.locator("[data-spring=true]").first).to_be_attached()
    dock = page.locator(".question-dock")
    material = dock.evaluate("el => getComputedStyle(el).backdropFilter")
    assert material != "none", material
    before = dock.evaluate("el => getComputedStyle(el).transform")
    page.get_by_role("textbox", name="向收藏库提问…").focus()
    page.wait_for_timeout(180)
    after = dock.evaluate("el => getComputedStyle(el).transform")
    assert before != after, (before, after)
    button = page.get_by_role("button", name="提问")
    box = button.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    pressed = button.evaluate("el => getComputedStyle(el).transform")
    page.mouse.up()
    assert pressed != "none", pressed
    page.close()


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    compare_original_apple(browser)
    key_flow(browser, "original")
    key_flow(browser, "apple")
    reduced_motion_check(browser)
    apple_behavior_check(browser)
    capture(browser)
    browser.close()

print("PASS: C original/apple parity, two-surface flows, motion accessibility, responsive screenshots")
