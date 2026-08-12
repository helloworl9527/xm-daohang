"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormEvent, KeyboardEvent, RefObject, useEffect, useState } from "react";

import { Pressable } from "@/components/ui/Pressable";

interface KeywordSearchProps {
  draft: string;
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onClear: () => void;
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent) => void;
}

export function KeywordSearch({ draft, error, inputRef, onChange, onClear, onEnter, onSubmit }: KeywordSearchProps) {
  const t = useTranslations("public.directory");
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  return <form aria-label={t("searchLabel")} className="keyword-search" data-interactive={interactive ? "true" : undefined} onSubmit={onSubmit}>
    <label><span className="sr-only">{t("searchInput")}</span><input aria-describedby={error ? "keyword-error" : undefined} autoComplete="off" maxLength={101} name="keyword" onChange={(event) => onChange(event.target.value)} onKeyDown={onEnter} placeholder={t("searchPlaceholder")} ref={inputRef} value={draft} /></label>
    {draft ? <Pressable aria-label={t("clear")} className="keyword-clear" onClick={onClear} type="button"><X aria-hidden="true" size={18} /></Pressable> : null}
    <Pressable type="submit"><Search aria-hidden="true" size={18} /><span>{t("search")}</span></Pressable>
    {error ? <span id="keyword-error" role="alert">{error}</span> : null}
  </form>;
}
