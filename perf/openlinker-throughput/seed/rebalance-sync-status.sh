#!/usr/bin/env bash
#
# Re-point the seeded orders' `syncStatus` at a realistic per-destination
# failure rate, in place.
#
# WHY THIS IS NOT COSMETIC. `GET /orders?health=needs_attention` filters on
# `syncStatus @> '[{"status":"failed"}]'::jsonb`. The first three size steps
# were seeded at a 15% per-destination failure rate over two destinations, so
# 27.7% of all orders match - an install in the middle of an incident, not one
# in steady state. Two separate measurements read differently because of it:
#
#   * the COUNT is a full non-sargable scan either way, so its cost barely
#     moves with selectivity - but
#   * the PAGE walks `IDX_order_records_createdAt` backwards applying the
#     filter row by row until 20 rows pass. At a 27.7% match rate it finds
#     twenty within about seventy rows. At 0.6% it has to walk thousands.
#
# So the seeded distortion made the page look cheap and left the count as the
# only visible problem. A realistic rate is expected to move the page, and
# that movement is a finding rather than an artefact.
#
# The rewrite is deterministic (`hashtext` on the order id, not random()), so
# re-running is idempotent and a later campaign can reproduce the identical
# split.
#
# IT SETS THE SHARE IN BOTH DIRECTIONS, and the first draft did not - that is
# worth recording, because the failure was silent and is the exact class of
# defect this whole pass exists to remove. That draft only ever HEALED, on the
# reasoning that a seeder should never manufacture a needs-attention row. But
# a row survived as failed only if it was ALREADY failed AND its hash fell in
# the kept fraction, so the realised share was the PRODUCT of the two:
# 27.686% x 0.6% = 0.166%, not 0.6%. Measured live at 0.158%, 3.8x below
# target, and the run's own assertion passed because it only tested for
# overshoot. A seeder whose entire job is to set a distribution has to be able
# to set it in both directions, and has to assert both sides of it.
#
# Touches only rows carrying the seed prefix.
#
# Usage: NEEDS_ATTENTION_PCT=0.6 ./rebalance-sync-status.sh
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="rebalance-sync-status"

# Share of ALL seeded orders that should match the needs-attention predicate.
# 0.6% is the campaign's stated stand-in for a healthy install: destination
# creates fail occasionally (a disabled connection, a rejected payload, a
# throttled shop) and are then retried, so a steady-state backlog of orders
# stuck failed is small. It is a CHOSEN figure, not a measured industry one,
# and the report says so.
NEEDS_ATTENTION_PCT="${NEEDS_ATTENTION_PCT:-0.6}"
awk -v p="$NEEDS_ATTENTION_PCT" 'BEGIN{exit !(p >= 0 && p <= 100)}' \
  || die "NEEDS_ATTENTION_PCT must be between 0 and 100, got '$NEEDS_ATTENTION_PCT'"

# Resolution of the hash bucket. 100000 buckets lets a rate as low as 0.001%
# be expressed exactly rather than rounded to zero.
BUCKETS=100000
KEEP_BUCKETS="$(awk -v p="$NEEDS_ATTENTION_PCT" -v b="$BUCKETS" 'BEGIN{printf "%d", (p/100)*b}')"

require_connections

BEFORE_TOTAL="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'")"
BEFORE_FAILED="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\' AND \"syncStatus\" @> '[{\"status\": \"failed\"}]'::jsonb")"
[ "${BEFORE_TOTAL:-0}" -gt 0 ] || die "no seeded order_records found - nothing to rebalance"

BEFORE_PCT="$(pg_sql "SELECT round(100.0*${BEFORE_FAILED}/NULLIF(${BEFORE_TOTAL},0), 3)")"
log "before: $BEFORE_FAILED of $BEFORE_TOTAL seeded orders match needs-attention (${BEFORE_PCT}%)"
log "target: ${NEEDS_ATTENTION_PCT}% (keep bucket < $KEEP_BUCKETS of $BUCKETS)"

# `abs(hashtext(id)) % BUCKETS` is stable for a given id, so the SAME rows are
# failed on every run - which is what makes this idempotent and reproducible.
# hashtext can return the minimum int32, whose abs() overflows; the modulo is
# taken on the bigint cast first so that value cannot raise.
KEEP_PREDICATE="(abs(hashtext(\"internalOrderId\")::bigint) % ${BUCKETS}) < ${KEEP_BUCKETS}"
IS_FAILED="o.\"syncStatus\" @> '[{\"status\": \"failed\"}]'::jsonb"

START="$(epoch)"

# Two narrow UPDATEs over the DISAGREEING rows only, never a blanket rewrite of
# the whole table: at a million rows the blanket form rewrites 1.1 GB and
# doubles the table's bloat to change a few thousand rows.
#
# jsonb_agg over the array rewrites the entries in place and preserves their
# order and their destinationConnectionId, so a row keeps its real
# per-destination shape rather than being replaced by a synthesised one.
seed_sql <<SQL
-- (1) Heal: currently failed, should not be.
UPDATE order_records o
SET "syncStatus" = (
  SELECT jsonb_agg(
           CASE WHEN e->>'status' = 'failed' THEN jsonb_set(e, '{status}', '"synced"'::jsonb) ELSE e END
           ORDER BY ord)
  FROM jsonb_array_elements(o."syncStatus") WITH ORDINALITY AS t(e, ord)
)
WHERE o."internalOrderId" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'
  AND ${IS_FAILED}
  AND NOT ${KEEP_PREDICATE};

-- (2) Fail: should be failed, currently is not. WHICH destination fails is
-- itself hashed, so the population keeps a mix of first-destination and
-- second-destination failures rather than every minted failure landing on the
-- same connection - an all-one-destination population would make any
-- per-destination read look artificially clean.
UPDATE order_records o
SET "syncStatus" = (
  SELECT jsonb_agg(
           CASE WHEN ord = 1 + (abs(hashtext(o."internalOrderId" || ':dest')::bigint) % 2)
                THEN jsonb_set(e, '{status}', '"failed"'::jsonb) ELSE e END
           ORDER BY ord)
  FROM jsonb_array_elements(o."syncStatus") WITH ORDINALITY AS t(e, ord)
)
WHERE o."internalOrderId" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'
  AND NOT ${IS_FAILED}
  AND ${KEEP_PREDICATE};
SQL

ELAPSED=$(( $(epoch) - START ))

vacuum_analyze_reset order_records

AFTER_FAILED="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\' AND \"syncStatus\" @> '[{\"status\": \"failed\"}]'::jsonb")"
AFTER_TOTAL="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'")"
AFTER_PCT="$(pg_sql "SELECT round(100.0*${AFTER_FAILED}/NULLIF(${AFTER_TOTAL},0), 3)")"

log "after: $AFTER_FAILED of $AFTER_TOTAL seeded orders match needs-attention (${AFTER_PCT}%) in ${ELAPSED}s"

# TWO-SIDED, and the low side is the one that matters. A one-sided check is
# what let the first draft land 3.8x below target and report success: an
# undershoot is invisible in every downstream figure, because the resulting
# dataset still looks plausible and nothing else in the harness knows what the
# share was supposed to be.
#
# The realised share is over ALL order_records while the rewrite only reaches
# the seeded ones, so a stand carrying unseeded rows lands slightly under
# target by exactly their share; the tolerance absorbs that and the log states
# both populations.
UNSEEDED="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" NOT LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'")"
SEEDED_PCT="$(pg_sql "SELECT round(100.0 * (SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\' AND \"syncStatus\" @> '[{\"status\": \"failed\"}]'::jsonb)
                     / NULLIF((SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE '${PREFIX}\\_ord\\_%' ESCAPE '\\'),0), 3)")"
log "seeded population alone: ${SEEDED_PCT}% (target ${NEEDS_ATTENTION_PCT}%); ${UNSEEDED} unseeded row(s) are not rewritten and dilute the whole-table figure"

awk -v a="$SEEDED_PCT" -v t="$NEEDS_ATTENTION_PCT" \
  'BEGIN{ lo = t*0.9; hi = t*1.1;
          if (a < lo || a > hi) { printf "realised %.3f%% is outside [%.3f, %.3f]\n", a, lo, hi; exit 1 } }' \
  || die "rebalance: the seeded share is ${SEEDED_PCT}%, outside 10% of the ${NEEDS_ATTENTION_PCT}% target - the keep predicate did not do what it says"

log "rebalance-sync-status done"
