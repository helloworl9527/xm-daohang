import OpenAI from "openai";

import { pool } from "@/db/client";
import { encryptSecret } from "@/lib/crypto/secretbox";
import { getDecryptedSecret, getSettings, updateSettings, type Settings } from "@/lib/config/settings";

const EMBEDDING_FIXTURES = [
  "如何在 PostgreSQL 中使用向量检索？",
  "pgvector 为 PostgreSQL 提供向量存储、余弦距离与近邻检索能力。",
  "在数据库中保存文本嵌入后，可以按余弦相似度查找语义相关内容。",
  "烘焙蛋糕时先预热烤箱，并按比例称量面粉和黄油。",
  "周末天气晴朗，适合去公园散步和拍照。",
] as const;

export interface ModelConnectionDraft {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface ResolvedModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ModelProbeAdapter {
  testLlm(config: ResolvedModelConfig): Promise<string>;
  embed(config: ResolvedModelConfig, inputs: readonly string[]): Promise<number[][]>;
}

export interface EmbeddingProbeResult {
  dimension: number;
  cutoff: number;
  minPositive: number;
  maxNegative: number;
}

function normalizeDraft(draft: ModelConnectionDraft): ModelConnectionDraft {
  let url: URL;
  try {
    url = new URL(draft.baseUrl);
  } catch {
    throw new Error("MODEL_CONFIG_INVALID");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MODEL_CONFIG_INVALID");
  }
  const model = draft.model.trim();
  if (!model) throw new Error("MODEL_CONFIG_INVALID");
  const baseUrl = url.toString().replace(/\/$/, "");
  return { baseUrl, model, apiKey: draft.apiKey };
}

async function resolveDraft(
  draft: ModelConnectionDraft,
  savedField: "llmKey" | "embKey",
): Promise<ResolvedModelConfig> {
  const normalized = normalizeDraft(draft);
  const apiKey = normalized.apiKey ?? (await getDecryptedSecret(savedField));
  if (!apiKey) throw new Error("MODEL_KEY_REQUIRED");
  return { baseUrl: normalized.baseUrl, model: normalized.model, apiKey };
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error("EMBEDDING_INVALID");
  const score = dot / Math.sqrt(leftNorm * rightNorm);
  if (!Number.isFinite(score)) throw new Error("EMBEDDING_INVALID");
  return score;
}

function validateVectors(vectors: number[][]): number {
  if (vectors.length !== EMBEDDING_FIXTURES.length) throw new Error("EMBEDDING_INVALID");
  const dimension = vectors[0]?.length ?? 0;
  if (dimension < 1) throw new Error("EMBEDDING_INVALID");
  for (const vector of vectors) {
    if (vector.length !== dimension || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("EMBEDDING_INVALID");
    }
  }
  return dimension;
}

export const openAiProbeAdapter: ModelProbeAdapter = {
  async testLlm(config) {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: "只回复：连接成功" }],
      max_tokens: 16,
      temperature: 0,
    });
    const content = response.choices[0]?.message.content?.trim();
    if (!content) throw new Error("LLM_INVALID_RESPONSE");
    return content;
  },
  async embed(config, inputs) {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    const response = await client.embeddings.create({
      model: config.model,
      input: [...inputs],
      encoding_format: "float",
    });
    return response.data.map((entry) => entry.embedding);
  },
};

export async function probeLlmConfig(
  draft: ModelConnectionDraft,
  adapter: ModelProbeAdapter = openAiProbeAdapter,
): Promise<{ ok: true }> {
  const resolved = await resolveDraft(draft, "llmKey");
  await adapter.testLlm(resolved);
  return { ok: true };
}

export async function probeEmbeddingConfig(
  draft: ModelConnectionDraft,
  adapter: ModelProbeAdapter = openAiProbeAdapter,
): Promise<EmbeddingProbeResult> {
  const resolved = await resolveDraft(draft, "embKey");
  const vectors = await adapter.embed(resolved, EMBEDDING_FIXTURES);
  const dimension = validateVectors(vectors);
  const query = vectors[0];
  const positiveScores = [cosine(query, vectors[1]), cosine(query, vectors[2])];
  const negativeScores = [cosine(query, vectors[3]), cosine(query, vectors[4])];
  const minPositive = Math.min(...positiveScores);
  const maxNegative = Math.max(...negativeScores);
  if (!(minPositive > maxNegative)) throw new Error("EMBEDDING_INSEPARABLE");
  const cutoff = (minPositive + maxNegative) / 2;
  if (!Number.isFinite(cutoff) || cutoff < -1 || cutoff > 1) {
    throw new Error("EMBEDDING_INVALID");
  }
  return { dimension, cutoff, minPositive, maxNegative };
}

export async function saveLlmConfig(
  draft: ModelConnectionDraft,
  adapter: ModelProbeAdapter = openAiProbeAdapter,
): Promise<Settings> {
  const resolved = await resolveDraft(draft, "llmKey");
  await adapter.testLlm(resolved);
  return updateSettings({
    llmBaseUrl: resolved.baseUrl,
    llmModel: resolved.model,
    ...(draft.apiKey === undefined ? {} : { llmKey: resolved.apiKey }),
  });
}

export async function saveEmbeddingConfig(
  draft: ModelConnectionDraft,
  adapter: ModelProbeAdapter = openAiProbeAdapter,
): Promise<Settings> {
  const resolved = await resolveDraft(draft, "embKey");
  const probe = await probeEmbeddingConfig(resolved, adapter);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("insert into app_settings (id) values (1) on conflict (id) do nothing");
    const currentResult = await client.query<{
      emb_base_url: string | null;
      emb_model: string | null;
      emb_dim: number | null;
      emb_version: number;
      emb_rebuild_status: Settings["embRebuildStatus"];
    }>(
      `select emb_base_url, emb_model, emb_dim, emb_version, emb_rebuild_status
         from app_settings where id = 1 for update`,
    );
    const current = currentResult.rows[0];
    if (!current) throw new Error("SETTINGS_NOT_FOUND");
    const identityChanged =
      current.emb_base_url !== resolved.baseUrl ||
      current.emb_model !== resolved.model ||
      current.emb_dim !== probe.dimension;
    const version = current.emb_version + (identityChanged ? 1 : 0);
    let rebuildStatus = current.emb_rebuild_status;
    if (identityChanged) {
      const queued = await client.query<{ count: number }>(
        `with bumped as (
           update items
              set process_generation = process_generation + 1,
                  updated_at = now()
            where status = 'completed'
            returning id, process_generation
         ), queued as (
           insert into processing_requests
             (item_id, process_generation, emb_version, attempt, status, next_attempt_at)
           select id, process_generation, $1, 0, 'pending', now()
             from bumped
           returning 1
         )
         select count(*)::int as count from queued`,
        [version],
      );
      rebuildStatus = (queued.rows[0]?.count ?? 0) > 0 ? "building" : "ready";
    }
    const encryptedKey = draft.apiKey === undefined ? null : encryptSecret(resolved.apiKey);

    await client.query(
      `update app_settings
          set emb_base_url = $1,
              emb_model = $2,
              emb_key_enc = coalesce($3, emb_key_enc),
              emb_dim = $4,
              emb_version = $5,
              search_min_cosine = $6,
              emb_rebuild_status = $7
        where id = 1`,
      [
        resolved.baseUrl,
        resolved.model,
        encryptedKey,
        probe.dimension,
        version,
        probe.cutoff,
        rebuildStatus,
      ],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return getSettings();
}
