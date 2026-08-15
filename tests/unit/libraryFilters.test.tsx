import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryFilters, type LibraryFiltersValue } from "@/app/admin/(protected)/library/LibraryFilters";
import { render } from "../render";

describe("LibraryFilters", () => {
  afterEach(() => cleanup());

  it("preserves q, comma-separated tags, status, submit, and clear contracts", () => {
    let value: LibraryFiltersValue = { q: "", tags: [], status: "" };
    const onSubmit = vi.fn();
    const onClear = vi.fn();
    const onChange = vi.fn((next: LibraryFiltersValue) => { value = next; });
    const view = render(<LibraryFilters disabled={false} onChange={onChange} onClear={onClear} onSubmit={onSubmit} value={value} />);

    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "PostgreSQL" } });
    expect(onChange).toHaveBeenLastCalledWith({ q: "PostgreSQL", tags: [], status: "" });
    value = { q: "PostgreSQL", tags: [], status: "" };
    view.rerender(<LibraryFilters disabled={false} onChange={onChange} onClear={onClear} onSubmit={onSubmit} value={value} />);
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "数据库, 后端" } });
    expect(onChange).toHaveBeenLastCalledWith({ q: "PostgreSQL", tags: ["数据库", "后端"], status: "" });
    value = { q: "PostgreSQL", tags: ["数据库", "后端"], status: "" };
    view.rerender(<LibraryFilters disabled={false} onChange={onChange} onClear={onClear} onSubmit={onSubmit} value={value} />);
    fireEvent.change(screen.getByLabelText("状态"), { target: { value: "completed" } });
    expect(onChange).toHaveBeenLastCalledWith({ q: "PostgreSQL", tags: ["数据库", "后端"], status: "completed" });

    fireEvent.submit(screen.getByRole("button", { name: "筛选" }).closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables every interactive filter control while loading", () => {
    render(<LibraryFilters disabled onChange={vi.fn()} onClear={vi.fn()} onSubmit={vi.fn()} value={{ q: "", tags: [], status: "" }} />);
    expect(screen.getByRole("searchbox", { name: "关键词" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "标签" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "状态" })).toBeDisabled();
    for (const control of screen.getAllByRole("button")) expect(control).toBeDisabled();
  });
});
