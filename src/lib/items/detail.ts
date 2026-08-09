import { pool } from "@/db/client";
import type { LibraryItemDto } from "@/lib/items/list";

export class ItemDetailError extends Error {
  constructor(public readonly code: "ITEM_NOT_FOUND" | "ITEM_CONFLICT" | "ETAG_INVALID") {
    super(code);
    this.name = "ItemDetailError";
  }
}

interface DetailRow {
  id: string;
  url: string;
  type: LibraryItemDto["type"];
  title: string | null;
  summary: string | null;
  summary_manual: boolean;
  tags: string[];
  status: LibraryItemDto["status"];
  fail_reason: string | null;
  source: LibraryItemDto["source"];
  created_at: Date;
  updated_at: Date;
  updated_token: string;
}

const DETAIL_COLUMNS = `
  id, url, type, title, summary, summary_manual, tags, status, fail_reason, source,
  created_at, updated_at, updated_at::text as updated_token
`;

function toDto(row: DetailRow): LibraryItemDto {
  return {
    id: row.id,
    url: row.url,
    type: row.type,
    title: row.title,
    summary: row.summary,
    summaryManual: row.summary_manual,
    tags: row.tags,
    status: row.status,
    failReason: row.fail_reason,
    source: row.source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function etagFor(token: string): string {
  return `"${Buffer.from(token).toString("base64url")}"`;
}

function tokenFromEtag(etag: string): string {
  const match = /^"([A-Za-z0-9_-]+)"$/.exec(etag);
  if (!match) throw new ItemDetailError("ETAG_INVALID");
  try {
    const token = Buffer.from(match[1]!, "base64url").toString("utf8");
    if (!token) throw new Error("empty");
    return token;
  } catch {
    throw new ItemDetailError("ETAG_INVALID");
  }
}

export async function getItemDetail(id: string) {
  const result = await pool.query<DetailRow>(
    `select ${DETAIL_COLUMNS} from items where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new ItemDetailError("ITEM_NOT_FOUND");
  return { item: toDto(row), etag: etagFor(row.updated_token) };
}

export async function updateItemSummary(id: string, summary: string, etag: string) {
  const updatedToken = tokenFromEtag(etag);
  const result = await pool.query<DetailRow>(
    `update items
        set summary = $2,
            summary_manual = true,
            updated_at = clock_timestamp()
      where id = $1 and updated_at::text = $3
      returning ${DETAIL_COLUMNS}`,
    [id, summary, updatedToken],
  );
  const row = result.rows[0];
  if (!row) {
    const exists = await pool.query("select 1 from items where id = $1", [id]);
    throw new ItemDetailError(exists.rowCount ? "ITEM_CONFLICT" : "ITEM_NOT_FOUND");
  }
  return { item: toDto(row), etag: etagFor(row.updated_token) };
}

export async function deleteItem(id: string): Promise<void> {
  const result = await pool.query("delete from items where id = $1 returning id", [id]);
  if (!result.rowCount) throw new ItemDetailError("ITEM_NOT_FOUND");
}
