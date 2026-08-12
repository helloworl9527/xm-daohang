import { pool } from "@/db/client";

export interface SiteCard {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  type: "web" | "github";
}

export interface PublicCorpusQueryable {
  query<T extends object>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export async function searchPublicCorpus(query: string, queryable: PublicCorpusQueryable = pool): Promise<SiteCard[]> {
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const result = await queryable.query<SiteCard>(
    `select id, title, summary, url, tags, type
       from items
      where status = 'completed'
        and type in ('web', 'github')
        and (title ilike $1 escape '\\'
          or summary ilike $1 escape '\\'
          or exists (select 1 from unnest(tags) tag where tag ilike $1 escape '\\'))
      order by created_at desc, id desc
      limit 50`,
    [pattern],
  );
  return result.rows;
}
