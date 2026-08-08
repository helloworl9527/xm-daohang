import OpenAI from "openai";

export interface LlmRequest {
  system: string;
  user: string;
}

export interface LlmDependencies {
  loadConfig?: () => Promise<{ baseUrl: string; model: string; apiKey: string }>;
  requestText?: (
    config: { baseUrl: string; model: string; apiKey: string },
    request: LlmRequest,
  ) => Promise<string>;
}

export class AiClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
  ) {
    super(code);
    this.name = "AiClientError";
  }
}

function safeHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = error.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

async function loadLlmConfig(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
  const { getDecryptedSecret, getSettings } = await import("@/lib/config/settings");
  const [settings, apiKey] = await Promise.all([getSettings(), getDecryptedSecret("llmKey")]);
  if (!settings.llmBaseUrl || !settings.llmModel || !apiKey) {
    throw new AiClientError("LLM_NOT_CONFIGURED", false);
  }
  return { baseUrl: settings.llmBaseUrl, model: settings.llmModel, apiKey };
}

async function requestOpenAiText(
  config: { baseUrl: string; model: string; apiKey: string },
  request: LlmRequest,
): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  const content = response.choices[0]?.message.content;
  if (!content) throw new AiClientError("LLM_INVALID_RESPONSE", true);
  return content;
}

export async function generateLlmText(
  request: LlmRequest,
  dependencies: LlmDependencies = {},
): Promise<string> {
  try {
    const config = await (dependencies.loadConfig ?? loadLlmConfig)();
    return await (dependencies.requestText ?? requestOpenAiText)(config, request);
  } catch (error) {
    if (error instanceof AiClientError) throw error;
    throw new AiClientError("LLM_UPSTREAM_FAILED", true, safeHttpStatus(error));
  }
}
