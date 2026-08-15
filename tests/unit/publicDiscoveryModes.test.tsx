import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next-intl", () => ({
  useFormatter: () => ({ number: (value: number) => String(value) }),
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DirectoryShell } from "@/app/(public)/_components/DirectoryShell";

describe("public discovery modes", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function openAsk() {
    fireEvent.click(screen.getByRole("tab", { name: "askMode" }));
    return screen.getByRole("textbox", { name: "inputLabel" });
  }

  it("keeps a disabled ask mode visible and explains the initial readiness failure", () => {
    render(<DirectoryShell disabledReason="disabledUnavailable"><p>directory</p></DirectoryShell>);

    const input = openAsk();
    expect(input).toBeDisabled();
    expect(screen.getByText("disabledUnavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "submit" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a request-time MODEL_UNAVAILABLE response to its independent state", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: "MODEL_UNAVAILABLE" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }));
    render(<DirectoryShell><p>directory</p></DirectoryShell>);

    const input = openAsk();
    fireEvent.change(input, { target: { value: "What changed?" } });
    fireEvent.submit(screen.getByRole("form", { name: "regionLabel" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "unavailable" })).toBeVisible());
    expect(screen.queryByRole("heading", { name: "limited" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "error" })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("preserves the shared draft across modes without writing an ask question to the URL", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ answer: "answer", sources: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    render(<DirectoryShell><p>directory</p></DirectoryShell>);

    const keyword = screen.getByRole("textbox", { name: "searchInput" });
    fireEvent.change(keyword, { target: { value: "shared draft" } });
    const ask = openAsk();
    expect(ask).toHaveValue("shared draft");
    fireEvent.change(ask, { target: { value: "ask-only draft" } });
    fireEvent.click(screen.getByRole("tab", { name: "keywordMode" }));
    expect(screen.getByRole("textbox", { name: "searchInput" })).toHaveValue("ask-only draft");
    fireEvent.click(screen.getByRole("tab", { name: "askMode" }));
    fireEvent.submit(screen.getByRole("form", { name: "regionLabel" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/ask", expect.objectContaining({
      body: JSON.stringify({ question: "ask-only draft" }),
      method: "POST",
    })));
    expect(push).not.toHaveBeenCalled();
  });

  it("fails closed when an ask success envelope contains malformed sources", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ answer: "unsafe", sources: [{}] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    render(<DirectoryShell><p>directory</p></DirectoryShell>);

    const input = openAsk();
    fireEvent.change(input, { target: { value: "question" } });
    fireEvent.submit(screen.getByRole("form", { name: "regionLabel" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "error" })).toBeVisible());
    expect(screen.queryByText("unsafe")).not.toBeInTheDocument();
  });
});
