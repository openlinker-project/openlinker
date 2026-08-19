# OpenLinker Web (admin SPA) — static production build served by nginx.
#
# Build from the REPO ROOT so the pnpm workspace manifests and the shared
# tsconfig.base.json (extended by apps/web/tsconfig.json) are in the context:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_BASE_URL=http://localhost:3000 .
#
# Every VITE_* below is a BUILD-TIME input (Vite bakes it into the bundle —
# see docs/frontend-architecture.md § Runtime Configuration), so each one
# needs an explicit ARG here: root .dockerignore excludes `.env.*`, meaning
# no env FILE ever reaches this build and `--build-arg` is the only channel.
#
# VITE_API_BASE_URL must point at the API origin reachable from the
# operator's BROWSER, not from inside the Docker network.
#
# The VITE_OG_* trio drives the Open Graph / Twitter share card (#2174) and
# is what makes a demo deployment's links visually distinguishable from
# production's. All three default to empty, which yields the plain
# production card — see apps/web/.env.example.
FROM node:22.23.1-alpine3.24 AS build

# Pinned to match the repo's packageManager field (package.json).
RUN npm install -g pnpm@10.33.4

WORKDIR /app

# Workspace manifests + the shared tsconfig the web tsconfig extends.
# @openlinker/web has no workspace dependencies, so only its own
# package.json is needed for install resolution.
COPY package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/

# Only apps/web is present as a workspace member (it has no @openlinker/*
# deps), so the workspace here is a strict subset of the lockfile's importer
# set. --no-frozen-lockfile lets pnpm resolve that subset instead of erroring;
# without it a CI=true build (pnpm auto-enables --frozen-lockfile) would fail.
# --ignore-scripts: skips the root husky `prepare` hook (not needed in Docker).
RUN pnpm install --no-frozen-lockfile --ignore-scripts

COPY apps/web ./apps/web

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

ARG VITE_OG_TITLE_PREFIX=
ENV VITE_OG_TITLE_PREFIX=$VITE_OG_TITLE_PREFIX
ARG VITE_OG_BADGE_TEXT=
ENV VITE_OG_BADGE_TEXT=$VITE_OG_BADGE_TEXT
ARG VITE_OG_SITE_URL=
ENV VITE_OG_SITE_URL=$VITE_OG_SITE_URL

RUN pnpm --filter @openlinker/web build

# Runtime stage — nginx serving the static bundle, as a non-root user (#1411).
# nginxinc/nginx-unprivileged is the official image built for exactly this:
# it already runs as uid 101 (nginx) and listens on 8080 instead of the
# privileged port 80 — see apps/web/nginx.conf, which listens on 8080 to match.
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
