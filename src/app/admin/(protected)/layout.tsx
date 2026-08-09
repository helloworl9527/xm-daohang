import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { AdminNav } from "@/app/admin/(protected)/AdminNav";
import { requireAdminPage } from "@/lib/auth/guard";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const [, t] = await Promise.all([requireAdminPage(), getTranslations("admin")]);
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main">{t("skip")}</a>
      <AdminNav />
      <div id="admin-main">{children}</div>
    </div>
  );
}
