import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secretbox";

export type SecretField = "llmKey" | "embKey" | "telegramToken";

export interface Settings {
  llmBaseUrl: string | null;
  llmModel: string | null;
  llmKeyMasked: string | null;
  embBaseUrl: string | null;
  embModel: string | null;
  embKeyMasked: string | null;
  embDim: number | null;
  embVersion: number;
  searchMinCosine: number | null;
  embRebuildStatus: "unconfigured" | "building" | "ready" | "failed";
  ratelimitEnabled: boolean;
  ratelimitIpDaily: number;
  ratelimitGlobalDaily: number;
  telegramTokenMasked: string | null;
  telegramAllowedIds: number[];
  githubBackoffUntil: Date | null;
  defaultLocale: "zh" | "en";
}

export interface SettingsPatch {
  llmBaseUrl?: string | null;
  llmModel?: string | null;
  llmKey?: string;
  embBaseUrl?: string | null;
  embModel?: string | null;
  embKey?: string;
  embDim?: number | null;
  embVersion?: number;
  searchMinCosine?: number | null;
  embRebuildStatus?: Settings["embRebuildStatus"];
  ratelimitEnabled?: boolean;
  ratelimitIpDaily?: number;
  ratelimitGlobalDaily?: number;
  telegramToken?: string;
  telegramAllowedIds?: number[];
  defaultLocale?: Settings["defaultLocale"];
}

async function ensureSettings(): Promise<void> {
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
}

function maskSecret(value: string | null): string | null {
  if (value === null) return null;
  if (value.length <= 7) return "••••";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function decryptedOrNull(value: string | null): string | null {
  return value === null ? null : decryptSecret(value);
}

export async function getSettings(): Promise<Settings> {
  await ensureSettings();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  if (!row) throw new Error("SETTINGS_NOT_FOUND");

  return {
    llmBaseUrl: row.llmBaseUrl,
    llmModel: row.llmModel,
    llmKeyMasked: maskSecret(decryptedOrNull(row.llmKeyEnc)),
    embBaseUrl: row.embBaseUrl,
    embModel: row.embModel,
    embKeyMasked: maskSecret(decryptedOrNull(row.embKeyEnc)),
    embDim: row.embDim,
    embVersion: row.embVersion,
    searchMinCosine: row.searchMinCosine,
    embRebuildStatus: row.embRebuildStatus as Settings["embRebuildStatus"],
    ratelimitEnabled: row.ratelimitEnabled,
    ratelimitIpDaily: row.ratelimitIpDaily,
    ratelimitGlobalDaily: row.ratelimitGlobalDaily,
    telegramTokenMasked: maskSecret(decryptedOrNull(row.tgTokenEnc)),
    telegramAllowedIds: row.tgAllowedIds,
    githubBackoffUntil: row.githubBackoffUntil,
    defaultLocale: row.defaultLocale as Settings["defaultLocale"],
  };
}

export async function getDecryptedSecret(field: SecretField): Promise<string | null> {
  await ensureSettings();
  const [row] = await db
    .select({
      llmKeyEnc: appSettings.llmKeyEnc,
      embKeyEnc: appSettings.embKeyEnc,
      tgTokenEnc: appSettings.tgTokenEnc,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!row) throw new Error("SETTINGS_NOT_FOUND");
  const encrypted = {
    llmKey: row.llmKeyEnc,
    embKey: row.embKeyEnc,
    telegramToken: row.tgTokenEnc,
  }[field];
  return decryptedOrNull(encrypted);
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  await ensureSettings();
  const update: Partial<typeof appSettings.$inferInsert> = {};

  if (patch.llmBaseUrl !== undefined) update.llmBaseUrl = patch.llmBaseUrl;
  if (patch.llmModel !== undefined) update.llmModel = patch.llmModel;
  if (patch.llmKey !== undefined) update.llmKeyEnc = encryptSecret(patch.llmKey);
  if (patch.embBaseUrl !== undefined) update.embBaseUrl = patch.embBaseUrl;
  if (patch.embModel !== undefined) update.embModel = patch.embModel;
  if (patch.embKey !== undefined) update.embKeyEnc = encryptSecret(patch.embKey);
  if (patch.embDim !== undefined) update.embDim = patch.embDim;
  if (patch.embVersion !== undefined) update.embVersion = patch.embVersion;
  if (patch.searchMinCosine !== undefined) update.searchMinCosine = patch.searchMinCosine;
  if (patch.embRebuildStatus !== undefined) update.embRebuildStatus = patch.embRebuildStatus;
  if (patch.ratelimitEnabled !== undefined) update.ratelimitEnabled = patch.ratelimitEnabled;
  if (patch.ratelimitIpDaily !== undefined) update.ratelimitIpDaily = patch.ratelimitIpDaily;
  if (patch.ratelimitGlobalDaily !== undefined) {
    update.ratelimitGlobalDaily = patch.ratelimitGlobalDaily;
  }
  if (patch.telegramToken !== undefined) update.tgTokenEnc = encryptSecret(patch.telegramToken);
  if (patch.telegramAllowedIds !== undefined) update.tgAllowedIds = patch.telegramAllowedIds;
  if (patch.defaultLocale !== undefined) update.defaultLocale = patch.defaultLocale;

  if (Object.keys(update).length > 0) {
    await db.update(appSettings).set(update).where(eq(appSettings.id, 1));
  }
  return getSettings();
}
