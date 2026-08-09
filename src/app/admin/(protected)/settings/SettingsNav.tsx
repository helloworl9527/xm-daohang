"use client";

import { useTranslations } from "next-intl";

export function SettingsNav() {
  const t = useTranslations("admin.settings.nav");
  const links = ["models", "refetch", "rate", "security", "telegram", "locale"] as const;
  return (
    <nav aria-label={t("label")} className="settings-nav">
      {links.map((key) => <a href={`#settings-${key}`} key={key}>{t(key)}</a>)}
    </nav>
  );
}
