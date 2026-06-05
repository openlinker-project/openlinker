#!/bin/bash
# WooCommerce Dev Stack Seed Script
#
# Run explicitly via: pnpm dev:stack:seed-woocommerce
# (docker exec openlinker-woocommerce bash /docker-entrypoint-initdb.d/01-seed-wc-data.sh)
#
# Idempotent: safe to re-run; skips if WC-SHIRT-001 already exists.
# Credentials are reused across runs (file persisted on the volume).
#
# Auth: WC REST API over plain HTTP requires query-string auth
# (?consumer_key=ck_...&consumer_secret=cs_...) — HTTP Basic Auth is
# rejected by WC unless HTTPS is active.
# Key generation: direct DB insert via wp eval to avoid WC_Auth::create_keys()
# incompatibilities in WC 9+.
# JSON parsing: grep + cut only — bitnami/wordpress:latest (Photon OS) ships
# neither jq nor python3.
set -e

log() { echo "[WC seed] $*"; }

# Extract the first numeric "id" field from piped JSON.
json_first_id() { grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2; }

# Extract a named string field from piped JSON.
json_str_field() { grep -oE "\"$1\":\"[^\"]+\"" | head -1 | cut -d'"' -f4; }

log "Waiting for WordPress core install..."
until wp core is-installed --allow-root --no-debug 2>/dev/null; do sleep 5; done

log "Waiting for WooCommerce class availability..."
until wp eval 'echo class_exists("WC_Auth") ? "ok" : "no";' \
    --allow-root --no-debug 2>/dev/null | grep -q "^ok$"; do sleep 5; done

# Activate HPOS
wp option update woocommerce_feature_hpos_enabled yes --allow-root --no-debug
log "HPOS activated."

# API credentials — reuse from volume if already created, otherwise generate fresh.
CREDS_FILE="/bitnami/wordpress/.dev-secrets/woocommerce-credentials.json"
mkdir -p /bitnami/wordpress/.dev-secrets

if [ -f "$CREDS_FILE" ]; then
  log "Re-using existing API credentials."
  cp "$CREDS_FILE" /tmp/wc-creds.json
else
  # Direct DB insert — bypasses WC_Auth::create_keys() which is unreliable in WC 9+
  # and requires a web request context. hash_hmac("sha256", key, "wc-api") is the
  # same hash WooCommerce uses in wc_api_hash().
  wp eval '
    $ck = "ck_" . bin2hex(random_bytes(20));
    $cs = "cs_" . bin2hex(random_bytes(20));
    global $wpdb;
    $wpdb->insert(
      $wpdb->prefix . "woocommerce_api_keys",
      [
        "user_id"         => 1,
        "description"     => "OL Dev Key",
        "permissions"     => "read_write",
        "consumer_key"    => hash_hmac("sha256", $ck, "wc-api"),
        "consumer_secret" => $cs,
        "truncated_key"   => substr($ck, -7),
      ]
    );
    echo json_encode(["consumer_key" => $ck, "consumer_secret" => $cs]);
  ' --allow-root --no-debug 2>/dev/null | tail -1 > /tmp/wc-creds.json
  cp /tmp/wc-creds.json "$CREDS_FILE"
  log "API key created and saved."
fi

log "Credentials written to: $CREDS_FILE"
log "Run: pnpm dev:stack:wc-credentials  to view them on the host."

CONSUMER_KEY=$(json_str_field consumer_key < /tmp/wc-creds.json)
CONSUMER_SECRET=$(json_str_field consumer_secret < /tmp/wc-creds.json)
BASE_URL="http://localhost:8080"
QS="consumer_key=${CONSUMER_KEY}&consumer_secret=${CONSUMER_SECRET}"

# Idempotency guard
EXISTING_SHIRT=$(curl -s "${BASE_URL}/wp-json/wc/v3/products?sku=WC-SHIRT-001&${QS}" | json_first_id)
if [ -n "$EXISTING_SHIRT" ]; then
  log "Seed data already present (WC-SHIRT-001 id=$EXISTING_SHIRT). Skipping."
  exit 0
fi

# DRY helper: WC REST POST with query-string auth (required for HTTP, not HTTPS)
wc_post() {
  curl -s -X POST "${BASE_URL}/wp-json/wc/v3${1}?${QS}" \
    -H "Content-Type: application/json" \
    -d "$2"
}

# Get-or-create "Clothing" category.
# On duplicate WC returns: {"code":"term_exists","data":{"status":400,"term_id":N}}
CATEGORY_RESP=$(wc_post '/products/categories' '{"name":"Clothing"}')
CATEGORY_ID=$(echo "$CATEGORY_RESP" | json_first_id)
if [ -z "$CATEGORY_ID" ]; then
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
  log "ERROR: failed to create WC-SHIRT-001. Response: $SHIRT_RESP"; exit 1
fi
log "Simple product WC-SHIRT-001 created (id=$SHIRT_ID, stock=50)."

# Variable product
JEANS_RESP=$(wc_post '/products' \
  "{\"name\":\"OL Test Jeans\",\"sku\":\"WC-JEANS\",\"type\":\"variable\",\"categories\":[{\"id\":$CATEGORY_ID}],\"attributes\":[{\"name\":\"Size\",\"options\":[\"S\",\"M\"],\"variation\":true,\"visible\":true}]}")
JEANS_ID=$(echo "$JEANS_RESP" | json_first_id)
if [ -z "$JEANS_ID" ]; then
  log "ERROR: failed to create WC-JEANS. Response: $JEANS_RESP"; exit 1
fi

VARS_RESP=$(wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-S","regular_price":"79.99","manage_stock":true,"stock_quantity":30,"attributes":[{"name":"Size","option":"S"}]}')
VARS_ID=$(echo "$VARS_RESP" | json_first_id)
if [ -z "$VARS_ID" ]; then
  log "ERROR: failed to create WC-JEANS-S. Response: $VARS_RESP"; exit 1
fi

VARM_RESP=$(wc_post "/products/$JEANS_ID/variations" \
  '{"sku":"WC-JEANS-M","regular_price":"79.99","manage_stock":true,"stock_quantity":20,"attributes":[{"name":"Size","option":"M"}]}')
VARM_ID=$(echo "$VARM_RESP" | json_first_id)
if [ -z "$VARM_ID" ]; then
  log "ERROR: failed to create WC-JEANS-M. Response: $VARM_RESP"; exit 1
fi

log "Variable product WC-JEANS id=$JEANS_ID (S id=$VARS_ID stock=30, M id=$VARM_ID stock=20)."
log "Seed complete. WC admin: http://localhost:8082/wp-admin (admin / admin123)."
