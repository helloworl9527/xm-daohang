import type { ReactNode } from "react";

import { requireAdminPage } from "@/lib/auth/guard";

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return children;
}
