# Allegro upstream stub (#2856).
#
# Pinned to the exact base image tag the repo's root Dockerfile uses for its
# `base` / `production` / `worker` stages, so this container is built from
# the same node runtime as everything else in the stand.
FROM node:22.23.1-alpine3.24

# Nothing besides the node runtime is installed: server.mjs has zero
# dependencies (node:http, node:crypto, node:url only), so there is no
# install step and no package.json - see server.mjs's own header comment
# for why this directory is deliberately not a pnpm workspace member.
WORKDIR /app
COPY server.mjs ./server.mjs

# Surfaced back through GET /__stub/config, so a run manifest can record
# exactly which stub build a measurement was taken against
# (#2856 Build Specification "The stub's git sha for the manifest").
ARG STUB_GIT_SHA=unknown
ENV STUB_GIT_SHA=${STUB_GIT_SHA}

ENV STUB_PORT=8080
EXPOSE 8080

# busybox wget ships in the alpine base image, so no extra package is
# needed for a compose healthcheck to hit the control surface.
HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 \
  CMD wget -q -O - "http://127.0.0.1:${STUB_PORT}/__stub/health" || exit 1

CMD ["node", "server.mjs"]
