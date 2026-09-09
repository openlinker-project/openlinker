#!/usr/bin/env bash
#
# Removes every row this seed family wrote, matching on the '${PREFIX}' tag
# alone (#2849 AC). Deliberately a STANDALONE script rather than a change to
# #2854's stand-down.sh - that script owns the whole stand's teardown and
# knows nothing about this seed's id shapes; this one only ever DELETEs rows
# this seed itself could have written.
#
# Order matters for the FK-carrying tables (product_variants/inventory_items
# -> products): children first.
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="seed-cleanup"

# Both guards run BEFORE any DELETE below. require_connections catches an
# unsourced stand-ids.env here rather than as an "unbound variable" crash
# after the destructive blocks below have already run (the WC-side block
# reads $WC_CONNECTION_ID unconditionally, past its own `if`); the confirm
# gate catches a plain accidental invocation of this whole script.
require_connections
require_cleanup_confirmed

log "deleting perfseed order_line_items"
pg_sql_write "DELETE FROM order_line_items WHERE \"orderRecordId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed order_records"
pg_sql_write "DELETE FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed sync_jobs"
pg_sql_write "DELETE FROM sync_jobs WHERE \"idempotencyKey\" LIKE '${PREFIX}:g%'" >/dev/null

log "deleting perfseed identifier_mappings (synthetic external ids)"
pg_sql_write "DELETE FROM identifier_mappings WHERE \"externalId\" LIKE '${PREFIX^^}-EXT-%'" >/dev/null

# seed-shop-catalogue.sh's mappings carry the SHOP's own external ids (a bare
# `id_product` / `id_product_attribute`), so no externalId pattern can find
# them - matching one would risk deleting a mapping this seed never wrote.
# They are identified by the prefix-tagged internalId instead, which keeps the
# "only rows this seed could have written" property intact.
log "deleting perfseed identifier_mappings (shop-aligned, matched on internalId)"
pg_sql_write "DELETE FROM identifier_mappings WHERE \"internalId\" LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed inventory_items"
pg_sql_write "DELETE FROM inventory_items WHERE id LIKE '${PREFIX}\\_inv\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed product_variants"
pg_sql_write "DELETE FROM product_variants WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed products"
pg_sql_write "DELETE FROM products WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'" >/dev/null

vacuum_analyze_reset order_records order_line_items sync_jobs identifier_mappings inventory_items product_variants products

# ---------------------------------------------------------------------------
# PrestaShop side (seed-shop-catalogue.sh). Matches ONLY the PERFSHOP-
# reference prefix, exactly as the OpenLinker half matches only the perfseed
# id prefix, so neither can reach the shop's own catalogue.
#
# Children before parents: ps_product_attribute_* key on the combination id,
# which stops resolving once ps_product_attribute is gone.
# ---------------------------------------------------------------------------
SHOP_PREFIX="PERFSHOP-"
SHOP_MATCHING="$(ps_sql "SELECT COUNT(*) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
log "deleting $SHOP_MATCHING PrestaShop product(s) carrying the ${SHOP_PREFIX} prefix"
if [ "${SHOP_MATCHING:-0}" != "0" ]; then
  ps_sql_write "
    CREATE TEMPORARY TABLE perf_del AS SELECT id_product FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%';
    CREATE TEMPORARY TABLE perf_del_pa AS SELECT id_product_attribute FROM ps_product_attribute WHERE reference LIKE '${SHOP_PREFIX}%';
    DELETE pac FROM ps_product_attribute_combination pac JOIN perf_del_pa d ON d.id_product_attribute = pac.id_product_attribute;
    DELETE pas FROM ps_product_attribute_shop pas JOIN perf_del_pa d ON d.id_product_attribute = pas.id_product_attribute;
    DELETE pa FROM ps_product_attribute pa JOIN perf_del_pa d ON d.id_product_attribute = pa.id_product_attribute;
    DELETE sa FROM ps_stock_available sa JOIN perf_del d ON d.id_product = sa.id_product;
    DELETE cp FROM ps_category_product cp JOIN perf_del d ON d.id_product = cp.id_product;
    DELETE pl FROM ps_product_lang pl JOIN perf_del d ON d.id_product = pl.id_product;
    DELETE psh FROM ps_product_shop psh JOIN perf_del d ON d.id_product = psh.id_product;
    DELETE p FROM ps_product p JOIN perf_del d ON d.id_product = p.id_product;
  "
fi
# The handback is a real table by necessity (two processes, two databases), so
# a seeder that died between writing and dropping it leaves one behind.
ps_sql "DROP TABLE IF EXISTS perf_shop_handback" >/dev/null
pg_sql_write "DROP TABLE IF EXISTS perf_shop_handback" >/dev/null

SHOP_REMAINING="$(ps_sql "SELECT COUNT(*) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
log "PrestaShop products remaining with the ${SHOP_PREFIX} prefix: ${SHOP_REMAINING:-?}"

# ---------------------------------------------------------------------------
# WooCommerce side (seed-wc-catalogue.sh, #3025). The OL-side mappings it
# writes carry the internalId of a REAL, already-synced PrestaShop product
# (`ol_product_*`/`ol_variant_*`, or a seed-shop-catalogue.sh clone) - never
# the `perfseed_product_*` prefix the block above matches on - so they must
# be found the same way seed-wc-catalogue.sh itself finds its own work: by
# the WC_SKU_PREFIX every product it creates carries, never by internalId
# (which would either miss them, or risk deleting a real synced product's
# unrelated mapping to another connection).
# ---------------------------------------------------------------------------
WC_SKU_PREFIX="PERFWC-"
WC_PRODUCT_IDS_JSON="$(wc_wp eval '
  global $wpdb;
  $ids = $wpdb->get_col($wpdb->prepare(
    "SELECT p.ID FROM {$wpdb->posts} p
     JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = \"_sku\"
     WHERE p.post_type = \"product\" AND m.meta_value LIKE %s",
    $wpdb->esc_like("'"$WC_SKU_PREFIX"'") . "%"
  ));
  echo json_encode(array_map("intval", $ids));
' 2>/dev/null || printf '[]')"
WC_PRODUCT_COUNT_CLEAN="$(jq 'length' <<<"$WC_PRODUCT_IDS_JSON" 2>/dev/null || printf 0)"
log "deleting $WC_PRODUCT_COUNT_CLEAN WooCommerce product(s) carrying the ${WC_SKU_PREFIX} SKU prefix"

if [ "${WC_PRODUCT_COUNT_CLEAN:-0}" != "0" ]; then
  WC_IDS_CSV="$(jq -r 'join(",")' <<<"$WC_PRODUCT_IDS_JSON")"
  pg_sql_write "DELETE FROM identifier_mappings
    WHERE \"connectionId\"='${WC_CONNECTION_ID}' AND \"entityType\"='Product' AND \"externalId\" IN
      (SELECT unnest(string_to_array('${WC_IDS_CSV}', ',')))" >/dev/null
  # ProductVariant rows carry 'product:{wcId}#{n}' - matched by prefix over
  # the same id set, since the exact suffix is this seeder's own bookkeeping
  # detail (see seed-wc-catalogue.sh's own comment) rather than a value a
  # WHERE ... IN clause can enumerate.
  pg_sql_write "DELETE FROM identifier_mappings
    WHERE \"connectionId\"='${WC_CONNECTION_ID}' AND \"entityType\"='ProductVariant'
      AND \"externalId\" ~ ('^product:(' || replace('${WC_IDS_CSV}', ',', '|') || ')#')" >/dev/null

  # NOT via wc_wp (stderr -> /dev/null) - the same swallowing that hid the
  # docker-cp ownership warning live in seed-wc-catalogue.sh, and this is the
  # one call in this script that can silently no-op N times (once per
  # already-deleted or never-created post) with only an exit code to show
  # for it.
  WP_DELETE_OUT="$(mktemp)"
  if ! docker exec -i "$WC_CONTAINER" wp --allow-root --no-debug --path="$WC_PATH" eval '
    global $wpdb;
    $ids = json_decode(file_get_contents("php://stdin"), true);
    foreach ($ids as $id) { wp_delete_post((int) $id, true); }
    echo count($ids);
  ' <<<"$WC_PRODUCT_IDS_JSON" > "$WP_DELETE_OUT" 2>&1; then
    cat "$WP_DELETE_OUT" >&2
    warn "cleanup: WooCommerce product deletion reported a non-zero exit (output above) - some PERFWC- product(s) may remain (re-run cleanup.sh to retry)"
  fi
  rm -f "$WP_DELETE_OUT"
fi

WC_REMAINING="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"connectionId\"='${WC_CONNECTION_ID}' AND \"entityType\" IN ('Product','ProductVariant')")"
log "WooCommerce identifier_mappings remaining for this connection: ${WC_REMAINING:-?}"

log "cleanup done"
