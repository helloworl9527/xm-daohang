import { AddItemForm } from "@/app/admin/(protected)/add/AddItemForm";
import { requireAdminPage } from "@/lib/auth/guard";
import { getSettings, type Settings } from "@/lib/config/settings";

function configured(settings: Settings): boolean {
  return Boolean(
    settings.llmBaseUrl && settings.llmModel && settings.llmKeyMasked &&
    settings.embBaseUrl && settings.embModel && settings.embKeyMasked && settings.embDim,
  );
}

export default async function AddItemPage() {
  const [session, settings] = await Promise.all([requireAdminPage(), getSettings()]);
  return (
    <main className="admin-workspace">
      <AddItemForm csrfToken={session.csrfToken} modelConfigured={configured(settings)} />
    </main>
  );
}
