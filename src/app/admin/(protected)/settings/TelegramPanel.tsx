"use client";

import { useTranslations } from "next-intl";
import { FormEvent, useState } from "react";

interface TelegramValue { tokenMasked: string | null; allowedIds: number[] }

export function TelegramPanel({ csrfToken, initial }: { csrfToken: string; initial: TelegramValue }) {
  const t = useTranslations("admin.settings.telegram");
  const [token, setToken] = useState("");
  const [allowedIds, setAllowedIds] = useState(initial.allowedIds.join(", "));
  const [mask, setMask] = useState(initial.tokenMasked);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save(event: FormEvent) {
    event.preventDefault();
    const ids = allowedIds.split(/[\s,]+/).filter(Boolean).map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) { setStatus("error"); return; }
    setStatus("saving");
    try {
      const response = await fetch("/admin/api/settings/telegram", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ ...(token ? { token } : {}), allowedIds: ids }),
      });
      if (!response.ok) throw new Error("SAVE_FAILED");
      const payload = await response.json() as TelegramValue;
      setMask(payload.tokenMasked);
      setAllowedIds(payload.allowedIds.join(", "));
      setToken("");
      setStatus("saved");
      navigator.vibrate?.(7);
    } catch {
      setStatus("error");
    }
  }

  return (
    <section aria-labelledby="settings-telegram-title" className="settings-panel" id="settings-telegram">
      <header><p>{t("eyebrow")}</p><h2 id="settings-telegram-title">{t("title")}</h2><p>{t("description")}</p></header>
      <form onSubmit={save}><fieldset disabled={status === "saving"}>
        <label><span>{t("token")}</span><input aria-describedby="telegram-token-status" autoComplete="off" name="telegram-token" onChange={(event) => setToken(event.target.value)} placeholder={t("tokenPlaceholder")} type="password" value={token} /><small className="settings-secret-status" id="telegram-token-status">{mask ? t("tokenConfigured", { mask }) : t("tokenNotConfigured")}</small></label>
        <label><span>{t("allowedIds")}</span><textarea name="telegram-allowed-ids" onChange={(event) => setAllowedIds(event.target.value)} rows={3} spellCheck={false} value={allowedIds} /></label>
        <button type="submit">{status === "saving" ? t("saving") : t("save")}</button>
        <output aria-live="polite">{status === "saved" ? t("saved") : status === "error" ? t("error") : null}</output>
      </fieldset></form>
    </section>
  );
}
