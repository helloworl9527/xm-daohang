import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSettingsForm } from "@/app/admin/(protected)/settings/models/ModelSettingsForm";
import type { Settings } from "@/lib/config/settings";
import { render } from "../render";

const baseSettings: Settings = {
  llmBaseUrl: "https://llm.example/v1",
  llmModel: "chat-model",
  llmKeyMasked: "sk-…aaaa",
  embBaseUrl: "https://emb.example/v1",
  embModel: "embedding-model",
  embKeyMasked: "sk-…bbbb",
  embDim: 1_024,
  embVersion: 2,
  searchMinCosine: 0.55,
  embRebuildStatus: "ready",
  refetchEnabled: false,
  refetchIntervalDays: 30,
  refetchLastRun: null,
  ratelimitEnabled: true,
  ratelimitIpDaily: 20,
  ratelimitGlobalDaily: 200,
  telegramTokenMasked: null,
  telegramAllowedIds: [],
  githubBackoffUntil: null,
  defaultLocale: "zh",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("model settings form", () => {
  it("renders independent masked groups without plaintext keys", () => {
    render(<ModelSettingsForm csrfToken="csrf-token" initialSettings={baseSettings} />);

    const llm = screen.getByRole("region", { name: "对话模型" });
    const embedding = screen.getByRole("region", { name: "嵌入模型" });
    expect(within(llm).getByPlaceholderText("输入 API Key")).toHaveValue("");
    expect(within(embedding).getByPlaceholderText("输入 API Key")).toHaveValue("");
    expect(within(llm).getByText("已配置 sk-…aaaa；留空将保留现有密钥。")).toBeVisible();
    expect(within(embedding).getByText("已配置 sk-…bbbb；留空将保留现有密钥。")).toBeVisible();
    expect(document.body.textContent).not.toContain("sensitive");
  });

  it("tests a draft without saving and reports measured embedding details", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return Response.json({
        dimension: 1_024,
        cutoff: 0.625,
        minPositive: 0.9,
        maxNegative: 0.35,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ModelSettingsForm csrfToken="csrf-token" initialSettings={baseSettings} />);

    fireEvent.click(screen.getByRole("button", { name: "测试嵌入模型" }));

    await screen.findByText("实测 1024 维 · 阈值 0.625");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/admin/api/settings/models/test");
  });

  it("disables only embedding controls while rebuilding", () => {
    render(
      <ModelSettingsForm
        csrfToken="csrf-token"
        initialSettings={{ ...baseSettings, embRebuildStatus: "building" }}
      />,
    );

    expect(screen.getByText(/向量重建中/)).toBeVisible();
    expect(screen.getByRole("button", { name: "测试嵌入模型" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试对话模型" })).toBeEnabled();
  });

  it("keeps existing values and exposes an error state when a request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 502 })));
    render(<ModelSettingsForm csrfToken="csrf-token" initialSettings={baseSettings} />);
    const input = screen.getByDisplayValue("chat-model");

    fireEvent.click(screen.getByRole("button", { name: "测试对话模型" }));

    await waitFor(() => expect(screen.getByText("连接失败，原配置未更改。")).toBeVisible());
    expect(input).toHaveValue("chat-model");
  });
});
