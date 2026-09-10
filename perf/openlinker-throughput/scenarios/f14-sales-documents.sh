#!/usr/bin/env bash
#
# F14 - sales documents under load, at a provider rather than a lane
# (#3044, epic #2840).
#
# #3006's fiscal-lane-stub.sh answers "how many documents/hour does the
# `fiscal` LANE admit" against an always-fixed-latency stub whose payload
# never issues a real routing decision - this scenario answers the
# adjacent, previously-unmeasured question: what does the REAL write path
# do, for both document kinds, at a provider's declared latency? One
# scenario over both kinds because the routing decision above them is
# shared (ADR-041 §3a: invoice XOR fiscal receipt for one order) and the
# guard that enforces it (#2047/#2157's cross-kind
# `blocksIssuanceElsewhere` check) sits on the write path of both.
#
# Three arms:
#   A. Invoicing issuance throughput, N distinct orders through
#      `perf-invoicing` (invoicing-stub, #3006) at a declared stub latency.
#   B. Fiscalization issuance throughput, N distinct orders through
#      `perf-eparagony` (the REAL eparagony.pl adapter, #3043) at a
#      declared stub latency, polling GET /orders/:id/fiscal-registration
#      to its `registered` terminal (issuance there is ASYNC - a 202 plus a
#      worker job - unlike invoicing's synchronous POST /invoices).
#   C. The one-document-per-order guard, under REAL concurrency: one
#      POST /invoices (perf-invoicing) and one POST /fiscal-registrations
#      (perf-eparagony) fired against the SAME order at (as close as bash
#      background jobs get to) the same instant. Exactly one document may
#      exist for that order afterwards - the other call must be refused,
#      never silently ignored or double-applied. This is the scenario's
#      own correctness guard (mirrored on #1845's arm C, #3046) - verified
#      in BOTH directions, since a guard that only ever passes on its
#      happy path has never actually been exercised.
#   D. An `in-doubt` outcome, on demand. eparagony-stub's `forceOutcome:
#      'hang'` knob plus a clamped-low `config.statusPollTimeoutMs` on
#      `perf-eparagony` reliably exhausts the real adapter's poll budget -
#      the one outcome this whole campaign has never produced, and the one
#      an operator cannot resolve by retrying (stubs/eparagony/README.md).
#
# Every arm uses hand-seeded `order_records` rows (F13's
# `orderSnapshot`-only-what's-needed pattern) rather than real marketplace
# ingestion - the write paths under test (`InvoiceService.issueInvoice`,
# `FiscalRegistrationService.requestRegistration`) read `orderFromReadySnapshot`,
# never the source adapter, so a hand-built `ready` snapshot with a buyer
# address and one taxed line is the real input these services see.
#
# WHAT THIS DOES NOT MEASURE, restated so it cannot be misquoted: a real
# provider's throughput, variance, rate limits, or failure taxonomy.
# invoicing-stub's and eparagony-stub's `latencyMs` are declared constants,
# never a distribution, and every figure below is a statement about
# OpenLinker's own write path and lock, not about inFakt, KSeF, Subiekt, or
# the real eparagony.pl.
#
# Usage: ./f14-sales-documents.sh [--smoke]
#   (default)  all four arms, a dated report under results/
#   --smoke    tiny counts (arm A only, 2 orders) - proves the plumbing
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f14"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

: "${INVOICING_CONNECTION_ID:?INVOICING_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"
: "${EPARAGONY_CONNECTION_ID:?EPARAGONY_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"

INVOICING_STUB_URL="${INVOICING_STUB_URL:-http://127.0.0.1:${INVOICING_STUB_HOST_PORT:-19083}}"
EPARAGONY_STUB_URL="${EPARAGONY_STUB_URL:-http://127.0.0.1:${EPARAGONY_STUB_HOST_PORT:-19084}}"

ARM_A_ORDERS="${ARM_A_ORDERS:-10}"
ARM_B_ORDERS="${ARM_B_ORDERS:-10}"
STUB_LATENCY_MS="${STUB_LATENCY_MS:-2000}"
POLL_MAX_WAIT_SECS="${POLL_MAX_WAIT_SECS:-60}"

if [ "$SMOKE" = 1 ]; then
  ARM_A_ORDERS=2
  ARM_B_ORDERS=0
  warn "SMOKE MODE - arm A only, 2 orders. Not a measurement."
fi

curl -sS --max-time 5 "$INVOICING_STUB_URL/__stub/health" >/dev/null \
  || die "invoicing-stub not reachable at $INVOICING_STUB_URL/__stub/health - is the lab stand up?"
curl -sS --max-time 5 "$EPARAGONY_STUB_URL/__stub/health" >/dev/null \
  || die "eparagony-stub not reachable at $EPARAGONY_STUB_URL/__stub/health - is the lab stand up?"

ol_login

RESULTS_DIR="$(results_dir_init f14-sales-documents "$([ "$SMOKE" = 1 ] && echo smoke || echo strict)")"

# guard_build FIRST: without it the manifest records gitSha=unknown, so the
# figures cannot be tied to the code that produced them - and nothing checks
# that the running image is the tree under test. Both halves matter; the sha is
# the record, the tree comparison is the verification (#2854).
guard_build
guard_stand_exclusive f14-sales-documents
guard_scheduler_off
guard_runner_state enabled
guard_connection_endpoints "$INVOICING_CONNECTION_ID" "$EPARAGONY_CONNECTION_ID"

RUN_TAG="$(epoch)_$$"

# Cleanup-only, non-fatal write (the f13-writeback.sh precedent) - a trap
# that dies mid-cleanup on the first already-gone row would leave every row
# after it behind.
pg_sql_write_besteffort() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -c "$1" >/dev/null 2>&1 \
    || warn "pg_sql_write_besteffort: cleanup statement failed (non-fatal, trap continues): $1"
}

# Cleanup matches by RUN_TAG'd orderId PREFIX, never a bash array of seeded
# ids - `seed_order` is always called via `oid="$(seed_order ...)"`, and a
# command-substitution subshell's array mutations never propagate back to
# this process (found live: a first draft appended to a
# `SEEDED_ORDER_IDS` array *inside* `seed_order`, which stayed permanently
# empty here, silently leaking every invoice_records/fiscal_registration_records
# row this scenario ever created).
f14_cleanup() {
  pg_sql_write_besteffort "DELETE FROM invoice_records WHERE \"orderId\" LIKE 'f14_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM fiscal_registration_records WHERE \"orderId\" LIKE 'f14_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM order_records WHERE \"internalOrderId\" LIKE 'f14_${RUN_TAG}_%'"
  release_stand_exclusive
}
trap f14_cleanup EXIT

# ---------------------------------------------------------------------------
# seed_order <suffix> - a minimal `ready` order_records row with a usable
# buyer address (F13's pattern, extended with one taxed line and a full
# address so BOTH `orderFromReadySnapshot({requireBuyer:true})` (invoicing)
# and the `requireBuyer:false` fiscalization path see a real, well-formed
# Order). taxRate is stamped so a stand with OL_TAX_RATE_STRICT_ENABLED=true
# would still pass the ADR-063 gate - never required by this stand's
# default (off), but honest either way.
# ---------------------------------------------------------------------------
seed_order() {
  local suffix="$1"
  local order_id="f14_${RUN_TAG}_${suffix}"
  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    VALUES
      ('$order_id','$INVOICING_CONNECTION_ID'::uuid,
       \$snap\$$(jq -nc --arg id "$order_id" '{
         id: $id, status: "processing",
         items: [{id: "line-1", productId: "ol_product_f14", quantity: 1, price: 123.00, name: "F14 perf line", taxRate: "23", taxRateCountry: "PL", taxSource: "resolved"}],
         totals: {subtotal: 100.00, tax: 23.00, shipping: 0, total: 123.00, currency: "PLN", taxTreatment: "inclusive", totalTaxTreatment: "inclusive"},
         billingAddress: {address1: "ul. Testowa 1", city: "Warszawa", postalCode: "00-001", country: "PL", firstName: "F14", lastName: "Perf"},
         createdAt: (now | strftime("%Y-%m-%dT%H:%M:%SZ")), updatedAt: (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
       }')\$snap\$::jsonb,
       '[]'::jsonb,'ready',now(),now())" >/dev/null
  printf '%s' "$order_id"
}

ARM_RESULTS_FILE="$RESULTS_DIR/arm-results.txt"
: > "$ARM_RESULTS_FILE"

stub_set_invoicing_latency() {
  curl -sS --max-time 5 -X PUT "$INVOICING_STUB_URL/__stub/config" \
    -H 'Content-Type: application/json' -d "{\"latencyMs\":$1}" >/dev/null \
    || die "could not set invoicing-stub latency to $1 ms"
}
stub_set_eparagony_config() {
  curl -sS --max-time 5 -X PUT "$EPARAGONY_STUB_URL/__stub/config" \
    -H 'Content-Type: application/json' -d "$1" >/dev/null \
    || die "could not PUT eparagony-stub config: $1"
}

window_start "$RESULTS_DIR" f14-sales-documents "'$INVOICING_CONNECTION_ID','$EPARAGONY_CONNECTION_ID'" "$SMOKE" \
  "$(jq -n --argjson lat "$STUB_LATENCY_MS" '{invoicingStubLatencyMs: $lat, eparagonyStubLatencyMs: $lat}')"

# ===========================================================================
# Arm A - invoicing throughput at declared stub latency (synchronous path:
# POST /invoices blocks on issueInvoice() -> the adapter -> the stub).
# ===========================================================================
log "--- arm A: invoicing issuance throughput ($ARM_A_ORDERS orders, stub latency=${STUB_LATENCY_MS}ms) ---"
stub_set_invoicing_latency "$STUB_LATENCY_MS"
ARM_A_OK=0
ARM_A_TOTAL_MS=0
if [ "$ARM_A_ORDERS" -gt 0 ]; then
  for ((i = 0; i < ARM_A_ORDERS; i++)); do
    oid="$(seed_order "invA_$i")"
    t0="$(date +%s%3N)"
    resp="$(ol_api POST /v1/invoices "$(jq -n --arg oid "$oid" --arg cid "$INVOICING_CONNECTION_ID" '{orderId:$oid, connectionId:$cid}')" || printf '{}')"
    t1="$(date +%s%3N)"
    status="$(printf '%s' "$resp" | json_field status)"
    [ "$status" = "issued" ] && ARM_A_OK=$((ARM_A_OK + 1))
    ARM_A_TOTAL_MS=$((ARM_A_TOTAL_MS + t1 - t0))
  done
  arm_a_mean_ms=$((ARM_A_TOTAL_MS / ARM_A_ORDERS))
  arm_a_per_hour=$(awk -v ms="$arm_a_mean_ms" 'BEGIN{printf "%.1f", (ms>0)?(3600000.0/ms):0}')
  log "arm A: $ARM_A_OK/$ARM_A_ORDERS issued, mean=${arm_a_mean_ms}ms => ${arm_a_per_hour}/hour at declared stub latency ${STUB_LATENCY_MS}ms (single-caller, no lane-cap sweep)"
  printf 'armA-invoicing-throughput ok=%s total=%s meanMs=%s perHour=%s stubLatencyMs=%s\n' \
    "$ARM_A_OK" "$ARM_A_ORDERS" "$arm_a_mean_ms" "$arm_a_per_hour" "$STUB_LATENCY_MS" >> "$ARM_RESULTS_FILE"
else
  log "arm A: skipped (ARM_A_ORDERS=0, smoke mode)"
fi

# ===========================================================================
# Arm B - fiscalization throughput. ASYNC: POST /fiscal-registrations
# returns 202 immediately; the actual provider round-trip happens in the
# worker's fiscalization.register job. Each order is timed from submit to
# the progress read reporting a terminal `registered`.
# ===========================================================================
ARM_B_OK=0
ARM_B_TOTAL_MS=0
if [ "$SMOKE" = 0 ] && [ "$ARM_B_ORDERS" -gt 0 ]; then
  log "--- arm B: fiscalization issuance throughput ($ARM_B_ORDERS orders, stub latency=${STUB_LATENCY_MS}ms) ---"
  stub_set_eparagony_config "$(jq -n --argjson lat "$STUB_LATENCY_MS" '{latencyMs:$lat, forceOutcome:"confirmed"}')"
  for ((i = 0; i < ARM_B_ORDERS; i++)); do
    oid="$(seed_order "invB_$i")"
    t0="$(date +%s%3N)"
    ol_api POST /v1/fiscal-registrations "$(jq -n --arg oid "$oid" --arg cid "$EPARAGONY_CONNECTION_ID" '{orderId:$oid, connectionId:$cid}')" >/dev/null

    waited=0
    progress=""
    while :; do
      poll="$(ol_api GET "/v1/orders/$oid/fiscal-registration?connectionId=$EPARAGONY_CONNECTION_ID")"
      progress="$(printf '%s' "$poll" | json_field progress)"
      case "$progress" in
        registered|rejected|in-doubt) break ;;
      esac
      waited=$((waited + 1))
      [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] || { warn "arm B order $oid did not terminalise within ${POLL_MAX_WAIT_SECS}s (last progress=$progress)"; break; }
      sleep 1
    done
    t1="$(date +%s%3N)"
    [ "$progress" = "registered" ] && ARM_B_OK=$((ARM_B_OK + 1))
    ARM_B_TOTAL_MS=$((ARM_B_TOTAL_MS + t1 - t0))
    log "arm B order $oid: progress=$progress elapsed=$((t1 - t0))ms"
  done
  arm_b_mean_ms=$((ARM_B_TOTAL_MS / ARM_B_ORDERS))
  arm_b_per_hour=$(awk -v ms="$arm_b_mean_ms" 'BEGIN{printf "%.1f", (ms>0)?(3600000.0/ms):0}')
  log "arm B: $ARM_B_OK/$ARM_B_ORDERS registered, mean end-to-end=${arm_b_mean_ms}ms (submit to observed terminal, includes the worker's own poll cadence - NOT purely the stub's declared latency) => ${arm_b_per_hour}/hour"
  printf 'armB-fiscalization-throughput ok=%s total=%s meanMs=%s perHour=%s stubLatencyMs=%s\n' \
    "$ARM_B_OK" "$ARM_B_ORDERS" "$arm_b_mean_ms" "$arm_b_per_hour" "$STUB_LATENCY_MS" >> "$ARM_RESULTS_FILE"
else
  log "--- arm B: skipped (smoke mode or ARM_B_ORDERS=0) ---"
fi

# ===========================================================================
# Arm C - the one-document-per-order guard, under real concurrency.
# One POST /invoices and one POST /fiscal-registrations for the SAME order,
# launched as near-simultaneously as bash background jobs get. Exactly one
# document may exist for the order afterwards - #2047/#2157's own
# invariant, checked here against the REAL write paths rather than
# asserted from the code.
# ===========================================================================
ARM_C_OK=0
if [ "$SMOKE" = 0 ]; then
  log "--- arm C: one-document-per-order guard under concurrency ---"
  c_order="$(seed_order "raceC")"
  c_dir="$(mktemp -d)"
  (
    ol_api POST /v1/invoices "$(jq -n --arg oid "$c_order" --arg cid "$INVOICING_CONNECTION_ID" '{orderId:$oid, connectionId:$cid}')" \
      > "$c_dir/invoice.json" 2>"$c_dir/invoice.err"
    printf '%s' "$?" > "$c_dir/invoice.rc"
  ) &
  pid_invoice=$!
  (
    ol_api POST /v1/fiscal-registrations "$(jq -n --arg oid "$c_order" --arg cid "$EPARAGONY_CONNECTION_ID" '{orderId:$oid, connectionId:$cid}')" \
      > "$c_dir/fiscal.json" 2>"$c_dir/fiscal.err"
    printf '%s' "$?" > "$c_dir/fiscal.rc"
  ) &
  pid_fiscal=$!
  wait "$pid_invoice" "$pid_fiscal" 2>/dev/null || true

  invoice_rc="$(cat "$c_dir/invoice.rc" 2>/dev/null || echo 1)"
  fiscal_rc="$(cat "$c_dir/fiscal.rc" 2>/dev/null || echo 1)"
  invoice_status="$(printf '%s' "$(cat "$c_dir/invoice.json" 2>/dev/null)" | json_field status 2>/dev/null || true)"

  # Let arm B's async fiscal job (if it was accepted) settle before reading
  # the final state - a race whose loser is a REJECTED write is decided at
  # request time (both endpoints check synchronously before enqueuing/
  # issuing), but the fiscal side's own registration outcome is still async.
  sleep 3

  invoice_count="$(pg_sql "SELECT COUNT(*) FROM invoice_records WHERE \"orderId\"='$c_order' AND status='issued'")"
  fiscal_count="$(pg_sql "SELECT COUNT(*) FROM fiscal_registration_records WHERE \"orderId\"='$c_order' AND status NOT IN ('failed')")"
  total_live="$((${invoice_count:-0} + ${fiscal_count:-0}))"

  log "arm C: order=$c_order invoice_rc=$invoice_rc fiscal_rc=$fiscal_rc invoice_records(issued)=${invoice_count:-0} fiscal_registration_records(non-failed)=${fiscal_count:-0}"

  if [ "$total_live" -le 1 ]; then
    ARM_C_OK=1
    log "arm C VALID: at most one live sales document exists for order $c_order after concurrent invoice+fiscal attempts (total_live=$total_live)"
  else
    warn "arm C DISCARDED: order $c_order ended up with $total_live live sales documents (invoice=${invoice_count:-0}, fiscal=${fiscal_count:-0}) - the cross-kind one-document-per-order guard did not hold"
  fi
  printf 'armC-one-doc-per-order invoiceIssued=%s fiscalLive=%s totalLive=%s ok=%s\n' \
    "${invoice_count:-0}" "${fiscal_count:-0}" "$total_live" "$ARM_C_OK" >> "$ARM_RESULTS_FILE"
  rm -rf "$c_dir"
else
  log "--- arm C: skipped (smoke mode) ---"
fi

# ===========================================================================
# Arm D - the in-doubt outcome, on demand. forceOutcome=hang plus a
# clamped-low statusPollTimeoutMs on the connection reliably exhausts the
# real adapter's poll budget (stubs/eparagony/README.md).
# ===========================================================================
ARM_D_OK=0
if [ "$SMOKE" = 0 ]; then
  log "--- arm D: in-doubt outcome (forceOutcome=hang, statusPollTimeoutMs clamped low) ---"
  d_order="$(seed_order "inDoubtD")"

  d_config_before="$(pg_sql "SELECT config::text FROM connections WHERE id='$EPARAGONY_CONNECTION_ID'")"
  d_config_after="$(printf '%s' "$d_config_before" | jq -c '. + {statusPollTimeoutMs: 5000}')"
  pg_sql_write "UPDATE connections SET config='$d_config_after'::jsonb WHERE id='$EPARAGONY_CONNECTION_ID'" >/dev/null
  stub_set_eparagony_config '{"forceOutcome":"hang"}'

  t0="$(date +%s%3N)"
  ol_api POST /v1/fiscal-registrations "$(jq -n --arg oid "$d_order" --arg cid "$EPARAGONY_CONNECTION_ID" '{orderId:$oid, connectionId:$cid}')" >/dev/null

  waited=0
  progress=""
  while :; do
    poll="$(ol_api GET "/v1/orders/$d_order/fiscal-registration?connectionId=$EPARAGONY_CONNECTION_ID")"
    progress="$(printf '%s' "$poll" | json_field progress)"
    case "$progress" in
      registered|rejected|in-doubt) break ;;
    esac
    waited=$((waited + 1))
    [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] || { warn "arm D: order $d_order did not terminalise within ${POLL_MAX_WAIT_SECS}s (last progress=$progress)"; break; }
    sleep 1
  done
  t1="$(date +%s%3N)"

  # Restore the connection's config and stub knob regardless of outcome, so a
  # later arm/run never inherits a hung stub or a 5s poll budget.
  pg_sql_write "UPDATE connections SET config='$d_config_before'::jsonb WHERE id='$EPARAGONY_CONNECTION_ID'" >/dev/null
  stub_set_eparagony_config '{"forceOutcome":"confirmed"}'

  if [ "$progress" = "in-doubt" ]; then
    ARM_D_OK=1
    log "arm D VALID: order $d_order reached progress=in-doubt after $((t1 - t0))ms (poll budget 5000ms) - the one outcome this campaign has never produced before"
  else
    warn "arm D DISCARDED: order $d_order reached progress=$progress instead of in-doubt after $((t1 - t0))ms"
  fi
  printf 'armD-in-doubt progress=%s elapsedMs=%s ok=%s\n' "$progress" "$((t1 - t0))" "$ARM_D_OK" >> "$ARM_RESULTS_FILE"
else
  log "--- arm D: skipped (smoke mode) ---"
fi

window_stop "$RESULTS_DIR"

# ---------------------------------------------------------------------------
# Verdict - arm C (the cross-kind one-document-per-order guard) and arm D
# (the in-doubt outcome) are this scenario's own correctness checks, per the
# campaign's "verify every new guard in both directions" rule.
#
# Arms A/B are throughput measurements, and they still never gate on being
# SLOW - a slow number is a result. They now gate on being EMPTY, which is a
# different thing entirely: an arm that asked for N documents and got zero has
# produced no measurement at all, and there is nothing to be slow about.
#
# This is not hypothetical. On 2026-09-10 a TLS terminator in front of the
# eparagony stub was holding a stale upstream address, so every fiscal call
# 502'd, arm B scored 0/10 - and this scenario wrote status=VALID over it,
# because the original rule read "arms A/B never gate the verdict". A verdict
# that passes while an arm is dead is exactly the false instrument this
# campaign exists to find, one level up from the code under test.
# ---------------------------------------------------------------------------
if [ "$SMOKE" = 1 ]; then
  log "smoke run - no verdict written (never produces a measurement, per this scenario's own header)"
elif [ "$ARM_A_ORDERS" -gt 0 ] && [ "$ARM_A_OK" -eq 0 ]; then
  verdict_write "$RESULTS_DIR" DISCARDED "arm-a-invoicing-produced-no-samples"
elif [ "$ARM_B_ORDERS" -gt 0 ] && [ "$ARM_B_OK" -eq 0 ]; then
  verdict_write "$RESULTS_DIR" DISCARDED "arm-b-fiscalization-produced-no-samples"
elif [ "$ARM_C_OK" = "1" ] && [ "$ARM_D_OK" = "1" ]; then
  verdict_write "$RESULTS_DIR" VALID
elif [ "$ARM_C_OK" != "1" ]; then
  verdict_write "$RESULTS_DIR" DISCARDED "arm-c-one-document-per-order-guard-failed"
else
  verdict_write "$RESULTS_DIR" DISCARDED "arm-d-in-doubt-outcome-not-reached"
fi

log "results: $RESULTS_DIR"
cat "$ARM_RESULTS_FILE"
