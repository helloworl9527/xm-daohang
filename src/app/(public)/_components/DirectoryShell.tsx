"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useReducer,
  useRef,
} from "react";

import { AskExperience } from "@/app/(public)/_components/AskBar";
import { SiteLink } from "@/app/(public)/_components/DirectoryView";
import { KeywordSearch } from "@/app/(public)/_components/KeywordSearch";
import { type AskResultState, type PublicSource, ResultPanel } from "@/app/(public)/_components/ResultPanel";
import { MotionRegion } from "@/components/ui/MotionRegion";
import { Pressable } from "@/components/ui/Pressable";
import type { SiteCard } from "@/lib/items/publicCorpus";

type DiscoveryMode = "keyword" | "ask";
type KeywordResultState =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "loading"; query: string; previous: KeywordResultState | null }
  | { kind: "success"; query: string; matches: SiteCard[] }
  | { kind: "error"; query: string };

interface DiscoveryState {
  mode: DiscoveryMode;
  draft: string;
  keywordResult: KeywordResultState;
  askResult: AskResultState;
  activeRequest: { mode: DiscoveryMode; id: number } | null;
}

type Action =
  | { type: "draft"; value: string }
  | { type: "mode"; mode: DiscoveryMode; draft?: string }
  | { type: "keyword-idle"; draft?: string }
  | { type: "keyword-invalid" }
  | { type: "keyword-loading"; query: string; id: number }
  | { type: "keyword-success"; query: string; matches: SiteCard[]; id: number }
  | { type: "keyword-error"; query: string; id: number }
  | { type: "ask-invalid" }
  | { type: "ask-loading"; id: number }
  | { type: "ask-result"; result: AskResultState; id: number }
  | { type: "cancel"; mode: DiscoveryMode };

function settledKeyword(state: KeywordResultState): KeywordResultState | null {
  return state.kind === "loading" ? state.previous : state.kind === "invalid" ? null : state;
}

function settledAsk(state: AskResultState): AskResultState | null {
  return state.kind === "loading" ? state.previous ?? null : state.kind === "invalid" ? null : state;
}

function isPublicSource(value: unknown): value is PublicSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<PublicSource>;
  return typeof source.id === "string"
    && (typeof source.title === "string" || source.title === null)
    && (typeof source.summary === "string" || source.summary === null)
    && typeof source.url === "string"
    && Array.isArray(source.tags)
    && source.tags.every((tag) => typeof tag === "string")
    && typeof source.score === "number"
    && typeof source.cited === "boolean";
}

export function discoveryReducer(state: DiscoveryState, action: Action): DiscoveryState {
  switch (action.type) {
    case "draft":
      return { ...state, draft: action.value };
    case "mode":
      return { ...state, mode: action.mode, draft: action.draft ?? state.draft };
    case "keyword-idle":
      return { ...state, draft: action.draft ?? state.draft, keywordResult: { kind: "idle" }, activeRequest: state.activeRequest?.mode === "keyword" ? null : state.activeRequest };
    case "keyword-invalid":
      return { ...state, keywordResult: { kind: "invalid" } };
    case "keyword-loading":
      return { ...state, keywordResult: { kind: "loading", query: action.query, previous: settledKeyword(state.keywordResult) }, activeRequest: { mode: "keyword", id: action.id } };
    case "keyword-success":
      if (state.activeRequest?.mode !== "keyword" || state.activeRequest.id !== action.id) return state;
      return { ...state, keywordResult: { kind: "success", query: action.query, matches: action.matches }, activeRequest: null };
    case "keyword-error":
      if (state.activeRequest?.mode !== "keyword" || state.activeRequest.id !== action.id) return state;
      return { ...state, keywordResult: { kind: "error", query: action.query }, activeRequest: null };
    case "ask-invalid":
      return { ...state, askResult: { kind: "invalid" } };
    case "ask-loading":
      return { ...state, askResult: { kind: "loading", previous: settledAsk(state.askResult) }, activeRequest: { mode: "ask", id: action.id } };
    case "ask-result":
      if (state.activeRequest?.mode !== "ask" || state.activeRequest.id !== action.id) return state;
      return { ...state, askResult: action.result, activeRequest: null };
    case "cancel": {
      if (action.mode === "keyword") {
        const previous = state.keywordResult.kind === "loading" ? state.keywordResult.previous : null;
        return { ...state, keywordResult: previous ?? { kind: "idle" }, activeRequest: state.activeRequest?.mode === "keyword" ? null : state.activeRequest };
      }
      const previous = state.askResult.kind === "loading" ? state.askResult.previous : null;
      return { ...state, askResult: previous ?? { kind: "idle" }, activeRequest: state.activeRequest?.mode === "ask" ? null : state.activeRequest };
    }
  }
}

export function DirectoryState({ kind, onRetry, search = false }: { kind: "error"; onRetry?: () => void; search?: boolean }) {
  const t = useTranslations("public.directory");
  const router = useRouter();
  return <section className={`directory-state is-${kind}`} role="alert"><h2>{t(search ? "searchError" : "loadError")}</h2><p>{t(search ? "searchErrorDetail" : "loadErrorDetail")}</p><Pressable onClick={onRetry ?? (() => router.refresh())} type="button">{t("retry")}</Pressable></section>;
}

function SearchCards({ matches }: { matches: SiteCard[] }) {
  return <div className="directory-grid search-grid">{matches.map((site) => <SiteLink key={site.id} site={site} />)}</div>;
}

function SearchResult({ onClear, onRetry, state }: { onClear: () => void; onRetry: () => void; state: KeywordResultState }) {
  const t = useTranslations("public.directory");
  if (state.kind === "loading") {
    return <section aria-busy="true" aria-label={t("searching")} className="directory-grid directory-skeleton">{[0, 1, 2].map((index) => <div key={index}><span /><span /><span /></div>)}</section>;
  }
  if (state.kind === "error") return <DirectoryState kind="error" onRetry={onRetry} search />;
  if (state.kind !== "success") return null;
  return <section aria-live="polite" className="search-results"><header><div><h2>{state.matches.length ? t("results") : t("noResults")}</h2><p>{t("resultMeta", { query: state.query, count: state.matches.length })}</p></div><Pressable onClick={onClear} type="button">{t("clear")}</Pressable></header>{state.matches.length ? <SearchCards matches={state.matches} /> : <p className="directory-empty">{t("noResultsDetail")}</p>}</section>;
}

export function DirectoryShell({ children, disabledReason = null }: { children: ReactNode; disabledReason?: string | null }) {
  const directory = useTranslations("public.directory");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const committed = params.get("q") ?? "";
  const [state, dispatch] = useReducer(discoveryReducer, {
    mode: "keyword",
    draft: committed,
    keywordResult: { kind: "idle" },
    askResult: { kind: "idle" },
    activeRequest: null,
  });
  const input = useRef<HTMLInputElement>(null);
  const controllers = useRef<Partial<Record<DiscoveryMode, AbortController>>>({});
  const requestIds = useRef<Record<DiscoveryMode, number>>({ keyword: 0, ask: 0 });
  const lastUrlQuery = useRef(committed);
  const urlChangedWhileAsking = useRef(false);

  const abort = (mode: DiscoveryMode) => {
    controllers.current[mode]?.abort();
    delete controllers.current[mode];
    requestIds.current[mode] += 1;
    dispatch({ type: "cancel", mode });
  };

  useEffect(() => {
    const urlChanged = lastUrlQuery.current !== committed;
    if (urlChanged && state.mode === "ask") {
      urlChangedWhileAsking.current = true;
      controllers.current.keyword?.abort();
      delete controllers.current.keyword;
      requestIds.current.keyword += 1;
      dispatch({ type: "keyword-idle" });
    }
    lastUrlQuery.current = committed;
    if (state.mode === "ask") return;
    if (urlChanged) {
      if (committed) dispatch({ type: "draft", value: committed });
      else dispatch({ type: "keyword-idle", draft: "" });
    }
    if (!committed) {
      controllers.current.keyword?.abort();
      requestIds.current.keyword += 1;
      dispatch({ type: "keyword-idle" });
      return;
    }

    controllers.current.keyword?.abort();
    const controller = new AbortController();
    const id = ++requestIds.current.keyword;
    controllers.current.keyword = controller;
    dispatch({ type: "keyword-loading", query: committed, id });
    void fetch("/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: committed }),
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { query?: string; matches?: SiteCard[] };
      if (!response.ok || payload.query !== committed || !Array.isArray(payload.matches)) throw new Error("invalid search response");
      dispatch({ type: "keyword-success", query: committed, matches: payload.matches, id });
    }).catch((error: unknown) => {
      if ((error as Error).name !== "AbortError") dispatch({ type: "keyword-error", query: committed, id });
    });
    return () => controller.abort();
  }, [committed, state.mode]);

  const switchMode = (mode: DiscoveryMode) => {
    if (mode === state.mode) {
      input.current?.focus();
      return;
    }
    abort(state.mode);
    const restoreKeyword = mode === "keyword" && urlChangedWhileAsking.current;
    dispatch({ type: "mode", mode, draft: restoreKeyword ? committed : undefined });
    if (restoreKeyword) urlChangedWhileAsking.current = false;
    queueMicrotask(() => input.current?.focus());
  };

  const onModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, mode: DiscoveryMode) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    switchMode(mode === "keyword" ? "ask" : "keyword");
  };

  const commitKeyword = (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = (input.current?.value ?? state.draft).normalize("NFKC").trim();
    if (!normalized || normalized.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
      dispatch({ type: "keyword-invalid" });
      input.current?.focus();
      return;
    }
    dispatch({ type: "draft", value: normalized });
    router.push(`${pathname}?q=${encodeURIComponent(normalized)}`);
  };

  const clearKeyword = () => {
    abort("keyword");
    dispatch({ type: "keyword-idle", draft: "" });
    router.push(pathname);
    input.current?.focus();
  };

  const submitAsk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = (input.current?.value ?? state.draft).trim();
    if (disabledReason) return;
    if (!normalized || normalized.length > 500) {
      dispatch({ type: "ask-invalid" });
      input.current?.focus();
      return;
    }
    abort("ask");
    const controller = new AbortController();
    const id = ++requestIds.current.ask;
    controllers.current.ask = controller;
    dispatch({ type: "ask-loading", id });
    navigator.vibrate?.(7);
    try {
      const response = await fetch("/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: normalized }),
        signal: controller.signal,
      });
      const payload = await response.json() as { answer?: string; sources?: PublicSource[]; error?: { code?: string } };
      let result: AskResultState;
      if (response.status === 429 || payload.error?.code === "RATE_LIMITED") result = { kind: "limited" };
      else if (response.status === 503 || payload.error?.code === "MODEL_UNAVAILABLE") result = { kind: "unavailable" };
      else if (!response.ok) result = { kind: "error" };
      else if (!Array.isArray(payload.sources) || payload.sources.length === 0) result = { kind: "empty" };
      else if (typeof payload.answer === "string" && payload.sources.every(isPublicSource)) result = { kind: "success", answer: payload.answer, sources: payload.sources };
      else result = { kind: "error" };
      dispatch({ type: "ask-result", result, id });
    } catch (error) {
      if ((error as Error).name !== "AbortError") dispatch({ type: "ask-result", result: { kind: "error" }, id });
    }
  };

  const keywordError = state.keywordResult.kind === "invalid" ? directory("invalid") : null;
  return <>
    <section aria-labelledby="public-discovery-title" className="public-discovery-workspace">
      <div className="public-discovery-heading"><p>{directory("eyebrow")}</p><h1 id="public-discovery-title">{directory("workspaceTitle")}</h1><p>{directory("workspaceCopy")}</p></div>
      <div className="public-discovery-mode" role="tablist" aria-label={directory("modeLabel")}>
        {(["keyword", "ask"] as const).map((mode) => <Pressable aria-controls="public-discovery-panel" aria-selected={state.mode === mode} id={`public-discovery-${mode}`} key={mode} onClick={() => switchMode(mode)} onKeyDown={(event) => onModeKeyDown(event, mode)} role="tab" tabIndex={state.mode === mode ? 0 : -1} type="button">{directory(mode === "keyword" ? "keywordMode" : "askMode")}</Pressable>)}
      </div>
      <div aria-labelledby={`public-discovery-${state.mode}`} className="public-discovery-panel" id="public-discovery-panel" role="tabpanel">
        {state.mode === "keyword" ? <KeywordSearch draft={state.draft} error={keywordError} inputRef={input} loading={state.keywordResult.kind === "loading"} onChange={(value) => dispatch({ type: "draft", value })} onClear={clearKeyword} onSubmit={commitKeyword} /> : <AskExperience disabledReason={disabledReason} inputRef={input} onChange={(value) => dispatch({ type: "draft", value })} onSubmit={submitAsk} state={state.askResult} value={state.draft} />}
        <p className="public-discovery-note">{state.mode === "keyword" ? directory("keywordNote") : directory("askNote")}</p>
        {state.mode === "ask" ? <ResultPanel state={state.askResult} /> : null}
      </div>
    </section>
    <MotionRegion className="directory-content">{state.mode === "keyword" && committed ? <SearchResult onClear={clearKeyword} onRetry={() => router.refresh()} state={state.keywordResult} /> : children}</MotionRegion>
  </>;
}
