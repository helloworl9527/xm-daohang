import { getTranslations } from "next-intl/server";

import { LocalePanel } from "@/app/admin/(protected)/settings/LocalePanel";
import { RateLimitPanel } from "@/app/admin/(protected)/settings/RateLimitPanel";
import { RefetchPanel } from "@/app/admin/(protected)/settings/RefetchPanel";
import { SecurityPanel } from "@/app/admin/(protected)/settings/SecurityPanel";
import { SettingsNav } from "@/app/admin/(protected)/settings/SettingsNav";
import { TelegramPanel } from "@/app/admin/(protected)/settings/TelegramPanel";
import { ModelSettingsForm } from "@/app/admin/(protected)/settings/models/ModelSettingsForm";
import { pool } from "@/db/client";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSettings } from "@/lib/config/settings";
import { businessDay } from "@/lib/time/businessDay";

export default async function SettingsPage() {
  const [session, settings, t] = await Promise.all([
    requireAdminPage(), getSettings(), getTranslations("admin.settings"),
  ]);
  const day = businessDay();
  const usage = await pool.query<{ count: number }>(
    "select count from ask_counters where day = $1 and scope = 'global'",
    [day],
  );
  const refetch = {
    enabled: settings.refetchEnabled,
    intervalDays: settings.refetchIntervalDays,
    lastRun: settings.refetchLastRun?.toISOString() ?? null,
    nextRun: settings.refetchEnabled && settings.refetchLastRun
      ? new Date(settings.refetchLastRun.getTime() + settings.refetchIntervalDays * 86_400_000).toISOString()
      : null,
  };

  return (
    <main className="admin-settings-page settings-workspace">
      <header className="admin-settings-header"><p>{t("eyebrow")}</p><h1>{t("title")}</h1><p>{t("description")}</p></header>
      <SettingsNav />
      <section aria-labelledby="settings-models-title" className="settings-panel" id="settings-models">
        <header><p>{t("modelsEyebrow")}</p><h2 id="settings-models-title">{t("modelsTitle")}</h2></header>
        <ModelSettingsForm csrfToken={session.csrfToken} initialSettings={settings} />
      </section>
      <RefetchPanel csrfToken={session.csrfToken} initial={refetch} />
      <RateLimitPanel csrfToken={session.csrfToken} initial={{ enabled: settings.ratelimitEnabled, ipDaily: settings.ratelimitIpDaily, globalDaily: settings.ratelimitGlobalDaily, day, usedGlobal: usage.rows[0]?.count ?? 0 }} />
      <SecurityPanel csrfToken={session.csrfToken} />
      <TelegramPanel csrfToken={session.csrfToken} initial={{ tokenMasked: settings.telegramTokenMasked, allowedIds: settings.telegramAllowedIds }} />
      <LocalePanel csrfToken={session.csrfToken} initial={settings.defaultLocale} />
    </main>
  );
}
