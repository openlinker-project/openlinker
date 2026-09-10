#!/usr/bin/env bash
#
# F15 - shipping under load: label, waybill relay, tracking (#3045, epic
# #2840).
#
# Three shipped mechanisms have never been measured: `ShipmentDispatchService`
# (label purchase, serialised per order), the `Shipment.waybillRelayedAt`
# at-most-once claim (#1947, including its claim-then-release-on-failure
# path), and `ShipmentStatusSyncService`'s `null -> value` tracking backfill,
# which relays a SECOND `dispatched` event once a late-minted waybill
# arrives. `ShippingProviderManagerPort` is still a FUTURE capability port
# (docs/architecture-overview.md), so this scenario resolves it through the
# `mappings` context's fulfillment-routing rules - the real seam
# `ShipmentDispatchService.dispatch` actually uses - never a hand-rolled
# adapter call.
#
# Three arms:
#   A. Label purchase throughput, N distinct orders, against
#      `shipping-stub` (#3043) at a declared latency, with
#      `mintTrackingImmediately: true` (the synchronous label + waybill
#      case). What binds throughput here is stated as a finding, not
#      assumed: `ShipmentDispatchService.dispatch` takes a per-ORDER lock
#      (#1917), so DISTINCT orders never contend on it - this arm's
#      ceiling is the stub's declared latency times one caller, never the
#      lock.
#   B. The late-waybill relay claim (#1947). One label purchased with
#      `mintTrackingImmediately: false` (trackingNumber stays `null` -
#      ShipX's real shape, per stubs/shipping/README.md), then
#      `marketplace.shipment.statusSync` is hand-enqueued (rather than
#      waiting on its cron) against the shipping-stub connection, which
#      reads the stub's now-late-minted tracking number and claims
#      `waybillRelayedAt` - the ONE claim this arm exists to observe, not
#      the happy-path synchronous mint arm A already exercises.
#   C. A transient relay failure on the SAME `waybillRelayedAt` claim arm B
#      exercises - not `notify-dispatched` (a different idempotency
#      mechanism entirely, the shipment's own status gate, which never
#      touches `waybillRelayedAt`). A label is dispatched against a real
#      WooCommerce order (the destination participant); `lab-wc-tls` is
#      stopped for the FIRST late-tracking statusSync sweep (a real
#      connection-refused network fault), confirming the claim was NOT
#      taken and the tracking number NOT persisted (#1947's own
#      release-on-`rejected`-target rule - "never persist the number while
#      holding the claim"); `lab-wc-tls` is restarted and the SAME sweep
#      re-run, confirming both land cleanly. Both directions of the SAME
#      guard, per the campaign's own rule - not two different assertions.
#      (allegro-stub was tried first and rejected: it has no
#      `PUT .../fulfillment` route at all - a structural 404 identical
#      whether the container is up or down, so it cannot demonstrate
#      release-then-retry. Already named in f13-writeback.sh's own
#      committed report.)
#
# WHAT THE STUB DOES AND DOES NOT MODEL (stubs/shipping/README.md, restated
# so it cannot be misquoted): it is a REAL `ShippingProviderManagerPort`
# adapter (@openlinker/integrations-shipping-stub) making a real HTTP call
# through the real dispatch/status-sync code paths - fake only in what it
# talks to. It does NOT model cancellation, pickup-point search, insurance,
# COD, a genuinely invalid label request, or the webhook-driven tracking
# path (only poll-based backfill). Every figure below is a statement about
# OpenLinker's own dispatch/relay/claim mechanics against a declared stub
# latency - never about InPost, DPD Polska, or any real carrier's
# throughput or failure taxonomy.
#
# Usage: ./f15-shipping.sh [--smoke]
#   (default)  all three arms, a dated report under results/
#   --smoke    arm A only, 2 labels - proves the plumbing
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f15"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

: "${SHIPPING_CONNECTION_ID:?SHIPPING_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"
: "${ALLEGRO_A_CONNECTION_ID:?ALLEGRO_A_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"
: "${PS_CONNECTION_ID:?PS_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"

SHIPPING_STUB_URL="${SHIPPING_STUB_URL:-http://127.0.0.1:${SHIPPING_STUB_HOST_PORT:-19086}}"
ARM_A_LABELS="${ARM_A_LABELS:-10}"
STUB_LATENCY_MS="${STUB_LATENCY_MS:-500}"

if [ "$SMOKE" = 1 ]; then
  ARM_A_LABELS=2
  warn "SMOKE MODE - arm A only, 2 labels. Not a measurement."
fi

curl -sS --max-time 5 "$SHIPPING_STUB_URL/__stub/health" >/dev/null \
  || die "shipping-stub not reachable at $SHIPPING_STUB_URL/__stub/health - is the lab stand up?"

ol_login

RESULTS_DIR="$(results_dir_init f15-shipping "$([ "$SMOKE" = 1 ] && echo smoke || echo strict)")"

# guard_build FIRST: without it the manifest records gitSha=unknown, so the
# figures cannot be tied to the code that produced them - and nothing checks
# that the running image is the tree under test. Both halves matter; the sha is
# the record, the tree comparison is the verification (#2854).
guard_build
guard_stand_exclusive f15-shipping
guard_scheduler_off
guard_runner_state enabled
guard_connection_endpoints "$SHIPPING_CONNECTION_ID"

RUN_TAG="$(epoch)_$$"
SOURCE_DELIVERY_METHOD_ID="f15-kurier-${RUN_TAG}"

pg_sql_write_besteffort() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -c "$1" >/dev/null 2>&1 \
    || warn "pg_sql_write_besteffort: cleanup statement failed (non-fatal, trap continues): $1"
}

f15_cleanup() {
  pg_sql_write_besteffort "DELETE FROM shipments WHERE \"orderId\" LIKE 'f15_${RUN_TAG}_%'"
  # lab-wc-tls is stopped by arm C; a script killed mid-arm must not leave
  # it down for every OTHER scenario on this shared stand.
  docker start lab-wc-tls >/dev/null 2>&1 || true
  release_stand_exclusive
}
trap f15_cleanup EXIT

# ---------------------------------------------------------------------------
# The routing rule this scenario needs: without one, `dispatch()` falls back
# to the `omp_fulfilled` DEFAULT (mappings.fulfillment-routing.service.ts's
# own header) and never calls a `ShippingProviderManagerPort` adapter at
# all - the whole mechanism this scenario exists to measure. Scoped under
# ALLEGRO_A (a real, pre-existing OrderSource connection) rather than a
# throwaway one, so the rule is a realistic "divert this marketplace's
# delivery method to an OL-managed carrier" configuration, not a synthetic
# fixture with no analogue in the product.
# ---------------------------------------------------------------------------
log "--- fulfillment-routing rule: $SOURCE_DELIVERY_METHOD_ID -> ol_managed_carrier/$SHIPPING_CONNECTION_ID ---"
ol_api PUT "/v1/connections/$ALLEGRO_A_CONNECTION_ID/routing-rules" \
  "$(jq -n --arg m "$SOURCE_DELIVERY_METHOD_ID" --arg c "$SHIPPING_CONNECTION_ID" \
    '{items: [{sourceDeliveryMethodId: $m, processorKind: "ol_managed_carrier", processorConnectionId: $c}]}')" >/dev/null

stub_set_shipping_config() {
  curl -sS --max-time 5 -X PUT "$SHIPPING_STUB_URL/__stub/config" \
    -H 'Content-Type: application/json' -d "$1" >/dev/null \
    || die "could not PUT shipping-stub config: $1"
}

RECIPIENT_JSON='{"email":"f15-perf@example.test","phone":"+48500100100","address":{"street":"Testowa","buildingNumber":"1","city":"Warszawa","postCode":"00-001","countryCode":"PL"}}'
PARCEL_JSON='{"dimensions":{"length":200,"width":150,"height":100},"weightGrams":500}'

generate_label() {
  local order_id="$1"
  ol_api POST /v1/shipments/generate-label \
    "$(jq -n --arg src "$ALLEGRO_A_CONNECTION_ID" --arg method "$SOURCE_DELIVERY_METHOD_ID" \
      --arg oid "$order_id" --argjson recipient "$RECIPIENT_JSON" --argjson parcel "$PARCEL_JSON" \
      '{sourceConnectionId: $src, sourceDeliveryMethodId: $method, orderId: $oid,
        shippingMethod: "kurier", recipient: $recipient, parcel: $parcel}')"
}

# seed_wc_order <label> - creates a REAL WooCommerce order via its own REST
# API and echoes its external id. Both the relay-claim arms (B and C) need
# an ACTUALLY-EXISTING destination participant to relay into - a fabricated
# external id (this scenario's own first draft used one against Allegro)
# 404s at the writeback adapter's one outbound call, which stays `generated`
# (retriable) rather than `dispatched` and never opens the late-relay gate
# at all. Credentials are encrypted at rest (ConnectionRepository never
# exposes them plain) - read the same way every other scenario on this
# stand does, from stand-ids.env.
seed_wc_order() {
  local label="$1"
  : "${WC_CONSUMER_KEY:?WC_CONSUMER_KEY not set - source stand-ids.env (bootstrap.sh) first}"
  : "${WC_CONSUMER_SECRET:?WC_CONSUMER_SECRET not set - source stand-ids.env (bootstrap.sh) first}"
  docker exec -e NODE_TLS_REJECT_UNAUTHORIZED=0 "$(discover_worker_containers | awk '{print $1}')" node -e "
    const ck='$WC_CONSUMER_KEY', cs='$WC_CONSUMER_SECRET';
    const auth = Buffer.from(ck+':'+cs).toString('base64');
    fetch('https://wc-tls/wp-json/wc/v3/orders', {method:'POST',
      headers:{'Authorization':'Basic '+auth,'Content-Type':'application/json'},
      body: JSON.stringify({status:'processing', billing:{first_name:'F15',last_name:'$label',email:'f15-$label@example.test'}})
    }).then(async r => { const b = await r.json(); process.stdout.write(String(b.id || '')); });
  "
}

ARM_RESULTS_FILE="$RESULTS_DIR/arm-results.txt"
: > "$ARM_RESULTS_FILE"

# enqueue_status_sync <idempotency_key> <cursor_key> - inserts a
# `marketplace.shipment.statusSync` job and BLOCKS until THAT SPECIFIC job
# reaches `succeeded`. Polling the shipment row instead (an earlier draft
# did exactly this) is unsound on a connection carrying more than one
# shipment: `pollsUntilTracking:1` mints the late tracking number on the
# FIRST per-shipment read inside the sweep, so a caller watching the
# shipment table sees success and moves on while the sweep is still
# running the rest of its page - and because `MarketplaceShipmentStatusSyncHandler`
# takes a per-CONNECTION `SyncLockPort` lock for the whole sweep, the next
# arm's own job (enqueued on the same connection) is then silently SKIPPED
# ("already in progress", still reported `succeeded` - a no-op, not a
# failure) rather than actually running. Found live: arm C's fail-phase and
# retry-phase jobs both skipped this way while arm B's own job was still
# mid-sweep, so `waybillRelayedAt` never moved in either direction and the
# arm read DISCARDED for a reason that had nothing to do with the guard
# under test.
enqueue_status_sync() {
  local idem_key="$1" cursor_key="$2" job_id waited status
  # `psql -tA` suppresses column headers/row counts for a SELECT but NOT the
  # `INSERT 0 1` command tag that follows a `RETURNING` clause's own output
  # row - found live ("invalid input syntax for type uuid" on the very next
  # query, because $job_id captured both lines). `head -1` keeps only the id.
  job_id="$(pg_sql "INSERT INTO sync_jobs
      (\"jobType\",\"connectionId\",\"payloadJson\",\"status\",\"idempotencyKey\",\"attempts\",\"maxAttempts\",\"nextRunAt\")
    VALUES
      ('marketplace.shipment.statusSync','$SHIPPING_CONNECTION_ID'::uuid,
       '{\"schemaVersion\":1,\"limit\":50,\"cursorKey\":\"$cursor_key\"}'::jsonb,
       'queued','$idem_key',0,1,now())
    RETURNING id" | head -1)"
  [ -n "$job_id" ] || die "enqueue_status_sync: INSERT ... RETURNING id returned nothing for $idem_key"
  waited=0
  while :; do
    status="$(pg_sql "SELECT status FROM sync_jobs WHERE id='$job_id'")"
    [ "$status" != "succeeded" ] && [ "$status" != "dead" ] || break
    waited=$((waited + 1))
    [ "$waited" -lt 30 ] || { warn "enqueue_status_sync: job $job_id ($idem_key) still $status after 30s"; break; }
    sleep 1
  done
  [ "$status" = "succeeded" ] || warn "enqueue_status_sync: job $job_id ($idem_key) ended status=$status, not succeeded"
}

window_start "$RESULTS_DIR" f15-shipping "'$SHIPPING_CONNECTION_ID'" "$SMOKE" \
  "$(jq -n --argjson lat "$STUB_LATENCY_MS" '{shippingStubLatencyMs: $lat}')"

# ===========================================================================
# Arm A - label purchase throughput, mintTrackingImmediately=true (the
# synchronous happy path).
# ===========================================================================
log "--- arm A: label purchase throughput ($ARM_A_LABELS labels, stub latency=${STUB_LATENCY_MS}ms) ---"
stub_set_shipping_config "$(jq -n --argjson lat "$STUB_LATENCY_MS" '{latencyMs:$lat, mintTrackingImmediately:true}')"
ARM_A_OK=0
ARM_A_TOTAL_MS=0
for ((i = 0; i < ARM_A_LABELS; i++)); do
  order_id="f15_${RUN_TAG}_armA_$i"
  t0="$(date +%s%3N)"
  resp="$(generate_label "$order_id")"
  t1="$(date +%s%3N)"
  kind="$(printf '%s' "$resp" | json_field kind)"
  tracking="$(printf '%s' "$resp" | jq -r '.shipment.trackingNumber // empty')"
  [ "$kind" = "dispatched" ] && [ -n "$tracking" ] && ARM_A_OK=$((ARM_A_OK + 1))
  ARM_A_TOTAL_MS=$((ARM_A_TOTAL_MS + t1 - t0))
done
arm_a_mean_ms=$((ARM_A_TOTAL_MS / ARM_A_LABELS))
arm_a_per_hour=$(awk -v ms="$arm_a_mean_ms" 'BEGIN{printf "%.1f", (ms>0)?(3600000.0/ms):0}')
log "arm A: $ARM_A_OK/$ARM_A_LABELS labels issued with an immediate tracking number, mean=${arm_a_mean_ms}ms => ${arm_a_per_hour}/hour (single caller; ShipmentDispatchService's per-order lock never contends across DISTINCT orders, so the binding constraint here is the stub's declared latency times one caller, not the lock)"
printf 'armA-label-throughput ok=%s total=%s meanMs=%s perHour=%s stubLatencyMs=%s\n' \
  "$ARM_A_OK" "$ARM_A_LABELS" "$arm_a_mean_ms" "$arm_a_per_hour" "$STUB_LATENCY_MS" >> "$ARM_RESULTS_FILE"

# ===========================================================================
# Arm B - the late-waybill relay claim (#1947). mintTrackingImmediately=false
# so `generate-label` returns trackingNumber=null (ShipX's real shape); the
# statusSync job is hand-enqueued so this arm does not wait on its cron.
# ===========================================================================
ARM_B_OK=0
if [ "$SMOKE" = 0 ]; then
  log "--- arm B: late-waybill relay claim ---"
  stub_set_shipping_config '{"mintTrackingImmediately":false,"pollsUntilTracking":1}'
  b_order_id="f15_${RUN_TAG}_armB"

  # `ShipmentStatusSyncService`'s late-tracking relay is gated to shipments
  # already past the OPERATOR-dispatch step (status `dispatched`/`in_transit`
  # only, PUSH_GATE_OPEN_FROM) - a freshly-labelled shipment sits at
  # `generated` and only backfills the tracking DATA field, never claiming
  # `waybillRelayedAt` at all (found live: the first draft of this arm
  # generated a label and went straight to the statusSync sweep, so tracking
  # backfilled correctly but the claim never even attempted - a gate working
  # as designed, not a defect). So this arm also needs an order/identifier-
  # mapping pair naming a REAL destination participant (a fabricated Allegro
  # external id 404s at the writeback call and leaves the shipment at
  # `generated` forever - found live on the next draft) and a
  # `notify-dispatched` call to cross that gate BEFORE the late tracking
  # number ever arrives - matching the real ShipX shape the whole arm is
  # meant to exercise.
  b_wc_order_id="$(seed_wc_order armB)"
  [ -n "$b_wc_order_id" ] || die "arm B: could not seed a real WooCommerce order"
  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    VALUES
      ('$b_order_id','$ALLEGRO_A_CONNECTION_ID'::uuid,
       '{\"totals\":{\"currency\":\"PLN\",\"total\":10.00}}'::jsonb,
       '[]'::jsonb,'ready',now(),now())" >/dev/null
  pg_sql_write "INSERT INTO identifier_mappings
      (id,\"entityType\",\"internalId\",\"externalId\",\"platformType\",\"connectionId\",\"createdAt\",\"updatedAt\")
    VALUES
      (gen_random_uuid(),'Order','$b_order_id','$b_wc_order_id','woocommerce','$WC_CONNECTION_ID'::uuid,now(),now())" >/dev/null

  resp="$(generate_label "$b_order_id")"
  b_shipment_id="$(printf '%s' "$resp" | jq -r '.shipment.id // empty')"
  b_tracking0="$(printf '%s' "$resp" | jq -r '.shipment.trackingNumber // empty')"
  [ -n "$b_shipment_id" ] || die "arm B: generate-label returned no shipment id: $resp"
  log "arm B: shipment=$b_shipment_id created with trackingNumber=${b_tracking0:-<null>} (expected null - mintTrackingImmediately=false)"

  ol_api POST "/v1/shipments/$b_shipment_id/notify-dispatched" >/dev/null
  b_status_after_notify="$(pg_sql "SELECT status FROM shipments WHERE id='$b_shipment_id'")"
  log "arm B: notify-dispatched crossed the operator-dispatch gate (status=$b_status_after_notify)"

  before_relayed="$(pg_sql "SELECT \"waybillRelayedAt\" FROM shipments WHERE id='$b_shipment_id'")"

  enqueue_status_sync "f15:statusSync:${RUN_TAG}" "f15.${RUN_TAG}.shipmentStatus.scanOffset"

  after_tracking="$(pg_sql "SELECT \"trackingNumber\" FROM shipments WHERE id='$b_shipment_id'")"
  after_relayed="$(pg_sql "SELECT \"waybillRelayedAt\" FROM shipments WHERE id='$b_shipment_id'")"
  log "arm B: after statusSync - trackingNumber=${after_tracking:-<null>} waybillRelayedAt: before=${before_relayed:-<null>} after=${after_relayed:-<null>}"
  if [ -n "$after_tracking" ] && [ -z "${before_relayed:-}" ] && [ -n "${after_relayed:-}" ]; then
    ARM_B_OK=1
    log "arm B VALID: the null -> value tracking transition claimed waybillRelayedAt exactly once (before=<null>, after=$after_relayed)"
  else
    warn "arm B DISCARDED: expected before=<null> after=<non-null>, got before=${before_relayed:-<null>} after=${after_relayed:-<null>} (tracking=${after_tracking:-<null>})"
  fi
  printf 'armB-late-waybill-relay trackingBefore=%s trackingAfter=%s relayedAtBefore=%s relayedAtAfter=%s ok=%s\n' \
    "${b_tracking0:-null}" "${after_tracking:-null}" "${before_relayed:-null}" "${after_relayed:-null}" "$ARM_B_OK" >> "$ARM_RESULTS_FILE"
else
  log "--- arm B: skipped (smoke mode) ---"
fi

# ===========================================================================
# Arm C - a transient relay failure, then release-and-retry, on the SAME
# claim arm B exercises (`waybillRelayedAt`, via `relayWaybillToParticipants`
# inside `ShipmentStatusSyncService` - NOT `notify-dispatched`, which owns a
# DIFFERENT idempotency mechanism entirely, the shipment's own status gate,
# and never touches `waybillRelayedAt` at all - found live while building
# this arm: an early draft toggled `notify-dispatched` against a stopped/
# started allegro-stub and observed `waybillRelayedAt` staying null in BOTH
# directions, because that call was never the right lever).
#
# The relay's failure mode here is a DESTINATION going transiently
# unreachable, not the source: `allegro-stub` has no `PUT .../fulfillment`
# route at all (a structural 404, "no route" - the SAME finding
# f13-writeback.sh's own committed report already names: "the stub serves
# neither [fulfillment-status PUT nor shipment-tracking GET] endpoint"), so
# toggling it produces an identical outcome whether it is up or down and
# cannot demonstrate release-then-retry. A destination that is fully
# functional when reachable - WooCommerce - is a genuine transient-failure
# lever instead: `wc-tls` (the TLS front `WooCommerceProductPublisherAdapter`
# actually calls) stopped is a real connection-refused network fault, and
# restarted is the identical request succeeding.
# ===========================================================================
ARM_C_OK=0
if [ "$SMOKE" = 0 ]; then
  log "--- arm C: transient relay failure -> release -> retry ---"
  c_order_id="f15_${RUN_TAG}_armC"

  c_wc_order_id="$(seed_wc_order armC)"
  [ -n "$c_wc_order_id" ] || die "arm C: could not seed a real WooCommerce order to relay into"
  log "arm C: seeded WooCommerce order $c_wc_order_id as the relay's destination participant"

  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    VALUES
      ('$c_order_id','$ALLEGRO_A_CONNECTION_ID'::uuid,
       '{\"totals\":{\"currency\":\"PLN\",\"total\":10.00}}'::jsonb,
       '[]'::jsonb,'ready',now(),now())" >/dev/null
  pg_sql_write "INSERT INTO identifier_mappings
      (id,\"entityType\",\"internalId\",\"externalId\",\"platformType\",\"connectionId\",\"createdAt\",\"updatedAt\")
    VALUES
      (gen_random_uuid(),'Order','$c_order_id','$c_wc_order_id','woocommerce','$WC_CONNECTION_ID'::uuid,now(),now())" >/dev/null

  stub_set_shipping_config '{"mintTrackingImmediately":false,"pollsUntilTracking":1}'
  resp="$(generate_label "$c_order_id")"
  c_shipment_id="$(printf '%s' "$resp" | jq -r '.shipment.id // empty')"
  [ -n "$c_shipment_id" ] || die "arm C: generate-label returned no shipment id: $resp"
  ol_api POST "/v1/shipments/$c_shipment_id/notify-dispatched" >/dev/null
  log "arm C: shipment=$c_shipment_id labelled and dispatched (trackingNumber still null - mintTrackingImmediately=false)"

  log "arm C: stopping lab-wc-tls to force the destination relay to fail transiently"
  docker stop lab-wc-tls >/dev/null

  enqueue_status_sync "f15:armC:statusSync:fail:${RUN_TAG}" "f15.${RUN_TAG}.armC.shipmentStatus.scanOffset"
  relayed_after_fail="$(pg_sql "SELECT \"waybillRelayedAt\" FROM shipments WHERE id='$c_shipment_id'")"
  tracking_after_fail="$(pg_sql "SELECT \"trackingNumber\" FROM shipments WHERE id='$c_shipment_id'")"
  log "arm C: after first statusSync (wc-tls down) - trackingNumber=${tracking_after_fail:-<null>} waybillRelayedAt=${relayed_after_fail:-<null>}"

  log "arm C: restarting lab-wc-tls"
  docker start lab-wc-tls >/dev/null
  # wc-tls carries no published host port (internal-network only), so
  # readiness is checked from a container already on that network.
  waited=0
  while ! docker exec -e NODE_TLS_REJECT_UNAUTHORIZED=0 "$(discover_worker_containers | awk '{print $1}')" \
    node -e "fetch('https://wc-tls/').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
    waited=$((waited + 1))
    [ "$waited" -lt 30 ] || { warn "arm C: lab-wc-tls did not answer within 30s of restart - proceeding anyway"; break; }
    sleep 1
  done

  enqueue_status_sync "f15:armC:statusSync:retry:${RUN_TAG}" "f15.${RUN_TAG}.armC.shipmentStatus.scanOffset"
  relayed_after_retry="$(pg_sql "SELECT \"waybillRelayedAt\" FROM shipments WHERE id='$c_shipment_id'")"
  tracking_after_retry="$(pg_sql "SELECT \"trackingNumber\" FROM shipments WHERE id='$c_shipment_id'")"
  log "arm C: after retry statusSync (wc-tls restored) - trackingNumber=${tracking_after_retry:-<null>} waybillRelayedAt=${relayed_after_retry:-<null>}"

  if [ -z "${relayed_after_fail:-}" ] && [ -z "${tracking_after_fail:-}" ] && [ -n "${relayed_after_retry:-}" ] && [ -n "${tracking_after_retry:-}" ]; then
    ARM_C_OK=1
    log "arm C VALID: the claim was released on the transient destination failure (waybillRelayedAt AND trackingNumber both stayed null - #1947's 'never persist the number while holding the claim' rule) and taken cleanly on the retry"
  else
    warn "arm C DISCARDED: expected (relayedAtAfterFail,trackingAfterFail)=(<null>,<null>) and (relayedAtAfterRetry,trackingAfterRetry)=(<non-null>,<non-null>), got fail=(${relayed_after_fail:-<null>},${tracking_after_fail:-<null>}) retry=(${relayed_after_retry:-<null>},${tracking_after_retry:-<null>})"
  fi
  printf 'armC-transient-relay-failure trackingAfterFail=%s relayedAfterFail=%s trackingAfterRetry=%s relayedAfterRetry=%s ok=%s\n' \
    "${tracking_after_fail:-null}" "${relayed_after_fail:-null}" "${tracking_after_retry:-null}" "${relayed_after_retry:-null}" "$ARM_C_OK" >> "$ARM_RESULTS_FILE"
else
  log "--- arm C: skipped (smoke mode) ---"
fi

window_stop "$RESULTS_DIR"

# ---------------------------------------------------------------------------
# Verdict - arms B and C are this scenario's own correctness guards (the
# #1947 claim, in both its happy-path late-mint direction and its
# release-then-retry direction). Arm A is a throughput measurement and
# never gates the verdict.
# ---------------------------------------------------------------------------
if [ "$SMOKE" = 1 ]; then
  log "smoke run - no verdict written (never produces a measurement, per this scenario's own header)"
elif [ "$ARM_B_OK" = "1" ] && [ "$ARM_C_OK" = "1" ]; then
  verdict_write "$RESULTS_DIR" VALID
elif [ "$ARM_B_OK" != "1" ]; then
  verdict_write "$RESULTS_DIR" DISCARDED "arm-b-late-waybill-relay-claim-failed"
else
  verdict_write "$RESULTS_DIR" DISCARDED "arm-c-transient-relay-release-retry-failed"
fi

log "results: $RESULTS_DIR"
cat "$ARM_RESULTS_FILE"
