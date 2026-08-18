FROM node:22.23.1-alpine3.24 AS base

# Install pnpm — pinned to match the repo's packageManager field (package.json)
# so the Docker build resolves the exact same pnpm release as local dev/CI.
RUN npm install -g pnpm@10.33.4

# bash: the repo's `migration:run` script (apps/api/package.json) invokes the
# typeorm CLI via `bash`, which Alpine does not ship by default. The demo's
# one-shot `migrate` service runs from this stage, so it needs bash present.
RUN apk add --no-cache bash

# Set working directory
WORKDIR /app

# Copy package files and configuration
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY pnpm-lock.yaml* ./
# NOTE: this list is hand-enumerated to match every `@openlinker/*` entry in
# apps/api/package.json + apps/worker/package.json ("workspace:*" deps). A new
# plugin package MUST be added here (and to the matching --from=base COPY dist
# lists below) or `pnpm install` fails to resolve its "workspace:*" reference
# and the image build breaks (the #1365 review class of bug, cf. #916/#917).
# `docker build --target base .` in CI (see .github/workflows/ci.yml) catches
# a missed addition immediately.
COPY apps/api/package.json ./apps/api/
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/
COPY libs/test-kit/package.json ./libs/test-kit/
COPY libs/integrations/ai/package.json ./libs/integrations/ai/
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/
COPY libs/integrations/eparagony/package.json ./libs/integrations/eparagony/
COPY libs/integrations/erli/package.json ./libs/integrations/erli/
COPY libs/integrations/fx/package.json ./libs/integrations/fx/
COPY libs/integrations/infakt/package.json ./libs/integrations/infakt/
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/
COPY libs/integrations/ksef/package.json ./libs/integrations/ksef/
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

# Install dependencies
# pnpm-lock.yaml ensures consistent dependency resolution
RUN pnpm install

# Copy source code (this will include pnpm-lock.yaml if it exists)
COPY . .

# Build application
RUN pnpm build

# Drop root (#1411): the `migrate` service (docker-compose.demo.yml) runs
# straight from this stage, so it must not execute as root either. The
# `node` user/group (uid/gid 1000) ships built into the official node image —
# chowning once at the end (after every root-owned install/build step) avoids
# permission churn earlier in the layer chain.
RUN chown -R node:node /app
USER node

# Production stage
FROM node:22.23.1-alpine3.24 AS production

WORKDIR /app

# Copy package files
# NOTE: same enumerated list as the `base` stage above — keep both in sync
# with apps/api/package.json + apps/worker/package.json.
COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY libs/core/package.json ./libs/core/
COPY libs/shared/package.json ./libs/shared/
COPY libs/plugin-sdk/package.json ./libs/plugin-sdk/
COPY libs/test-kit/package.json ./libs/test-kit/
COPY libs/integrations/ai/package.json ./libs/integrations/ai/
COPY libs/integrations/allegro/package.json ./libs/integrations/allegro/
COPY libs/integrations/dpd-polska/package.json ./libs/integrations/dpd-polska/
COPY libs/integrations/eparagony/package.json ./libs/integrations/eparagony/
COPY libs/integrations/erli/package.json ./libs/integrations/erli/
COPY libs/integrations/fx/package.json ./libs/integrations/fx/
COPY libs/integrations/infakt/package.json ./libs/integrations/infakt/
COPY libs/integrations/inpost/package.json ./libs/integrations/inpost/
COPY libs/integrations/ksef/package.json ./libs/integrations/ksef/
COPY libs/integrations/prestashop/package.json ./libs/integrations/prestashop/
COPY libs/integrations/subiekt/package.json ./libs/integrations/subiekt/
COPY libs/integrations/woocommerce/package.json ./libs/integrations/woocommerce/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/

# Install production dependencies only
# Skip prepare scripts to avoid husky installation in Docker
#
# The trailing `chown` is folded into THIS layer on purpose (#1411): it covers
# the manifest COPYs above plus everything `pnpm install` just wrote, and
# because the files are created and chowned in the same layer no duplicate
# copy is stored. Every later COPY uses `--chown=node:node` instead, so no
# stage needs a standalone `RUN chown -R /app` (which would re-write the whole
# tree — node_modules included — into a fresh layer of the final image).
RUN npm install -g pnpm@10.33.4 && \
    pnpm install --prod --ignore-scripts && \
    chown -R node:node /app

# Copy built application and dependencies
# NOTE: same enumerated package set as the `base` stage's manifest COPY list
# above — add a plugin's dist here whenever it's added there.
COPY --from=base --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=base --chown=node:node /app/libs/core/dist ./libs/core/dist
COPY --from=base --chown=node:node /app/libs/shared/dist ./libs/shared/dist
COPY --from=base --chown=node:node /app/libs/plugin-sdk/dist ./libs/plugin-sdk/dist
COPY --from=base --chown=node:node /app/libs/integrations/ai/dist ./libs/integrations/ai/dist
COPY --from=base --chown=node:node /app/libs/integrations/allegro/dist ./libs/integrations/allegro/dist
COPY --from=base --chown=node:node /app/libs/integrations/dpd-polska/dist ./libs/integrations/dpd-polska/dist
COPY --from=base --chown=node:node /app/libs/integrations/eparagony/dist ./libs/integrations/eparagony/dist
COPY --from=base --chown=node:node /app/libs/integrations/erli/dist ./libs/integrations/erli/dist
COPY --from=base --chown=node:node /app/libs/integrations/fx/dist ./libs/integrations/fx/dist
COPY --from=base --chown=node:node /app/libs/integrations/infakt/dist ./libs/integrations/infakt/dist
COPY --from=base --chown=node:node /app/libs/integrations/inpost/dist ./libs/integrations/inpost/dist
COPY --from=base --chown=node:node /app/libs/integrations/ksef/dist ./libs/integrations/ksef/dist
COPY --from=base --chown=node:node /app/libs/integrations/prestashop/dist ./libs/integrations/prestashop/dist
COPY --from=base --chown=node:node /app/libs/integrations/subiekt/dist ./libs/integrations/subiekt/dist
COPY --from=base --chown=node:node /app/libs/integrations/woocommerce/dist ./libs/integrations/woocommerce/dist
COPY --from=base --chown=node:node /app/node_modules ./node_modules
COPY --from=base --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=base --chown=node:node /app/libs/core/node_modules ./libs/core/node_modules
COPY --from=base --chown=node:node /app/libs/shared/node_modules ./libs/shared/node_modules

# Drop root (#1411) — same rationale as the `base` stage above. Ownership is
# already correct: the prod-install layer chowned what it created, and every
# `COPY --from=base` above carries `--chown=node:node`.
USER node

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "apps/api/dist/apps/api/src/main.js"]

# Worker stage — extends the production layer set (same libs dist + node_modules)
# with the worker's own compiled output and entrypoint. The worker exposes no
# HTTP surface (NestFactory.createApplicationContext), so no EXPOSE.
#
# This carries the full API image (apps/api/dist + its node_modules) that the
# worker never runs, plus a dev-inclusive worker install — accepted bloat for
# a demo overlay; a leaner dedicated worker base is a follow-up if this image
# is ever used outside the demo.
FROM production AS worker

# `production` already dropped to USER node, and that carries over here.
# COPY is executed by the builder itself (always as root, regardless of the
# active USER), so `--chown=node:node` sets the final ownership inline — no
# `USER root` round-trip and no extra `RUN chown` layer.
COPY --from=base --chown=node:node /app/apps/worker/dist ./apps/worker/dist
COPY --from=base --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules

CMD ["node", "apps/worker/dist/apps/worker/src/main.js"]
