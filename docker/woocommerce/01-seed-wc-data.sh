#!/bin/bash
# WooCommerce Dev Stack Seed Script
#
# Run explicitly via: pnpm dev:stack:seed-woocommerce
# (docker exec openlinker-woocommerce bash /docker-entrypoint-initdb.d/01-seed-wc-data.sh)
#
# NOTE: bitnami/wordpress does NOT auto-run scripts from /docker-entrypoint-initdb.d/
# on container restart — only on the very first run of a fresh volume. This script
# must be invoked manually via the pnpm command above after container startup.
#
# Creates WC REST API credentials, activates HPOS, and seeds sample products used
# for local development.
#
# Idempotent: checks for WC-SHIRT-001 before seeding; safe to re-run via
# `pnpm dev:stack:seed-woocommerce` without duplicating data.
#
# JSON parsing uses grep + cut — no jq or python3 required (bitnami/wordpress:latest
# ships neither; it is based on Photon OS with a minimal toolset).
set -e

log() { echo "[WC seed] $*"; }

# Extract the first numeric "id" field from a JSON string.
# Works for both success responses {"id":N,...} and passes through to term_id fallback.
json_first_id() {
  grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2
}

# Extract a string value from flat JSON passed via stdin.
# Usage: json_str_field KEY <<< "$JSON"
json_str_field() {
  grep -oE "\"$1\":\"[^\"]+\"" | head -1 | cut -d'"' -f4
}

log "Waiting for WordPress core install..."
until wp core is-installed --allow-root --no-debug 2>/dev/null; do sleep 5; done

log "Waiting for WooCommerce class availability..."
until wp eval 'echo class_exists("WC_Auth") ? "ok" : "no";' \
    --allow-root --no-debug 2>/dev/null | grep -q "^ok$"; do sleep 5; done

# Activate HPOS (High-Performance Order Storage — v1 requirement per spec §6)
wp option update woocommerce_feature_hpos_enabled yes --allow-root --no-debug
log "HPOS activated."

# Generate WC REST API key.
# --no-debug + stderr redirect prevent PHP notices contaminating stdout.
# tail -1: WP-CLI may emit progress lines before the JSON — take last line only.
wp eval \
  'echo json_encode((new WC_Auth)->create_keys("OL Dev Key", 1, "read_write"));' \
  --allow-root --no-debug 2>/dev/null \
  | tail -1 > /tmp/wc-creds.json

mkdir -p /bitnami/wordpress/.dev-secrets
cp /tmp/wc-creds.json /bitnami/wordpress/.dev-secrets/woocommerce-credentials.json
log "Consumer key written to volume:.dev-secrets/woocommerce-credentials.json"
log "Run: pnpm dev:stack:wc-credentials  to view credentials on the host."

# Parse credentials with grep+cut (no jq or python3 needed)
CONSUMER_KEY=$(json_str_field consumer_key < /tmp/wc-creds.json)
CONSUMER_SECRET=$(json_str_field consumer_secret < /tmp/wc-creds.json)

BASE_URL="http://localhost:8080"
AUTH="$CONSUMER_KEY:$CONSUMER_SECRET"

# Idempotency guard — skip if WC-SHIRT-001 already exists
EXISTING_SHIRT=$(curl -s -u "$AUTH" "$BASE_URL/wp-json/wc/v3/products?sku=WC-SHIRT-001" \
  | json_first_id)
if [ -n "$EXISTING_SHIRT" ]; then
  log "Seed data already present (WC-SHIRT-001 id=$EXISTING_SHIRT). Skipping."
  exit 0
fi

# DRY helper: WC REST POST — does NOT use -f so HTTP errors don't abort the script;
# callers validate the response themselves.
wc_post() {
  curl -s -u "$AUTH" -X POST "$BASE_URL/wp-json/wc/v3$1" \
    -H "Content-Type: application/json" \
    -d "$2"
}

# Get-or-create "Clothing" category.
# WC returns {"id":N,...} on success or
# {"code":"term_exists","data":{"status":400,"term_id":N}} on duplicate.
CATEGORY_RESP=$(wc_post '/products/categories' '{"name":"Clothing"}')
CATEGORY_ID=$(echo "$CATEGORY_RESP" | json_first_id)
if [ -z "$CATEGORY_ID" ]; then
  # "term_exists" error path — extract term_id from the data object
  CATEGORY_ID=$(echo "$CATEGORY_RESP" | grep -oE '"term_id":[0-9]+' | head -1 | cut -d: -f2)
fi
if [ -z "$CATEGORY_ID" ]; then
  log "ERROR: could not get or create 'Clothing' category. Response: $CATEGORY_RESP"
  exit 1
fi
log "Category 'Clothing' id=$CATEGORY_ID"

# Simple product
SHIRT_RESP=$(wc_post '/products' \
  "{\"name\":\"OL Test Shirt\",\"sku\":\"WC-SHIRT-001\",\"type\":\"simple\",\"regular_price\":\"49.99\",\"manage_stock\":true,\"stock_quantity\":50,\"categories\":[{\"id\":$CATEGORY_ID}]}")
SHIRT_ID=$(echo "$SHIRT_RESP" | json_first_id)
if [ -z "$SHIRT_ID" ]; then
  log "ERROR: failed to create WC-SHIRT-001. Response: $SHIRT_RESP"
  exit 1
fi
log "Simple product WC-SHIRT-001 created (id=$SHIRT_ID, stock=50)."

# Variable product
JEANS_RESP=$(wc_post '/products' \
  "{\"name\":\"OL Test Jeans\",\"sku\":\"WC-JEANS\",\"type\":\"variable\",\"categories\":[{\"id\":$CATEGORY_ID}],\"attributes\":[{\"name\":\"Size\",\"options\":[\"S\",\"M\"],\"variation\":true,\"visible\":true}]}")
JEANS_ID=$(echo "$JEANS_RESP" | json_first_id)
if [ -z "$JEANS_ID" ]; then
  log "ERROR: failed to create WC-JEANS. Response: $JEANS_RESP"
  exit 1
fi

# Variations
VARS_RESP=$(wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-S","regular_price":"79.99","manage_stock":true,"stock_quantity":30,"attributes":[{"name":"Size","option":"S"}]}')
VARS_ID=$(echo "$VARS_RESP" | json_first_id)
if [ -z "$VARS_ID" ]; then
  log "ERROR: failed to create WC-JEANS-S variation. Response: $VARS_RESP"
  exit 1
fi

VARM_RESP=$(wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-M","regular_price":"79.99","manage_stock":true,"stock_quantity":20,"attributes":[{"name":"Size","option":"M"}]}')
VARM_ID=$(echo "$VARM_RESP" | json_first_id)
if [ -z "$VARM_ID" ]; then
  log "ERROR: failed to create WC-JEANS-M variation. Response: $VARM_RESP"
  exit 1
fi

log "Variable product WC-JEANS id=$JEANS_ID (S id=$VARS_ID stock=30, M id=$VARM_ID stock=20) created."
log "Seed complete. Access WC at http://localhost:8082 (host) — admin/admin123."
