"use client";

import { useRef, useState } from "react";

export function DeleteItemDialog({ onConfirm }: { onConfirm: () => Promise<boolean> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);

  const open = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancelRef.current?.focus();
  };

  const close = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      triggerRef.current?.focus();
    }
  };

  const confirm = async () => {
    setDeleting(true);
    try {
      if (await onConfirm()) close();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <button className="item-delete-trigger" onClick={open} ref={triggerRef} type="button">
        删除条目
      </button>
      <dialog
        aria-labelledby="delete-item-title"
        className="item-delete-dialog"
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <h2 id="delete-item-title">确认删除条目</h2>
        <p>删除后将同时移除向量与公开检索来源，且无法恢复。</p>
        <div className="item-dialog-actions">
          <button disabled={deleting} onClick={close} ref={cancelRef} type="button">取消</button>
          <button disabled={deleting} onClick={() => void confirm()} type="button">
            {deleting ? "删除中…" : "确认删除"}
          </button>
        </div>
      </dialog>
    </>
  );
}
