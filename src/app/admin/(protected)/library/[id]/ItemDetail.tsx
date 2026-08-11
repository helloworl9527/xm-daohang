"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DeleteItemDialog } from "./DeleteItemDialog";
import { CategorySelector } from "./CategorySelector";
import { SummaryEditor } from "./SummaryEditor";
import type { ItemDetailDto } from "@/lib/items/detail";

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; item: ItemDetailDto; etag: string };

async function discardError(response: Response): Promise<void> {
  await response.json().catch(() => undefined);
}

export function ItemDetail({ itemId, csrfToken }: { itemId: string; csrfToken: string }) {
  const locale = useLocale();
  const t = useTranslations("admin.detail");
  const library = useTranslations("admin.library");
  const common = useTranslations("common");
  const statusLabels = { processing: common("processing"), completed: common("completed"), failed: common("failed") };
  const sourceLabels = { admin: common("adminSource"), telegram: common("telegramSource") };
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [refetching, setRefetching] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/admin/api/items/${itemId}`, { cache: "no-store" });
      if (!response.ok) {
        await discardError(response);
        setState({ kind: "error", message: t("loadError") });
        return;
      }
      const payload = await response.json() as { item: ItemDetailDto };
      setState({ kind: "loaded", item: payload.item, etag: response.headers.get("etag") ?? "" });
    } catch {
      setState({ kind: "error", message: t("loadError") });
    }
  }, [itemId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSummary = async (summary: string): Promise<boolean> => {
    if (state.kind !== "loaded") return false;
    setActionError("");
    setNotice("");
    try {
      const response = await fetch(`/admin/api/items/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "If-Match": state.etag,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ summary }),
      });
      if (!response.ok) {
        await discardError(response);
        setActionError(t("savingError"));
        return false;
      }
      const payload = await response.json() as { item: ItemDetailDto };
      setState({ kind: "loaded", item: payload.item, etag: response.headers.get("etag") ?? state.etag });
      setNotice(t("saved"));
      return true;
    } catch {
      setActionError(t("savingNetworkError"));
      return false;
    }
  };

  const refetch = async () => {
    if (state.kind !== "loaded" || state.item.status === "processing") return;
    setRefetching(true);
    setActionError("");
    setNotice("");
    try {
      const response = await fetch(`/admin/api/items/${itemId}/refetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: "{}",
      });
      if (!response.ok) {
        await discardError(response);
        setActionError(t("refetchError"));
        return;
      }
      setState({ ...state, item: { ...state.item, status: "processing", failReason: null } });
      setNotice(t("queued"));
    } catch {
      setActionError(t("refetchNetworkError"));
    } finally {
      setRefetching(false);
    }
  };

  const remove = async (): Promise<boolean> => {
    setActionError("");
    try {
      const response = await fetch(`/admin/api/items/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: "{}",
      });
      if (!response.ok) {
        await discardError(response);
        setActionError(t("deleteError"));
        return false;
      }
      setNotice(t("deleted"));
      router.replace("/admin/library");
      return true;
    } catch {
      setActionError(t("deleteError"));
      return false;
    }
  };

  if (state.kind === "loading") {
    return <div className="item-detail-state" role="status">{t("loading")}</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="item-detail-state">
        <p role="alert">{state.message}</p>
        <button onClick={() => void load()} type="button">{common("retry")}</button>
      </div>
    );
  }

  const { item } = state;
  const refetchDisabled = item.status === "processing" || refetching;
  return (
    <article aria-labelledby="item-detail-title" className="item-detail">
      <header className="item-detail-header">
        <Link href="/admin/library">{t("back")}</Link>
        <div>
          <span className={`library-status library-status--${item.status}`}>{statusLabels[item.status]}</span>
          <h1 id="item-detail-title">{item.title || item.url}</h1>
        </div>
        <a href={item.url} rel="noreferrer" target="_blank">{item.url}</a>
      </header>

      <div className="item-detail-grid">
        <div className="item-detail-primary">
          <SummaryEditor disabled={item.status === "processing"} initialSummary={item.summary ?? ""} manual={item.summaryManual} onSave={saveSummary} />
          <CategorySelector
            categoryId={item.categoryId}
            categoryManual={item.categoryManual}
            csrfToken={csrfToken}
            disabled={item.status === "processing"}
            etag={state.etag}
            itemId={item.id}
            onSaved={(category, etag) => setState({ kind: "loaded", etag, item: { ...item, ...category } })}
          />
        </div>
        <aside aria-label={t("infoLabel")} className="item-detail-meta">
          <h2>{t("info")}</h2>
          <dl>
            <div><dt>{t("status")}</dt><dd>{statusLabels[item.status]}</dd></div>
            <div><dt>{t("source")}</dt><dd>{sourceLabels[item.source]}</dd></div>
            <div><dt>{t("updated")}</dt><dd><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(item.updatedAt))}</time></dd></div>
          </dl>
          <ul aria-label={common("itemTags")} className="library-tags">
            {item.tags.map((tag) => <li key={tag}>{tag}</li>)}
          </ul>
          {item.failReason ? <p className="library-item-failure">{library("failureReason", { reason: item.failReason })}</p> : null}
        </aside>
      </div>

      <section aria-labelledby="item-actions-title" className="item-detail-actions">
        <div>
          <h2 id="item-actions-title">{t("actions")}</h2>
          <p>{t("actionsDescription")}</p>
        </div>
        <div className="item-action-buttons">
          <button disabled={refetchDisabled} id="refetch" onClick={() => void refetch()} type="button">
            {refetchDisabled ? t("refetching") : t("refetch")}
          </button>
          <DeleteItemDialog onConfirm={remove} />
        </div>
      </section>

      <div aria-live="polite" className="item-action-status">
        {notice ? <p>{notice}</p> : null}
        {actionError ? <p role="alert">{actionError}</p> : null}
      </div>
    </article>
  );
}
