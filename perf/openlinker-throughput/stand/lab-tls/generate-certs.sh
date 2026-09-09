#!/usr/bin/env bash
#
# One-shot self-signed certs for the `lab` stand's TWO NEW TLS-fronted stubs
# (#3043): `eparagony-stub-tls` and `erli-stub-tls`. Extends the `wc-tls`
# precedent (#2854, `stand/wc-tls/generate-certs.sh`) rather than duplicating
# it - `EparagonyHttpClient` and `ErliHttpClient` both refuse a non-https
# base URL, so both real adapters need a TLS terminator in front of their
# stub, exactly as WooCommerce's REST API did.
#
# The two are generated together and folded into ONE combined CA bundle
# alongside wc-tls's own `ca.pem`, because `NODE_EXTRA_CA_CERTS` accepts
# exactly one file path - a file that may itself hold several concatenated
# PEM certificates. `docker-compose.lab.yml`'s api/worker services mount
# `bundle.pem` (built here) at the SAME path `wc-tls-ca.pem` used to occupy,
# so trusting three lab CAs costs nothing beyond running this script before
# `wc-tls/generate-certs.sh` has already run (or after - order does not
# matter, both write independent files and this script only READS wc-tls's
# `ca.pem`, never regenerates it).
#
# Run this BEFORE `docker compose up`, same as `wc-tls/generate-certs.sh`.
#
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$DIR/certs"
WC_TLS_CA="$DIR/../wc-tls/certs/ca.pem"
mkdir -p "$CERTS_DIR"

gen_cert() {
  local name="$1" san="$2"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$CERTS_DIR/${name}.key" -out "$CERTS_DIR/${name}.crt" \
    -subj "/CN=${name}" -addext "subjectAltName=DNS:${san}" \
    2>/dev/null
  cp "$CERTS_DIR/${name}.crt" "$CERTS_DIR/${name}-ca.pem"
}

# eparagony-stub-tls: the TLS FRONT's own container name is the hostname the
# connection's apiBaseUrl/authBaseUrl point at - deliberately NOT the bare
# "eparagony-stub" the plain-HTTP backend (container_name: lab-eparagony-stub)
# already answers to. Docker's embedded DNS resolves "eparagony-stub" to
# THAT container regardless of what this cert's SAN claims, so an https
# request there would reach a listener with nothing on port 443 - found
# live. No allowlist to satisfy (unlike Erli below), so a plain
# container-name SAN is enough once it names the right container.
gen_cert eparagony-stub-tls eparagony-stub-tls

# erli-stub: the SAN must match the NETWORK ALIAS `erli-stub.erli.dev`
# declared on the erli-stub-tls service in docker-compose.lab.yml - see
# stubs/erli/README.md "Why a network alias, not a bare hostname" for why
# that alias (not the bare service name) is what `isAllowedErliBaseUrl`
# requires config.baseUrl to resolve to.
gen_cert erli-stub erli-stub.erli.dev

if [ ! -f "$WC_TLS_CA" ]; then
  echo "warning: $WC_TLS_CA not found - run stand/wc-tls/generate-certs.sh first for a complete bundle" >&2
  cat "$CERTS_DIR/eparagony-stub-tls-ca.pem" "$CERTS_DIR/erli-stub-ca.pem" > "$CERTS_DIR/bundle.pem"
else
  cat "$WC_TLS_CA" "$CERTS_DIR/eparagony-stub-tls-ca.pem" "$CERTS_DIR/erli-stub-ca.pem" > "$CERTS_DIR/bundle.pem"
fi

echo "wrote $CERTS_DIR/{eparagony-stub,erli-stub}.{key,crt}, $CERTS_DIR/bundle.pem"
