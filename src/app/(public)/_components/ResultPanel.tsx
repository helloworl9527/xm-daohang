"use client";

import { useTranslations } from "next-intl";

export interface PublicSource {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  score: number;
  cited: boolean;
}

export type AskResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; answer: string; sources: PublicSource[] }
  | { kind: "empty" }
  | { kind: "limited" }
  | { kind: "error" };

export function ResultPanel({ state }: { state: AskResultState }) {
  const t = useTranslations("public.ask");
  if (state.kind === "idle") return null;

  if (state.kind === "loading") {
    return (
      <section aria-busy="true" aria-live="polite" className="public-result public-result-state">
        <p className="public-result-kicker">{t("searching")}</p>
        <div aria-hidden="true" className="public-result-skeleton">
          <span /><span /><span />
        </div>
      </section>
    );
  }

  if (state.kind === "empty" || state.kind === "limited" || state.kind === "error") {
    const title = state.kind === "empty" ? t("empty") : state.kind === "limited" ? t("limited") : t("error");
    const detail = state.kind === "empty"
      ? t("emptyDetail")
      : state.kind === "limited"
        ? t("limitedDetail")
        : t("errorDetail");
    return (
      <section aria-live="polite" className={`public-result public-result-state is-${state.kind}`}>
        <p className="public-result-kicker">{t("resultLabel")}</p>
        <h2>{title}</h2>
        <p>{detail}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="public-answer-title" aria-live="polite" className="public-result">
      <div className="public-answer">
        <p className="public-result-kicker">{t("resultLabel")}</p>
        <h2 id="public-answer-title">{state.answer}</h2>
      </div>
      <div aria-label={t("sourcesLabel")} className="public-sources">
        {state.sources.slice(0, 10).map((source, index) => (
          <a className="public-source" href={source.url} key={source.id} rel="noreferrer" target="_blank">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h3>{source.title?.trim() || source.url}</h3>
            {source.summary ? <p>{source.summary}</p> : null}
            <small>{t("openSource")}</small>
          </a>
        ))}
      </div>
    </section>
  );
}
