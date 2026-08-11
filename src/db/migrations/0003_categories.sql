CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_name_not_blank_check" CHECK (length(btrim("categories"."name")) > 0),
	CONSTRAINT "categories_sort_check" CHECK ("categories"."sort" >= 0)
);
--> statement-breakpoint
CREATE TABLE "category_change_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" uuid NOT NULL,
	"mode" text NOT NULL,
	"base_version" integer NOT NULL,
	"applied_version" integer,
	"accepted" jsonb NOT NULL,
	"ignored" jsonb NOT NULL,
	"reclassify_requested" boolean DEFAULT false NOT NULL,
	"reclassify_generation" integer DEFAULT 0 NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"cursor_created_at" timestamp with time zone,
	"cursor_id" uuid,
	"status" text DEFAULT 'applying' NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"renamed_count" integer DEFAULT 0 NOT NULL,
	"merged_count" integer DEFAULT 0 NOT NULL,
	"deleted_count" integer DEFAULT 0 NOT NULL,
	"ignored_count" integer DEFAULT 0 NOT NULL,
	"manual_protected" integer DEFAULT 0 NOT NULL,
	"reclassified" integer DEFAULT 0 NOT NULL,
	"moved_unclassified" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "category_change_runs_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "category_change_runs_mode_check" CHECK ("category_change_runs"."mode" in ('supplement', 'full', 'manual')),
	CONSTRAINT "category_change_runs_base_version_check" CHECK ("category_change_runs"."base_version" >= 0),
	CONSTRAINT "category_change_runs_applied_version_check" CHECK ("category_change_runs"."applied_version" is null or "category_change_runs"."applied_version" >= 0),
	CONSTRAINT "category_change_runs_generation_check" CHECK ("category_change_runs"."reclassify_generation" >= 0),
	CONSTRAINT "category_change_runs_status_check" CHECK ("category_change_runs"."status" in ('applying', 'reclassifying', 'completed', 'partial', 'failed', 'superseded')),
	CONSTRAINT "category_change_runs_counts_check" CHECK ("category_change_runs"."added_count" >= 0 and "category_change_runs"."renamed_count" >= 0 and "category_change_runs"."merged_count" >= 0 and "category_change_runs"."deleted_count" >= 0 and "category_change_runs"."ignored_count" >= 0 and "category_change_runs"."manual_protected" >= 0 and "category_change_runs"."reclassified" >= 0 and "category_change_runs"."moved_unclassified" >= 0)
);
--> statement-breakpoint
CREATE TABLE "category_reclassify_failures" (
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"error_code" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_reclassify_failures_run_id_item_id_pk" PRIMARY KEY("run_id","item_id"),
	CONSTRAINT "category_reclassify_failures_attempts_check" CHECK ("category_reclassify_failures"."attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "category_run_retry_requests" (
	"run_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"generation" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_run_retry_requests_run_id_request_key_pk" PRIMARY KEY("run_id","request_key"),
	CONSTRAINT "category_run_retry_requests_run_generation_unique" UNIQUE("run_id","generation"),
	CONSTRAINT "category_run_retry_requests_generation_check" CHECK ("category_run_retry_requests"."generation" >= 1)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "categories_initialized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "category_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "category_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "category_reclassify_failures" ADD CONSTRAINT "category_reclassify_failures_run_id_category_change_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."category_change_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_reclassify_failures" ADD CONSTRAINT "category_reclassify_failures_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_run_retry_requests" ADD CONSTRAINT "category_run_retry_requests_run_id_category_change_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."category_change_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_normalized_unique" ON "categories" USING btree (lower(btrim("name")));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_category_idx" ON "items" USING btree ("category_id");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_category_version_check" CHECK ("app_settings"."category_version" >= 0);
