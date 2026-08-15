"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { FormEvent, RefObject } from "react";

import type { AskResultState } from "@/app/(public)/_components/ResultPanel";
import { Pressable } from "@/components/ui/Pressable";

interface AskBarProps {
  disabledReason: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  state: AskResultState;
  value: string;
}

export function AskExperience({ disabledReason, inputRef, onChange, onSubmit, state, value }: AskBarProps) {
  const t = useTranslations("public.ask");
  const format = useFormatter();
  const loading = state.kind === "loading";
  const disabled = Boolean(disabledReason) || loading;
  return <aside aria-label={t("regionLabel")} className="public-ask-dock public-discovery-form-wrap">
    <form aria-label={t("regionLabel")} className="public-ask-form public-discovery-form" noValidate onSubmit={onSubmit}>
      <Sparkles aria-hidden="true" className="public-discovery-icon" size={20} />
      <label><span className="sr-only">{t("inputLabel")}</span><input aria-describedby="public-ask-help" autoComplete="off" disabled={Boolean(disabledReason)} maxLength={500} name="question" onChange={(event) => onChange(event.target.value)} placeholder={t("placeholder")} ref={inputRef} value={value} /></label>
      <Pressable aria-label={loading ? t("searching") : state.kind === "error" ? t("retry") : t("submit")} disabled={disabled} type="submit"><span className="public-ask-button-text">{loading ? t("searchingShort") : state.kind === "error" ? t("retry") : t("submit")}</span><ArrowRight aria-hidden="true" className="public-ask-arrow" size={18} /></Pressable>
      {state.kind === "invalid" ? <span className="public-discovery-error" role="alert">{t("invalid")}</span> : null}
    </form>
    <div className="public-ask-meta" id="public-ask-help"><span>{disabledReason ?? t("scope")}</span><span>{format.number(value.length)} / {format.number(500)}</span></div>
  </aside>;
}
