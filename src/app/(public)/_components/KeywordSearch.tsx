"use client";

import { useTranslations } from "next-intl";
import { FormEvent, RefObject } from "react";

interface KeywordSearchProps {
  draft: string;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: (event: FormEvent) => void;
}

export function KeywordSearch({ draft, error, inputRef, onChange, onClear, onSubmit }: KeywordSearchProps) {
  const t = useTranslations("public.directory");
  return <form aria-label={t("searchLabel")} className="keyword-search" onSubmit={onSubmit}>
    <label><span className="sr-only">{t("searchInput")}</span><input aria-describedby={error ? "keyword-error" : undefined} autoComplete="off" maxLength={101} name="keyword" onChange={(event) => onChange(event.target.value)} placeholder={t("searchPlaceholder")} ref={inputRef} value={draft} /></label>
    {draft ? <button aria-label={t("clear")} className="keyword-clear" onClick={onClear} type="button">×</button> : null}
    <button type="submit">{t("search")}</button>
    {error ? <span id="keyword-error" role="alert">{error}</span> : null}
  </form>;
}
