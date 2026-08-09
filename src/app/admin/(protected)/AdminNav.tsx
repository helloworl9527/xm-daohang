"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const links = [
    { href: "/admin", label: t("add") },
    { href: "/admin/library", label: t("library") },
    { href: "/admin/settings", label: t("settings") },
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
          <Link href={link.href} key={link.href} prefetch={false}>{link.label}</Link>
        ))}
      </nav>
    </aside>
  );
}
