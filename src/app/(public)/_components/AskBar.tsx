"use client";

import { ArrowRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { FormEvent, useEffect, useState } from "react";

import { type AskResultState, type PublicSource, ResultPanel } from "@/app/(public)/_components/ResultPanel";
import { Pressable } from "@/components/ui/Pressable";

interface AskBarProps {
  disabledReason: string | null;
}

export function AskExperience({ disabledReason }: AskBarProps) {
  const t = useTranslations("public.ask");
  const format = useFormatter();
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskResultState>({ kind: "idle" });
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const loading = state.kind === "loading";
  const disabled = Boolean(disabledReason) || loading;

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardOpen(viewport.height < window.innerHeight * 0.72);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (disabled || normalized.length === 0) return;
    navigator.vibrate?.(7);
    setState({ kind: "loading" });
    try {
      const response = await fetch("/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: normalized }),
      });
      const payload = await response.json() as {
        answer?: string;
        sources?: PublicSource[];
        error?: { code?: string };
      };
      if (response.status === 429 || payload.error?.code === "RATE_LIMITED") {
        setState({ kind: "limited" });
      } else if (!response.ok) {
        setState({ kind: "error" });
      } else if (!payload.sources?.length) {
        setState({ kind: "empty" });
      } else if (typeof payload.answer === "string") {
        setState({ kind: "success", answer: payload.answer, sources: payload.sources });
      } else {
        setState({ kind: "error" });
      }
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <>
      <ResultPanel state={state} />
      <aside
        aria-label={t("regionLabel")}
        className={`public-ask-dock${keyboardOpen ? " is-keyboard-open" : ""}`}
      >
        <form className="public-ask-form" noValidate onSubmit={submit}>
          <label>
            <span className="sr-only">{t("inputLabel")}</span>
            <input
              aria-describedby="public-ask-help"
              autoComplete="off"
              disabled={Boolean(disabledReason)}
              maxLength={500}
              name="question"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("placeholder")}
              value={question}
            />
          </label>
          <Pressable aria-label={loading ? t("searching") : state.kind === "error" ? t("retry") : t("submit")} disabled={disabled} type="submit">
            <ArrowRight aria-hidden="true" className="public-ask-arrow" size={18} />
            <span className="public-ask-button-text">{loading ? t("searchingShort") : state.kind === "error" ? t("retry") : t("submit")}</span>
          </Pressable>
        </form>
        <div className="public-ask-meta" id="public-ask-help">
          <span>{disabledReason ?? t("scope")}</span>
          <span>{format.number(question.length)} / {format.number(500)}</span>
        </div>
      </aside>
    </>
  );
}
