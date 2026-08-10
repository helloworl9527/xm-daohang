// @vitest-environment node

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, items, processingRequests } from "@/db/schema";
import { PUT } from "@/app/admin/api/settings/models/route";
import { POST } from "@/app/admin/api/settings/models/test/route";
import { createCsrfToken } from "@/lib/auth/guard";
import { createSession } from "@/lib/auth/session";
import * as modelSettings from "@/lib/config/modelSettings";
import {
  probeEmbeddingConfig,
  saveEmbeddingConfig,
  saveLlmConfig,
  type ModelProbeAdapter,
} from "@/lib/config/modelSettings";
import { getDecryptedSecret, getSettings } from "@/lib/config/settings";
import { addItem } from "@/lib/items/add";
import { logger, serializeLog } from "@/lib/log/logger";

function vector(dim: number, first: number, second = 0): number[] {
  return [first, second, ...Array.from({ length: dim - 2 }, () => 0)];
}

function adapterWith(vectors: number[][]): ModelProbeAdapter {
  return {
    testLlm: async () => "连接成功",
    embed: async () => vectors,
  };
}

function separableVectors(dim = 1_024): number[][] {
  return [
    vector(dim, 1),
    vector(dim, 0.95, 0.05),
    vector(dim, 0.85, 0.15),
    vector(dim, 0, 1),
    vector(dim, -1, 0),
  ];
}

const embeddingDraft = {
  baseUrl: "https://models.example/v1",
  model: "embedding-model",
  apiKey: "sk-embedding-abcd",
};

beforeAll(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Model settings tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete(processingRequests);
  await db.delete(items);
  await db.delete(appSettings);
});

afterAll(async () => {
  await pool.end();
});

describe("model configuration probes", () => {
  it("measures 1024 dimensions and calibrates a model-specific cutoff", async () => {
    const result = await probeEmbeddingConfig(
      embeddingDraft,
      adapterWith(separableVectors()),
    );

    expect(result.dimension).toBe(1_024);
    expect(result.minPositive).toBeGreaterThan(result.maxNegative);
    expect(result.cutoff).toBeGreaterThan(result.maxNegative);
    expect(result.cutoff).toBeLessThan(result.minPositive);
  });

  it.each([
    ["empty", []],
    ["NaN", separableVectors().map((entry, index) => (index === 1 ? [Number.NaN, 1] : entry))],
    ["dimension drift", separableVectors().map((entry, index) => (index === 2 ? entry.slice(1) : entry))],
    [
      "inseparable fixtures",
      [vector(3, 1), vector(3, 0, 1), vector(3, 0, 1), vector(3, 1), vector(3, -1)],
    ],
  ])("rejects %s probe output", async (_label, vectors) => {
    await expect(
      probeEmbeddingConfig(embeddingDraft, adapterWith(vectors)),
    ).rejects.toThrow(/EMBEDDING_(INVALID|INSEPARABLE)/);
  });

  it("does not overwrite a working LLM configuration when a live save probe fails", async () => {
    const working = adapterWith(separableVectors());
    await saveLlmConfig(
      { baseUrl: "https://old.example/v1", model: "old-chat", apiKey: "sk-old-aaaa" },
      working,
    );

    const failing: ModelProbeAdapter = {
      ...working,
      testLlm: async () => {
        throw new Error("UPSTREAM_FAILED");
      },
    };
    await expect(
      saveLlmConfig(
        { baseUrl: "https://new.example/v1", model: "new-chat", apiKey: "sk-new-bbbb" },
        failing,
      ),
    ).rejects.toThrow("UPSTREAM_FAILED");

    await expect(getSettings()).resolves.toMatchObject({
      llmBaseUrl: "https://old.example/v1",
      llmModel: "old-chat",
      llmKeyMasked: "sk-…aaaa",
    });
    await expect(getDecryptedSecret("llmKey")).resolves.toBe("sk-old-aaaa");
  });
});

describe("embedding configuration activation", () => {
  it("activates an empty library immediately and permits the first item", async () => {
    const adapter = adapterWith(separableVectors());
    await saveLlmConfig(
      { baseUrl: "https://models.example/v1", model: "chat-model", apiKey: "sk-chat-abcd" },
      adapter,
    );

    const settings = await saveEmbeddingConfig(embeddingDraft, adapter);

    expect(settings).toMatchObject({
      embDim: 1_024,
      embVersion: 1,
      embRebuildStatus: "ready",
    });
    expect(await db.select().from(processingRequests)).toHaveLength(0);

    const added = await addItem("https://example.com/first", {
      assertPublicUrl: async () => "https://example.com/first",
    });
    expect(added).toMatchObject({ status: "processing", deduped: false });
    expect(await db.select().from(processingRequests)).toEqual([
      expect.objectContaining({ itemId: added.id, embVersion: 1, status: "pending" }),
    ]);
  });

  it("increments each changed identity once and queues every completed item", async () => {
    const common = {
      type: "web" as const,
      source: "admin" as const,
      tags: ["model", "rebuild", "fixture"],
    };
    await db.insert(items).values([
      {
        ...common,
        url: "https://example.com/one",
        urlCanonical: "https://example.com/one",
        status: "completed",
        embedding: [1, 0, 0],
        embeddingDim: 3,
        embeddingVersion: 0,
      },
      {
        ...common,
        url: "https://example.com/two",
        urlCanonical: "https://example.com/two",
        status: "completed",
        embedding: [0, 1, 0],
        embeddingDim: 3,
        embeddingVersion: 0,
      },
      {
        ...common,
        url: "https://example.com/failed",
        urlCanonical: "https://example.com/failed",
        status: "failed",
      },
    ]);
    const adapter = adapterWith(separableVectors());

    const first = await saveEmbeddingConfig(embeddingDraft, adapter);
    const same = await saveEmbeddingConfig({ ...embeddingDraft, apiKey: undefined }, adapter);
    const changed = await saveEmbeddingConfig(
      { ...embeddingDraft, model: "embedding-model-v2", apiKey: undefined },
      adapter,
    );

    expect(first).toMatchObject({ embDim: 1_024, embVersion: 1, embRebuildStatus: "building" });
    expect(same.embVersion).toBe(1);
    expect(changed.embVersion).toBe(2);
    expect(changed.searchMinCosine).toBeGreaterThan(0);

    const requests = await db.select().from(processingRequests);
    expect(requests).toHaveLength(4);
    expect(requests.filter((request) => request.embVersion === 1)).toHaveLength(2);
    expect(requests.filter((request) => request.embVersion === 2)).toHaveLength(2);
    const completed = await db.select().from(items).where(eq(items.status, "completed"));
    expect(completed.map((item) => item.processGeneration)).toEqual([2, 2]);
    await expect(getDecryptedSecret("embKey")).resolves.toBe("sk-embedding-abcd");
  });
});

describe("model settings API security pipeline", () => {
  const body = JSON.stringify({
    kind: "llm",
    baseUrl: "https://models.example/v1",
    model: "chat-model",
    apiKey: "sk-request-secret",
  });

  it("rejects auth, origin, CSRF, and content-type failures before probing", async () => {
    const anonymous = await PUT(
      new Request("https://admin.example/admin/api/settings/models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    expect(anonymous.status).toBe(401);

    const { token } = await createSession();
    const cookie = `admin_session=${token}`;
    const wrongOrigin = await PUT(
      new Request("https://admin.example/admin/api/settings/models", {
        method: "PUT",
        headers: {
          cookie,
          host: "admin.example",
          origin: "https://evil.example",
          "content-type": "application/json",
          "x-csrf-token": createCsrfToken(token),
        },
        body,
      }),
    );
    expect(wrongOrigin.status).toBe(403);

    const wrongCsrf = await PUT(
      new Request("https://admin.example/admin/api/settings/models", {
        method: "PUT",
        headers: {
          cookie,
          host: "admin.example",
          origin: "https://admin.example",
          "content-type": "application/json",
          "x-csrf-token": "wrong",
        },
        body,
      }),
    );
    expect(wrongCsrf.status).toBe(403);

    const wrongContentType = await PUT(
      new Request("https://admin.example/admin/api/settings/models", {
        method: "PUT",
        headers: {
          cookie,
          host: "admin.example",
          origin: "https://admin.example",
          "content-type": "text/plain",
          "x-csrf-token": createCsrfToken(token),
        },
        body,
      }),
    );
    expect(wrongContentType.status).toBe(415);
    expect(await db.select().from(appSettings)).toHaveLength(0);
  });

  it.each([
    ["test", POST],
    ["save", PUT],
  ] as const)("does not expose an upstream-reflected draft key in %s logs or responses", async (
    operation,
    handler,
  ) => {
    const draftKey = "sk-DRAFT-MUST-NOT-LOG-9876";
    const upstreamError = Object.assign(
      new Error(`401 invalid credential ${draftKey}`),
      { status: 401 },
    );
    const probe = vi
      .spyOn(modelSettings, operation === "test" ? "probeLlmConfig" : "saveLlmConfig")
      .mockRejectedValue(upstreamError);
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const { token } = await createSession();

    const response = await handler(
      new Request("https://admin.example/admin/api/settings/models", {
        method: operation === "test" ? "POST" : "PUT",
        headers: {
          cookie: `admin_session=${token}`,
          host: "admin.example",
          origin: "https://admin.example",
          "content-type": "application/json",
          "x-csrf-token": createCsrfToken(token),
        },
        body: JSON.stringify({
          kind: "llm",
          baseUrl: "https://models.example/v1",
          model: "chat-model",
          apiKey: draftKey,
        }),
      }),
    );

    expect(probe).toHaveBeenCalledOnce();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(draftKey);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("model_probe_failed", {
      which: "llm",
      category: "upstream",
      httpStatus: 401,
    });
    expect(serializeLog(log.mock.calls[0])).not.toContain(draftKey);
  });
});
