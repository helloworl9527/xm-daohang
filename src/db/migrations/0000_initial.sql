CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_singleton_check" CHECK ("admin_user"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"llm_base_url" text,
	"llm_model" text,
	"llm_key_enc" text,
	"emb_base_url" text,
	"emb_model" text,
	"emb_key_enc" text,
	"emb_dim" integer,
	"emb_version" integer DEFAULT 0 NOT NULL,
	"search_min_cosine" real,
	"emb_rebuild_status" text DEFAULT 'unconfigured' NOT NULL,
	"refetch_enabled" boolean DEFAULT false NOT NULL,
	"refetch_interval_days" integer DEFAULT 30 NOT NULL,
	"refetch_last_run" timestamp with time zone,
	"ratelimit_enabled" boolean DEFAULT true NOT NULL,
	"ratelimit_ip_daily" integer DEFAULT 20 NOT NULL,
	"ratelimit_global_daily" integer DEFAULT 200 NOT NULL,
	"tg_token_enc" text,
	"tg_allowed_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"github_backoff_until" timestamp with time zone,
	"default_locale" text DEFAULT 'zh' NOT NULL,
	CONSTRAINT "app_settings_singleton_check" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "app_settings_emb_dim_check" CHECK ("app_settings"."emb_dim" is null or "app_settings"."emb_dim" > 0),
	CONSTRAINT "app_settings_emb_version_check" CHECK ("app_settings"."emb_version" >= 0),
	CONSTRAINT "app_settings_search_min_cosine_check" CHECK ("app_settings"."search_min_cosine" is null or "app_settings"."search_min_cosine" between -1 and 1),
	CONSTRAINT "app_settings_rebuild_status_check" CHECK ("app_settings"."emb_rebuild_status" in ('unconfigured', 'building', 'ready', 'failed')),
	CONSTRAINT "app_settings_refetch_interval_check" CHECK ("app_settings"."refetch_interval_days" between 1 and 3650),
	CONSTRAINT "app_settings_ratelimit_ip_check" CHECK ("app_settings"."ratelimit_ip_daily" between 1 and 10000),
	CONSTRAINT "app_settings_ratelimit_global_check" CHECK ("app_settings"."ratelimit_global_daily" between 1 and 1000000),
	CONSTRAINT "app_settings_locale_check" CHECK ("app_settings"."default_locale" in ('zh', 'en'))
);
--> statement-breakpoint
CREATE TABLE "ask_counters" (
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ask_counters_day_scope_pk" PRIMARY KEY("day","scope"),
	CONSTRAINT "ask_counters_count_check" CHECK ("ask_counters"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_selections" (
	"day" date NOT NULL,
	"rank" smallint NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "daily_selections_day_rank_pk" PRIMARY KEY("day","rank"),
	CONSTRAINT "daily_selections_day_item_unique" UNIQUE("day","item_id"),
	CONSTRAINT "daily_selections_rank_check" CHECK ("daily_selections"."rank" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"url_canonical" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"summary" text,
	"summary_manual" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"fail_reason" text,
	"source" text NOT NULL,
	"content_hash" text,
	"embedding" vector,
	"embedding_dim" integer,
	"embedding_version" integer,
	"process_generation" integer DEFAULT 0 NOT NULL,
	"last_shown_on" date,
	"shown_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_url_canonical_unique" UNIQUE("url_canonical"),
	CONSTRAINT "items_type_check" CHECK ("items"."type" in ('web', 'doc', 'github')),
	CONSTRAINT "items_status_check" CHECK ("items"."status" in ('processing', 'completed', 'failed')),
	CONSTRAINT "items_source_check" CHECK ("items"."source" in ('admin', 'telegram')),
	CONSTRAINT "items_process_generation_check" CHECK ("items"."process_generation" >= 0),
	CONSTRAINT "items_shown_count_check" CHECK ("items"."shown_count" >= 0),
	CONSTRAINT "items_embedding_metadata_check" CHECK (("items"."embedding" is null and "items"."embedding_dim" is null and "items"."embedding_version" is null) or ("items"."embedding" is not null and "items"."embedding_dim" > 0 and "items"."embedding_version" >= 0)),
	CONSTRAINT "items_completed_tags_check" CHECK ("items"."status" <> 'completed' or cardinality("items"."tags") between 3 and 5)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"success" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_requests" (
	"item_id" uuid NOT NULL,
	"process_generation" integer NOT NULL,
	"emb_version" integer NOT NULL,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	CONSTRAINT "processing_requests_item_id_process_generation_attempt_pk" PRIMARY KEY("item_id","process_generation","attempt"),
	CONSTRAINT "processing_requests_generation_check" CHECK ("processing_requests"."process_generation" >= 0),
	CONSTRAINT "processing_requests_emb_version_check" CHECK ("processing_requests"."emb_version" >= 0),
	CONSTRAINT "processing_requests_attempt_check" CHECK ("processing_requests"."attempt" between 0 and 3),
	CONSTRAINT "processing_requests_status_check" CHECK ("processing_requests"."status" in ('pending', 'queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"process_generation" integer NOT NULL,
	"chat_id_hash" text NOT NULL,
	"chat_id_enc" text NOT NULL,
	"outcome" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_by" text,
	"lease_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "telegram_receipts_item_generation_chat_unique" UNIQUE("item_id","process_generation","chat_id_hash"),
	CONSTRAINT "telegram_receipts_generation_check" CHECK ("telegram_receipts"."process_generation" >= 0),
	CONSTRAINT "telegram_receipts_outcome_check" CHECK ("telegram_receipts"."outcome" is null or "telegram_receipts"."outcome" in ('completed', 'failed')),
	CONSTRAINT "telegram_receipts_status_check" CHECK ("telegram_receipts"."status" in ('waiting', 'ready', 'sending', 'sent', 'failed')),
	CONSTRAINT "telegram_receipts_attempts_check" CHECK ("telegram_receipts"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_selections" ADD CONSTRAINT "daily_selections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_requests" ADD CONSTRAINT "processing_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_receipts" ADD CONSTRAINT "telegram_receipts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "login_attempts_lookup_idx" ON "login_attempts" USING btree ("ip_hash","at" DESC NULLS LAST);
