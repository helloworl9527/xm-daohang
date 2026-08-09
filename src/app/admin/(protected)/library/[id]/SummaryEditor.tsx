"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Pressable } from "@/components/ui/Pressable";

export function SummaryEditor({
  disabled,
  initialSummary,
  manual,
  onSave,
}: {
  disabled: boolean;
  initialSummary: string;
  manual: boolean;
  onSave: (summary: string) => Promise<boolean>;
}) {
  const t = useTranslations("admin.detail");
  const [draft, setDraft] = useState(initialSummary);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(initialSummary), [initialSummary]);

  useEffect(() => {
    if (draft === initialSummary) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, initialSummary]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="summary-editor-title" className="item-summary-editor">
      <div className="item-detail-section-heading">
        <h2 id="summary-editor-title">{t("summary")}</h2>
        {manual ? <span>{t("manual")}</span> : null}
      </div>
      <label className="item-summary-field">
        <span>{t("summary")}</span>
        <textarea
          autoComplete="off"
          disabled={disabled || saving}
          maxLength={10_000}
          name="summary"
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
          value={draft}
        />
      </label>
      <Pressable
        disabled={disabled || saving || !draft.trim() || draft === initialSummary}
        onClick={() => void save()}
        type="button"
      >
        {saving ? t("saving") : t("save")}
      </Pressable>
    </section>
  );
}
