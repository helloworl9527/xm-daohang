"use client";

import type { FormEvent } from "react";
import { Search, Tag } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("admin.library");
  const common = useTranslations("common");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className="library-filters" onSubmit={submit}>
      <label>
        <span>{t("keyword")}</span>
        <span className="library-filter-control">
          <Search aria-hidden="true" size={16} />
          <input
            autoComplete="off"
            disabled={disabled}
            maxLength={200}
            name="q"
            onChange={(event) => onChange({ ...value, q: event.target.value })}
            placeholder={t("keywordPlaceholder")}
            type="search"
            value={value.q}
          />
        </span>
      </label>
      <label>
        <span>{t("tags")}</span>
        <span className="library-filter-control">
          <Tag aria-hidden="true" size={16} />
          <input
            autoComplete="off"
            disabled={disabled}
            name="tag"
            onChange={(event) => onChange({
              ...value,
              tags: event.target.value.split(",").map((tag) => tag.trim()),
            })}
            placeholder={t("tagsPlaceholder")}
            value={value.tags.join(", ")}
          />
        </span>
      </label>
      <label>
        <span>{t("status")}</span>
        <select
          autoComplete="off"
          disabled={disabled}
          name="status"
          onChange={(event) => onChange({
            ...value,
            status: event.target.value as LibraryFiltersValue["status"],
          })}
          value={value.status}
        >
          <option value="">{t("allStatuses")}</option>
          <option value="completed">{common("completed")}</option>
          <option value="processing">{common("processing")}</option>
          <option value="failed">{common("failed")}</option>
        </select>
      </label>
      <div className="library-filter-actions">
        <Pressable disabled={disabled} type="submit">{t("filter")}</Pressable>
        <Pressable disabled={disabled} onClick={onClear} type="button">{t("clear")}</Pressable>
      </div>
    </form>
  );
}
