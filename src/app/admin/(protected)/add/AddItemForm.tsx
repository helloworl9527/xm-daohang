"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Pressable } from "@/components/ui/Pressable";

type AddStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "error"; message: string };

interface AddResponse {
  id?: string;
  deduped?: boolean;
  error?: { code?: string; message?: string };
}

function inferTypeHint(value: string): "web" | "github" | "document" | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.toLowerCase() === "github.com") return "github";
    if (/\.(?:docx?|md|odt|pdf|rtf|txt)$/iu.test(parsed.pathname)) return "document";
    return "web";
  } catch {
    return null;
  }
}

export function AddItemForm({
  csrfToken,
  modelConfigured,
}: {
  csrfToken: string;
  modelConfigured: boolean;
}) {
  const t = useTranslations("admin.add");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<AddStatus>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status.kind === "submitting";
  const typeHint = inferTypeHint(url);

  useEffect(() => {
    if (!url || status.kind === "success" || status.kind === "duplicate") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [status.kind, url]);

  const submit = async () => {
    setStatus({ kind: "submitting" });
    try {
      const response = await fetch("/admin/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json() as AddResponse;
      if (!response.ok || !payload.id) {
        setStatus({
          kind: "error",
          message: t("error"),
        });
        inputRef.current?.focus();
        return;
      }
      setStatus(payload.deduped
        ? { kind: "duplicate", id: payload.id }
        : { kind: "success", id: payload.id });
      navigator.vibrate?.(7);
    } catch {
      setStatus({ kind: "error", message: t("networkError") });
      inputRef.current?.focus();
    }
  };

  return (
    <section aria-labelledby="add-item-title" className="admin-work-section">
      <div className="admin-section-heading">
        <p>{t("eyebrow")}</p>
        <h1 id="add-item-title">{t("title")}</h1>
        <p>{t("description")}</p>
      </div>

      {!modelConfigured ? (
        <div className="admin-inline-notice" role="status">
          <strong>{t("configureTitle")}</strong>
          <span>{t("configureDescription")}</span>
          <Link href="/admin/settings/models">{t("configureLink")}</Link>
        </div>
      ) : null}

      <form
        className="add-item-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="add-item-url">{t("url")}</label>
        <div className="add-item-input-row">
          <input
            aria-describedby="add-item-status"
            aria-invalid={status.kind === "error"}
            autoComplete="url"
            disabled={!modelConfigured || busy}
            id="add-item-url"
            inputMode="url"
            name="url"
            onChange={(event) => {
              setUrl(event.target.value);
              if (status.kind !== "idle" && status.kind !== "submitting") setStatus({ kind: "idle" });
            }}
            placeholder="https://example.com/article…"
            ref={inputRef}
            required
            spellCheck={false}
            type="url"
            value={url}
          />
          <Pressable disabled={!modelConfigured || busy} type="submit">
            {busy ? t("adding") : t("submit")}
          </Pressable>
        </div>
        <p aria-live="polite" className="add-item-type-hint">
          {typeHint ? t("typeHint", { type: t(`type.${typeHint}`) }) : t("typeHintEmpty")}
        </p>
      </form>

      <div aria-live="polite" className="add-item-status" id="add-item-status">
        {status.kind === "success" ? (
          <p>{t("success")} <Link href={`/admin/library/${status.id}`} prefetch={false}>{t("view")}</Link></p>
        ) : null}
        {status.kind === "duplicate" ? (
          <p>
            {t("duplicate")}
            {" "}<Link href={`/admin/library/${status.id}`} prefetch={false}>{t("view")}</Link>
            {" "}<Link href={`/admin/library/${status.id}#refetch`} prefetch={false}>{t("viewRefetch")}</Link>
          </p>
        ) : null}
        {status.kind === "error" ? <p role="alert">{status.message}</p> : null}
      </div>
    </section>
  );
}
