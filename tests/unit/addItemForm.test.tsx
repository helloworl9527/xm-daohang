import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddItemForm } from "@/app/admin/(protected)/add/AddItemForm";
import { render } from "../render";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AddItemForm", () => {
  it("disables submission and links to model settings when configuration is incomplete", () => {
    render(<AddItemForm csrfToken="csrf" modelConfigured={false} />);
    expect(screen.getByLabelText("公开链接")).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加到收藏库" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "前往模型设置" })).toHaveAttribute(
      "href",
      "/admin/settings/models",
    );
  });

  it("keeps the URL visible and announces a successful enqueue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111",
      deduped: false,
      status: "processing",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<AddItemForm csrfToken="csrf" modelConfigured />);
    const input = screen.getByLabelText("公开链接");
    fireEvent.change(input, { target: { value: "https://example.com/article" } });
    fireEvent.click(screen.getByRole("button", { name: "添加到收藏库" }));

    await waitFor(() => expect(screen.getByText("已加入，正在抓取总结中。")).toBeVisible());
    expect(input).toHaveValue("https://example.com/article");
    expect(fetch).toHaveBeenCalledWith("/admin/api/items", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": "csrf" },
    }));
  });

  it("announces a duplicate and provides item and refetch entry points", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "22222222-2222-4222-8222-222222222222",
      deduped: true,
      status: "completed",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<AddItemForm csrfToken="csrf" modelConfigured />);
    fireEvent.change(screen.getByLabelText("公开链接"), {
      target: { value: "https://example.com/existing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加到收藏库" }));

    await waitFor(() => expect(screen.getByText("该链接已收藏。")).toBeVisible());
    expect(screen.getByRole("link", { name: "查看条目" })).toHaveAttribute(
      "href",
      "/admin/library/22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByRole("link", { name: "查看并重抓" })).toHaveAttribute(
      "href",
      "/admin/library/22222222-2222-4222-8222-222222222222#refetch",
    );
  });
});
