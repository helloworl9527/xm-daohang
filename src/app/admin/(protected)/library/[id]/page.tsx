import { ItemDetail } from "./ItemDetail";
import { requireAdminPage } from "@/lib/auth/guard";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [session, route] = await Promise.all([requireAdminPage(), params]);
  return (
    <main className="admin-workspace item-detail-workspace">
      <ItemDetail csrfToken={session.csrfToken} itemId={route.id} />
    </main>
  );
}
