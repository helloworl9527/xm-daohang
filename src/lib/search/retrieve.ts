import { pool } from "@/db/client";
import { embedText } from "@/lib/ai/embedding";

export interface SearchHit {
  id: string;
  title: string | null;
  summary: string | null;
  url: string;
  tags: string[];
  score: number;
}

export class SearchUnavailableError extends Error {
  readonly code = "SEARCH_UNAVAILABLE";

  constructor() {
    super("SEARCH_UNAVAILABLE");
  }
}

interface RetrieveDependencies {
  embed?: (query: string) => Promise<number[]>;
}

interface SearchSettings {
  emb_base_url: string | null;
  emb_model: string | null;
  emb_key_enc: string | null;
  emb_dim: number | null;
  emb_version: number;
  search_min_cosine: number | null;
  emb_rebuild_status: string;
}

function isReady(settings: SearchSettings | undefined): settings is SearchSettings & {
  emb_base_url: string;
  emb_model: string;
  emb_key_enc: string;
  emb_dim: number;
  search_min_cosine: number;
} {
  return Boolean(
    settings &&
      settings.emb_rebuild_status === "ready" &&
      settings.emb_base_url &&
      settings.emb_model &&
      settings.emb_key_enc &&
      settings.emb_dim &&
      settings.emb_dim > 0 &&
      settings.emb_version >= 0 &&
      settings.search_min_cosine !== null &&
      settings.search_min_cosine >= -1 &&
      settings.search_min_cosine <= 1,
  );
}

export async function retrieve(
  query: string,
  dependencies: RetrieveDependencies = {},
): Promise<SearchHit[]> {
  const settingsResult = await pool.query<SearchSettings>(
    `select emb_base_url, emb_model, emb_key_enc, emb_dim, emb_version,
            search_min_cosine, emb_rebuild_status
       from app_settings where id = 1`,
  );
  const settings = settingsResult.rows[0];
  if (!isReady(settings)) throw new SearchUnavailableError();

  const vector = await (dependencies.embed ?? embedText)(query);
  if (
    vector.length !== settings.emb_dim ||
    vector.length === 0 ||
    vector.some((value) => !Number.isFinite(value)) ||
    vector.every((value) => value === 0)
  ) {
    throw new SearchUnavailableError();
  }

  const literal = `[${vector.join(",")}]`;
  const result = await pool.query<{
    id: string;
    title: string | null;
    summary: string | null;
    url: string;
    tags: string[];
    score: string | number;
  }>(
    `with candidates as materialized (
       select id, title, summary, url, tags, embedding
         from items
        where status = 'completed'
          and embedding is not null
          and embedding_version = $2
          and embedding_dim = $3
     )
     select id, title, summary, url, tags,
            1 - (embedding <=> $1::vector) as score
       from candidates
      where 1 - (embedding <=> $1::vector) >= $4
      order by score desc, id
      limit 10`,
    [literal, settings.emb_version, settings.emb_dim, settings.search_min_cosine],
  );

  return result.rows.map((row) => ({ ...row, score: Number(row.score) }));
}
