export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WORKER_MODE === "1") {
    const { startWorker } = await import("@/worker/index");
    await startWorker();
  }
}
