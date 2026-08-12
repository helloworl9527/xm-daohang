import { pool } from "@/db/client";

export interface SiteCard {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  categoryName: string | null;
  faviconPath: string;
}

export interface PublicCorpusQueryable {
  query<T extends object>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export async function hasCompletedAskCorpus(
  queryable: PublicCorpusQueryable = pool,
): Promise<boolean> {
  const result = await queryable.query<{ exists: boolean }>(
    "select exists(select 1 from items where status = 'completed') as exists",
  );
  return result.rows[0]?.exists === true;
}

interface SiteCardRow {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  category_name: string | null;
  favicon_path: string;
}

export async function searchPublicCorpus(query: string, queryable: PublicCorpusQueryable = pool): Promise<SiteCard[]> {
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const result = await queryable.query<SiteCardRow>(
    `select items.id, items.title, items.summary, items.url, items.tags,
            categories.name category_name, '/favicon/' || items.id favicon_path
       from items left join categories on categories.id = items.category_id
      where items.status = 'completed'
        and items.type in ('web', 'github')
        and (items.title ilike $1 escape '\\'
          or items.summary ilike $1 escape '\\'
          or exists (select 1 from unnest(items.tags) tag where tag ilike $1 escape '\\'))
      order by lower(coalesce(items.title, items.url)), items.id
      limit 50`,
    [pattern],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    url: row.url,
    tags: row.tags,
    categoryName: row.category_name,
    faviconPath: row.favicon_path,
  }));
}
