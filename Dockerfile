# syntax=docker/dockerfile:1.7
FROM node:22.22.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
    NODE_OPTIONS=--max-old-space-size=2048
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-prod,target=/pnpm/store pnpm install --prod --frozen-lockfile
RUN cp -RL node_modules/drizzle-orm /tmp/drizzle-orm

FROM base AS app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 pnpm_config_verify_deps_before_run=false
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./src/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/auth/password.ts ./src/lib/auth/password.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/crypto/secretbox.ts ./src/lib/crypto/secretbox.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/log/logger.ts ./src/lib/log/logger.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=production-dependencies --chown=nextjs:nodejs /tmp/drizzle-orm ./node_modules/drizzle-orm
RUN node scripts/verify-production-artifact.mjs /app
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

FROM app AS worker
ENV WORKER_MODE=1 PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]
