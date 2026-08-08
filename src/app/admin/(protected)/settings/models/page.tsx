import { ModelSettingsForm } from "@/app/admin/(protected)/settings/models/ModelSettingsForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSettings } from "@/lib/config/settings";

export default async function ModelSettingsPage() {
  const [session, settings] = await Promise.all([requireAdminPage(), getSettings()]);
  return (
    <main className="admin-settings-page">
      <header className="admin-settings-header">
        <p>设置</p>
        <h1>模型配置</h1>
      </header>
      <ModelSettingsForm csrfToken={session.csrfToken} initialSettings={settings} />
    </main>
  );
}
