#!/bin/bash
# WooCommerce Dev Stack Seed Script
#
# Run explicitly via: pnpm dev:stack:seed-woocommerce
# (docker exec openlinker-woocommerce bash /docker-entrypoint-initdb.d/01-seed-wc-data.sh)
#
# Idempotent: safe to re-run; skips product creation if WC-SHIRT-001 exists.
#
# Product seeding uses WC PHP API via wp eval — avoids all HTTP auth complexity.
# WooCommerce REST API over plain HTTP only allows OAuth 1.0a (not query-string
# or Basic Auth — those require is_ssl() = true). Calling WC PHP classes directly
# bypasses auth entirely and is far simpler for a dev seed script.
#
# API key (for OL connection) is created via direct wpdb insert — more reliable
# than WC_Auth::create_keys() in WC 9+ from WP-CLI context.
#
# JSON parsing: grep + cut only — bitnami/wordpress:latest ships neither jq nor python3.
set -e

log() { echo "[WC seed] $*"; }
json_str_field() { grep -oE "\"$1\":\"[^\"]+\"" | head -1 | cut -d'"' -f4; }

log "Waiting for WordPress core install..."
until wp core is-installed --allow-root --no-debug 2>/dev/null; do sleep 5; done

log "Waiting for WooCommerce class availability..."
until wp eval 'echo class_exists("WC_Product_Simple") ? "ok" : "no";' \
    --allow-root --no-debug 2>/dev/null | grep -q "^ok$"; do sleep 5; done

wp option update woocommerce_feature_hpos_enabled yes --allow-root --no-debug
log "HPOS activated."

# API credentials for OL connection — direct DB insert, reliable across WC versions.
# wc_api_hash() = hash_hmac('sha256', $key, 'wc-api')
log "Generating API key..."
wp eval '
  $ck = "ck_" . bin2hex(random_bytes(20));
  $cs = "cs_" . bin2hex(random_bytes(20));
  global $wpdb;
  $ok = $wpdb->insert(
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
  if (!$ok) { fwrite(STDERR, "DB insert failed: " . $wpdb->last_error . "\n"); exit(1); }
  echo json_encode(["consumer_key" => $ck, "consumer_secret" => $cs]);
' --allow-root --no-debug 2>/dev/null | tail -1 > /tmp/wc-creds.json

mkdir -p /bitnami/wordpress/.dev-secrets
cp /tmp/wc-creds.json /bitnami/wordpress/.dev-secrets/woocommerce-credentials.json
log "API key saved. Run: pnpm dev:stack:wc-credentials  to view on the host."

# Idempotency: check via WC PHP API (no HTTP auth needed)
EXISTING=$(wp eval '
  $p = wc_get_products(["sku" => "WC-SHIRT-001", "limit" => 1]);
  echo $p ? $p[0]->get_id() : "";
' --allow-root --no-debug 2>/dev/null | tail -1)

# Products and orders have independent idempotency guards so that re-running
# the script on an instance seeded before orders were added still creates them.
if [ -n "$EXISTING" ]; then
  log "Products already present (WC-SHIRT-001 id=$EXISTING). Skipping product creation."
  SHIRT_ID=$EXISTING
  # type=variation is required — wc_get_products() excludes variations by default.
  VARS_ID=$(wp eval '
    $p = wc_get_products(["sku" => "WC-JEANS-S", "limit" => 1, "type" => "variation"]);
    echo $p ? $p[0]->get_id() : "";
  ' --allow-root --no-debug 2>/dev/null | tail -1)
  if [ -z "$VARS_ID" ]; then
    log "ERROR: could not resolve WC-JEANS-S variation id"; exit 1
  fi
else

# Get-or-create "Clothing" category via WP taxonomy API
log "Creating category..."
CATEGORY_ID=$(wp eval '
  $existing = term_exists("Clothing", "product_cat");
  if ($existing) {
    echo is_array($existing) ? $existing["term_id"] : $existing;
  } else {
    $term = wp_insert_term("Clothing", "product_cat");
    echo is_wp_error($term) ? "" : $term["term_id"];
  }
' --allow-root --no-debug 2>/dev/null | tail -1)

if [ -z "$CATEGORY_ID" ]; then
  log "ERROR: failed to get or create Clothing category"; exit 1
fi
log "Category 'Clothing' id=$CATEGORY_ID"

# Simple product via WC PHP API
SHIRT_ID=$(wp eval "
  \$p = new WC_Product_Simple();
  \$p->set_name('OL Test Shirt');
  \$p->set_sku('WC-SHIRT-001');
  \$p->set_regular_price('49.99');
  \$p->set_manage_stock(true);
  \$p->set_stock_quantity(50);
  \$p->set_category_ids([$CATEGORY_ID]);
  \$p->set_status('publish');
  echo \$p->save();
" --allow-root --no-debug 2>/dev/null | tail -1)

if [ -z "$SHIRT_ID" ] || [ "$SHIRT_ID" = "0" ]; then
  log "ERROR: failed to create WC-SHIRT-001"; exit 1
fi
log "Simple product WC-SHIRT-001 id=$SHIRT_ID (stock=50)."

# Variable product
JEANS_ID=$(wp eval "
  \$attr = new WC_Product_Attribute();
  \$attr->set_name('Size');
  \$attr->set_options(['S', 'M']);
  \$attr->set_variation(true);
  \$attr->set_visible(true);

  \$p = new WC_Product_Variable();
  \$p->set_name('OL Test Jeans');
  \$p->set_sku('WC-JEANS');
  \$p->set_category_ids([$CATEGORY_ID]);
  \$p->set_attributes([\$attr]);
  \$p->set_status('publish');
  echo \$p->save();
" --allow-root --no-debug 2>/dev/null | tail -1)

if [ -z "$JEANS_ID" ] || [ "$JEANS_ID" = "0" ]; then
  log "ERROR: failed to create WC-JEANS"; exit 1
fi

# Variations
VARS_ID=$(wp eval "
  \$v = new WC_Product_Variation();
  \$v->set_parent_id($JEANS_ID);
  \$v->set_sku('WC-JEANS-S');
  \$v->set_regular_price('79.99');
  \$v->set_manage_stock(true);
  \$v->set_stock_quantity(30);
  \$v->set_attributes(['size' => 'S']);
  \$v->set_status('publish');
  echo \$v->save();
" --allow-root --no-debug 2>/dev/null | tail -1)

if [ -z "$VARS_ID" ] || [ "$VARS_ID" = "0" ]; then
  log "ERROR: failed to create WC-JEANS-S variation"; exit 1
fi

VARM_ID=$(wp eval "
  \$v = new WC_Product_Variation();
  \$v->set_parent_id($JEANS_ID);
  \$v->set_sku('WC-JEANS-M');
  \$v->set_regular_price('79.99');
  \$v->set_manage_stock(true);
  \$v->set_stock_quantity(20);
  \$v->set_attributes(['size' => 'M']);
  \$v->set_status('publish');
  echo \$v->save();
" --allow-root --no-debug 2>/dev/null | tail -1)

if [ -z "$VARM_ID" ] || [ "$VARM_ID" = "0" ]; then
  log "ERROR: failed to create WC-JEANS-M variation"; exit 1
fi

log "Variable product WC-JEANS id=$JEANS_ID (S id=$VARS_ID stock=30, M id=$VARM_ID stock=20)."
fi

# Sample orders — give OL's OrderSource ingestion (modified_after polling) a feed
# to read, and make the WC admin look like a live shop. Guarded separately from
# products (see above).
ORDERS_EXIST=$(wp eval '
  $o = wc_get_orders(["billing_email" => "jan.kowalski@example.com", "limit" => 1]);
  echo $o ? $o[0]->get_id() : "";
' --allow-root --no-debug 2>/dev/null | tail -1)

if [ -n "$ORDERS_EXIST" ]; then
  log "Sample orders already present (order id=$ORDERS_EXIST). Skipping order creation."
else
  ORDER1_ID=$(wp eval "
    \$addr = [
      'first_name' => 'Jan', 'last_name' => 'Kowalski',
      'email' => 'jan.kowalski@example.com', 'phone' => '+48600100200',
      'address_1' => 'ul. Testowa 1', 'city' => 'Warszawa',
      'postcode' => '00-001', 'country' => 'PL',
    ];
    \$order = wc_create_order();
    \$order->add_product(wc_get_product($SHIRT_ID), 2);
    \$order->set_address(\$addr, 'billing');
    \$order->set_address(\$addr, 'shipping');
    \$order->set_payment_method('cod');
    \$order->set_payment_method_title('Cash on delivery');
    \$order->calculate_totals();
    \$order->update_status('processing', 'OL dev seed');
    echo \$order->get_id();
  " --allow-root --no-debug 2>/dev/null | tail -1)

  if [ -z "$ORDER1_ID" ] || [ "$ORDER1_ID" = "0" ]; then
    log "ERROR: failed to create sample order 1"; exit 1
  fi
  log "Order #$ORDER1_ID created (2x WC-SHIRT-001, processing, jan.kowalski@example.com)."

  ORDER2_ID=$(wp eval "
    \$addr = [
      'first_name' => 'Anna', 'last_name' => 'Nowak',
      'email' => 'anna.nowak@example.com', 'phone' => '+48600300400',
      'address_1' => 'ul. Przykladowa 7', 'city' => 'Krakow',
      'postcode' => '30-001', 'country' => 'PL',
    ];
    \$order = wc_create_order();
    \$order->add_product(wc_get_product($VARS_ID), 1);
    \$order->set_address(\$addr, 'billing');
    \$order->set_address(\$addr, 'shipping');
    \$order->set_payment_method('bacs');
    \$order->set_payment_method_title('Bank transfer');
    \$order->calculate_totals();
    \$order->update_status('completed', 'OL dev seed');
    echo \$order->get_id();
  " --allow-root --no-debug 2>/dev/null | tail -1)

  if [ -z "$ORDER2_ID" ] || [ "$ORDER2_ID" = "0" ]; then
    log "ERROR: failed to create sample order 2"; exit 1
  fi
  log "Order #$ORDER2_ID created (1x WC-JEANS-S, completed, anna.nowak@example.com)."
fi

log "Seed complete. WC admin: http://localhost:8082/wp-admin (admin / admin123)."
