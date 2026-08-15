// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("public directory page architecture", () => {
  it("removes daily and hero rendering while isolating the directory read", async () => {
    const page = await readFile("src/app/(public)/page.tsx", "utf8");
    const data = await readFile("src/app/(public)/_components/DirectoryData.tsx", "utf8");
    const shell = await readFile("src/app/(public)/_components/DirectoryShell.tsx", "utf8");
    expect(page).not.toContain("pickDailyForNow");
    expect(page).not.toContain("public-intro");
    expect(page).not.toContain("public-daily-grid");
    expect(page).toContain("<DirectoryShell");
    expect(page).not.toContain("<AskExperience");
    expect(page).not.toContain("getPublicDirectory");
    expect(page).toContain("hasCommittedQuery ? null");
    expect(data).toContain("getPublicDirectory()");
    expect(shell).not.toContain("getPublicDirectory");
    expect(shell).toContain("<KeywordSearch");
    expect(shell).toContain("<AskExperience");
  });

  it("keeps directory failure local and renders three busy skeletons", async () => {
    const data = await readFile("src/app/(public)/_components/DirectoryData.tsx", "utf8");
    const loading = await readFile("src/app/(public)/loading.tsx", "utf8");
    expect(data).toContain("catch");
    expect(data).toContain('kind="error"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("length: 3");
    expect(loading).not.toContain("public-intro");
    expect(loading).not.toContain("public-daily-grid");
  });

  it("guards stale search responses even when a transport ignores abort", async () => {
    const shell = await readFile("src/app/(public)/_components/DirectoryShell.tsx", "utf8");
    expect(shell).toContain("requestIds.current.keyword");
    expect(shell).toContain('state.activeRequest?.mode !== "keyword"');
    expect(shell).toContain("controller.abort()");
  });
});
