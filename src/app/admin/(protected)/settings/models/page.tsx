import { ModelSettingsForm } from "@/app/admin/(protected)/settings/models/ModelSettingsForm";
import { getTranslations } from "next-intl/server";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSettings } from "@/lib/config/settings";

export default async function ModelSettingsPage() {
  const [session, settings, t] = await Promise.all([requireAdminPage(), getSettings(), getTranslations("admin.models")]);
  return (
    <main className="admin-settings-page">
      <header className="admin-settings-header">
        <p>{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
      </header>
      <ModelSettingsForm csrfToken={session.csrfToken} initialSettings={settings} />
    </main>
  );
}
