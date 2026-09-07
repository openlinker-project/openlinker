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

log "cleanup done"
