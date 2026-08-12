import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryWorkbench } from "@/app/admin/(protected)/categories/_components/CategoryWorkbench";
import { CategorySelector } from "@/app/admin/(protected)/library/[id]/CategorySelector";
import { applyCategoriesInputSchema } from "@/lib/categories/apply";
import { render } from "../render";

const CATEGORY_A = "30000000-0000-4000-8000-000000000001";
const CATEGORY_B = "30000000-0000-4000-8000-000000000002";
const CATEGORY_C = "30000000-0000-4000-8000-000000000003";
const overview = {
  categories: [
    { id: CATEGORY_A, name: "开发工具", slug: "dev", sort: 0, autoCount: 4, manualCount: 2 },
    { id: CATEGORY_B, name: "人工智能", slug: "ai", sort: 1, autoCount: 3, manualCount: 0 },
    { id: CATEGORY_C, name: "阅读资料", slug: "reading", sort: 2, autoCount: 1, manualCount: 0 },
  ],
  eligible: { classified: 7, unclassified: 3, total: 10 },
  manualItems: 2,
  completedDocs: 5,
};

const proposal = {
  mode: "full" as const,
  baseVersion: 2,
  snapshotAt: "2026-08-11T00:00:00.000Z",
  diffs: [
    { kind: "add" as const, proposalId: "new", name: "数据工具", autoCount: 0, manualCount: 0 },
    {
      kind: "delete" as const,
      proposalId: "delete-dev",
      sourceCategoryId: CATEGORY_A,
      autoCount: 4,
      manualCount: 2,
    },
  ],
};

const fourKindProposal = {
  mode: "full" as const,
  baseVersion: 2,
  snapshotAt: "2026-08-11T00:00:00.000Z",
  diffs: [
    { kind: "add" as const, proposalId: "new", name: "数据工具", autoCount: 0, manualCount: 0 },
    { kind: "rename" as const, proposalId: "rename-ai", sourceCategoryId: CATEGORY_B, name: "智能工具", autoCount: 3, manualCount: 0 },
    {
      kind: "merge" as const,
      proposalId: "merge-dev",
      sourceCategoryId: CATEGORY_A,
      target: { kind: "existing" as const, categoryId: CATEGORY_B },
      autoCount: 4,
      manualCount: 0,
    },
    { kind: "delete" as const, proposalId: "delete-reading", sourceCategoryId: CATEGORY_C, autoCount: 1, manualCount: 0 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  let uuidSequence = 20;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `30000000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`),
  });
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
});

afterEach(() => cleanup());

async function renderProposal(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock.mockResolvedValueOnce(Response.json(proposal)));
  render(<CategoryWorkbench csrfToken="csrf-token" initialOverview={overview} />);
  fireEvent.click(screen.getByRole("button", { name: /全量重拟/ }));
  await screen.findByRole("heading", { name: "变更预览" });
}

describe("CategoryWorkbench", () => {
  it("keeps the manual protection visible and disables apply when every diff is ignored", async () => {
    const fetchMock = vi.fn();
    await renderProposal(fetchMock);

    expect(screen.getByRole("note")).toHaveTextContent("人工分类始终保护");
    for (const button of screen.getAllByRole("button", { name: "忽略" })) fireEvent.click(button);
    expect(screen.getByRole("button", { name: "检查并应用 0 项" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "新分类" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "自动条目去向" })).toBeDisabled();
    expect(screen.getByText("应用 0 / 忽略 2")).toBeVisible();
  });

  it("gives immediate press feedback and clears it when proposal input is cancelled", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CategoryWorkbench csrfToken="csrf-token" initialOverview={overview} />);
    const button = screen.getByRole("button", { name: /补充建议/ });
    fireEvent.pointerDown(button);
    expect(button).toHaveAttribute("data-pressed", "true");
    fireEvent.pointerCancel(button);
    expect(button).not.toHaveAttribute("data-pressed");
  });

  it("restores the latest server run after navigating back to the workbench", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<CategoryWorkbench csrfToken="csrf-token" initialOverview={overview} initialRun={{
      id: "run-1",
      status: "partial",
      failedCount: 2,
      reclassified: 8,
      movedUnclassified: 1,
      counts: { added: 1, renamed: 1, merged: 0, deleted: 0, ignored: 2 },
    }} />);

    expect(screen.getByRole("heading", { name: "应用完成，部分重跑失败" })).toBeVisible();
    expect(screen.getByText("8")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试失败条目" })).toBeEnabled();
  });

  it("edits a diff and shows an independent confirmation with reclassification enabled", async () => {
    const fetchMock = vi.fn();
    await renderProposal(fetchMock);

    fireEvent.change(screen.getByRole("textbox", { name: "新分类" }), { target: { value: "数据工程" } });
    fireEvent.change(screen.getByRole("combobox", { name: "自动条目去向" }), {
      target: { value: `existing:${CATEGORY_B}` },
    });
    const reviewButton = screen.getByRole("button", { name: "检查并应用 2 项" });
    reviewButton.focus();
    fireEvent.click(reviewButton);

    const dialog = screen.getByRole("dialog", { name: "确认应用分类变更" });
    expect(dialog).toHaveTextContent("应用 2 / 忽略 0 / 人工保护 2");
    expect(within(dialog).getByRole("checkbox", { name: "应用后重跑自动分类条目" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "检查并应用 2 项" })).toHaveFocus());
  });

  it("surfaces a manual-category conflict and reuses the same request key", async () => {
    const fetchMock = vi.fn();
    await renderProposal(fetchMock);
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: { code: "MANUAL_CATEGORY_CONFLICT" } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "MANUAL_CATEGORY_CONFLICT" } }, { status: 409 }));

    fireEvent.click(screen.getByRole("button", { name: "检查并应用 2 项" }));
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先迁移或在预览忽略该项");
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const firstBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as { requestKey: string };
    const secondBody = JSON.parse(fetchMock.mock.calls[2]![1].body as string) as { requestKey: string };
    expect(secondBody.requestKey).toBe(firstBody.requestKey);
  });

  it("passes every UI-produced accepted diff kind through the real strict apply schema", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(fourKindProposal))
      .mockResolvedValueOnce(Response.json({
        runId: "run-four-kinds",
        status: "completed",
        counts: { added: 1, renamed: 1, merged: 1, deleted: 1, ignored: 0 },
      }))
      .mockResolvedValueOnce(Response.json({ overview }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CategoryWorkbench csrfToken="csrf-token" initialOverview={overview} />);

    fireEvent.click(screen.getByRole("button", { name: /全量重拟/ }));
    await screen.findByRole("heading", { name: "变更预览" });
    fireEvent.click(screen.getByRole("button", { name: "检查并应用 4 项" }));
    fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const body: unknown = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    const parsed = applyCategoriesInputSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.accepted.map((diff) => diff.kind)).toEqual(["add", "rename", "merge", "delete"]);
    expect(parsed.data.accepted).toContainEqual(expect.objectContaining({
      kind: "merge",
      target: { kind: "existing", categoryId: CATEGORY_B },
    }));
    for (const [kind, requiredField] of [
      ["add", "name"],
      ["rename", "name"],
      ["merge", "target"],
      ["delete", "autoDestination"],
    ] as const) {
      const invalid = structuredClone(parsed.data) as unknown as {
        accepted: Array<Record<string, unknown>>;
      };
      const diff = invalid.accepted.find((candidate) => candidate.kind === kind);
      expect(diff, `${kind} fixture`).toBeDefined();
      delete diff![requiredField];
      expect(
        applyCategoriesInputSchema.safeParse(invalid).success,
        `${kind}.${requiredField} is required`,
      ).toBe(false);
    }
  });

  it("requires a separate confirmation before deleting a fixed category", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ autoCount: 4, manualCount: 2 }))
      .mockResolvedValueOnce(Response.json({ overview: { ...overview, categories: [overview.categories[1]] } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CategoryWorkbench csrfToken="csrf-token" initialOverview={overview} />);

    fireEvent.click(screen.getByRole("button", { name: "删除 开发工具" }));
    const dialog = screen.getByRole("dialog", { name: "确认删除分类" });
    expect(dialog).toHaveTextContent("6 条内容将转为未分类");
    expect(dialog).toHaveTextContent("2 条人工条目会保留人工保护标记");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除并转未分类" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/admin/api/categories/${CATEGORY_A}`,
      expect.objectContaining({ method: "DELETE" }),
    ));
  });
});

describe("CategorySelector", () => {
  it("saves a manual category with If-Match and reports artificial priority", async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ overview }))
      .mockResolvedValueOnce(Response.json({
        item: { categoryId: CATEGORY_B, categoryName: "人工智能", categoryManual: true },
      }, { headers: { ETag: '"etag-two"' } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CategorySelector categoryId={null} categoryManual={false} csrfToken="csrf-token" disabled={false} etag='"etag-one"' itemId="item-1" onSaved={onSaved} />);

    const select = await screen.findByRole("combobox", { name: "选择单一主分类" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "人工智能" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: CATEGORY_B } });
    fireEvent.click(screen.getByRole("button", { name: "保存分类" }));
    await screen.findByText("人工分类已保存，后续 AI 不覆盖。");

    expect(fetchMock).toHaveBeenLastCalledWith("/admin/api/items/item-1/category", expect.objectContaining({
      method: "PATCH",
      headers: expect.objectContaining({ "If-Match": '"etag-one"' }),
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ categoryManual: true }), '"etag-two"');
  });

  it("restores the original selection after an item conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ overview }))
      .mockResolvedValueOnce(Response.json({ error: { code: "ITEM_CONFLICT" } }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CategorySelector categoryId={CATEGORY_A} categoryManual csrfToken="csrf-token" disabled={false} etag='"etag-one"' itemId="item-1" onSaved={vi.fn()} />);

    const select = await screen.findByRole("combobox", { name: "选择单一主分类" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "人工智能" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: CATEGORY_B } });
    fireEvent.click(screen.getByRole("button", { name: "保存分类" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("条目已更新，请刷新后再选择");
    expect(select).toHaveValue(CATEGORY_A);
  });
});
