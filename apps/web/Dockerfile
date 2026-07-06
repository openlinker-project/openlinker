# OpenLinker Web (admin SPA) — static production build served by nginx.
#
# Build from the REPO ROOT so the pnpm workspace manifests and the shared
# tsconfig.base.json (extended by apps/web/tsconfig.json) are in the context:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_BASE_URL=http://localhost:3000 .
#
# VITE_API_BASE_URL is a BUILD-TIME input (Vite bakes it into the bundle —
# see docs/frontend-architecture.md § Runtime Configuration). It must point
# at the API origin reachable from the operator's BROWSER, not from inside
# the Docker network.
FROM node:20-alpine AS build

RUN npm install -g pnpm@9

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

RUN pnpm --filter @openlinker/web build

# Runtime stage — plain nginx serving the static bundle.
FROM nginx:alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
