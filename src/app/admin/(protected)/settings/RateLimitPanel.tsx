"use client";

import { useFormatter, useTranslations } from "next-intl";
import { FormEvent, useState } from "react";

interface RateValue { enabled: boolean; ipDaily: number; globalDaily: number; day: string; usedGlobal: number }

export function RateLimitPanel({ csrfToken, initial }: { csrfToken: string; initial: RateValue }) {
  const t = useTranslations("admin.settings.rate");
  const format = useFormatter();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await fetch("/admin/api/settings/rate-limit", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ enabled: value.enabled, ipDaily: value.ipDaily, globalDaily: value.globalDaily }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      setValue(await response.json() as RateValue);
      setStatus("saved");
      navigator.vibrate?.(7);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="settings-rate-title" className="settings-panel" id="settings-rate">
      <header><p>{t("eyebrow")}</p><h2 id="settings-rate-title">{t("title")}</h2><p>{t("description")}</p></header>
      <form onSubmit={save}><fieldset disabled={status === "saving"}>
        <label className="settings-toggle"><input checked={value.enabled} name="rate-enabled" onChange={(event) => setValue((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" /><span>{t("enabled")}</span></label>
        <div className="settings-field-grid">
          <label><span>{t("ipDaily")}</span><input inputMode="numeric" max={10000} min={1} name="rate-ip" onChange={(event) => setValue((current) => ({ ...current, ipDaily: Number(event.target.value) }))} required type="number" value={value.ipDaily} /></label>
          <label><span>{t("globalDaily")}</span><input inputMode="numeric" max={1000000} min={1} name="rate-global" onChange={(event) => setValue((current) => ({ ...current, globalDaily: Number(event.target.value) }))} required type="number" value={value.globalDaily} /></label>
        </div>
        <p className="settings-usage">{t("usage", { used: format.number(value.usedGlobal), limit: format.number(value.globalDaily), day: value.day })}</p>
        <button type="submit">{status === "saving" ? t("saving") : t("save")}</button>
        <output aria-live="polite">{status === "saved" ? t("saved") : status === "error" ? t("error") : null}</output>
      </fieldset></form>
    </section>
  );
}
