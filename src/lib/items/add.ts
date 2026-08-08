import { pool } from "@/db/client";
import { parsePublicGitHubUrl } from "@/lib/fetch/github";
import { assertPublicUrl as defaultAssertPublicUrl } from "@/lib/fetch/urlGuard";
import { requestProcessingWithClient } from "@/lib/items/processing";

export interface AddedItem {
  id: string;
  status: string;
  deduped: boolean;
}

export interface AddItemDependencies {
  assertPublicUrl?: (rawUrl: string) => Promise<string>;
}

export class AddItemError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AddItemError";
  }
}

function itemType(canonicalUrl: string): "web" | "doc" | "github" {
  const url = new URL(canonicalUrl);
  if (url.hostname.toLowerCase() === "github.com") {
    parsePublicGitHubUrl(canonicalUrl);
    return "github";
  }
  return /\.(?:pdf|txt)$/i.test(url.pathname) ? "doc" : "web";
}

function modelConfigured(row: Record<string, unknown> | undefined): boolean {
  return Boolean(
    row?.llm_base_url && row.llm_model && row.llm_key_enc &&
    row.emb_base_url && row.emb_model && row.emb_key_enc && row.emb_dim,
  );
}

export async function addItem(
  rawUrl: string,
  dependencies: AddItemDependencies = {},
): Promise<AddedItem> {
  const readiness = await pool.query<Record<string, unknown>>(
    `select llm_base_url, llm_model, llm_key_enc, emb_base_url, emb_model, emb_key_enc, emb_dim
       from app_settings where id = 1`,
  );
  if (!modelConfigured(readiness.rows[0])) throw new AddItemError("MODEL_UNAVAILABLE");

  let canonicalUrl: string;
  try {
    canonicalUrl = await (dependencies.assertPublicUrl ?? defaultAssertPublicUrl)(rawUrl);
  } catch {
    throw new AddItemError("URL_INVALID");
  }
  let type: "web" | "doc" | "github";
  try {
    type = itemType(canonicalUrl);
  } catch {
    throw new AddItemError("URL_INVALID");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const lockedSettings = await client.query<Record<string, unknown>>(
      `select llm_base_url, llm_model, llm_key_enc, emb_base_url, emb_model, emb_key_enc, emb_dim
         from app_settings where id = 1 for share`,
    );
    if (!modelConfigured(lockedSettings.rows[0])) throw new AddItemError("MODEL_UNAVAILABLE");

    const inserted = await client.query<{ id: string; status: string }>(
      `insert into items (url, url_canonical, type, source, status)
       values ($1, $1, $2, 'admin', 'processing')
       on conflict (url_canonical) do nothing
       returning id, status`,
      [canonicalUrl, type],
    );
    const created = inserted.rows[0];
    if (!created) {
      const existing = await client.query<{ id: string; status: string }>(
        "select id, status from items where url_canonical = $1",
        [canonicalUrl],
      );
      const item = existing.rows[0];
      if (!item) throw new AddItemError("ITEM_CONFLICT");
      await client.query("commit");
      return { ...item, deduped: true };
    }

    await requestProcessingWithClient(client, created.id);
    await client.query("commit");
    return { id: created.id, status: "processing", deduped: false };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
