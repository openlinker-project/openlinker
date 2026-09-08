# PrestaShop fault-injection proxy (#2978).
#
# Same base tag as the Allegro stub next door and as the repo's root
# Dockerfile, so every process on the `lab` stand runs one node runtime.
FROM node:22.23.1-alpine3.24

# Zero dependencies (node:http / node:crypto only) - no package.json, no
# install step. See server.mjs's header for what this container is for.
WORKDIR /app
COPY server.mjs ./server.mjs

# Surfaced through GET /__fault/health so a run manifest records which proxy
# build the measurement was taken against.
ARG PROXY_GIT_SHA=unknown
ENV PROXY_GIT_SHA=${PROXY_GIT_SHA}

ENV PROXY_PORT=8080
ENV PROXY_UPSTREAM_HOST=prestashop
ENV PROXY_UPSTREAM_PORT=80
EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 \
  CMD wget -q -O - "http://127.0.0.1:${PROXY_PORT}/__fault/health" || exit 1

CMD ["node", "server.mjs"]
