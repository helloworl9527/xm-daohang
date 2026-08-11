import { randomUUID } from "node:crypto";

import type PgBoss from "pg-boss";

import packageMetadata from "../../package.json";
import { logger } from "@/lib/log/logger";
import {
  CATEGORY_RECLASSIFY_QUEUE,
  ensureCategoryReclassifyQueue,
  publishPendingCategoryReclassifications,
  type CategoryReclassifyPayload,
} from "@/lib/categories/reclassify";
import { createBoss, ensureProcessingQueue, PROCESS_ITEM_QUEUE } from "@/lib/queue/boss";
import { businessDay } from "@/lib/time/businessDay";
import { dispatchTelegramReceipt } from "@/worker/bot/receiptDispatcher";
import { launchTelegramBot, type TelegramRuntime } from "@/worker/bot/telegram";
import { cleanupRetention, recordWorkerHeartbeat } from "@/worker/jobs/maintenance";
import { processItemJob } from "@/worker/jobs/processItem";
import { reclassifyCategoriesJob } from "@/worker/jobs/reclassifyCategories";
import {
  registerScheduledRefetch,
  runScheduledRefetch,
  SCHEDULED_REFETCH_QUEUE,
} from "@/worker/jobs/scheduledRefetch";
import { publishPendingRequests, type ProcessingJobPayload } from "@/worker/queue/requestPublisher";

export const MAINTENANCE_QUEUE = "daily-maintenance";
const LOOP_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

interface WorkerRuntime {
  stop(): Promise<void>;
}

async function registerMaintenance(boss: PgBoss): Promise<void> {
  const timeZone = process.env.APP_TIMEZONE;
  businessDay(new Date(), timeZone);
  await boss.createQueue(MAINTENANCE_QUEUE, {
    name: MAINTENANCE_QUEUE,
    policy: "short",
    retryLimit: 0,
  });
  await boss.schedule(MAINTENANCE_QUEUE, "15 3 * * *", {}, {
    tz: timeZone,
    singletonKey: MAINTENANCE_QUEUE,
    retryLimit: 0,
  });
}

function repeat(operation: () => Promise<void>, intervalMs: number): { stop: () => void; idle: () => Promise<void> } {
  let stopped = false;
  let active = Promise.resolve();
  const run = () => {
    if (stopped) return;
    active = operation().catch(() => {
      logger.warn("worker_loop_failed", { category: "internal" });
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  return {
    stop: () => { stopped = true; clearInterval(timer); },
    idle: async () => { await active; },
  };
}

export async function createWorkerRuntime(): Promise<WorkerRuntime> {
  const workerId = process.env.WORKER_ID?.trim() || `worker-${randomUUID()}`;
  const boss = createBoss();
  boss.on("error", () => logger.error("queue_error", { category: "internal" }));
  await boss.start();
  await ensureProcessingQueue(boss);
  await ensureCategoryReclassifyQueue(boss);
  await registerScheduledRefetch(boss);
  await registerMaintenance(boss);

  await boss.work<ProcessingJobPayload>(PROCESS_ITEM_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await processItemJob(job.data);
  });
  await boss.work<CategoryReclassifyPayload>(CATEGORY_RECLASSIFY_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) await reclassifyCategoriesJob(job.data);
  });
  await boss.work(SCHEDULED_REFETCH_QUEUE, { batchSize: 1 }, async () => {
    await runScheduledRefetch();
  });
  await boss.work(MAINTENANCE_QUEUE, { batchSize: 1 }, async () => {
    await cleanupRetention();
  });

  let telegram: TelegramRuntime | null = null;
  try {
    telegram = await launchTelegramBot();
  } catch {
    logger.warn("telegram_start_failed", { category: "configuration" });
  }

  const publisher = repeat(async () => { await publishPendingRequests(boss); }, LOOP_INTERVAL_MS);
  const categoryPublisher = repeat(async () => {
    await publishPendingCategoryReclassifications(boss);
  }, LOOP_INTERVAL_MS);
  const receipts = repeat(async () => {
    if (telegram) await dispatchTelegramReceipt(workerId, { send: telegram.send });
  }, LOOP_INTERVAL_MS);
  const heartbeat = repeat(async () => {
    await recordWorkerHeartbeat(workerId, packageMetadata.version);
  }, HEARTBEAT_INTERVAL_MS);

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      publisher.stop();
      categoryPublisher.stop();
      receipts.stop();
      heartbeat.stop();
      await Promise.all([publisher.idle(), categoryPublisher.idle(), receipts.idle(), heartbeat.idle()]);
      await Promise.all([
        boss.offWork(PROCESS_ITEM_QUEUE),
        boss.offWork(CATEGORY_RECLASSIFY_QUEUE),
        boss.offWork(SCHEDULED_REFETCH_QUEUE),
        boss.offWork(MAINTENANCE_QUEUE),
      ]);
      if (telegram) await telegram.stop();
      await boss.stop({ graceful: true, timeout: 30_000, wait: true });
    },
  };
}

let runtimePromise: Promise<WorkerRuntime> | null = null;

export function startWorker(): Promise<WorkerRuntime> {
  runtimePromise ??= createWorkerRuntime();
  return runtimePromise;
}

async function shutdown(): Promise<void> {
  try {
    await (await runtimePromise)?.stop();
  } finally {
    process.exit(0);
  }
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
