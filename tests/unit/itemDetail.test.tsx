import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemDetail } from "@/app/admin/(protected)/library/[id]/ItemDetail";
import { render } from "../render";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const completedItem = {
  id: "00000000-0000-4000-8000-000000000021",
  url: "https://example.com/detail",
  type: "web",
  title: "条目详情",
  summary: "原总结。",
  summaryManual: false,
  categoryId: null,
  categoryName: null,
  categoryManual: false,
  tags: ["标签一", "标签二", "标签三"],
  status: "completed",
  failReason: null,
  source: "admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function detailResponse(item = completedItem, etag = '"etag-one"') {
  return Response.json({ item }, { headers: { ETag: etag } });
}

const categoryOverviewResponse = () => Response.json({ overview: { categories: [] } });

describe("ItemDetail", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.restoreAllMocks();
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  afterEach(() => cleanup());

  it("loads the detail and preserves a failed summary draft", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(detailResponse())
      .mockResolvedValueOnce(categoryOverviewResponse())
      .mockResolvedValueOnce(Response.json({ error: { message: "保存失败。" } }, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ItemDetail itemId={completedItem.id} csrfToken="csrf-token" />);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取条目…");
    const editor = await screen.findByRole("textbox", { name: "总结" });
    expect(screen.getByRole("complementary", { name: "条目信息" })).toHaveTextContent("网页");
    expect(screen.getByRole("heading", { name: "标签" })).toBeVisible();
    fireEvent.change(editor, { target: { value: "未保存的人工总结。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存总结" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败，请稍后重试。");
    expect(editor).toHaveValue("未保存的人工总结。");
    expect(fetchMock).toHaveBeenCalledWith(
      `/admin/api/items/${completedItem.id}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "If-Match": '"etag-one"' }),
      }),
    );
  });

  it("marks a saved summary as manual", async () => {
    const saved = { ...completedItem, summary: "人工总结。", summaryManual: true };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(detailResponse())
      .mockResolvedValueOnce(categoryOverviewResponse())
      .mockResolvedValueOnce(detailResponse(saved, '"etag-two"'));
    vi.stubGlobal("fetch", fetchMock);
    render(<ItemDetail itemId={completedItem.id} csrfToken="csrf-token" />);

    const editor = await screen.findByRole("textbox", { name: "总结" });
    fireEvent.change(editor, { target: { value: "人工总结。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存总结" }));
    expect(await screen.findByText("已标记为人工编辑")).toBeVisible();
    expect(screen.getByRole("button", { name: "删除条目" })).toBeVisible();
  });

  it("confirms deletion in a dialog while processing", async () => {
    const processing = { ...completedItem, status: "processing" as const };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(detailResponse(processing))
      .mockResolvedValueOnce(categoryOverviewResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ItemDetail itemId={completedItem.id} csrfToken="csrf-token" />);

    await screen.findByRole("complementary", { name: "条目信息" });
    const deleteButton = screen.getByRole("button", { name: "删除条目" });
    fireEvent.click(deleteButton);
    expect(screen.getByRole("dialog", { name: "确认删除条目" })).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/library"));
    expect(fetchMock).toHaveBeenCalledWith(
      `/admin/api/items/${completedItem.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
