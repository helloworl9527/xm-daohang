// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  probeEmbeddingConfig,
  probeLlmConfig,
  type ModelProbeAdapter,
} from "@/lib/config/modelSettings";

function adapter(onBaseUrl: (baseUrl: string) => void): ModelProbeAdapter {
  return {
    async testLlm(config) {
      onBaseUrl(config.baseUrl);
      return "ok";
    },
    async embed(config) {
      onBaseUrl(config.baseUrl);
      return [
        [1, 0],
        [0.95, 0.05],
        [0.85, 0.15],
        [0, 1],
        [-1, 0],
      ];
    },
  };
}

describe("model endpoint normalization", () => {
  it.each([
    ["https://models.example/v1", "https://models.example/v1"],
    ["https://models.example/v1/chat/completions", "https://models.example/v1"],
    ["https://models.example/v1/chat/completions/", "https://models.example/v1"],
  ])("normalizes chat endpoint %s", async (input, expected) => {
    let received = "";
    await probeLlmConfig(
      { baseUrl: input, model: "chat-model", apiKey: "sk-test" },
      adapter((baseUrl) => {
        received = baseUrl;
      }),
    );
    expect(received).toBe(expected);
  });

  it.each([
    ["https://models.example/v1", "https://models.example/v1"],
    ["https://models.example/v1/embeddings", "https://models.example/v1"],
    ["https://models.example/v1/embeddings/", "https://models.example/v1"],
  ])("normalizes embedding endpoint %s", async (input, expected) => {
    let received = "";
    await probeEmbeddingConfig(
      { baseUrl: input, model: "embedding-model", apiKey: "sk-test" },
      adapter((baseUrl) => {
        received = baseUrl;
      }),
    );
    expect(received).toBe(expected);
  });
});
