"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { LibraryFilters, type LibraryFiltersValue } from "./LibraryFilters";
import { LibraryList } from "./LibraryList";
import type { LibraryItemDto } from "@/lib/items/list";

interface LibraryPayload {
  items: LibraryItemDto[];
  nextCursor: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; payload: LibraryPayload }
  | { kind: "error" };

function queryFor(filters: LibraryFiltersValue, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const tag of filters.tags.map((value) => value.trim()).filter(Boolean)) params.append("tag", tag);
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function LibraryView({ initialFilters }: { initialFilters: LibraryFiltersValue }) {
  const t = useTranslations("admin.library");
  const common = useTranslations("common");
  const router = useRouter();
  const [draft, setDraft] = useState(initialFilters);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const activeQuery = queryFor(initialFilters);
  const hasFilters = activeQuery.length > 0;

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/admin/api/items${activeQuery ? `?${activeQuery}` : ""}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("LIST_FAILED");
      setState({ kind: "loaded", payload: await response.json() as LibraryPayload });
    } catch {
      setState({ kind: "error" });
    }
  }, [activeQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitFilters = () => {
    const query = queryFor(draft);
    router.replace(`/admin/library${query ? `?${query}` : ""}`);
  };

  const loadMore = async (payload: LibraryPayload) => {
    if (!payload.nextCursor) return;
    setLoadingMore(true);
    try {
      const query = queryFor(initialFilters, payload.nextCursor);
      const response = await fetch(`/admin/api/items?${query}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("LIST_FAILED");
      const next = await response.json() as LibraryPayload;
      setState({
        kind: "loaded",
        payload: { items: [...payload.items, ...next.items], nextCursor: next.nextCursor },
      });
    } catch {
      setState({ kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section aria-labelledby="library-title" className="admin-work-section library-section">
      <div className="admin-section-heading">
        <p>{t("eyebrow")}</p>
        <h1 id="library-title">{t("title")}</h1>
        <p>{t("description")}</p>
      </div>

      <LibraryFilters
        disabled={state.kind === "loading"}
        onChange={setDraft}
        onClear={() => router.replace("/admin/library")}
        onSubmit={submitFilters}
        value={draft}
      />

      <div aria-live="polite" className="library-results">
        {state.kind === "loading" ? (
          <div className="library-loading" role="status">
            <p>{t("loading")}</p>
            <ol aria-hidden="true" className="library-list library-skeleton">
              {Array.from({ length: 3 }, (_, index) => (
                <li className="library-item library-skeleton-row" key={index}>
                  <div className="library-skeleton-main">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="library-skeleton-meta">
                    <span />
                    <span />
                    <span />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {state.kind === "error" ? (
          <div className="library-state">
            <p role="alert">{t("error")}</p>
            <button onClick={() => void load()} type="button">{common("retry")}</button>
          </div>
        ) : null}
        {state.kind === "loaded" && state.payload.items.length === 0 ? (
          <div className="library-state">
            {hasFilters ? (
              <>
                <p>{t("noMatch")}</p>
                <button onClick={() => router.replace("/admin/library")} type="button">{t("clearFilters")}</button>
              </>
            ) : (
              <>
                <p>{t("empty")}</p>
                <Link href="/admin/add">{t("addFirst")}</Link>
              </>
            )}
          </div>
        ) : null}
        {state.kind === "loaded" && state.payload.items.length > 0 ? (
          <>
            <p className="library-result-count">{t("count", { count: state.payload.items.length })}</p>
            <LibraryList items={state.payload.items} />
            {state.payload.nextCursor ? (
              <button
                className="library-more"
                disabled={loadingMore}
                onClick={() => void loadMore(state.payload)}
                type="button"
              >
                {loadingMore ? t("loadingMore") : t("loadMore")}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
