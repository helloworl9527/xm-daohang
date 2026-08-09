"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormEvent, useState } from "react";

export function LocalePanel({ csrfToken, initial }: { csrfToken: string; initial: "zh" | "en" }) {
  const t = useTranslations("admin.settings.locale");
  const router = useRouter();
  const [locale, setLocale] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await fetch("/admin/api/settings/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="settings-locale-title" className="settings-panel" id="settings-locale">
      <header><p>{t("eyebrow")}</p><h2 id="settings-locale-title">{t("title")}</h2><p>{t("description")}</p></header>
      <form onSubmit={save}><fieldset disabled={status === "saving"}>
        <label><span>{t("language")}</span><select name="default-locale" onChange={(event) => setLocale(event.target.value as "zh" | "en")} value={locale}><option value="zh">{t("zh")}</option><option value="en">{t("en")}</option></select></label>
        <button type="submit">{status === "saving" ? t("saving") : t("save")}</button>
        <output aria-live="polite">{status === "saved" ? t("saved") : status === "error" ? t("error") : null}</output>
      </fieldset></form>
    </section>
  );
}
