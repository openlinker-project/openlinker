#!/usr/bin/env bash
#
# F16 - shop publishing under load: ProductPublisher and CategoryProvisioner
# (#3046, epic #2840).
#
# Measures the bulk shop-publish path (`POST /listings/bulk-shop-publish`)
# against the real WooCommerce connection (#3043 provisioned it with
# ProductPublisher + CategoryProvisioner), split the way #3046's own AC
# requires: simple products and variable products are DIFFERENT units of
# work (a variable product is one parent PLUS N variations, #1836) and must
# never be averaged into one figure.
#
# Sources lib.sh (#2841) for every guard/manifest/verdict primitive - this
# scenario owns nothing that library already owns.
#
# Four arms:
#   A. simple-product publish  - N single-variant products
#   B. variable-product publish - all sibling variants of N multi-variant
#      products, submitted together (one parent + N variations each)
#   C. partial-submit failure - a batch mixing real variant ids with one
#      syntactically-valid-but-nonexistent id, to exercise #1845's
#      totalCount reconciliation rather than assert it from the code
#   D. AI-description arm - arm A resubmitted with generateDescription:true,
#      reported SEPARATELY (never blended into the baseline)
#
# This stand's catalogue is small (11 real variants across 6 products, from
# the OL PrestaShop module's own fixture seed) - too small for a k6 load
# ladder to mean anything, so this scenario is a plain curl/bash driver
# measuring real request latency and batch-completion time, not a
# sustained-rate test. What it measures is real: real HTTP calls through
# the real WooCommerce adapter, honestly reported at the scale the stand
# actually has.
#
# Usage: ./f16-shop-publish.sh [--smoke]
#   (default)  all four arms, a dated report under results/
#   --smoke    arm A only, against one variant - proves the moving parts
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f16"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
SEED_DIR="$SCRIPT_DIR/../seed"
# shellcheck disable=SC1091
source "$SEED_DIR/seed-lib.sh"

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

require_connections
[ -n "${WC_CONNECTION_ID:-}" ] || die "WC_CONNECTION_ID not set - run bootstrap.sh first"

# The real fixture catalogue this stand carries (#3043's own module fixture
# seed - not a #2849 set-based seeder, since the whole point of this
# scenario is CREATING listings, not reading a pre-seeded history). Hardcoded
# rather than queried, because `product_variants` on this stand also carries
# stale rows from earlier reinstalls with NO live PrestaShop counterpart
# (found live while building this scenario) - querying broadly would risk
# publishing against a variant id the shop can no longer resolve. These six
# products/eleven variants were confirmed live, right now, against the
# CURRENT PrestaShop catalogue (`ps_product` ids 20-25) via
# `GET /v1/products/:id/variants`.
# RESOLVED FROM THIS STAND, NOT HARDCODED. The shipped list was captured from
# the author's own stand ("confirmed live, right now"), but ol_variant_* ids are
# minted per install - so every id in it was NOT_FOUND here and all four arms
# failed while the publish jobs themselves succeeded. Resolving live keeps the
# author's constraint (only variants whose product resolves at the PrestaShop
# master) without pinning ids that cannot survive a second stand.
mapfile -t SIMPLE_VARIANTS < <(pg_sql "SELECT v.id FROM product_variants v
  JOIN identifier_mappings m ON m.\"internalId\"=v.\"productId\" AND m.\"entityType\"='Product'
  JOIN connections c ON c.id=m.\"connectionId\" AND c.name='perf-prestashop'
  WHERE (SELECT count(*) FROM product_variants x WHERE x.\"productId\"=v.\"productId\")=1
  ORDER BY v.id LIMIT 3")
[ "${#SIMPLE_VARIANTS[@]}" -eq 3 ] || die "f16: could not resolve 3 single-variant products mapped at the PrestaShop master"
# Three variable products, siblings grouped - each inner array is ONE
# product's full variant set (#1836: one parent + N variations per submit).
mapfile -t VARIABLE_PRODUCT_1 < <(pg_sql "SELECT id FROM product_variants WHERE \"productId\"='ol_product_39956975656e4565b2096b7f1df41b8f' ORDER BY id")
mapfile -t VARIABLE_PRODUCT_2 < <(pg_sql "SELECT id FROM product_variants WHERE \"productId\"='ol_product_d7e51c102e8744288c80bf8be2861935' ORDER BY id")
mapfile -t VARIABLE_PRODUCT_3 < <(pg_sql "SELECT id FROM product_variants WHERE \"productId\"='ol_product_e8893939236c444083c514b1786a46b4' ORDER BY id")

ol_login

RESULTS_DIR="$(results_dir_init f16-shop-publish "$([ "$SMOKE" = 1 ] && echo smoke || echo strict)")"

# guard_build FIRST: without it the manifest records gitSha=unknown, so the
# figures cannot be tied to the code that produced them - and nothing checks
# that the running image is the tree under test. Both halves matter; the sha is
# the record, the tree comparison is the verification (#2854).
guard_build
guard_stand_exclusive f16-shop-publish
guard_scheduler_off
guard_runner_state enabled
guard_connection_endpoints "$WC_CONNECTION_ID"

CONN_IDS_CSV="'$WC_CONNECTION_ID'"
window_start "$RESULTS_DIR" f16-shop-publish "$CONN_IDS_CSV" "$SMOKE" \
  "$(jq -n --arg wc "$WC_CONNECTION_ID" '{destinationConnectionId: $wc, destinationCapabilities: "ProductPublisher,CategoryProvisioner"}')"

# ---------------------------------------------------------------------------
# submit_batch <items_json> <status> [generateDescription]
# Submits, polls the batch to a terminal status (with a bounded wait), and
# echoes "elapsedMs terminalStatus totalCount succeededCount failedCount".
# ---------------------------------------------------------------------------
POLL_MAX_WAIT_SECS="${POLL_MAX_WAIT_SECS:-120}"

submit_batch() {
  local items_json="$1" status="$2" gen_desc="${3:-false}" body resp batch_id t_start t_elapsed
  body="$(jq -n --arg conn "$WC_CONNECTION_ID" --argjson items "$items_json" --arg status "$status" --argjson gen "$gen_desc" \
    '{connectionId: $conn, items: $items, status: $status, generateDescription: $gen}')"
  t_start="$(epoch)"
  resp="$(ol_api POST /v1/listings/bulk-shop-publish "$body")"
  batch_id="$(printf '%s' "$resp" | json_field batchId)"
  [ -n "$batch_id" ] || die "submit_batch: no batchId in response: $resp"

  local waited=0 poll batch_status total succ fail
  while :; do
    poll="$(ol_api GET "/v1/listings/bulk-shop-publish/$batch_id")"
    batch_status="$(printf '%s' "$poll" | json_field status)"
    case "$batch_status" in
      completed|partially-failed|failed) break ;;
    esac
    waited=$((waited + 2))
    [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] || die "submit_batch: batch $batch_id did not terminalise within ${POLL_MAX_WAIT_SECS}s (last status=$batch_status)"
    sleep 2
  done
  t_elapsed="$(( $(epoch) - t_start ))"
  total="$(printf '%s' "$poll" | jq -r '.totalCount')"
  succ="$(printf '%s' "$poll" | jq -r '.succeededCount')"
  fail="$(printf '%s' "$poll" | jq -r '.failedCount')"
  # >&2, not stdout: submit_batch's return value is the single printf line
  # below, captured via $(...) by every caller. lib.sh's log() writes to
  # stdout (by design, for direct-run visibility) - if this diagnostic line
  # shared that stream, every caller's `result="$(submit_batch ...)"` would
  # capture BOTH lines, and arm C's `read -r ... <<< "$result"` word-splits
  # across the embedded newline too, misassigning every field (found live:
  # c_total ended up holding the batch id instead of "2").
  log "batch $batch_id: status=$batch_status total=$total succeeded=$succ failed=$fail elapsed=${t_elapsed}s" >&2
  printf '%s %s %s %s %s %s\n' "$t_elapsed" "$batch_status" "$total" "$succ" "$fail" "$batch_id"
}

ARM_RESULTS_FILE="$RESULTS_DIR/arm-results.txt"
: > "$ARM_RESULTS_FILE"

if [ "$SMOKE" = 1 ]; then
  log "--- smoke: arm A only, one simple variant ---"
  items="$(jq -n --arg v "${SIMPLE_VARIANTS[0]}" '[{internalVariantId: $v, stock: 5}]')"
  result="$(submit_batch "$items" published false)"
  printf 'smoke %s\n' "$result" >> "$ARM_RESULTS_FILE"
else
  log "--- arm A: simple-product publish (${#SIMPLE_VARIANTS[@]} products) ---"
  items="$(printf '%s\n' "${SIMPLE_VARIANTS[@]}" | jq -R '{internalVariantId: ., stock: 5}' | jq -s '.')"
  result="$(submit_batch "$items" published false)"
  printf 'armA-simple %s\n' "$result" >> "$ARM_RESULTS_FILE"

  log "--- arm B: variable-product publish (3 products, $(( ${#VARIABLE_PRODUCT_1[@]} + ${#VARIABLE_PRODUCT_2[@]} + ${#VARIABLE_PRODUCT_3[@]} )) variants total) ---"
  items="$(printf '%s\n' "${VARIABLE_PRODUCT_1[@]}" "${VARIABLE_PRODUCT_2[@]}" "${VARIABLE_PRODUCT_3[@]}" | jq -R '{internalVariantId: ., stock: 3}' | jq -s '.')"
  result="$(submit_batch "$items" published false)"
  printf 'armB-variable %s\n' "$result" >> "$ARM_RESULTS_FILE"

  # --- arm C: partial-submit failure ------------------------------------
  # One real variant + one syntactically-valid, non-existent one
  # (VARIANT_ID_PATTERN-shaped so it passes DTO validation and reaches the
  # service, where resolution fails per-item - #1845's partial-submit
  # atomicity is exactly "totalCount reconciles down, no batch left running
  # forever", never "the whole request 400s").
  log "--- arm C: partial-submit failure (1 real + 1 nonexistent variant) ---"
  items="$(jq -n --arg v1 "${SIMPLE_VARIANTS[1]}" \
    '[{internalVariantId: $v1, stock: 5}, {internalVariantId: "ol_variant_deadbeefdeadbeefdeadbeefdeadbeef", stock: 5}]')"
  result="$(submit_batch "$items" published false)"
  read -r c_elapsed c_status c_total c_succ c_fail c_batch_id <<< "$result"
  printf 'armC-partial-failure %s\n' "$result" >> "$ARM_RESULTS_FILE"
  # VALID direction: the reconciliation must show 2 total, exactly one
  # success, exactly one failure - never "completed" (that would mean the
  # bad row was silently dropped rather than counted as failed) and never
  # left "running" (a stranded batch, the defect #1845 fixed).
  ARM_C_OK=1
  if [ "$c_total" != "2" ] || [ "$c_succ" != "1" ] || [ "$c_fail" != "1" ] || [ "$c_status" != "partially-failed" ]; then
    ARM_C_OK=0
    warn "arm C DISCARDED: expected total=2 succeeded=1 failed=1 status=partially-failed, got total=$c_total succeeded=$c_succ failed=$c_fail status=$c_status"
  else
    log "arm C VALID: partial-submit reconciliation correct (batch $c_batch_id: total=2, succeeded=1, failed=1, status=partially-failed)"
  fi

  # --- arm D: AI-description, reported separately -----------------------
  log "--- arm D: AI-description arm (arm A resubmitted, generateDescription=true) ---"
  items="$(printf '%s\n' "${SIMPLE_VARIANTS[@]}" | jq -R '{internalVariantId: ., stock: 5}' | jq -s '.')"
  result="$(submit_batch "$items" published true)"
  printf 'armD-ai-description %s\n' "$result" >> "$ARM_RESULTS_FILE"
fi

window_stop "$RESULTS_DIR"

# ---------------------------------------------------------------------------
# Verdict - no k6 involved, so run_post_guards' k6-specific arguments do not
# apply here. This scenario's own correctness check (arm C) IS the guard
# that matters: a partial-submit batch that reconciles wrong or never
# terminalises is exactly the "stranded batch" defect #1845 fixed, and the
# one thing this scenario would be worthless without checking.
# ---------------------------------------------------------------------------
if [ "$SMOKE" = 1 ]; then
  log "smoke run - no verdict written (never produces a measurement, per this scenario's own header)"
elif [ "${ARM_C_OK:-0}" = "1" ]; then
  verdict_write "$RESULTS_DIR" VALID
else
  verdict_write "$RESULTS_DIR" DISCARDED "arm-c-partial-submit-reconciliation-wrong"
fi

log "results: $RESULTS_DIR"
cat "$ARM_RESULTS_FILE"
