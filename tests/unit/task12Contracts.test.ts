import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Task 12 UI contracts", () => {
  it("keeps Chinese and English message keys identical and removes obsolete public daily copy", () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
    for (const key of ["eyebrow", "title", "description", "itemsLabel", "dailyError"] as const) {
      expect(zh.public).not.toHaveProperty(key);
      expect(en.public).not.toHaveProperty(key);
    }
  });

  it("uses the exact approved Lucide dependency and no hand-drawn SVG or text glyph icons", () => {
    const manifest = JSON.parse(source("package.json")) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["lucide-react"]).toBe("1.31.0");
    const files = [
      "src/app/(public)/_components/KeywordSearch.tsx",
      "src/app/(public)/_components/DirectoryView.tsx",
      "src/app/(public)/_components/AskBar.tsx",
      "src/app/admin/(protected)/AdminNav.tsx",
      "src/app/admin/(protected)/categories/_components/CategoryWorkbench.tsx",
    ];
    const combined = files.map(source).join("\n");
    expect(combined).toContain('from "lucide-react"');
    expect(combined).not.toContain("<svg");
    expect(combined).not.toMatch(/[×↗→]/u);
  });

  it("reuses interaction primitives and contains no presentation timers", () => {
    const category = source("src/app/admin/(protected)/categories/_components/CategoryWorkbench.tsx");
    const directory = source("src/app/(public)/_components/DirectoryShell.tsx");
    const product = [category, directory, source("src/app/(public)/_components/KeywordSearch.tsx")].join("\n");
    expect(category).toContain("<Pressable");
    expect(category).toContain("<MotionRegion");
    expect(category).toContain("<MaterialSurface");
    expect(directory).toContain("<MotionRegion");
    expect(product).not.toContain("setTimeout(");
  });

  it("keeps the category navigation entry and accessible public form names", () => {
    const nav = source("src/app/admin/(protected)/AdminNav.tsx");
    const keyword = source("src/app/(public)/_components/KeywordSearch.tsx");
    expect(nav).toContain('href: "/admin/categories"');
    expect(nav).toContain("FolderTree");
    expect(keyword).toContain('autoComplete="off"');
    expect(keyword).toContain('name="keyword"');
  });
});
