import OpenAI from "openai";

import { AiClientError } from "@/lib/ai/llm";

interface EmbeddingConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimension: number;
}

export interface EmbeddingDependencies {
  loadConfig?: () => Promise<EmbeddingConfig>;
  requestEmbedding?: (config: EmbeddingConfig, input: string) => Promise<number[]>;
}

async function loadEmbeddingConfig(): Promise<EmbeddingConfig> {
  const { getDecryptedSecret, getSettings } = await import("@/lib/config/settings");
  const [settings, apiKey] = await Promise.all([getSettings(), getDecryptedSecret("embKey")]);
  if (!settings.embBaseUrl || !settings.embModel || !settings.embDim || !apiKey) {
    throw new AiClientError("EMBEDDING_NOT_CONFIGURED", false);
  }
  return {
    baseUrl: settings.embBaseUrl,
    model: settings.embModel,
    apiKey,
    dimension: settings.embDim,
  };
}

async function requestOpenAiEmbedding(config: EmbeddingConfig, input: string): Promise<number[]> {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  const response = await client.embeddings.create({
    model: config.model,
    input,
    encoding_format: "float",
  });
  const vector = response.data[0]?.embedding;
  if (!vector) throw new AiClientError("EMBEDDING_INVALID_VECTOR", true);
  return vector;
}

export async function embedText(
  input: string,
  dependencies: EmbeddingDependencies = {},
): Promise<number[]> {
  let config: EmbeddingConfig;
  let vector: number[];
  try {
    config = await (dependencies.loadConfig ?? loadEmbeddingConfig)();
    vector = await (dependencies.requestEmbedding ?? requestOpenAiEmbedding)(config, input);
  } catch (error) {
    if (error instanceof AiClientError) throw error;
    throw new AiClientError("EMBEDDING_UPSTREAM_FAILED", true);
  }

  if (vector.length !== config.dimension) {
    throw new AiClientError("EMBEDDING_DIMENSION_MISMATCH", true);
  }
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new AiClientError("EMBEDDING_INVALID_VECTOR", true);
  }
  if (vector.every((value) => value === 0)) {
    throw new AiClientError("EMBEDDING_INVALID_VECTOR", true);
  }
  return vector;
}
