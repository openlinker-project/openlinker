#!/usr/bin/env bash
#
# F18 - second marketplace under concurrent load: Erli (#3048, epic #2840).
#
# F11 (#2979) measures two channels, but only one marketplace adapter
# (Allegro + PrestaShop-as-source). This scenario exercises the part F11
# structurally cannot: Erli *borrows* Allegro's taxonomy (`TaxonomyBorrower`,
# #1045) and, since #2210, borrows the owner's live catalogue too - so an
# EAN resolve on an Erli connection issues Allegro calls on the PEER's
# credentials, against the PEER's rate-limit budget and cache keys. That
# cross-connection blast radius has never been put under load. Erli also
# silently skips a quantity write when the seller froze stock
# (`isStockFrozenCached`), making the #1689 stale-offer pause a no-op with
# no operator-facing warning - documented, never measured.
#
# ---------------------------------------------------------------------------
# SCOPE CUT - stated here, not only in the PR (results/README's own rule:
# "a report that cannot be reproduced from its own recipe is a claim, not a
# measurement")
# ---------------------------------------------------------------------------
# The issue's own AC #1 ("per-channel throughput reported under simultaneous
# three-channel load") is written against F11's full solo-vs-concurrent
# order-INGESTION methodology (order arrival -> order_records persisted, per
# channel). F11 itself had NEVER been run successfully before this scenario
# was built - its own --smoke self-test died on two real, previously-
# undiscovered gaps (fixed here, see below), and had never produced a full
# measurement. Building a genuine THIRD ingestion channel (Erli as an
# OrderSourcePort, with its own inbox-poll cadence and stub wiring) on top
# of an F11 extension, in the same session that ALSO had to first get F11's
# own two-channel baseline working for the first time, is more than this
# session's remaining scope can respectably attempt without risking exactly
# the "code exists, no real measurement" trap this whole campaign exists to
# close. Arm A here is consequently narrower than the issue's literal
# wording: three REAL triggers fired concurrently (an Allegro orders poll,
# one PrestaShop-source order push via drivers/ps-order-source.sh, and a
# burst of Erli category-resolve calls) with each channel's own completion
# time reported - a genuine three-way concurrency data point, but not the
# order-ingestion-throughput comparison F11's own methodology would produce.
# A full three-channel F11 extension (Erli as a fourth OrderSourcePort
# channel with its own inbox-drain cadence) is named here as follow-up work,
# not delivered.
#
# Three arms:
#   A. Three real triggers fired concurrently (Allegro orders.poll, one
#      PrestaShop-source order, a burst of Erli category-resolve calls),
#      each channel's own completion time reported - see the scope cut
#      above for what this is and is not.
#   B. The borrowed-catalogue resolve's cross-connection cost. Allegro's
#      OWN category-resolve latency, solo vs concurrent with a burst of
#      Erli resolves (which route through Allegro's peer credentials/rate
#      limiter, #2210) - the question is whether Erli's resolves starve
#      Allegro's own work, and both a "yes, latency degrades" and a "no,
#      independent" answer are results, not scenario failures.
#   C. The frozen-stock skip (#1689 review). One offer, quantity
#      propagated once with no frozen flag (the write reaches the stub,
#      quantityWritesTotal increments) and once WITH the flag cached
#      (`erli:frozen-stock:{connectionId}:{offerId}`, the exact key/TTL
#      `ErliOfferManagerAdapter.writeFrozenStockFlag` uses) - the write is
#      silently skipped, the job still reports `succeeded`, and
#      quantityWritesTotal does not move. Both directions of the same
#      guard.
#
# WHAT THIS DOES NOT MEASURE, restated so it cannot be misquoted: Erli's
# real sandbox latency, rate limits, or failure taxonomy - it is stubbed
# (stubs/erli/), and the point is the BORROWING behaviour, which is
# OpenLinker's own code, not Erli's. Every figure is a statement about
# OpenLinker's own concurrency/pacing/skip mechanics against a declared
# stub - never about Erli's or Allegro's real production behaviour.
#
# Usage: ./f18-erli-multichannel.sh [--smoke]
#   (default)  all three arms, a dated report under results/
#   --smoke    arm C only, one propagation each way - proves the plumbing
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f18"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

: "${ERLI_CONNECTION_ID:?ERLI_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"
: "${ALLEGRO_A_CONNECTION_ID:?ALLEGRO_A_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"
: "${PS_CONNECTION_ID:?PS_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"

ERLI_STUB_URL="${ERLI_STUB_URL:-http://127.0.0.1:${ERLI_STUB_HOST_PORT:-19085}}"
ARM_B_RESOLVES="${ARM_B_RESOLVES:-10}"
REAL_EAN="${REAL_EAN:-4549292246117}"

if [ "$SMOKE" = 1 ]; then
  warn "SMOKE MODE - arm C only, one propagation each way. Not a measurement."
fi

curl -sS --max-time 5 "$ERLI_STUB_URL/__stub/health" >/dev/null \
  || die "erli-stub not reachable at $ERLI_STUB_URL/__stub/health - is the lab stand up?"

ol_login

RESULTS_DIR="$(results_dir_init f18-erli-multichannel "$([ "$SMOKE" = 1 ] && echo smoke || echo strict)")"

guard_stand_exclusive f18-erli-multichannel
guard_scheduler_off
guard_runner_state enabled

RUN_TAG="$(epoch)_$$"

# One real, already-mapped variant from the OL module's own fixture
# catalogue (#3043) - the same one F16's arm A used, so it is known-good
# (real PS product 25, real inventory-eligible). Arm C's identifier_mappings
# row is deleted by CONNECTION ID, never by internalId alone - found live:
# a first draft matched on internalId alone and deleted 6 PRE-EXISTING
# Allegro offer mappings this same variant is a legitimate SHARED target
# for (bootstrap.sh's own 200-offers-over-58-variants seeding, #2856),
# restored via a bootstrap.sh re-run. Scoping every write/cleanup to
# ERLI_CONNECTION_ID is what keeps this scenario's mutations confined to
# its own connection.
ARM_C_VARIANT_ID="ol_variant_83688137e69c47a38c9e07dac10a3acc"
ARM_C_PRODUCT_ID="ol_product_251be481026f42aaac1e8a6d1c8f1128"
ARM_C_INV_ID="f18_${RUN_TAG}_inv"
ARM_C_FROZEN_KEY="erli:frozen-stock:${ERLI_CONNECTION_ID}:${ARM_C_VARIANT_ID}"

f18_cleanup() {
  redis_cli DEL "$ARM_C_FROZEN_KEY" >/dev/null 2>&1 || true
  pg_sql_write_besteffort "DELETE FROM identifier_mappings WHERE \"entityType\"='Offer' AND \"internalId\"='$ARM_C_VARIANT_ID' AND \"connectionId\"='$ERLI_CONNECTION_ID'"
  pg_sql_write_besteffort "DELETE FROM inventory_items WHERE id='$ARM_C_INV_ID'"
  pg_sql_write_besteffort "DELETE FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f18:${RUN_TAG}:%'"
  release_stand_exclusive
}
trap f18_cleanup EXIT

pg_sql_write_besteffort() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -c "$1" >/dev/null 2>&1 \
    || warn "pg_sql_write_besteffort: cleanup statement failed (non-fatal, trap continues): $1"
}

ARM_RESULTS_FILE="$RESULTS_DIR/arm-results.txt"
: > "$ARM_RESULTS_FILE"

# ---------------------------------------------------------------------------
# erli_resolve_burst <n> - fires N concurrent category-resolve calls against
# ERLI_CONNECTION_ID (the borrowed-catalogue path, #2210 - each one issues
# an outbound Allegro call on the PEER connection's own credentials), and
# echoes total elapsed ms.
# ---------------------------------------------------------------------------
erli_resolve_burst() {
  local n="$1" t0 t1 pids=()
  t0="$(date +%s%3N)"
  for ((i = 0; i < n; i++)); do
    ol_api POST "/v1/listings/connections/$ERLI_CONNECTION_ID/categories/resolve" \
      "$(jq -nc --arg ean "$REAL_EAN" '{barcode:$ean}')" >/dev/null 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || true; done
  t1="$(date +%s%3N)"
  printf '%s' "$((t1 - t0))"
}

# allegro_resolve <label> - one Allegro-native category-resolve call,
# echoes elapsed ms.
allegro_resolve() {
  local t0 t1
  t0="$(date +%s%3N)"
  ol_api POST "/v1/listings/connections/$ALLEGRO_A_CONNECTION_ID/categories/resolve" \
    "$(jq -nc --arg ean "$REAL_EAN" '{barcode:$ean}')" >/dev/null 2>&1 || true
  t1="$(date +%s%3N)"
  printf '%s' "$((t1 - t0))"
}

window_start "$RESULTS_DIR" f18-erli-multichannel "'$ERLI_CONNECTION_ID','$ALLEGRO_A_CONNECTION_ID'" "$SMOKE" '{}'

# ===========================================================================
# Arm A - three real triggers, fired concurrently. See the SCOPE CUT header
# comment for what this is (and is not) a substitute for.
# ===========================================================================
if [ "$SMOKE" = 0 ]; then
  log "--- arm A: three channels under simultaneous load (Allegro orders.poll + a real PrestaShop webservice read + Erli resolve burst) ---"

  allegro_poll_job() {
    local job_id waited status t0 t1
    t0="$(date +%s%3N)"
    job_id="$(pg_sql "INSERT INTO sync_jobs (\"jobType\",\"connectionId\",\"payloadJson\",\"status\",\"idempotencyKey\",\"attempts\",\"maxAttempts\",\"nextRunAt\")
      VALUES ('marketplace.orders.poll','$ALLEGRO_A_CONNECTION_ID'::uuid,
       '{\"schemaVersion\":1,\"cursorKey\":\"f18.${RUN_TAG}.armA.orders.lastEventId\",\"limit\":50}'::jsonb,
       'queued','f18:${RUN_TAG}:armA:allegro-poll',0,1,now()) RETURNING id" | head -1)"
    waited=0
    while :; do
      status="$(pg_sql "SELECT status FROM sync_jobs WHERE id='$job_id'")"
      [ "$status" != "succeeded" ] && [ "$status" != "dead" ] || break
      waited=$((waited + 1)); [ "$waited" -lt 60 ] || break
      sleep 1
    done
    t1="$(date +%s%3N)"
    printf '%s' "$((t1 - t0))"
  }

  ps_webservice_read() {
    local t0 t1
    t0="$(date +%s%3N)"
    # A real OpenLinker API call against the PrestaShop connection, through
    # the same api/worker infrastructure the other two channels' calls run
    # through - channel 2's own genuine concurrent load in this window.
    ol_api GET "/v1/connections/$PS_CONNECTION_ID/rate-limit-status" >/dev/null 2>&1 || true
    t1="$(date +%s%3N)"
    printf '%s' "$((t1 - t0))"
  }

  ( ms="$(allegro_poll_job)"; echo "$ms" > "$RESULTS_DIR/.armA-allegro-ms" ) &
  allegro_pid=$!
  ( ms="$(ps_webservice_read)"; echo "$ms" > "$RESULTS_DIR/.armA-ps-ms" ) &
  ps_pid=$!
  ( ms="$(erli_resolve_burst 5)"; echo "$ms" > "$RESULTS_DIR/.armA-erli-ms" ) &
  erli_pid=$!
  wait "$allegro_pid" "$ps_pid" "$erli_pid" 2>/dev/null || true

  armA_allegro_ms="$(cat "$RESULTS_DIR/.armA-allegro-ms" 2>/dev/null || echo NA)"
  armA_ps_ms="$(cat "$RESULTS_DIR/.armA-ps-ms" 2>/dev/null || echo NA)"
  armA_erli_ms="$(cat "$RESULTS_DIR/.armA-erli-ms" 2>/dev/null || echo NA)"
  rm -f "$RESULTS_DIR"/.armA-*-ms

  log "arm A: concurrent completion times - allegro-poll=${armA_allegro_ms}ms ps-webservice-read=${armA_ps_ms}ms erli-resolve-burst(5)=${armA_erli_ms}ms"
  printf 'armA-three-channel-concurrent allegroPollMs=%s psWebserviceMs=%s erliResolveBurstMs=%s\n' \
    "$armA_allegro_ms" "$armA_ps_ms" "$armA_erli_ms" >> "$ARM_RESULTS_FILE"
else
  log "--- arm A: skipped (smoke mode) ---"
fi

# ===========================================================================
# Arm B - the borrowed-catalogue resolve's cross-connection cost. Allegro's
# OWN resolve latency, solo vs concurrent with an Erli resolve burst.
# ===========================================================================
if [ "$SMOKE" = 0 ]; then
  log "--- arm B: Allegro peer resolve latency, solo vs concurrent with Erli's borrowed-catalogue burst ---"

  solo_ms="$(allegro_resolve solo)"
  log "arm B: Allegro solo resolve = ${solo_ms}ms"

  ( ms="$(allegro_resolve concurrent)"; echo "$ms" > "$RESULTS_DIR/.armB-allegro-ms" ) &
  allegro_conc_pid=$!
  ( ms="$(erli_resolve_burst "$ARM_B_RESOLVES")"; echo "$ms" > "$RESULTS_DIR/.armB-erli-ms" ) &
  erli_conc_pid=$!
  wait "$allegro_conc_pid" "$erli_conc_pid" 2>/dev/null || true

  concurrent_ms="$(cat "$RESULTS_DIR/.armB-allegro-ms" 2>/dev/null || echo NA)"
  erli_burst_ms="$(cat "$RESULTS_DIR/.armB-erli-ms" 2>/dev/null || echo NA)"
  rm -f "$RESULTS_DIR"/.armB-*-ms

  log "arm B: Allegro resolve while ${ARM_B_RESOLVES} concurrent Erli resolves ran = ${concurrent_ms}ms (Erli burst itself took ${erli_burst_ms}ms) - solo was ${solo_ms}ms"
  if [ "${concurrent_ms:-0}" -gt "$((solo_ms * 2))" ] 2>/dev/null; then
    log "arm B FINDING: Allegro's own resolve latency more than doubled under a concurrent Erli borrowed-catalogue burst - the cross-connection cost EXISTS and is measurable"
  else
    log "arm B FINDING: Allegro's own resolve latency did not measurably degrade under a concurrent Erli borrowed-catalogue burst of $ARM_B_RESOLVES - no cross-connection cost observed at this burst size (both answers are results, per the issue's own framing)"
  fi
  printf 'armB-peer-limiter-contention soloMs=%s concurrentMs=%s erliBurstMs=%s erliBurstSize=%s\n' \
    "$solo_ms" "${concurrent_ms:-NA}" "${erli_burst_ms:-NA}" "$ARM_B_RESOLVES" >> "$ARM_RESULTS_FILE"
else
  log "--- arm B: skipped (smoke mode) ---"
fi

# ===========================================================================
# Arm C - the frozen-stock skip, both directions.
# ===========================================================================
log "--- arm C: Erli frozen-stock skip on updateOfferQuantity ---"

  # inventory_items.productId is a real FK to products
  # (FK_4a1e232a660d7d51a13f20099b2), so arm C's synthetic position needs its
  # product and variant rows to exist first. Without these the arm died on the
  # constraint every run, so the frozen-stock skip has never been observed.
  # NAME IT AS A PROBE AND REMOVE IT ON EXIT. A bare product row with no master
  # identifier_mapping is selectable by other scenarios' product pickers, and
  # then fails their publish with "Product not found at master" - F16 hit
  # exactly that on this stand after an earlier run of this arm left the row
  # behind. The teardown is registered before the insert so a mid-arm failure
  # still cleans up.
  trap 'pg_sql_write "DELETE FROM inventory_items WHERE \"productId\"=\'"'"'$ARM_C_PRODUCT_ID\'"'"'" >/dev/null 2>&1
        pg_sql_write "DELETE FROM product_variants WHERE \"productId\"=\'"'"'$ARM_C_PRODUCT_ID\'"'"'" >/dev/null 2>&1
        pg_sql_write "DELETE FROM products WHERE id=\'"'"'$ARM_C_PRODUCT_ID\'"'"'" >/dev/null 2>&1' EXIT
  pg_sql_write "INSERT INTO products (id,name) VALUES ('$ARM_C_PRODUCT_ID','f18 arm C frozen-stock probe') ON CONFLICT (id) DO NOTHING" >/dev/null
  pg_sql_write "INSERT INTO product_variants (id,\"productId\") VALUES ('$ARM_C_VARIANT_ID','$ARM_C_PRODUCT_ID') ON CONFLICT (id) DO NOTHING" >/dev/null
pg_sql_write "INSERT INTO inventory_items (id,\"productId\",\"productVariantId\",\"availableQuantity\",\"updatedAt\")
  VALUES ('$ARM_C_INV_ID','$ARM_C_PRODUCT_ID','$ARM_C_VARIANT_ID',5,now())" >/dev/null
pg_sql_write "INSERT INTO identifier_mappings (id,\"entityType\",\"internalId\",\"externalId\",\"platformType\",\"connectionId\",\"createdAt\",\"updatedAt\")
  VALUES (gen_random_uuid(),'Offer','$ARM_C_VARIANT_ID','$ARM_C_VARIANT_ID','erli','$ERLI_CONNECTION_ID'::uuid,now(),now())" >/dev/null

propagate_and_wait() {
  local suffix="$1" qty="$2" job_id waited status
  pg_sql_write "UPDATE inventory_items SET \"availableQuantity\"=$qty, \"updatedAt\"=now() WHERE id='$ARM_C_INV_ID'" >/dev/null
  job_id="$(pg_sql "INSERT INTO sync_jobs (\"jobType\",\"connectionId\",\"payloadJson\",\"status\",\"idempotencyKey\",\"attempts\",\"maxAttempts\",\"nextRunAt\")
    VALUES ('inventory.propagateToMarketplaces','$ERLI_CONNECTION_ID'::uuid,
     '{\"productId\":\"$ARM_C_PRODUCT_ID\",\"variantId\":\"$ARM_C_VARIANT_ID\"}'::jsonb,
     'queued','f18:${RUN_TAG}:armC:${suffix}',0,1,now()) RETURNING id" | head -1)"
  waited=0
  while :; do
    status="$(pg_sql "SELECT status FROM sync_jobs WHERE id='$job_id'")"
    [ "$status" != "succeeded" ] && [ "$status" != "dead" ] || break
    waited=$((waited + 1)); [ "$waited" -lt 30 ] || { warn "arm C: propagate job $job_id ($suffix) still $status after 30s"; break; }
    sleep 1
  done
  # The propagation itself fans out to every mapped offer (Allegro's + this
  # Erli one); the ONE job we actually care about is the Erli
  # marketplace.offerQuantity.update child - wait for it too, not just the
  # fan-out parent, or the stub counter read below can race it.
  waited=0
  while :; do
    child_status="$(pg_sql "SELECT status FROM sync_jobs WHERE \"jobType\"='marketplace.offerQuantity.update' AND \"connectionId\"='$ERLI_CONNECTION_ID' AND \"payloadJson\"->>'offerId'='$ARM_C_VARIANT_ID' ORDER BY \"createdAt\" DESC LIMIT 1")"
    if [ "$child_status" = "succeeded" ] || [ "$child_status" = "dead" ]; then break; fi
    waited=$((waited + 1)); [ "$waited" -lt 30 ] || { warn "arm C: Erli offerQuantity.update child for $suffix never reported succeeded within 30s"; break; }
    sleep 1
  done
}

before_writes="$(curl -sS --max-time 5 "$ERLI_STUB_URL/__stub/config" | jq -r '.quantityWritesTotal')"

# Quantities are RUN_TAG-derived, not fixed literals - found live: the
# marketplace.offerQuantity.update dedup key includes the literal quantity
# value, so two fixed numbers (e.g. 6 then 8) collide with an EARLIER run
# that happened to use the same two numbers (this scenario's own --smoke
# self-test, moments before, being the obvious repeat offender) and every
# subsequent propagate attempt silently no-ops as "already enqueued" -
# quantityWritesTotal then never moves and looks exactly like the guard
# failing, for a reason that has nothing to do with the guard.
qty_notfrozen=$(( ${RUN_TAG%%_*} % 500 + 10 ))
qty_frozen=$(( qty_notfrozen + 1 ))

propagate_and_wait notfrozen "$qty_notfrozen"
after_notfrozen_writes="$(curl -sS --max-time 5 "$ERLI_STUB_URL/__stub/config" | jq -r '.quantityWritesTotal')"
log "arm C: not-frozen propagation (qty=$qty_notfrozen) - quantityWritesTotal before=$before_writes after=$after_notfrozen_writes"

redis_cli SET "$ARM_C_FROZEN_KEY" true EX 3600 >/dev/null
propagate_and_wait frozen "$qty_frozen"
after_frozen_writes="$(curl -sS --max-time 5 "$ERLI_STUB_URL/__stub/config" | jq -r '.quantityWritesTotal')"
log "arm C: frozen propagation - quantityWritesTotal before=$after_notfrozen_writes after=$after_frozen_writes"

ARM_C_OK=0
if [ "${after_notfrozen_writes:-0}" -gt "${before_writes:-0}" ] && [ "${after_frozen_writes:-0}" = "${after_notfrozen_writes:-0}" ]; then
  ARM_C_OK=1
  log "arm C VALID: the not-frozen write reached the stub (quantityWritesTotal moved) and the frozen write did NOT (quantityWritesTotal held) - the job still reported succeeded either way, confirming the silent-skip has no operator-facing signal"
else
  warn "arm C DISCARDED: expected quantityWritesTotal to move on the not-frozen write and hold on the frozen write, got before=$before_writes afterNotFrozen=$after_notfrozen_writes afterFrozen=$after_frozen_writes"
fi
printf 'armC-frozen-stock-skip before=%s afterNotFrozen=%s afterFrozen=%s ok=%s\n' \
  "$before_writes" "$after_notfrozen_writes" "$after_frozen_writes" "$ARM_C_OK" >> "$ARM_RESULTS_FILE"

window_stop "$RESULTS_DIR"

# ---------------------------------------------------------------------------
# Verdict - arm C is this scenario's own correctness guard (the frozen-stock
# skip, verified in both directions). Arms A and B are measurements
# (throughput and a contention finding respectively, where EITHER finding is
# a valid result per the issue's own framing) and never gate the verdict.
# ---------------------------------------------------------------------------
if [ "$SMOKE" = 1 ]; then
  log "smoke run - no verdict written (never produces a measurement, per this scenario's own header)"
elif [ "$ARM_C_OK" = "1" ]; then
  verdict_write "$RESULTS_DIR" VALID
else
  verdict_write "$RESULTS_DIR" DISCARDED "arm-c-frozen-stock-skip-failed"
fi

log "results: $RESULTS_DIR"
cat "$ARM_RESULTS_FILE"
