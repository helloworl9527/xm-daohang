// @vitest-environment node

import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { appSettings, items, processingRequests } from "@/db/schema";
import { createBoss } from "@/lib/queue/boss";
import {
  registerScheduledRefetch,
  runScheduledRefetch,
  SCHEDULED_REFETCH_QUEUE,
} from "@/worker/jobs/scheduledRefetch";
import { publishPendingRequests, type ProcessingBoss } from "@/worker/queue/requestPublisher";

const NOW = new Date("2026-08-09T04:00:00.000Z");
const OLD = new Date("2026-07-01T00:00:00.000Z");

beforeAll(async () => {
  const database = await pool.query<{ current_database: string }>("select current_database()");
  if (database.rows[0]?.current_database !== "collection_system_test") {
    throw new Error("Scheduled refetch tests require the dedicated collection_system_test database");
  }
  await pool.query("drop schema public cascade; create schema public; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade");
  await migrate(db, { migrationsFolder: "src/db/migrations" });
});

beforeEach(async () => {
  delete process.env.GITHUB_PUBLIC_API_TOKEN;
  await db.delete(processingRequests);
  await db.delete(items);
  await db.delete(appSettings);
  await db.insert(appSettings).values({
    id: 1,
    embVersion: 3,
    refetchEnabled: true,
    refetchIntervalDays: 30,
  });
});

afterAll(async () => {
  await pool.query("drop schema if exists pgboss cascade");
  await pool.end();
});

async function insertDue(
  type: "web" | "doc" | "github",
  status: "completed" | "failed" | "processing" = "completed",
  index = crypto.randomUUID(),
  dates: { createdAt?: Date; updatedAt?: Date } = {},
) {
  const [item] = await db.insert(items).values({
    url: `https://example.com/${type}/${index}`,
    urlCanonical: `https://example.com/${type}/${index}`,
    type,
    source: "admin",
    status,
    createdAt: dates.createdAt ?? OLD,
    updatedAt: dates.updatedAt ?? OLD,
    ...(status === "completed" ? {
      summary: "旧总结第一句。旧总结第二句。",
      tags: ["标签一", "标签二", "标签三"],
      embedding: [1, 0, 0],
      embeddingDim: 3,
      embeddingVersion: 3,
    } : {}),
  }).returning();
  return item;
}

describe("scheduled refetch rounds", () => {
  it("runs one snapshot round across two workers and selects only due completed/failed items", async () => {
    const completed = await insertDue("web", "completed", "completed");
    const failed = await insertDue("doc", "failed", "failed");
    await insertDue("web", "processing", "processing");
    await insertDue("web", "completed", "recent", { updatedAt: new Date("2026-08-08T00:00:00Z") });

    const [first, second] = await Promise.all([
      runScheduledRefetch({ now: NOW }),
      runScheduledRefetch({ now: NOW }),
    ]);
    expect([first.status, second.status].sort()).toEqual(["already_ran", "scheduled"]);
    expect(first.scheduled + second.scheduled).toBe(2);

    const requests = await db.select().from(processingRequests);
    expect(requests.map((request) => request.itemId).sort()).toEqual([completed.id, failed.id].sort());
  });

  it("does nothing when disabled and excludes rows created after snapshot declaration", async () => {
    await insertDue("web", "completed", "existing");
    await db.update(appSettings).set({ refetchEnabled: false }).where(eq(appSettings.id, 1));
    await expect(runScheduledRefetch({ now: NOW })).resolves.toMatchObject({ status: "disabled", scheduled: 0 });

    await db.update(appSettings).set({ refetchEnabled: true, refetchLastRun: null }).where(eq(appSettings.id, 1));
    const afterSnapshot = vi.fn(async () => {
      await insertDue("web", "completed", "future", { createdAt: new Date(NOW.getTime() + 1) });
    });
    await expect(runScheduledRefetch({ now: NOW, afterSnapshot })).resolves.toMatchObject({ scheduled: 1 });
    expect(await db.select().from(processingRequests)).toHaveLength(1);
  });

  it("spreads the first 50 unauthenticated GitHub jobs and defers the 51st", async () => {
    for (let index = 0; index < 51; index += 1) await insertDue("github", "failed", String(index));

    await expect(runScheduledRefetch({ now: NOW, random: () => 0 })).resolves.toMatchObject({
      scheduled: 51,
      deferredGitHub: 1,
    });
    const requests = await db.select().from(processingRequests).orderBy(asc(processingRequests.nextAttemptAt));
    expect(requests).toHaveLength(51);
    expect(requests[49].nextAttemptAt.getTime()).toBeLessThan(NOW.getTime() + 60 * 60 * 1_000);
    expect(requests[50].nextAttemptAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 60 * 60 * 1_000);
  });

  it("honors persistent GitHub backoff without delaying web items and resumes after reset", async () => {
    const retryAt = new Date(NOW.getTime() + 20 * 60 * 1_000);
    await db.update(appSettings).set({ githubBackoffUntil: retryAt }).where(eq(appSettings.id, 1));
    const github = await insertDue("github", "failed", "backoff");
    const web = await insertDue("web", "failed", "not-blocked");
    await runScheduledRefetch({ now: NOW, random: () => 0 });

    const requests = await db.select().from(processingRequests);
    const githubRequest = requests.find((request) => request.itemId === github.id);
    const webRequest = requests.find((request) => request.itemId === web.id);
    expect(githubRequest?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(retryAt.getTime());
    expect(webRequest?.nextAttemptAt.getTime()).toBe(NOW.getTime());

    const later = new Date(retryAt.getTime() + 60_000);
    await db.update(appSettings).set({ refetchLastRun: null }).where(eq(appSettings.id, 1));
    const resumed = await insertDue("github", "failed", "resumed");
    await runScheduledRefetch({ now: later, random: () => 0 });
    const [resumedRequest] = await db.select().from(processingRequests).where(and(
      eq(processingRequests.itemId, resumed.id),
      eq(processingRequests.processGeneration, 1),
    ));
    expect(resumedRequest.nextAttemptAt.getTime()).toBe(later.getTime());
  });

  it("a PAT removes the unauthenticated budget but cannot alter T09 private=false enforcement", async () => {
    process.env.GITHUB_PUBLIC_API_TOKEN = "ghp-public-quota-only";
    for (let index = 0; index < 51; index += 1) await insertDue("github", "failed", `pat-${index}`);
    await expect(runScheduledRefetch({ now: NOW })).resolves.toMatchObject({
      scheduled: 51,
      deferredGitHub: 0,
    });
    const requests = await db.select().from(processingRequests);
    expect(requests.every((request) => request.nextAttemptAt.getTime() === NOW.getTime())).toBe(true);
  });

  it("recovers after a mid-round crash without duplicating the first generation", async () => {
    const first = await insertDue("web", "failed", "first");
    await insertDue("web", "failed", "second");
    let calls = 0;
    await expect(runScheduledRefetch({
      now: NOW,
      afterScheduled: async () => {
        calls += 1;
        if (calls === 1) throw new Error("worker crash");
      },
    })).rejects.toThrow("worker crash");

    await db.update(appSettings).set({ refetchLastRun: null }).where(eq(appSettings.id, 1));
    await runScheduledRefetch({ now: new Date(NOW.getTime() + 60_000) });
    const firstRequests = await db.select().from(processingRequests).where(eq(processingRequests.itemId, first.id));
    expect(firstRequests).toHaveLength(1);
    expect(firstRequests[0].processGeneration).toBe(1);
  });

  it("a newly persisted rate-limit backoff blocks only GitHub publishing until reset", async () => {
    const github = await insertDue("github", "failed", "publisher-github");
    const web = await insertDue("web", "failed", "publisher-web");
    await runScheduledRefetch({ now: NOW, hasGitHubToken: true });
    const retryAt = new Date(NOW.getTime() + 10 * 60 * 1_000);
    await db.update(appSettings).set({ githubBackoffUntil: retryAt }).where(eq(appSettings.id, 1));
    const sent: string[] = [];
    const boss: ProcessingBoss = {
      send: vi.fn(async (_name, payload) => {
        sent.push(payload.itemId);
        return crypto.randomUUID();
      }),
    };

    await publishPendingRequests(boss, { now: NOW });
    expect(sent).toEqual([web.id]);
    await db.update(appSettings).set({ githubBackoffUntil: null }).where(eq(appSettings.id, 1));
    await publishPendingRequests(boss, { now: new Date(retryAt.getTime() + 1) });
    expect(sent).toEqual([web.id, github.id]);
  });

  it("registers one fixed singleton cron schedule in the real pg-boss version", async () => {
    const boss = createBoss();
    await boss.start();
    try {
      await registerScheduledRefetch(boss);
      await registerScheduledRefetch(boss);
      const schedules = (await boss.getSchedules()).filter(
        (schedule) => schedule.name === SCHEDULED_REFETCH_QUEUE,
      );
      expect(schedules).toHaveLength(1);
      expect(schedules[0].cron).toBe("0 * * * *");
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
