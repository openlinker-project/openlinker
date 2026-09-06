#!/usr/bin/env bash
#
# One-shot self-signed cert for the `lab` stand's `wc-tls` proxy (#2854).
#
# WooCommerce's REST API refuses Basic Auth over what it believes is
# cleartext (query-string auth and Basic auth both require is_ssl()==true),
# and OpenLinker's WooCommerce connection config DTO independently rejects a
# non-https `siteUrl` (@IsUrl({ protocols: ['https'] })) - see
# docs/operations/perf-lab-stand.md. So the lab stand needs an internal TLS
# terminator in front of the plain-HTTP WooCommerce container, and OL's own
# outbound TLS client (Node/undici) needs to trust whatever CA signed that
# terminator's cert, or every request 502s with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
#
# This script generates BOTH ends of that trust relationship once, on the
# host, before `docker compose up` - not baked into an image build, so
# nothing here needs a `docker build` (the whole point of this stand is
# reusing the already-built ol-perf:api/worker images without a rebuild).
# `docker-compose.lab.yml` bind-mounts the three output files:
#   - server.crt / server.key -> the wc-tls nginx container
#   - ca.pem (== server.crt, self-signed)  -> api + worker, via
#     NODE_EXTRA_CA_CERTS, so Node's TLS trusts this one CA rather than
#     disabling certificate validation stack-wide (NODE_TLS_REJECT_UNAUTHORIZED=0,
#     the #2590 campaign's workaround, would also blind the process to a
#     real MITM on every OTHER outbound HTTPS call it makes).
#
# Idempotent-ish: re-running overwrites the files. Safe to re-run any time
# the stand is torn down and rebuilt - a stale cert would just fail the next
# `docker compose up`'s connection test loudly, not silently.
#
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "$DIR"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$DIR/server.key" -out "$DIR/server.crt" \
  -subj "/CN=wc-tls" -addext "subjectAltName=DNS:wc-tls" \
  2>/dev/null

cp "$DIR/server.crt" "$DIR/ca.pem"

echo "wrote $DIR/server.key, $DIR/server.crt, $DIR/ca.pem"
