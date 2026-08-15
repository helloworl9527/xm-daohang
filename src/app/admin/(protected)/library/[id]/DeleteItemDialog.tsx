"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

export function DeleteItemDialog({ onConfirm }: { onConfirm: () => Promise<boolean> }) {
  const t = useTranslations("admin.detail");
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
        <Trash2 aria-hidden="true" size={16} />
        {t("delete")}
      </button>
      <dialog
        aria-labelledby="delete-item-title"
        className="item-delete-dialog"
        onClose={() => triggerRef.current?.focus()}
        ref={dialogRef}
      >
        <span aria-hidden="true" className="item-delete-dialog-icon"><Trash2 size={20} /></span>
        <h2 id="delete-item-title">{t("deleteTitle")}</h2>
        <p>{t("deleteDescription")}</p>
        <div className="item-dialog-actions">
          <button disabled={deleting} onClick={close} ref={cancelRef} type="button">{t("cancel")}</button>
          <button disabled={deleting} onClick={() => void confirm()} type="button">
            {deleting ? t("deleting") : t("confirmDelete")}
          </button>
        </div>
      </dialog>
    </>
  );
}
