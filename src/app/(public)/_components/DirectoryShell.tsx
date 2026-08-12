"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";

import type { SiteCard } from "@/lib/items/publicCorpus";
import { SiteLink } from "@/app/(public)/_components/DirectoryView";
import { KeywordSearch } from "@/app/(public)/_components/KeywordSearch";

type SearchState = { kind: "idle" } | { kind: "loading" } | { kind: "success"; query: string; matches: SiteCard[] } | { kind: "error"; query: string };

export function DirectoryState({ kind, onRetry, search = false }: { kind: "error"; onRetry?: () => void; search?: boolean }) {
  const t = useTranslations("public.directory"); const router = useRouter();
  return <section className={`directory-state is-${kind}`} role="alert"><h2>{t(search ? "searchError" : "loadError")}</h2><p>{t(search ? "searchErrorDetail" : "loadErrorDetail")}</p><button onClick={onRetry ?? (() => router.refresh())} type="button">{t("retry")}</button></section>;
}

function SearchCards({ matches }: { matches: SiteCard[] }) {
  return <div className="directory-grid search-grid">{matches.map((site) => <SiteLink key={site.id} site={site} />)}</div>;
}

export function DirectoryShell({ children }: { children: ReactNode }) {
  const t = useTranslations("public.directory"); const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const committed = params.get("q") ?? ""; const [draft, setDraft] = useState(committed); const [error, setError] = useState<string | null>(null); const [state, setState] = useState<SearchState>({ kind: "idle" }); const [retry, setRetry] = useState(0); const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(committed), [committed]);
  useEffect(() => {
    if (!committed) { setState({ kind: "idle" }); return; }
    const controller = new AbortController(); const requested = committed; let active = true; setState({ kind: "loading" });
    fetch("/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: requested }), signal: controller.signal })
      .then(async (response) => { const body = await response.json() as { query?: string; matches?: SiteCard[] }; if (!response.ok || body.query !== requested || !body.matches) throw new Error(); if (active) setState({ kind: "success", query: requested, matches: body.matches }); })
      .catch((caught) => { if (active && (caught as Error).name !== "AbortError") setState({ kind: "error", query: requested }); });
    return () => { active = false; controller.abort(); };
  }, [committed, retry]);
  function commit(event?: FormEvent) { event?.preventDefault(); const normalized = draft.normalize("NFKC").trim(); if (!normalized || normalized.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) { setError(t("invalid")); input.current?.focus(); return; } setError(null); router.push(`${pathname}?q=${encodeURIComponent(normalized)}`); }
  function clear() { setDraft(""); setError(null); router.push(pathname); input.current?.focus(); }
  return <>
    <div className="directory-title-row"><h1>{t("title")}</h1><KeywordSearch draft={draft} error={error} inputRef={input} onChange={(value) => { setDraft(value); setError(null); }} onClear={clear} onSubmit={commit} /></div>
    <div className="directory-content">{!committed ? children : state.kind === "loading" ? <section aria-busy="true" aria-label={t("searching")} className="directory-grid directory-skeleton">{[0,1,2].map((i) => <div key={i}><span /><span /><span /></div>)}</section> : state.kind === "error" ? <DirectoryState kind="error" onRetry={() => setRetry((value) => value + 1)} search /> : state.kind === "success" ? <section aria-live="polite" className="search-results"><header><div><h2>{state.matches.length ? t("results") : t("noResults")}</h2><p>{t("resultMeta", { query: state.query, count: state.matches.length })}</p></div><button onClick={clear} type="button">{t("clear")}</button></header>{state.matches.length ? <SearchCards matches={state.matches} /> : <p className="directory-empty">{t("noResultsDetail")}</p>}</section> : null}</div>
  </>;
}
