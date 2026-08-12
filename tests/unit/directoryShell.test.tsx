import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn(); const refresh = vi.fn(); let query = "";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(query ? { q: query } : {}) }));

import { DirectoryShell } from "@/app/(public)/_components/DirectoryShell";

describe("DirectoryShell", () => {
  beforeEach(() => { query = ""; push.mockReset(); refresh.mockReset(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("does not search while typing and commits normalized input to URL", () => {
    render(<DirectoryShell><p>directory</p></DirectoryShell>);
    const input = screen.getByRole("textbox", { name: "searchInput" });
    fireEvent.change(input, { target: { value: "  Ａ  " } });
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("directory")).toBeVisible();
    fireEvent.submit(screen.getByRole("form", { name: "searchLabel" }));
    expect(push).toHaveBeenCalledWith("/?q=A");
  });

  it("submits the latest DOM value when Enter races a controlled state update", () => {
    render(<DirectoryShell><p>directory</p></DirectoryShell>);
    const input = screen.getByRole("textbox", { name: "searchInput" }) as HTMLInputElement;
    input.value = "latest";
    fireEvent.submit(screen.getByRole("form", { name: "searchLabel" }));
    expect(push).toHaveBeenCalledWith("/?q=latest");
  });

  it("keeps focus and reports invalid input without consuming search", () => {
    render(<DirectoryShell><p>directory</p></DirectoryShell>);
    const input = screen.getByRole("textbox", { name: "searchInput" });
    fireEvent.change(input, { target: { value: "a\0" } });
    fireEvent.submit(screen.getByRole("form", { name: "searchLabel" }));
    expect(screen.getByRole("alert")).toHaveTextContent("invalid");
    expect(input).toHaveFocus(); expect(fetch).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  });

  it("loads URL query results and distinguishes failure from empty", async () => {
    query = "alpha";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ query: "alpha", matches: [] }), { status: 200 }));
    render(<DirectoryShell><p>directory</p></DirectoryShell>);
    expect(screen.getByLabelText("searching")).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(screen.getByRole("heading", { name: "noResults" })).toBeVisible());
    expect(screen.getByText(/noResultsDetail/)).toBeVisible();
    cleanup();
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<DirectoryShell><p>directory</p></DirectoryShell>);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("searchError"));
    expect(screen.queryByRole("heading", { name: "noResults" })).not.toBeInTheDocument();
  });
});
