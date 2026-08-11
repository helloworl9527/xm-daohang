"use client";

import Link from "next/link";
import { FolderTree, Library, Plus, Settings } from "lucide-react";
import { useTranslations } from "next-intl";

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const links = [
    { href: "/admin", label: t("add"), icon: Plus },
    { href: "/admin/library", label: t("library"), icon: Library },
    { href: "/admin/categories", label: t("categories"), icon: FolderTree },
    { href: "/admin/settings", label: t("settings"), icon: Settings },
  ] as const;
  return (
    <aside className="admin-sidebar">
      <header className="admin-brand">
        <span aria-hidden="true">CS</span>
        <div>
          <strong>{t("brand")}</strong>
          <small>{t("workspace")}</small>
        </div>
      </header>
      <nav aria-label={t("label")} className="admin-nav">
        {links.map((link) => (
          <Link aria-label={link.label} href={link.href} key={link.href} prefetch={false} title={link.label}>
            <link.icon aria-hidden="true" size={20} />
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
