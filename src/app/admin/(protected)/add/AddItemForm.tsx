"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Pressable } from "@/components/ui/Pressable";

type AddStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "error"; message: string };

interface AddResponse {
  id?: string;
  deduped?: boolean;
  error?: { code?: string; message?: string };
}

export function AddItemForm({
  csrfToken,
  modelConfigured,
}: {
  csrfToken: string;
  modelConfigured: boolean;
}) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<AddStatus>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = status.kind === "submitting";

  useEffect(() => {
    if (!url || status.kind === "success" || status.kind === "duplicate") return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [status.kind, url]);

  const submit = async () => {
    setStatus({ kind: "submitting" });
    try {
      const response = await fetch("/admin/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json() as AddResponse;
      if (!response.ok || !payload.id) {
        setStatus({
          kind: "error",
          message: payload.error?.message ?? "添加失败，请稍后重试。",
        });
        inputRef.current?.focus();
        return;
      }
      setStatus(payload.deduped
        ? { kind: "duplicate", id: payload.id }
        : { kind: "success", id: payload.id });
      navigator.vibrate?.(7);
    } catch {
      setStatus({ kind: "error", message: "添加失败，请检查连接后重试。" });
      inputRef.current?.focus();
    }
  };

  return (
    <section aria-labelledby="add-item-title" className="admin-work-section">
      <div className="admin-section-heading">
        <p>入库</p>
        <h1 id="add-item-title">添加内容</h1>
        <p>支持公开网页、文档与 GitHub 公开仓库。完成条目可能通过公开问答返回。</p>
      </div>

      {!modelConfigured ? (
        <div className="admin-inline-notice" role="status">
          <strong>先完成模型配置</strong>
          <span>对话模型和嵌入模型均可用后才能添加内容。</span>
          <Link href="/admin/settings/models">前往模型设置</Link>
        </div>
      ) : null}

      <form
        className="add-item-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="add-item-url">公开链接</label>
        <div className="add-item-input-row">
          <input
            aria-describedby="add-item-status"
            aria-invalid={status.kind === "error"}
            autoComplete="url"
            disabled={!modelConfigured || busy}
            id="add-item-url"
            inputMode="url"
            name="url"
            onChange={(event) => {
              setUrl(event.target.value);
              if (status.kind !== "idle" && status.kind !== "submitting") setStatus({ kind: "idle" });
            }}
            placeholder="https://example.com/article…"
            ref={inputRef}
            required
            spellCheck={false}
            type="url"
            value={url}
          />
          <Pressable disabled={!modelConfigured || busy} type="submit">
            {busy ? "添加中…" : "添加到收藏库"}
          </Pressable>
        </div>
      </form>

      <div aria-live="polite" className="add-item-status" id="add-item-status">
        {status.kind === "success" ? (
          <p>已加入，正在抓取总结中。 <Link href={`/admin/library/${status.id}`} prefetch={false}>查看条目</Link></p>
        ) : null}
        {status.kind === "duplicate" ? (
          <p>
            该链接已收藏。
            {" "}<Link href={`/admin/library/${status.id}`} prefetch={false}>查看条目</Link>
            {" "}<Link href={`/admin/library/${status.id}#refetch`} prefetch={false}>查看并重抓</Link>
          </p>
        ) : null}
        {status.kind === "error" ? <p role="alert">{status.message}</p> : null}
      </div>
    </section>
  );
}
