#!/bin/bash
# WooCommerce Dev Stack Seed Script
#
# Runs inside the openlinker-woocommerce container on first boot (mounted at
# /docker-entrypoint-initdb.d/). Creates WC REST API credentials, activates HPOS,
# and seeds sample products used for local development and integration tests.
#
# Idempotent: checks for WC-SHIRT-001 before seeding; safe to re-run via
# `pnpm dev:stack:seed-woocommerce` without duplicating data.
set -e

log() { echo "[WC seed] $*"; }

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

# Parse credentials via jq (bitnami/wordpress includes jq; python3 not guaranteed)
CONSUMER_KEY=$(jq -r '.consumer_key' /tmp/wc-creds.json)
CONSUMER_SECRET=$(jq -r '.consumer_secret' /tmp/wc-creds.json)

BASE_URL="http://localhost:8080"
AUTH="$CONSUMER_KEY:$CONSUMER_SECRET"

# Idempotency guard — skip if WC-SHIRT-001 already exists
EXISTING_SHIRT=$(curl -sf -u "$AUTH" "$BASE_URL/wp-json/wc/v3/products?sku=WC-SHIRT-001" \
  | jq -r '.[0].id // empty')
if [ -n "$EXISTING_SHIRT" ]; then
  log "Seed data already present (WC-SHIRT-001 id=$EXISTING_SHIRT). Skipping."
  exit 0
fi

# DRY helper: all WC REST POST calls share the same auth, base URL, content-type
wc_post() {
  # wc_post <path> <json-body> — returns response body; exits non-zero on HTTP error
  curl -sf -u "$AUTH" -X POST "$BASE_URL/wp-json/wc/v3$1" \
    -H "Content-Type: application/json" \
    -d "$2"
}

# Category
CATEGORY_ID=$(wc_post '/products/categories' '{"name":"Clothing"}' | jq -r '.id')
log "Category 'Clothing' id=$CATEGORY_ID"

# Simple product
wc_post '/products' \
  "{\"name\":\"OL Test Shirt\",\"sku\":\"WC-SHIRT-001\",\"type\":\"simple\",\"regular_price\":\"49.99\",\"manage_stock\":true,\"stock_quantity\":50,\"categories\":[{\"id\":$CATEGORY_ID}]}" \
  > /dev/null
log "Simple product WC-SHIRT-001 created (stock=50)."

# Variable product
JEANS_ID=$(wc_post '/products' \
  "{\"name\":\"OL Test Jeans\",\"sku\":\"WC-JEANS\",\"type\":\"variable\",\"categories\":[{\"id\":$CATEGORY_ID}],\"attributes\":[{\"name\":\"Size\",\"options\":[\"S\",\"M\"],\"variation\":true,\"visible\":true}]}" \
  | jq -r '.id')

# Variations — use wc_post for consistency (DRY)
wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-S","regular_price":"79.99","manage_stock":true,"stock_quantity":30,"attributes":[{"name":"Size","option":"S"}]}' \
  > /dev/null

wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-M","regular_price":"79.99","manage_stock":true,"stock_quantity":20,"attributes":[{"name":"Size","option":"M"}]}' \
  > /dev/null

log "Variable product WC-JEANS (S stock=30, M stock=20) created."
log "Seed complete. Access WC at http://localhost:8082 (host) — admin/admin123."
