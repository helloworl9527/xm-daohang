import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("Ink & Signal design-system contracts", () => {
  it("keeps the approved token values and legacy palette", () => {
    const tokens: Record<string, string> = {
      "--ink-canvas": "#F6F5F2",
      "--ink-surface": "#FFFFFF",
      "--ink-surface-muted": "#EFEEE9",
      "--ink-text": "#17181A",
      "--ink-text-muted": "#686A70",
      "--ink-line": "#E4E2DC",
      "--ink-accent": "#E4573D",
      "--ink-accent-hover": "#C94732",
      "--ink-accent-soft": "#FBE8E3",
      "--ink-success": "#2E7D5B",
      "--ink-warning": "#B7791F",
      "--ink-danger": "#C53D3D",
      "--ink-focus": "#1669D3",
      "--ink-font-sans": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
      "--ink-font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
      "--ink-space-1": "0.25rem",
      "--ink-space-2": "0.5rem",
      "--ink-space-3": "0.75rem",
      "--ink-space-4": "1rem",
      "--ink-space-5": "1.5rem",
      "--ink-space-6": "2rem",
      "--ink-space-7": "3rem",
      "--ink-space-8": "4rem",
      "--ink-radius-sm": "4px",
      "--ink-radius-md": "8px",
      "--ink-radius-pill": "999px",
      "--ink-shadow-float": "0 12px 30px rgb(23 24 26 / 10%)",
      "--ink-shadow-focus": "0 0 0 3px rgb(22 105 211 / 28%)",
      "--ink-motion-fast": "120ms",
      "--ink-motion-standard": "320ms",
      "--ink-motion-ease": "cubic-bezier(0.2, 0.85, 0.25, 1)",
      "--ink-z-content": "0",
      "--ink-z-sticky": "20",
      "--ink-z-locale": "50",
      "--ink-z-drawer": "60",
      "--ink-z-dialog": "80",
      "--ink-z-skip": "100",
    };

    for (const [name, value] of Object.entries(tokens)) {
      expect(css).toContain(`${name}: ${value}`);
    }
    for (const name of ["--color-mist", "--color-white", "--color-ink", "--color-search", "--color-source", "--color-signal"]) {
      expect(css).toMatch(new RegExp(`${name.replaceAll("-", "\\-")}\\s*:`));
    }
  });

  it("keeps radii within the approved scale and declares all preference queries", () => {
    expect(css.match(/--ink-radius-(?:sm|md):\s*(\d+)px/g)?.every((entry) => Number(entry.match(/(\d+)px/)?.[1]) <= 8)).toBe(true);
    expect(css).toContain("--ink-radius-pill: 999px");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(css).toContain("@media (prefers-contrast: more)");
  });

  it("uses the low-specificity interaction opt-in and only transform motion", () => {
    expect(css).toContain(":where(.pressable, .ink-interactive");
    expect(css).toContain("[data-pressed=\"true\"]");
    expect(css).toContain("outline: 3px solid var(--ink-focus)");
    const interactionRules = css.slice(css.indexOf("/* Ink & Signal interaction contracts."));
    expect(interactionRules).not.toContain("!important");
    const migratedComponents = ["Pressable.tsx", "MotionRegion.tsx"]
      .map((file) => readFileSync(join(process.cwd(), "src/components/ui", file), "utf8"))
      .join("\n");
    expect(migratedComponents).not.toMatch(/style\.opacity|style\.height|style\.width/);
    expect(migratedComponents).not.toMatch(/zIndex|z-index/);
  });
});
