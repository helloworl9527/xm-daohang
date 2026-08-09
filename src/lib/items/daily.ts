import { createHash } from "node:crypto";

import { pool } from "@/db/client";

export interface DailyItem {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  rank: number;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function dailyOrderKey(day: string, itemId: string): string {
  return createHash("sha256").update(`${day}:${itemId}`).digest("hex");
}

export async function pickDaily(day: string): Promise<DailyItem[]> {
  if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new Error("INVALID_DAY");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [day]);
    await client.query(
      `delete from daily_selections selection
        where selection.day = $1
          and not exists (
            select 1 from items item
             where item.id = selection.item_id and item.status = 'completed'
          )`,
      [day],
    );

    const existing = await client.query<{ rank: number; item_id: string }>(
      "select rank, item_id from daily_selections where day = $1 order by rank",
      [day],
    );
    const usedRanks = new Set(existing.rows.map((row) => Number(row.rank)));
    const missingRanks = [1, 2, 3].filter((rank) => !usedRanks.has(rank));

    if (missingRanks.length > 0) {
      const candidates = await client.query<{ id: string }>(
        `select item.id
           from items item
          where item.status = 'completed'
            and not exists (
              select 1 from daily_selections selection
               where selection.day = $1 and selection.item_id = item.id
            )
          order by item.last_shown_on asc nulls first,
                   item.shown_count asc,
                   md5($1 || item.id::text)
          limit $2`,
        [day, missingRanks.length],
      );

      for (let index = 0; index < candidates.rows.length; index += 1) {
        const candidate = candidates.rows[index];
        const rank = missingRanks[index];
        await client.query(
          "insert into daily_selections (day, rank, item_id) values ($1, $2, $3)",
          [day, rank, candidate.id],
        );
        await client.query(
          `update items
              set last_shown_on = $1, shown_count = shown_count + 1
            where id = $2`,
          [day, candidate.id],
        );
      }
    }

    const selected = await client.query<DailyItem>(
      `select item.id, item.title, item.summary, item.url, item.tags, selection.rank
         from daily_selections selection
         join items item on item.id = selection.item_id
        where selection.day = $1 and item.status = 'completed'
        order by selection.rank`,
      [day],
    );
    await client.query("commit");
    return selected.rows.map((row) => ({ ...row, rank: Number(row.rank) }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
