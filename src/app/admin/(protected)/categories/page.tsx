import { getTranslations } from "next-intl/server";

import { CategoryWorkbench } from "./_components/CategoryWorkbench";
import { requireAdminPage } from "@/lib/auth/guard";
import { getLatestCategoryRun } from "@/lib/categories/reclassify";
import { getCategoryOverview } from "@/lib/categories/store";

export default async function CategoriesPage() {
  const session = await requireAdminPage();
  const [overview, latestRun, t] = await Promise.all([
    getCategoryOverview(),
    getLatestCategoryRun(),
    getTranslations("admin.categories"),
  ]);
  return (
    <main className="category-page">
      <header className="category-page-header">
        <p>{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p>{t("description")}</p>
      </header>
      <CategoryWorkbench csrfToken={session.csrfToken} initialOverview={overview} initialRun={latestRun} />
    </main>
  );
}
