import { pool } from "@/db/client";
import type { PublicCorpusQueryable, SiteCard } from "@/lib/items/publicCorpus";

export interface PublicDirectoryGroup {
  id: string | null;
  name: string | null;
  sites: SiteCard[];
}

interface CategoryRow {
  id: string;
  name: string;
}

interface DirectorySiteRow {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  category_id: string | null;
  category_name: string | null;
}

export async function getPublicDirectory(
  queryable: PublicCorpusQueryable = pool,
): Promise<PublicDirectoryGroup[]> {
  const [categoryResult, siteResult] = await Promise.all([
    queryable.query<CategoryRow>(
      "select id, name from categories order by sort, name, id",
    ),
    queryable.query<DirectorySiteRow>(
      `select items.id, items.title, items.summary, items.url, items.tags,
              items.category_id, categories.name category_name
         from items left join categories on categories.id = items.category_id
        where items.status = 'completed' and items.type in ('web', 'github')
        order by items.title, items.url, items.id`,
    ),
  ]);

  const groups = categoryResult.rows.map<PublicDirectoryGroup>((category) => ({
    id: category.id,
    name: category.name,
    sites: [],
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const unclassified: PublicDirectoryGroup = { id: null, name: null, sites: [] };

  for (const row of siteResult.rows) {
    const site: SiteCard = {
      id: row.id,
      title: row.title,
      summary: row.summary,
      url: row.url,
      tags: row.tags,
      categoryName: row.category_name,
      faviconPath: `/favicon/${row.id}`,
    };
    (row.category_id ? byId.get(row.category_id) : unclassified)?.sites.push(site);
  }

  return [...groups, unclassified];
}
