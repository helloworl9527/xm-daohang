import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { items } from "@/db/schema";

export interface UpsertItemInput {
  url: string;
  urlCanonical: string;
  type: "web" | "doc" | "github";
  source: "admin" | "telegram";
}

export async function upsertItem(input: UpsertItemInput): Promise<{
  item: typeof items.$inferSelect;
  deduped: boolean;
}> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(items).values(input).onConflictDoNothing({
      target: items.urlCanonical,
    }).returning();
    if (inserted) return { item: inserted, deduped: false };

    const [existing] = await tx.select().from(items).where(eq(items.urlCanonical, input.urlCanonical));
    if (!existing) throw new Error("ITEM_DEDUPE_CONFLICT");
    return { item: existing, deduped: true };
  });
}
