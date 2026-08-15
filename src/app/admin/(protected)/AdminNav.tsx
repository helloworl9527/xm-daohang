"use client";

import Link from "next/link";
import { Bot, FolderTree, Library, LogOut, Menu, Plus, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { logoutAction } from "@/app/admin/login/actions";
import { Pressable } from "@/components/ui/Pressable";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Plus;
  current: (pathname: string) => boolean;
};

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: t("collectionGroup"),
      items: [
        { href: "/admin", label: t("add"), icon: Plus, current: (path) => path === "/admin" || path === "/admin/add" },
        { href: "/admin/library", label: t("library"), icon: Library, current: (path) => path === "/admin/library" || path.startsWith("/admin/library/") },
      ],
    },
    {
      label: t("organizeGroup"),
      items: [
        { href: "/admin/categories", label: t("categories"), icon: FolderTree, current: (path) => path === "/admin/categories" },
      ],
    },
    {
      label: t("systemGroup"),
      items: [
        { href: "/admin/settings/models", label: t("models"), icon: Bot, current: (path) => path === "/admin/settings/models" },
        { href: "/admin/settings", label: t("settings"), icon: Settings, current: (path) => path === "/admin/settings" },
      ],
    },
  ];

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) queueMicrotask(() => trigger.current?.focus());
  }, []);

  const onKeyDown = useCallback((event: { key: string; preventDefault: () => void; shiftKey: boolean }) => {
    if (!mobile || !open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== "Tab") return;
    const locale = document.querySelector<HTMLElement>(".locale-switcher");
    const focusable = [sidebar.current, locale]
      .flatMap((root) => root ? Array.from(root.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)")) : [])
      .filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [close, mobile, open]);

  useEffect(() => {
    if (!mobile) return;
    const main = document.getElementById("admin-main");
    const mobileBar = document.querySelector<HTMLElement>(".admin-mobile-bar");
    const locale = document.querySelector<HTMLElement>(".locale-switcher");
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = open;
    if (mobileBar) mobileBar.inert = open;
    if (locale) locale.inert = !open;
    document.body.style.overflow = open ? "hidden" : previousOverflow;
    const handleKeyDown = (event: KeyboardEvent) => onKeyDown(event);
    if (open) document.addEventListener("keydown", handleKeyDown);

    if (open) {
      requestAnimationFrame(() => sidebar.current?.querySelector<HTMLElement>("a,button")?.focus());
    }
    return () => {
      if (main) main.inert = false;
      if (mobileBar) mobileBar.inert = false;
      if (locale) locale.inert = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobile, onKeyDown, open]);

  return (
    <>
      <header className="admin-mobile-bar">
        <button aria-expanded={open} aria-label={t(open ? "closeMenu" : "openMenu")} className="pressable" onClick={() => setOpen((value) => !value)} ref={trigger} type="button">
          {open ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
        <strong>{t("brand")}</strong>
      </header>
      <aside
        aria-hidden={mobile && !open}
        aria-label={t("label")}
        className="admin-sidebar"
        data-open={open}
        inert={mobile && !open}
        ref={sidebar}
      >
        <Link className="admin-brand" href="/admin" onClick={() => close()} prefetch={false}>
          <span aria-hidden="true">CS</span>
          <span>
            <strong>{t("brand")}</strong>
            <small>{t("workspace")}</small>
          </span>
        </Link>
        <nav aria-label={t("label")} className="admin-nav">
          {groups.map((group) => (
            <section className="admin-nav-group" key={group.label}>
              <h2>{group.label}</h2>
              <div>
                {group.items.map((link) => (
                  <Link aria-current={link.current(pathname) ? "page" : undefined} aria-label={link.label} href={link.href} key={link.href} onClick={() => close()} prefetch={false} title={link.label}>
                    <link.icon aria-hidden="true" size={19} />
                    <span>{link.label}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <footer className="admin-sidebar-footer">
          <span>{t("workspace")}</span>
          <form action={logoutAction}>
            <Pressable aria-label={t("logout")} title={t("logout")} type="submit"><LogOut aria-hidden="true" size={18} /></Pressable>
          </form>
        </footer>
      </aside>
      <button aria-label={t("closeMenu")} className="admin-drawer-scrim" data-open={open} onClick={() => close(true)} tabIndex={-1} type="button" />
    </>
  );
}
