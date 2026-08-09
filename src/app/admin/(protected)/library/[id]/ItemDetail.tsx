"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DeleteItemDialog } from "./DeleteItemDialog";
import { SummaryEditor } from "./SummaryEditor";
import type { LibraryItemDto } from "@/lib/items/list";

type DetailState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; item: LibraryItemDto; etag: string };

const statusLabels = { processing: "处理中", completed: "已完成", failed: "失败" } as const;
const sourceLabels = { admin: "管理端", telegram: "Telegram" } as const;

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function ItemDetail({ itemId, csrfToken }: { itemId: string; csrfToken: string }) {
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
        setState({ kind: "error", message: await errorMessage(response, "条目暂时无法读取。") });
        return;
      }
      const payload = await response.json() as { item: LibraryItemDto };
      setState({ kind: "loaded", item: payload.item, etag: response.headers.get("etag") ?? "" });
    } catch {
      setState({ kind: "error", message: "条目暂时无法读取。" });
    }
  }, [itemId]);

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
        setActionError(await errorMessage(response, "保存失败，请稍后重试。"));
        return false;
      }
      const payload = await response.json() as { item: LibraryItemDto };
      setState({ kind: "loaded", item: payload.item, etag: response.headers.get("etag") ?? state.etag });
      setNotice("总结已保存。");
      return true;
    } catch {
      setActionError("保存失败，请检查连接后重试。");
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
        setActionError(await errorMessage(response, "重抓失败，请稍后重试。"));
        return;
      }
      setState({ ...state, item: { ...state.item, status: "processing", failReason: null } });
      setNotice("已加入重抓队列。");
    } catch {
      setActionError("重抓失败，请检查连接后重试。");
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
        setActionError(await errorMessage(response, "删除失败，条目已保留。"));
        return false;
      }
      setNotice("条目已删除。");
      router.replace("/admin/library");
      return true;
    } catch {
      setActionError("删除失败，条目已保留。");
      return false;
    }
  };

  if (state.kind === "loading") {
    return <div className="item-detail-state" role="status">正在读取条目…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="item-detail-state">
        <p role="alert">{state.message}</p>
        <button onClick={() => void load()} type="button">重试</button>
      </div>
    );
  }

  const { item } = state;
  const refetchDisabled = item.status === "processing" || refetching;
  return (
    <article aria-labelledby="item-detail-title" className="item-detail">
      <header className="item-detail-header">
        <Link href="/admin/library">返回收藏库</Link>
        <div>
          <span className={`library-status library-status--${item.status}`}>{statusLabels[item.status]}</span>
          <h1 id="item-detail-title">{item.title || item.url}</h1>
        </div>
        <a href={item.url} rel="noreferrer" target="_blank">{item.url}</a>
      </header>

      <div className="item-detail-grid">
        <SummaryEditor
          disabled={item.status === "processing"}
          initialSummary={item.summary ?? ""}
          manual={item.summaryManual}
          onSave={saveSummary}
        />
        <aside aria-label="条目信息" className="item-detail-meta">
          <h2>条目信息</h2>
          <dl>
            <div><dt>状态</dt><dd>{statusLabels[item.status]}</dd></div>
            <div><dt>来源</dt><dd>{sourceLabels[item.source]}</dd></div>
            <div><dt>更新</dt><dd><time dateTime={item.updatedAt}>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(item.updatedAt))}</time></dd></div>
          </dl>
          <ul aria-label="条目标签" className="library-tags">
            {item.tags.map((tag) => <li key={tag}>{tag}</li>)}
          </ul>
          {item.failReason ? <p className="library-item-failure">失败原因：{item.failReason}</p> : null}
        </aside>
      </div>

      <section aria-labelledby="item-actions-title" className="item-detail-actions">
        <div>
          <h2 id="item-actions-title">条目操作</h2>
          <p>重抓会重新获取公开内容；人工总结不会被自动覆盖。</p>
        </div>
        <div className="item-action-buttons">
          <button disabled={refetchDisabled} id="refetch" onClick={() => void refetch()} type="button">
            {refetchDisabled ? "正在处理" : "手动重抓"}
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
