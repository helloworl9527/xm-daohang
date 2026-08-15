// @vitest-environment node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { JSDOM } from "jsdom";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const BASE_HEAD = "114c272c3a0bf9074060fe2cba256ca1d81f7e77";
const TSX_FILES = [
  "src/components/ui/Pressable.tsx",
  "src/components/ui/MotionRegion.tsx",
];

function baseline(path: string): string {
  return execFileSync("git", ["show", `${BASE_HEAD}:${path}`], { cwd: process.cwd(), encoding: "utf8" });
}

function classSelectors(selector: string): Set<string> {
  const classes = new Set<string>();
  for (let index = 0; index < selector.length; index += 1) {
    if (selector[index] !== ".") continue;
    let end = index + 1;
    while (end < selector.length && /[A-Za-z0-9_-]/.test(selector[end]!)) end += 1;
    if (end > index + 1) classes.add(selector.slice(index + 1, end));
    index = end - 1;
  }
  return classes;
}

function cssClasses(source: string): Set<string> {
  const dom = new JSDOM("<!doctype html><style></style>");
  const style = dom.window.document.querySelector("style")!;
  style.textContent = source;
  const sheet = style.sheet;
  if (!sheet) throw new Error("CSSOM did not create a stylesheet");

  const result = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if ("selectorText" in rule && typeof rule.selectorText === "string") {
        for (const name of classSelectors(rule.selectorText)) result.add(name);
      }
      if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  visit(sheet.cssRules);
  dom.window.close();
  return result;
}

function addStaticTokens(value: string, result: Set<string>) {
  for (const token of value.split(/\s+/)) if (token) result.add(token);
}

function jsxClasses(source: string, fileName: string): Set<string> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = new Set<string>();

  const collect = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) addStaticTokens(node.text, result);
    if (ts.isTemplateExpression(node)) {
      addStaticTokens(node.head.text, result);
      for (const span of node.templateSpans) addStaticTokens(span.literal.text, result);
    }
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "className" && node.initializer) {
      collect(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
}

function expectSuperset(current: Set<string>, base: Set<string>) {
  const missing = [...base].filter((name) => !current.has(name));
  expect(missing).toEqual([]);
}

describe("legacy class contracts", () => {
  it("keeps baseline CSS class selectors", () => {
    const path = "src/app/globals.css";
    expectSuperset(cssClasses(readFileSync(join(process.cwd(), path), "utf8")), cssClasses(baseline(path)));
  });

  it("keeps baseline static JSX class tokens and dynamic prefixes", () => {
    for (const path of TSX_FILES) {
      const current = jsxClasses(readFileSync(join(process.cwd(), path), "utf8"), path);
      expectSuperset(current, jsxClasses(baseline(path), path));
    }
  });

  it("fails closed when a known baseline class disappears", () => {
    const base = cssClasses(baseline("src/app/globals.css"));
    const fixture = new Set(base);
    fixture.delete("admin-shell");
    expect(() => expectSuperset(fixture, base)).toThrow();
  });
});
