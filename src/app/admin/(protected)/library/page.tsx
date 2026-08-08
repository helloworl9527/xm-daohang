import { LibraryView } from "./LibraryView";
import type { LibraryFiltersValue } from "./LibraryFilters";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawTags = params.tag;
  const tags = (Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : []).slice(0, 10);
  const rawStatus = one(params.status);
  const status: LibraryFiltersValue["status"] =
    rawStatus === "processing" || rawStatus === "completed" || rawStatus === "failed"
    ? rawStatus
    : "";
  const initialFilters = { q: one(params.q).slice(0, 200), tags, status };

  return (
    <main className="admin-workspace">
      <LibraryView initialFilters={initialFilters} key={JSON.stringify(initialFilters)} />
    </main>
  );
}
