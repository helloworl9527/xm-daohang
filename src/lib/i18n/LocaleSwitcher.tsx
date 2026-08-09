"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { localeCookieName, type Locale } from "@/lib/i18n/config";

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("locale");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    localStorage.setItem(localeCookieName, locale);
  }, [locale]);

  const change = (next: Locale) => {
    if (next === locale) return;
    document.cookie = `${localeCookieName}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    localStorage.setItem(localeCookieName, next);
    startTransition(() => router.refresh());
  };

  return (
    <div aria-label={t("label")} className="locale-switcher" role="group">
      <button aria-pressed={locale === "zh"} disabled={pending} onClick={() => change("zh")} type="button">
        {t("zh")}
      </button>
      <button aria-pressed={locale === "en"} disabled={pending} onClick={() => change("en")} type="button">
        {t("en")}
      </button>
    </div>
  );
}
