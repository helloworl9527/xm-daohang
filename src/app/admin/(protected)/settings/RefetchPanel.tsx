"use client";

import { useLocale, useTranslations } from "next-intl";
import { FormEvent, useState } from "react";

interface RefetchValue {
  enabled: boolean;
  intervalDays: number;
  lastRun: string | null;
  nextRun: string | null;
}

export function RefetchPanel({ csrfToken, initial }: { csrfToken: string; initial: RefetchValue }) {
  const t = useTranslations("admin.settings.refetch");
  const locale = useLocale();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const date = (input: string | null) => input
    ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(input))
    : t("never");

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await fetch("/admin/api/settings/refetch", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ enabled: value.enabled, intervalDays: value.intervalDays }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      setValue(await response.json() as RefetchValue);
      setStatus("saved");
      navigator.vibrate?.(7);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="settings-refetch-title" className="settings-panel" id="settings-refetch">
      <header><p>{t("eyebrow")}</p><h2 id="settings-refetch-title">{t("title")}</h2><p>{t("description")}</p></header>
      <form onSubmit={save}>
        <fieldset disabled={status === "saving"}>
          <label className="settings-toggle"><input checked={value.enabled} name="refetch-enabled" onChange={(event) => setValue((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /><span>{t("enabled")}</span></label>
          <label><span>{t("interval")}</span><input inputMode="numeric" max={3650} min={1} name="refetch-interval" onChange={(event) => setValue((current) => ({ ...current, intervalDays: Number(event.target.value) }))} required type="number" value={value.intervalDays} /></label>
          <dl className="settings-facts"><div><dt>{t("lastRun")}</dt><dd>{date(value.lastRun)}</dd></div><div><dt>{t("nextRun")}</dt><dd>{value.enabled ? date(value.nextRun) : t("disabled")}</dd></div></dl>
          <button type="submit">{status === "saving" ? t("saving") : t("save")}</button>
          <output aria-live="polite">{status === "saved" ? t("saved") : status === "error" ? t("error") : null}</output>
        </fieldset>
      </form>
    </section>
  );
}
