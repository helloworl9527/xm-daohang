CREATE INDEX "items_retrievable_idx" ON "items" USING btree ("status","embedding_version","embedding_dim") WHERE "items"."embedding" is not null;
--> statement-breakpoint
ANALYZE "items";
