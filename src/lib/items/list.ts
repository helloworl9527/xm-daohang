import { z } from "zod";

import { pool } from "@/db/client";

const statusSchema = z.enum(["processing", "completed", "failed"]);
const cursorSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export const libraryQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  tags: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  status: statusSchema.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface LibraryItemDto {
  id: string;
  url: string;
  type: "web" | "doc" | "github";
  title: string | null;
  summary: string | null;
  summaryManual: boolean;
  tags: string[];
  status: "processing" | "completed" | "failed";
  failReason: string | null;
  source: "admin" | "telegram";
  createdAt: string;
  updatedAt: string;
}

interface LibraryRow {
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
}

function decodeCursor(encoded: string | undefined) {
  if (!encoded) return undefined;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

function encodeCursor(row: LibraryRow): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at.toISOString(), id: row.id }))
    .toString("base64url");
}

function toDto(row: LibraryRow): LibraryItemDto {
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

export async function listLibraryItems(input: z.infer<typeof libraryQuerySchema>) {
  const cursor = decodeCursor(input.cursor);
  const clauses: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.q) {
    const q = bind(input.q.toLocaleLowerCase("zh-CN"));
    clauses.push(`(
      strpos(lower(coalesce(title, '')), ${q}) > 0
      or strpos(lower(coalesce(summary, '')), ${q}) > 0
      or strpos(lower(url), ${q}) > 0
    )`);
  }
  if (input.tags.length > 0) clauses.push(`tags @> ${bind(input.tags)}::text[]`);
  if (input.status) clauses.push(`status = ${bind(input.status)}`);
  if (cursor) {
    const updatedAt = bind(cursor.updatedAt);
    const id = bind(cursor.id);
    clauses.push(`(updated_at, id) < (${updatedAt}::timestamptz, ${id}::uuid)`);
  }

  const limit = bind(input.limit + 1);
  const result = await pool.query<LibraryRow>(
    `select id, url, type, title, summary, summary_manual, tags, status, fail_reason,
            source, created_at, updated_at
       from items
       ${clauses.length > 0 ? `where ${clauses.join(" and ")}` : ""}
      order by updated_at desc, id desc
      limit ${limit}`,
    values,
  );
  const hasNext = result.rows.length > input.limit;
  const page = result.rows.slice(0, input.limit);
  return {
    items: page.map(toDto),
    nextCursor: hasNext && page.length > 0 ? encodeCursor(page[page.length - 1]!) : null,
  };
}
