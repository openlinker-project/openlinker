# Carrier upstream stub (#3043, F15, epic #2840).
FROM node:22.23.1-alpine3.24

WORKDIR /app
COPY server.mjs ./server.mjs

ARG STUB_GIT_SHA=unknown
ENV STUB_GIT_SHA=${STUB_GIT_SHA}

ENV STUB_PORT=19086
EXPOSE 19086

HEALTHCHECK --interval=5s --timeout=3s --start-period=2s --retries=5 \
  CMD wget -q -O - "http://127.0.0.1:${STUB_PORT}/__stub/health" || exit 1

CMD ["node", "server.mjs"]
