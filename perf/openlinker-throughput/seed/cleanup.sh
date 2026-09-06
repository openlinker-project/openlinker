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

log "deleting perfseed identifier_mappings"
pg_sql_write "DELETE FROM identifier_mappings WHERE \"externalId\" LIKE '${PREFIX^^}-EXT-%'" >/dev/null

log "deleting perfseed inventory_items"
pg_sql_write "DELETE FROM inventory_items WHERE id LIKE '${PREFIX}\\_inv\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed product_variants"
pg_sql_write "DELETE FROM product_variants WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'" >/dev/null

log "deleting perfseed products"
pg_sql_write "DELETE FROM products WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'" >/dev/null

vacuum_analyze_reset order_records order_line_items sync_jobs identifier_mappings inventory_items product_variants products

log "cleanup done"
