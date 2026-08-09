// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { mergeWithChineseFallback, resolveLocale } from "@/lib/i18n/config";

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(full) : [full];
  }));
  return nested.flat();
}

describe("i18n configuration", () => {
  it("defaults invalid or missing preferences to Chinese", () => {
    expect(resolveLocale(undefined)).toBe("zh");
    expect(resolveLocale("fr")).toBe("zh");
    expect(resolveLocale("en")).toBe("en");
  });

  it("recursively falls back to Chinese for missing English keys", () => {
    const merged = mergeWithChineseFallback(
      { common: { save: "保存", nested: { retry: "重试" } } },
      { common: { save: "Save" } },
    );
    expect(merged).toEqual({ common: { save: "Save", nested: { retry: "重试" } } });
    expect(mergeWithChineseFallback(zh, en)).toHaveProperty("admin.detail.deleteDescription");
  });

  it("keeps all current page and component Chinese UI literals in message dictionaries", async () => {
    const files = (await filesBelow(path.resolve("src/app")))
      .filter((file) => file.endsWith(".tsx"));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (/[\u3400-\u9fff]/.test(line)) violations.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
      });
    }
    expect(violations).toEqual([]);
  });
});
