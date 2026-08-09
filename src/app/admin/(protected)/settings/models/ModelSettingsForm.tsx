"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Pressable } from "@/components/ui/Pressable";
import type { Settings } from "@/lib/config/settings";

type Kind = "llm" | "embedding";
type FormStatus = "idle" | "testing" | "saving" | "tested" | "saved" | "error";

interface Draft {
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface ModelGroupProps {
  kind: Kind;
  title: string;
  keyMask: string | null;
  initial: Draft;
  csrfToken: string;
  disabled?: boolean;
  onSaved(settings: Settings): void;
}

async function requestModel(
  path: string,
  csrfToken: string,
  kind: Kind,
  draft: Draft,
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: path.endsWith("/test") ? "POST" : "PUT",
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({
      kind,
      baseUrl: draft.baseUrl,
      model: draft.model,
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error("MODEL_REQUEST_FAILED");
  return payload;
}

function ModelGroup({
  kind,
  title,
  keyMask,
  initial,
  csrfToken,
  disabled = false,
  onSaved,
}: ModelGroupProps) {
  const t = useTranslations("admin.models");
  const [draft, setDraft] = useState(initial);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [probeDetail, setProbeDetail] = useState("");
  const busy = status === "testing" || status === "saving";
  const dirty =
    draft.baseUrl !== initial.baseUrl ||
    draft.model !== initial.model ||
    draft.apiKey !== initial.apiKey;

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const submit = async (mode: "test" | "save") => {
    setStatus(mode === "test" ? "testing" : "saving");
    setProbeDetail("");
    try {
      const payload = await requestModel(
        mode === "test"
          ? "/admin/api/settings/models/test"
          : "/admin/api/settings/models",
        csrfToken,
        kind,
        draft,
      );
      if (mode === "save") {
        onSaved(payload as unknown as Settings);
        setDraft((current) => ({ ...current, apiKey: "" }));
      }
      if (kind === "embedding" && typeof payload.dimension === "number") {
        setProbeDetail(t("probe", { dimension: payload.dimension, cutoff: Number(payload.cutoff).toFixed(3) }));
      }
      setStatus(mode === "test" ? "tested" : "saved");
      navigator.vibrate?.(7);
    } catch {
      setStatus("error");
    }
  };

  return (
    <section className="model-settings-group" aria-labelledby={`${kind}-model-title`}>
      <div className="model-settings-group__heading">
        <h2 id={`${kind}-model-title`}>{title}</h2>
        <output aria-live="polite">
          {status === "testing" ? t("testing") : null}
          {status === "saving" ? t("saving") : null}
          {status === "tested" ? probeDetail || t("connected") : null}
          {status === "saved" ? t("saved") : null}
          {status === "error" ? t("error") : null}
        </output>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit("save");
        }}
      >
        <fieldset disabled={disabled || busy}>
          <label>
            <span>Base URL</span>
            <input
              autoComplete="off"
              name={`${kind}-base-url`}
              onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
              required
              spellCheck={false}
              type="url"
              value={draft.baseUrl}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              autoComplete="off"
              name={`${kind}-api-key`}
              onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={keyMask ?? t("keyPlaceholder")}
              type="password"
              value={draft.apiKey}
            />
          </label>
          <label>
            <span>{t("modelName")}</span>
            <input
              autoComplete="off"
              name={`${kind}-model`}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
              required
              spellCheck={false}
              value={draft.model}
            />
          </label>
          <div className="model-settings-actions">
            <Pressable name="intent" onClick={() => void submit("test")} type="button">
              {status === "testing" ? t("testing") : t("test", { title })}
            </Pressable>
            <Pressable type="submit">
              {status === "saving" ? t("saving") : t("save", { title })}
            </Pressable>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

export function ModelSettingsForm({
  initialSettings,
  csrfToken,
}: {
  initialSettings: Settings;
  csrfToken: string;
}) {
  const t = useTranslations("admin.models");
  const [settings, setSettings] = useState(initialSettings);
  const rebuilding = settings.embRebuildStatus === "building";

  return (
    <div className="model-settings">
      <ModelGroup
        csrfToken={csrfToken}
        initial={{
          baseUrl: settings.llmBaseUrl ?? "",
          model: settings.llmModel ?? "",
          apiKey: "",
        }}
        keyMask={settings.llmKeyMasked}
        kind="llm"
        onSaved={setSettings}
        title={t("llm")}
      />
      <ModelGroup
        csrfToken={csrfToken}
        disabled={rebuilding}
        initial={{
          baseUrl: settings.embBaseUrl ?? "",
          model: settings.embModel ?? "",
          apiKey: "",
        }}
        keyMask={settings.embKeyMasked}
        kind="embedding"
        onSaved={setSettings}
        title={t("embedding")}
      />
      {rebuilding ? (
        <p className="model-rebuild-status" role="status">
          {t("rebuilding")}
        </p>
      ) : null}
    </div>
  );
}
