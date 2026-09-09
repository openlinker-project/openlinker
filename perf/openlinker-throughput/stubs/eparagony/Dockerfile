# eparagony.pl upstream stub (#3043, F14, epic #2840).
#
# Pinned to the exact base image tag the repo's root Dockerfile uses,
# matching stubs/allegro/Dockerfile and stubs/invoicing/Dockerfile.
FROM node:22.23.1-alpine3.24

# Zero dependencies (node:http/crypto/url only) - no install step, no
# package.json, deliberately not a pnpm workspace member (stubs/allegro's
# rationale).
WORKDIR /app
COPY server.mjs ./server.mjs

ARG STUB_GIT_SHA=unknown
ENV STUB_GIT_SHA=${STUB_GIT_SHA}

ENV STUB_PORT=19084
EXPOSE 19084

HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 \
  CMD wget -q -O - "http://127.0.0.1:${STUB_PORT}/__stub/health" || exit 1

CMD ["node", "server.mjs"]
