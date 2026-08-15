"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";

import { Pressable } from "@/components/ui/Pressable";

interface KeywordSearchProps {
  draft: string;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  loading: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function KeywordSearch({ draft, error, inputRef, loading, onChange, onClear, onSubmit }: KeywordSearchProps) {
  const t = useTranslations("public.directory");
  return <form aria-label={t("searchLabel")} className="keyword-search public-discovery-form" data-interactive="true" noValidate onSubmit={onSubmit}>
    <Search aria-hidden="true" className="public-discovery-icon" size={20} />
    <label><span className="sr-only">{t("searchInput")}</span><input aria-describedby={error ? "keyword-error" : undefined} autoComplete="off" maxLength={101} name="keyword" onChange={(event) => onChange(event.target.value)} placeholder={t("searchPlaceholder")} ref={inputRef} value={draft} /></label>
    {draft ? <Pressable aria-label={t("clear")} className="keyword-clear" onClick={onClear} type="button"><X aria-hidden="true" size={18} /></Pressable> : null}
    <Pressable disabled={loading} type="submit"><span>{loading ? t("searching") : t("search")}</span><ArrowRight aria-hidden="true" size={18} /></Pressable>
    {error ? <span id="keyword-error" role="alert">{error}</span> : null}
  </form>;
}
