import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { appSettings, categories } from "@/db/schema";

export type CategoryErrorCode =
  | "VALIDATION"
  | "DUPLICATE_CATEGORY"
  | "CATEGORY_NOT_FOUND";

export class CategoryError extends Error {
  constructor(public readonly code: CategoryErrorCode) {
    super(code);
    this.name = "CategoryError";
  }
}

export type CategoryQueryable = Pick<
  typeof db,
  "delete" | "execute" | "insert" | "select" | "update"
>;

type CategoryTransactionHost = CategoryQueryable & Pick<typeof db, "transaction">;

export interface CategoryInput {
  name: string;
  sort?: number;
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

function pgError(error: unknown): PgErrorLike | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as PgErrorLike;
    if (candidate.code) return candidate;
    current = candidate.cause;
  }
  return undefined;
}

function mapCategoryError(error: unknown): never {
  if (error instanceof CategoryError) throw error;
  const pg = pgError(error);
  if (
    pg?.code === "23505" &&
    (pg.constraint === "categories_name_normalized_unique" ||
      pg.constraint === "categories_slug_unique")
  ) {
    throw new CategoryError("DUPLICATE_CATEGORY");
  }
  throw error;
}

function isTransactionHost(queryable: CategoryQueryable): queryable is CategoryTransactionHost {
  return "transaction" in queryable && typeof queryable.transaction === "function";
}

async function inWriteTransaction<T>(
  queryable: CategoryQueryable,
  operation: (tx: CategoryQueryable) => Promise<T>,
): Promise<T> {
  if (isTransactionHost(queryable)) {
    return queryable.transaction((tx) => operation(tx));
  }
  return operation(queryable);
}

export function normalizeCategoryName(input: string): string {
  const name = input.normalize("NFKC").trim();
  if (name.length === 0 || Array.from(name).length > 80 || /\p{Cc}/u.test(name)) {
    throw new CategoryError("VALIDATION");
  }
  return name;
}

export async function lockCategoryState(queryable: CategoryQueryable) {
  await queryable.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const result = await queryable.execute<{
    categories_initialized: boolean;
    category_version: number;
  }>(sql`
    select categories_initialized, category_version
      from app_settings
     where id = 1
     for update
  `);
  const row = result.rows[0];
  if (!row) throw new Error("SETTINGS_NOT_FOUND");
  return { initialized: row.categories_initialized, version: row.category_version };
}

export async function advanceCategoryVersion(
  queryable: CategoryQueryable,
  options: { initialize: boolean },
): Promise<number> {
  const [settings] = await queryable
    .update(appSettings)
    .set({
      categoryVersion: sql`${appSettings.categoryVersion} + 1`,
      ...(options.initialize ? { categoriesInitialized: true } : {}),
    })
    .where(eq(appSettings.id, 1))
    .returning({ version: appSettings.categoryVersion });
  if (!settings) throw new Error("SETTINGS_NOT_FOUND");
  return settings.version;
}

export async function createCategoryRecord(
  queryable: CategoryQueryable,
  input: CategoryInput,
) {
  const id = randomUUID();
  const name = normalizeCategoryName(input.name);
  const sort = input.sort ?? 0;
  if (!Number.isSafeInteger(sort) || sort < 0) throw new CategoryError("VALIDATION");
  try {
    const [created] = await queryable
      .insert(categories)
      .values({ id, name, slug: `cat-${id.replaceAll("-", "")}`, sort })
      .returning();
    if (!created) throw new Error("CATEGORY_CREATE_FAILED");
    return created;
  } catch (error) {
    mapCategoryError(error);
  }
}

export async function renameCategoryRecord(
  queryable: CategoryQueryable,
  id: string,
  input: { name: string },
) {
  const name = normalizeCategoryName(input.name);
  try {
    const [renamed] = await queryable
      .update(categories)
      .set({ name, updatedAt: sql`clock_timestamp()` })
      .where(eq(categories.id, id))
      .returning();
    if (!renamed) throw new CategoryError("CATEGORY_NOT_FOUND");
    return renamed;
  } catch (error) {
    mapCategoryError(error);
  }
}

export async function listCategories(queryable: CategoryQueryable = db) {
  return queryable
    .select()
    .from(categories)
    .orderBy(asc(categories.sort), asc(categories.name), asc(categories.id));
}

export async function createCategory(
  input: CategoryInput,
  queryable: CategoryQueryable = db,
) {
  return inWriteTransaction(queryable, async (tx) => {
    await lockCategoryState(tx);
    const created = await createCategoryRecord(tx, input);
    await advanceCategoryVersion(tx, { initialize: true });
    return created;
  });
}

export async function renameCategory(
  id: string,
  name: string,
  queryable: CategoryQueryable = db,
) {
  return inWriteTransaction(queryable, async (tx) => {
    await lockCategoryState(tx);
    const renamed = await renameCategoryRecord(tx, id, { name });
    await advanceCategoryVersion(tx, { initialize: false });
    return renamed;
  });
}

export async function deleteCategory(
  id: string,
  queryable: CategoryQueryable = db,
): Promise<{ autoCount: number; manualCount: number }> {
  return inWriteTransaction(queryable, async (tx) => {
    await lockCategoryState(tx);
    const countResult = await tx.execute<{ auto_count: string; manual_count: string }>(sql`
      select
        count(*) filter (where category_manual = false)::text as auto_count,
        count(*) filter (where category_manual = true)::text as manual_count
      from items
      where category_id = ${id}
    `);
    const [deleted] = await tx
      .delete(categories)
      .where(eq(categories.id, id))
      .returning({ id: categories.id });
    if (!deleted) throw new CategoryError("CATEGORY_NOT_FOUND");
    await advanceCategoryVersion(tx, { initialize: false });
    const counts = countResult.rows[0];
    return {
      autoCount: Number(counts?.auto_count ?? 0),
      manualCount: Number(counts?.manual_count ?? 0),
    };
  });
}

interface OverviewCategoryRow extends Record<string, unknown> {
  id: string;
  name: string;
  slug: string;
  sort: number;
  created_at: Date;
  updated_at: Date;
  auto_count: string;
  manual_count: string;
}

interface OverviewTotalsRow extends Record<string, unknown> {
  eligible_classified: string;
  eligible_unclassified: string;
  manual_items: string;
  completed_docs: string;
}

export async function getCategoryOverview(queryable: CategoryQueryable = db) {
  const [categoryResult, totalResult] = await Promise.all([
    queryable.execute<OverviewCategoryRow>(sql`
      select c.id, c.name, c.slug, c.sort, c.created_at, c.updated_at,
             count(i.id) filter (where i.category_manual = false)::text as auto_count,
             count(i.id) filter (where i.category_manual = true)::text as manual_count
        from categories c
        left join items i on i.category_id = c.id
       group by c.id
       order by c.sort, c.name, c.id
    `),
    queryable.execute<OverviewTotalsRow>(sql`
      select
        count(*) filter (
          where status = 'completed' and type in ('web', 'github') and category_id is not null
        )::text as eligible_classified,
        count(*) filter (
          where status = 'completed' and type in ('web', 'github') and category_id is null
        )::text as eligible_unclassified,
        count(*) filter (where category_manual = true)::text as manual_items,
        count(*) filter (where status = 'completed' and type = 'doc')::text as completed_docs
      from items
    `),
  ]);
  const totals = totalResult.rows[0];
  const classified = Number(totals?.eligible_classified ?? 0);
  const unclassified = Number(totals?.eligible_unclassified ?? 0);
  return {
    categories: categoryResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      sort: row.sort,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      autoCount: Number(row.auto_count),
      manualCount: Number(row.manual_count),
    })),
    eligible: { classified, unclassified, total: classified + unclassified },
    manualItems: Number(totals?.manual_items ?? 0),
    completedDocs: Number(totals?.completed_docs ?? 0),
  };
}
