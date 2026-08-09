// @vitest-environment node

import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as live } from "@/app/api/health/live/route";
import { GET as ready } from "@/app/api/health/ready/route";
import { createWorkerRuntime } from "@/worker/index";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString });
const execFileAsync = promisify(execFile);
const originalTimezone = process.env.APP_TIMEZONE;

describe("deployment contracts", () => {
  beforeAll(() => {
    process.env.APP_TIMEZONE = "Asia/Shanghai";
  });

  afterAll(async () => {
    await pool.end();
    if (originalTimezone === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = originalTimezone;
  });

  it("keeps liveness dependency-free and readiness migration-aware", async () => {
    await expect(live()).resolves.toMatchObject({ status: 200 });
    const response = await ready();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ready" });
  });

  it("ships a four-service internal topology with only Caddy publishing ports", async () => {
    const [compose, workerHealth] = await Promise.all([
      readFile("docker-compose.yml", "utf8"),
      readFile("scripts/check-worker-health.ts", "utf8"),
    ]);
    for (const service of ["app", "worker", "postgres", "caddy"]) {
      expect(compose).toMatch(new RegExp(`^  ${service}:`, "m"));
    }
    expect(compose.match(/^    ports:/gm)).toHaveLength(1);
    expect(compose).toContain("internal: true");
    expect(compose).toContain("/api/health/ready");
    expect(workerHealth).toContain("worker_heartbeats");
  });

  it("strips spoofable proxy headers before injecting authenticated single-value headers", async () => {
    const caddy = await readFile("Caddyfile", "utf8");
    expect(caddy).toContain("header_up -X-Real-Client-IP");
    expect(caddy).toContain("header_up -X-Proxy-Auth");
    expect(caddy).toContain("header_up X-Real-Client-IP {remote_host}");
    expect(caddy).toContain("header_up X-Proxy-Auth {$PROXY_SHARED_SECRET}");
    expect(caddy).toContain("header_up X-Forwarded-For {remote_host}");
    expect(caddy).toContain("Strict-Transport-Security");
  });

  it("uses multi-stage standalone production images and documents every required secret name", async () => {
    const [dockerfile, env] = await Promise.all([
      readFile("Dockerfile", "utf8"),
      readFile(".env.example", "utf8"),
    ]);
    expect(dockerfile).toContain("AS builder");
    expect(dockerfile).toContain("AS app");
    expect(dockerfile).toContain("AS worker");
    expect(dockerfile).toContain("pnpm install --prod");
    expect(dockerfile).toContain(".next/standalone");
    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).toContain("ENV DATABASE_URL=postgresql://placeholder:");
    expect(dockerfile).toContain("pnpm_config_verify_deps_before_run=false");
    for (const key of ["DATABASE_URL", "APP_TIMEZONE", "APP_ENCRYPTION_KEY", "IP_HASH_KEY", "LOGIN_IP_HASH_KEY", "TG_ID_HASH_KEY", "PROXY_SHARED_SECRET"]) {
      expect(env).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("excludes every root devDependency from the standalone production filesystem", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as { devDependencies: Record<string, string> };
    const result = await execFileAsync(process.execPath, ["scripts/verify-production-artifact.mjs", ".next/standalone"]);
    expect(result.stdout).toContain(`excludes ${Object.keys(manifest.devDependencies).length} root devDependencies`);
  });

  it("fails closed when a root devDependency is reintroduced", async () => {
    const artifact = await mkdtemp(path.join(tmpdir(), "collection-production-gate-"));
    await mkdir(path.join(artifact, "node_modules", "typescript"), { recursive: true });
    await expect(execFileAsync(process.execPath, ["scripts/verify-production-artifact.mjs", artifact]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("DEV_DEPENDENCIES_PRESENT:typescript") });
  });

  it("starts a real pg-boss worker, records heartbeat, and stops gracefully", async () => {
    process.env.WORKER_ID = "deploy-smoke-worker";
    await pool.query("delete from worker_heartbeats where worker_id = $1", [process.env.WORKER_ID]);
    await pool.query("insert into app_settings (id) values (1) on conflict (id) do nothing");
    const runtime = await createWorkerRuntime();
    try {
      await expect.poll(async () => (await pool.query(
        "select version from worker_heartbeats where worker_id = $1",
        [process.env.WORKER_ID],
      )).rows[0]?.version).toBe("0.1.0");
    } finally {
      await runtime.stop();
    }
  });
});
