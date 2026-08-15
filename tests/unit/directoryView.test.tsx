import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { deriveSitePresentation, DirectoryView } from "@/app/(public)/_components/DirectoryView";

afterEach(cleanup);

const site = {
  id: "a5000000-0000-4000-8000-000000000001", title: "Example", summary: "Summary",
  url: "https://example.com/path", tags: ["one", "two", "three"], categoryName: "Tools",
  faviconPath: "/favicon/a5000000-0000-4000-8000-000000000001",
};

describe("DirectoryView", () => {
  it("derives GitHub metadata only from complete HTTP repository URLs", () => {
    expect(deriveSitePresentation("https://www.github.com/Owner/Repo/issues")).toEqual({ kind: "github", hostname: "Owner/Repo" });
    expect(deriveSitePresentation("https://github.com/owner")).toEqual({ kind: "web", hostname: "github.com" });
    expect(deriveSitePresentation("javascript:alert(1)")).toEqual({ kind: "web", hostname: "javascript:alert(1)" });
    expect(deriveSitePresentation("not a url")).toEqual({ kind: "web", hostname: "not a url" });
  });

  it("renders empty groups and unclassified last with safe whole-card links", () => {
    render(<DirectoryView groups={[
      { id: "cat-1", name: "Tools", sites: [site] },
      { id: "cat-2", name: "Empty", sites: [] },
      { id: null, name: null, sites: [] },
    ]} />);
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.at(-1)).toHaveTextContent("unclassified");
    expect(screen.getAllByText("emptyGroup")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Example/ })).toHaveAttribute("rel", "noopener nofollow");
    expect(screen.getByRole("link", { name: /Example/ })).toHaveAttribute("target", "_blank");
  });

  it("moves focus and aria-current to the selected stable category anchor", () => {
    render(<DirectoryView groups={[{ id: "cat-1", name: "Tools", sites: [site] }, { id: null, name: null, sites: [] }]} />);
    const anchor = within(screen.getByRole("navigation")).getByRole("link", { name: /Tools/ });
    fireEvent.click(anchor);
    expect(anchor).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("heading", { name: "Tools" })).toHaveFocus();
  });
});
