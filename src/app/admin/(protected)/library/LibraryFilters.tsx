"use client";

import type { FormEvent } from "react";

import { Pressable } from "@/components/ui/Pressable";

export interface LibraryFiltersValue {
  q: string;
  tags: string[];
  status: "" | "processing" | "completed" | "failed";
}

export function LibraryFilters({
  disabled,
  value,
  onChange,
  onClear,
  onSubmit,
}: {
  disabled: boolean;
  value: LibraryFiltersValue;
  onChange: (value: LibraryFiltersValue) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="library-filters" onSubmit={submit}>
      <label>
        <span>关键词</span>
        <input
          disabled={disabled}
          maxLength={200}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
          placeholder="标题、总结或链接"
          type="search"
          value={value.q}
        />
      </label>
      <label>
        <span>标签</span>
        <input
          disabled={disabled}
          onChange={(event) => onChange({
            ...value,
            tags: event.target.value.split(",").map((tag) => tag.trim()),
          })}
          placeholder="多个标签用逗号分隔"
          value={value.tags.join(", ")}
        />
      </label>
      <label>
        <span>状态</span>
        <select
          disabled={disabled}
          onChange={(event) => onChange({
            ...value,
            status: event.target.value as LibraryFiltersValue["status"],
          })}
          value={value.status}
        >
          <option value="">全部状态</option>
          <option value="completed">已完成</option>
          <option value="processing">处理中</option>
          <option value="failed">失败</option>
        </select>
      </label>
      <div className="library-filter-actions">
        <Pressable disabled={disabled} type="submit">筛选</Pressable>
        <button disabled={disabled} onClick={onClear} type="button">清除</button>
      </div>
    </form>
  );
}
