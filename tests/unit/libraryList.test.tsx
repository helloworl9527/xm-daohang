import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryView } from "@/app/admin/(protected)/library/LibraryView";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const item = {
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://example.com/postgresql",
  type: "web",
  title: "PostgreSQL 入门",
  summary: "一篇数据库索引指南。",
  summaryManual: false,
  tags: ["数据库", "PostgreSQL", "后端"],
  status: "completed",
  failReason: null,
  source: "admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("LibraryView", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => cleanup());

  it("renders loading and then a dense item list", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    render(<LibraryView initialFilters={{ q: "", tags: [], status: "" }} />);
    const loading = screen.getByRole("status");
    expect(loading).toHaveTextContent("正在读取收藏库…");
    expect(loading.querySelectorAll(".library-skeleton-row")).toHaveLength(3);
    expect(loading.querySelectorAll(".library-skeleton-main")).toHaveLength(3);
    expect(loading.querySelectorAll(".library-skeleton-meta")).toHaveLength(3);

    resolveFetch(Response.json({ items: [item], nextCursor: null }));
    expect(await screen.findByRole("heading", { name: "PostgreSQL 入门" })).toBeVisible();
    expect(screen.getByText("一篇数据库索引指南。")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看 PostgreSQL 入门" })).toHaveAttribute(
      "href",
      `/admin/library/${item.id}`,
    );
  });

  it("writes combined filters into the page URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [], nextCursor: null })));
    render(<LibraryView initialFilters={{ q: "", tags: [], status: "" }} />);
    await screen.findByText("收藏库还没有条目");

    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "向量检索" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "检索, pgvector" } });
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));

    expect(replace).toHaveBeenCalledWith(
      "/admin/library?q=%E5%90%91%E9%87%8F%E6%A3%80%E7%B4%A2&tag=%E6%A3%80%E7%B4%A2&tag=pgvector&status=completed",
    );
  });

  it("distinguishes no filtered results and retries a failed request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LibraryView initialFilters={{ q: "missing", tags: [], status: "" }} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("收藏库暂时无法读取。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("没有符合当前筛选的条目")).toBeVisible();
    expect(screen.getByRole("button", { name: "清除筛选" })).toBeVisible();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
