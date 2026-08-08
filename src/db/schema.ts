import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  fromDriver: (value) => {
    const content = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
    return content === "" ? [] : content.split(",").map(Number);
  },
  toDriver: (value) => `[${value.join(",")}]`,
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    urlCanonical: text("url_canonical").notNull().unique(),
    type: text("type").notNull(),
    title: text("title"),
    summary: text("summary"),
    summaryManual: boolean("summary_manual").notNull().default(false),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("processing"),
    failReason: text("fail_reason"),
    source: text("source").notNull(),
    contentHash: text("content_hash"),
    embedding: vector("embedding"),
    embeddingDim: integer("embedding_dim"),
    embeddingVersion: integer("embedding_version"),
    processGeneration: integer("process_generation").notNull().default(0),
    lastShownOn: date("last_shown_on", { mode: "string" }),
    shownCount: integer("shown_count").notNull().default(0),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("items_status_idx").on(table.status),
    index("items_retrievable_idx")
      .on(table.status, table.embeddingVersion, table.embeddingDim)
      .where(sql`${table.embedding} is not null`),
    check("items_type_check", sql`${table.type} in ('web', 'doc', 'github')`),
    check("items_status_check", sql`${table.status} in ('processing', 'completed', 'failed')`),
    check("items_source_check", sql`${table.source} in ('admin', 'telegram')`),
    check("items_process_generation_check", sql`${table.processGeneration} >= 0`),
    check("items_shown_count_check", sql`${table.shownCount} >= 0`),
    check(
      "items_embedding_metadata_check",
      sql`(${table.embedding} is null and ${table.embeddingDim} is null and ${table.embeddingVersion} is null) or (${table.embedding} is not null and ${table.embeddingDim} > 0 and ${table.embeddingVersion} >= 0)`,
    ),
    check(
      "items_completed_tags_check",
      sql`${table.status} <> 'completed' or cardinality(${table.tags}) between 3 and 5`,
    ),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    llmBaseUrl: text("llm_base_url"),
    llmModel: text("llm_model"),
    llmKeyEnc: text("llm_key_enc"),
    embBaseUrl: text("emb_base_url"),
    embModel: text("emb_model"),
    embKeyEnc: text("emb_key_enc"),
    embDim: integer("emb_dim"),
    embVersion: integer("emb_version").notNull().default(0),
    searchMinCosine: real("search_min_cosine"),
    embRebuildStatus: text("emb_rebuild_status").notNull().default("unconfigured"),
    refetchEnabled: boolean("refetch_enabled").notNull().default(false),
    refetchIntervalDays: integer("refetch_interval_days").notNull().default(30),
    refetchLastRun: timestamptz("refetch_last_run"),
    ratelimitEnabled: boolean("ratelimit_enabled").notNull().default(true),
    ratelimitIpDaily: integer("ratelimit_ip_daily").notNull().default(20),
    ratelimitGlobalDaily: integer("ratelimit_global_daily").notNull().default(200),
    tgTokenEnc: text("tg_token_enc"),
    tgAllowedIds: bigint("tg_allowed_ids", { mode: "number" })
      .array()
      .notNull()
      .default(sql`'{}'::bigint[]`),
    githubBackoffUntil: timestamptz("github_backoff_until"),
    defaultLocale: text("default_locale").notNull().default("zh"),
  },
  (table) => [
    check("app_settings_singleton_check", sql`${table.id} = 1`),
    check("app_settings_emb_dim_check", sql`${table.embDim} is null or ${table.embDim} > 0`),
    check("app_settings_emb_version_check", sql`${table.embVersion} >= 0`),
    check(
      "app_settings_search_min_cosine_check",
      sql`${table.searchMinCosine} is null or ${table.searchMinCosine} between -1 and 1`,
    ),
    check(
      "app_settings_rebuild_status_check",
      sql`${table.embRebuildStatus} in ('unconfigured', 'building', 'ready', 'failed')`,
    ),
    check(
      "app_settings_refetch_interval_check",
      sql`${table.refetchIntervalDays} between 1 and 3650`,
    ),
    check(
      "app_settings_ratelimit_ip_check",
      sql`${table.ratelimitIpDaily} between 1 and 10000`,
    ),
    check(
      "app_settings_ratelimit_global_check",
      sql`${table.ratelimitGlobalDaily} between 1 and 1000000`,
    ),
    check("app_settings_locale_check", sql`${table.defaultLocale} in ('zh', 'en')`),
  ],
);

export const adminUser = pgTable(
  "admin_user",
  {
    id: integer("id").primaryKey().default(1),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [check("admin_user_singleton_check", sql`${table.id} = 1`)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
  idleExpiresAt: timestamptz("idle_expires_at").notNull(),
  absoluteExpiresAt: timestamptz("absolute_expires_at").notNull(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ipHash: text("ip_hash").notNull(),
    at: timestamptz("at").notNull().defaultNow(),
    success: boolean("success").notNull(),
  },
  (table) => [index("login_attempts_lookup_idx").on(table.ipHash, table.at.desc())],
);

export const askCounters = pgTable(
  "ask_counters",
  {
    day: date("day", { mode: "string" }).notNull(),
    scope: text("scope").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.scope] }),
    check("ask_counters_count_check", sql`${table.count} >= 0`),
  ],
);

export const dailySelections = pgTable(
  "daily_selections",
  {
    day: date("day", { mode: "string" }).notNull(),
    rank: smallint("rank").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.rank] }),
    unique("daily_selections_day_item_unique").on(table.day, table.itemId),
    check("daily_selections_rank_check", sql`${table.rank} between 1 and 3`),
  ],
);

export const processingRequests = pgTable(
  "processing_requests",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    processGeneration: integer("process_generation").notNull(),
    embVersion: integer("emb_version").notNull(),
    attempt: smallint("attempt").notNull().default(0),
    status: text("status").notNull().default("pending"),
    nextAttemptAt: timestamptz("next_attempt_at").notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.processGeneration, table.attempt] }),
    check("processing_requests_generation_check", sql`${table.processGeneration} >= 0`),
    check("processing_requests_emb_version_check", sql`${table.embVersion} >= 0`),
    check("processing_requests_attempt_check", sql`${table.attempt} between 0 and 3`),
    check(
      "processing_requests_status_check",
      sql`${table.status} in ('pending', 'queued', 'running', 'done', 'failed')`,
    ),
  ],
);

export const telegramReceipts = pgTable(
  "telegram_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    processGeneration: integer("process_generation").notNull(),
    chatIdHash: text("chat_id_hash").notNull(),
    chatIdEnc: text("chat_id_enc").notNull(),
    outcome: text("outcome"),
    status: text("status").notNull().default("waiting"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at").notNull().defaultNow(),
    leasedBy: text("leased_by"),
    leaseUntil: timestamptz("lease_until"),
    sentAt: timestamptz("sent_at"),
  },
  (table) => [
    unique("telegram_receipts_item_generation_chat_unique").on(
      table.itemId,
      table.processGeneration,
      table.chatIdHash,
    ),
    check("telegram_receipts_generation_check", sql`${table.processGeneration} >= 0`),
    check("telegram_receipts_outcome_check", sql`${table.outcome} is null or ${table.outcome} in ('completed', 'failed')`),
    check(
      "telegram_receipts_status_check",
      sql`${table.status} in ('waiting', 'ready', 'sending', 'sent', 'failed')`,
    ),
    check("telegram_receipts_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  seenAt: timestamptz("seen_at").notNull(),
  version: text("version").notNull(),
});
