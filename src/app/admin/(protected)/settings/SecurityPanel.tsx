"use client";

import { useTranslations } from "next-intl";
import { FormEvent, useState } from "react";

export function SecurityPanel({ csrfToken }: { csrfToken: string }) {
  const t = useTranslations("admin.settings.security");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await fetch("/admin/api/settings/security", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      navigator.vibrate?.(7);
      window.location.assign("/admin/login");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="settings-security-title" className="settings-panel" id="settings-security">
      <header><p>{t("eyebrow")}</p><h2 id="settings-security-title">{t("title")}</h2><p>{t("description")}</p></header>
      <form onSubmit={save}><fieldset disabled={status === "saving"}>
        <div className="settings-field-grid">
          <label><span>{t("current")}</span><input autoComplete="current-password" name="current-password" onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
          <label><span>{t("next")}</span><input autoComplete="new-password" minLength={12} name="new-password" onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
        </div>
        <button type="submit">{status === "saving" ? t("saving") : t("save")}</button>
        <output aria-live="polite">{status === "error" ? t("error") : null}</output>
      </fieldset></form>
    </section>
  );
}
