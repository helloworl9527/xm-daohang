import type { ReactNode } from "react";

import { AdminNav } from "@/app/admin/(protected)/AdminNav";
import { requireAdminPage } from "@/lib/auth/guard";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="admin-shell">
      <a className="skip-link" href="#admin-main">跳到主要内容</a>
      <AdminNav />
      <div id="admin-main">{children}</div>
    </div>
  );
}
