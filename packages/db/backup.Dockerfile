# The nightly backup's image — POOLSE-89, run as a Railway cron service since
# 17-11-2026 (docs/deploy.md, "Backups and restoring").
#
#   docker build -f packages/db/backup.Dockerfile .
#
# The runtime is PG_TOOLS_IMAGE itself (postgres:<production's major>), so
# pg_dump is the matching client and runs natively — no Docker inside Railway.
# Node is copied in from the Debian image of the same release, so the
# dependencies built in the first stage (esbuild's binary for tsx included)
# match its C library.
#
# What is in it: @poolse/db's scripts and the API's notifier (the failure alert
# goes through the API's one email path). No .env (see .dockerignore), no key
# that opens a backup — the job refuses to start if one is set.

ARG PG_TOOLS_IMAGE=postgres:16

FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY packages/rules/package.json packages/rules/
COPY apps/api/package.json apps/api/

# The API's dependencies too: the alert imports its notifier.
RUN pnpm install --frozen-lockfile --filter @poolse/api...

COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY packages/rules packages/rules
COPY apps/api apps/api

# The notifier imports @poolse/db and @poolse/rules, which resolve to dist.
RUN pnpm --filter @poolse/db --filter @poolse/rules build

FROM ${PG_TOOLS_IMAGE} AS runtime

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app /app

# Not root: the job reads its variables and talks to the network, nothing more.
USER postgres

CMD ["sh", "packages/db/scripts/railway-backup.sh"]
