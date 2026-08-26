# The API image, built from the repo root as context.
#
#   docker build -f apps/api/Dockerfile .
#
# Two stages. The first installs and compiles; the second carries the result. The
# split is not about image size so much as about what ends up in front of the
# internet: the build stage holds the whole toolchain, the runtime stage holds a
# node process and a dist directory.
#
# Only the API and what it depends on are installed. `--filter @poolse/api...`
# (the three dots mean "and its workspace dependencies") pulls in packages/db and
# leaves the entire Next.js toolchain out of a container that will never render a
# page.

FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /app

# Manifests first, so a change to source code does not re-resolve every
# dependency. This layer is the slow one and it changes about once a month.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @poolse/api...

COPY tsconfig.base.json ./
COPY packages/db packages/db
COPY apps/api apps/api

# Builds packages/db before apps/api — pnpm orders workspace builds by their
# dependency graph, so this does not need to be spelled out.
RUN pnpm --filter @poolse/api... build

FROM node:22-alpine AS runtime

RUN corepack enable
WORKDIR /app

ENV NODE_ENV=production

# The whole tree, symlinked node_modules included: @poolse/db is a workspace link
# and copying only dist would break it. It also keeps the migration runner
# available, which the pre-deploy step needs.
COPY --from=build /app /app

# Railway sets PORT. The API reads API_PORT, so map one to the other rather than
# teaching the app a second name for the same thing.
ENV API_PORT=8080
EXPOSE 8080

# Migrations deliberately do NOT run here. A container that migrates on boot
# migrates once per replica and races itself; worse, a crash-looping deploy would
# retry the migration every few seconds. It runs as a pre-deploy step instead —
# see docs/deploy.md.
CMD ["node", "apps/api/dist/main.js"]
