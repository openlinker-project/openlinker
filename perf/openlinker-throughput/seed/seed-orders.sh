#!/usr/bin/env bash
#
# Set-based order_records + order_line_items seeder (#2849) for #2843's
# three order-side dataset sizes.
#
# ADDITIVE across sizes: run with TARGET_ORDERS=10000, then TARGET_ORDERS=100000,
# then TARGET_ORDERS=1000000 - each call inserts only the DELTA needed to
# reach the target, rather than re-seeding from zero, because the sweep
# history and catalogue are already there from seed-jobs.sh/seed-catalogue.sh
# and re-inserting 10k rows twice would violate the internalOrderId PK.
# The generation label (embedded in every id/tag) is the TARGET size itself
# (e.g. "g100000"), which is unique per size step by construction and needs
# no separate counter file.
#
# Every seeded row satisfies, in the MIGRATION-built schema (not just the
# harness's `synchronize` one - #2849's own warning):
#   - ck_order_records_fx_group / ck_order_records_fx_rule (reportingCurrency
#     + reportingTotalAmount + fxRule all set together, fxRule always
#     'prev-business-day', or all three NULL)
#   - the analytics preconditions net-sales/sales-analytics need: recordStatus
#     'ready' + non-null placedAt/totalAmount/currency/taxTreatment, PLUS a
#     resolvable order_line_items.taxRate (net-sales-tax-rate.types.ts) - or
#     every net figure is "zero and cheap at the same time" per #2849's own
#     phrase
#   - syncStatus written as the REAL per-destination array shape
#     ([{"destinationConnectionId":...,"status":"synced"|"failed"}]), so rows
#     do not collapse into the residual awaiting_dispatch health bucket
#
# Usage: TARGET_ORDERS=100000 ./seed-orders.sh
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="seed-orders"

TARGET_ORDERS="${TARGET_ORDERS:?TARGET_ORDERS is required, e.g. TARGET_ORDERS=10000}"
require_connections

EXISTING_TOTAL="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'" 2>/dev/null || printf 0)"
EXISTING_TOTAL="${EXISTING_TOTAL:-0}"

if [ "$EXISTING_TOTAL" -ge "$TARGET_ORDERS" ]; then
  log "already at/above target: $EXISTING_TOTAL perfseed order_records >= TARGET_ORDERS=$TARGET_ORDERS - nothing to do (this is the additive-sizing contract, not a refusal)"
  exit 0
fi

DELTA=$((TARGET_ORDERS - EXISTING_TOTAL))
SEED_OFFSET="$EXISTING_TOTAL"
# The generation label IS the target size - unique per size step, no counter
# file needed, and legible in every id this step mints (perfseed_ord_g100000_...).
GEN="${SEED_GEN:-$TARGET_ORDERS}"

refuse_unless_forced "order_records (gen=$GEN)" \
  "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_g${GEN}\\_%' ESCAPE '\\'" >/dev/null

# Ceiling per #2849's own stated targets (10k<=10s / 100k<=60s / 1M<=10min),
# picked by which bracket TARGET_ORDERS falls in - applied to the DELTA
# insert's wall time, since that IS the work this call does.
if [ "$TARGET_ORDERS" -le 10000 ]; then CEILING_SECS="${CEILING_SECS:-30}"
elif [ "$TARGET_ORDERS" -le 100000 ]; then CEILING_SECS="${CEILING_SECS:-180}"
else CEILING_SECS="${CEILING_SECS:-900}"
fi

log "seeding $DELTA order_records (offset=$SEED_OFFSET, target=$TARGET_ORDERS, gen=$GEN, rng=$SEED_RNG) - existing=$EXISTING_TOTAL"
START="$(epoch)"

seed_sql <<SQL
BEGIN;
SELECT setseed($SEED_RNG);

CREATE TEMP TABLE perfseed_orders_stage AS
SELECT
  gs.n,
  '${PREFIX}_ord_g${GEN}_' || gs.n AS id,
  random() AS r_status,
  random() AS r_conn,
  random() AS r_currency,
  random() AS r_treatment,
  random() AS r_reporting,
  random() AS r_era,
  random() AS r_sync_ps,
  random() AS r_sync_wc,
  (1 + floor(random() * 4))::int AS line_count,
  now() - ((random() * 400)::int || ' days')::interval AS placed_at
FROM generate_series(${SEED_OFFSET} + 1, ${SEED_OFFSET} + ${DELTA}) AS gs(n);

ALTER TABLE perfseed_orders_stage ADD COLUMN conn_id text;
ALTER TABLE perfseed_orders_stage ADD COLUMN record_status varchar;
ALTER TABLE perfseed_orders_stage ADD COLUMN currency varchar(3);
ALTER TABLE perfseed_orders_stage ADD COLUMN tax_treatment varchar;
ALTER TABLE perfseed_orders_stage ADD COLUMN total_amount numeric(12,2);
ALTER TABLE perfseed_orders_stage ADD COLUMN tax_rate_era varchar(16);

-- Distribution targets, stated (#2849 AC "target distribution proportions
-- ... written down"), asserted below after the insert:
--   orders per connection: prestashop 60% / woocommerce 40%
--   recordStatus: ready 90% / awaiting_mapping 5% / source_deleted 5%
--   currency: PLN 70% / EUR 20% / USD 10%
--   taxTreatment: inclusive 80% / exclusive 20%
--   reportingCurrency stamped (of 'ready' rows): 80%
--   taxRateEra: NULL 30% (not-yet-checked) / 'pre-rollout' 10% / 'standard' 60%
UPDATE perfseed_orders_stage SET
  conn_id = CASE WHEN r_conn < 0.6 THEN '${PS_CONNECTION_ID}' ELSE '${WC_CONNECTION_ID}' END,
  record_status = CASE WHEN r_status < 0.90 THEN 'ready' WHEN r_status < 0.95 THEN 'awaiting_mapping' ELSE 'source_deleted' END,
  currency = CASE WHEN r_currency < 0.7 THEN 'PLN' WHEN r_currency < 0.9 THEN 'EUR' ELSE 'USD' END,
  tax_treatment = CASE WHEN r_treatment < 0.8 THEN 'inclusive' ELSE 'exclusive' END,
  total_amount = round((50 + (n % 950) + random() * 50)::numeric, 2),
  tax_rate_era = CASE WHEN r_era < 0.3 THEN NULL WHEN r_era < 0.4 THEN 'pre-rollout' ELSE 'standard' END;

INSERT INTO order_records (
  "internalOrderId", "sourceConnectionId", "sourceEventId", "orderSnapshot", "syncStatus",
  "createdAt", "updatedAt", "recordStatus", "syncAttempts",
  "placedAt", "currency", "taxTreatment", "totalAmount", "taxRateEra",
  "reportingCurrency", "reportingTotalAmount", "fxRule"
)
SELECT
  s.id, s.conn_id::uuid, '${PREFIX}-evt-g${GEN}-' || s.n,
  jsonb_build_object(
    'totals', jsonb_build_object('currency', s.currency, 'total', s.total_amount),
    'shippingAddress', jsonb_build_object('lastName', 'Perfseed' || s.n),
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object('sku', 'ITEM-' || g)) FROM generate_series(1, s.line_count) g), '[]'::jsonb)
  ),
  jsonb_build_array(
    jsonb_build_object('destinationConnectionId', '${PS_CONNECTION_ID}', 'status', CASE WHEN s.r_sync_ps < 0.85 THEN 'synced' ELSE 'failed' END),
    jsonb_build_object('destinationConnectionId', '${WC_CONNECTION_ID}', 'status', CASE WHEN s.r_sync_wc < 0.85 THEN 'synced' ELSE 'failed' END)
  ),
  s.placed_at, s.placed_at + interval '1 minute',
  s.record_status, '[]'::jsonb,
  s.placed_at, s.currency, s.tax_treatment, s.total_amount, s.tax_rate_era,
  CASE WHEN s.record_status = 'ready' AND s.r_reporting < 0.8 THEN s.currency ELSE NULL END,
  CASE WHEN s.record_status = 'ready' AND s.r_reporting < 0.8 THEN s.total_amount ELSE NULL END,
  CASE WHEN s.record_status = 'ready' AND s.r_reporting < 0.8 THEN 'prev-business-day' ELSE NULL END
FROM perfseed_orders_stage s;

-- order_line_items - every seeded order gets 1-4 lines, unitPrice derived
-- from the order total, taxRate always '23' (always resolvable - the
-- net-sales exists-subqueries need this or the whole order is excluded).
INSERT INTO order_line_items (
  id, "orderRecordId", "lineNumber", "productId", "variantId", quantity, "unitPrice",
  "sourceConnectionId", "placedAt", "createdAt", "taxRate", "taxSource", "taxRateReadAt"
)
SELECT
  gen_random_uuid(),
  s.id,
  ln.ln,
  '${PREFIX}_prodline_' || s.n || '_' || ln.ln,
  NULL,
  1,
  round((s.total_amount / s.line_count)::numeric, 2),
  s.conn_id::uuid,
  s.placed_at,
  s.placed_at,
  '23', 'catalog', now()
FROM perfseed_orders_stage s
CROSS JOIN LATERAL generate_series(1, s.line_count) AS ln(ln);

COMMIT;
SQL

ELAPSED=$(( $(epoch) - START ))
seed_check_ceiling "order_records+order_line_items delta ($DELTA rows, target $TARGET_ORDERS)" "$ELAPSED" "$CEILING_SECS"

vacuum_analyze_reset order_records order_line_items

# Post-seed distribution assertion over THIS generation only (#2849 AC).
TOLERANCE_PCT="${TOLERANCE_PCT:-5}"
check_share() {
  local label="$1" where="$2" target_pct="$3" total actual pct
  total="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_g${GEN}\\_%' ESCAPE '\\'")"
  actual="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_g${GEN}\\_%' ESCAPE '\\' AND $where")"
  pct="$(pg_sql "SELECT round(100.0 * $actual / NULLIF($total,0), 1)")"
  log "distribution gen=$GEN: $label = $actual/$total (${pct}%, target ${target_pct}% +/- ${TOLERANCE_PCT}pp)"
  awk -v p="$pct" -v t="$target_pct" -v tol="$TOLERANCE_PCT" 'BEGIN{d=p-t; if(d<0)d=-d; exit !(d<=tol)}' \
    || warn "distribution gen=$GEN: $label is ${pct}%, outside target ${target_pct}% +/- ${TOLERANCE_PCT}pp"
}
check_share "recordStatus=ready" "\"recordStatus\"='ready'" 90
check_share "sourceConnectionId=PS" "\"sourceConnectionId\"='${PS_CONNECTION_ID}'" 60
check_share "currency=PLN" "currency='PLN'" 70
check_share "reportingCurrency stamped (of ready)" "\"recordStatus\"='ready' AND \"reportingCurrency\" IS NOT NULL" 72

N_ORDERS="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'")"
N_LINES="$(pg_sql "SELECT COUNT(*) FROM order_line_items oli JOIN order_records o ON o.\"internalOrderId\"=oli.\"orderRecordId\" WHERE o.\"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'")"
log "seed-orders done in ${ELAPSED}s: delta=$DELTA total_perfseed_orders=$N_ORDERS total_perfseed_lines=$N_LINES rng_seed=$SEED_RNG gen=$GEN"
