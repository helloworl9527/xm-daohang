// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const createCompletion = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = { completions: { create: createCompletion } };
  },
}));

import { generateLlmText } from "@/lib/ai/llm";

describe("OpenAI-compatible LLM client", () => {
  beforeEach(() => {
    createCompletion.mockReset();
    createCompletion.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
  });

  it("mentions lowercase json when requesting json_object output", async () => {
    await expect(generateLlmText(
      { system: "只返回结构化结果。", user: "测试内容" },
      {
        loadConfig: async () => ({
          baseUrl: "https://models.example/v1",
          model: "chat-model",
          apiKey: "sk-test",
        }),
      },
    )).resolves.toBe("{}");

    expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      response_format: { type: "json_object" },
      messages: [
        expect.objectContaining({ role: "system", content: expect.stringContaining("json") }),
        { role: "user", content: "测试内容" },
      ],
    }));
  });
});
