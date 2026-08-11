"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type Option = { id: string; name: string };

export function CategorySelector({
  categoryId,
  categoryManual,
  csrfToken,
  disabled,
  etag,
  itemId,
  onSaved,
}: {
  categoryId: string | null;
  categoryManual: boolean;
  csrfToken: string;
  disabled: boolean;
  etag: string;
  itemId: string;
  onSaved: (item: { categoryId: string | null; categoryName: string | null; categoryManual: boolean }, etag: string) => void;
}) {
  const t = useTranslations("admin.detail.category");
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState(categoryId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(function loadCategories() {
    let cancelled = false;
    void fetch("/admin/api/categories", { cache: "no-store" }).then(async (response) => {
      if (!response.ok || cancelled) return;
      const payload = await response.json() as { overview: { categories: Option[] } };
      if (!cancelled) setOptions(payload.overview.categories);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(function syncSelectedCategory() {
    setSelected(categoryId ?? "");
  }, [categoryId]);

  const save = async () => {
    const previous = categoryId ?? "";
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/admin/api/items/${itemId}/category`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": etag,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ categoryId: selected || null }),
      });
      if (!response.ok) {
        setSelected(previous);
        setError(response.status === 409 ? t("conflict") : t("error"));
        return;
      }
      const payload = await response.json() as { item: { categoryId: string | null; categoryName: string | null; categoryManual: boolean } };
      onSaved(payload.item, response.headers.get("etag") ?? etag);
      setMessage(t("saved"));
    } catch {
      setSelected(previous);
      setError(t("error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="category-selector-title" className="item-category-selector">
      <div className="item-detail-section-heading"><h2 id="category-selector-title">{t("title")}</h2>{categoryManual ? <span><ShieldCheck aria-hidden="true" size={15} />{t("manual")}</span> : null}</div>
      <label><span>{t("label")}</span><select autoComplete="off" disabled={disabled || saving} name="item-category" onChange={(event) => setSelected(event.target.value)} value={selected}><option value="">{t("unclassified")}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <button disabled={disabled || saving || selected === (categoryId ?? "")} onClick={() => void save()} type="button">{saving ? t("saving") : t("save")}</button>
      <div aria-live="polite">{message ? <p>{message}</p> : null}{error ? <p role="alert">{error}</p> : null}</div>
    </section>
  );
}
