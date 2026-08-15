import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

for (const path of ["/", "/admin/login"]) {
  test(`${path} has stable Ink & Signal foundations`, async ({ page }, testInfo) => {
    const fontRequests: string[] = [];
    const browserErrors: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontRequests.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const focusTarget = page.locator("button:visible, input:visible, select:visible, textarea:visible, a[href]:visible").first();
    await focusTarget.focus();
    const focus = await focusTarget.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle, outlineWidth: style.outlineWidth, shadow: style.boxShadow };
    });
    expect(focus.outlineWidth).not.toBe("0px");
    expect(focus.outline).not.toBe("none");

    const targets = page.locator("button:visible, input:visible, select:visible, textarea:visible");
    const count = await targets.count();
    for (let index = 0; index < count; index += 1) {
      const box = await targets.nth(index).boundingBox();
      if (!box) continue;
      expect(box.height, `target ${index} is too short`).toBeGreaterThanOrEqual(testInfo.project.name.includes("mobile") ? 44 : 40);
    }

    expect(fontRequests.filter((url) => !url.startsWith("http://127.0.0.1:3100/") && !url.startsWith("http://localhost:3100/")).length).toBe(0);
    expect(browserErrors).toEqual([]);

    const directory = joinScreenshotDirectory();
    mkdirSync(directory, { recursive: true });
    const pageName = path === "/" ? "public-home" : "admin-login";
    await page.screenshot({ path: `${directory}/${pageName}-${testInfo.project.name}.png`, fullPage: true });
  });
}

function joinScreenshotDirectory() {
  return ".workflow/screenshots/ink-signal/phase-1";
}
