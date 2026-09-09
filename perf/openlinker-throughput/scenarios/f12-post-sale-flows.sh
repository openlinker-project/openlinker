#!/usr/bin/env bash
#
# F12: post-sale flows under load (#2980, epic #2840).
#
# The #2840 programme measured the path an order takes INTO OpenLinker. This
# scenario measures what happens AFTER the sale: cancellation, returns,
# refunds and (best-effort) invoice/receipt issuance, driven concurrently
# against real data on the `lab` stand, per #2980's own scope:
#
#   - cancellation releases the reservation ledger and then restores stock,
#     in that order (`OfferStockRestoreService.restoreStockForCancelledOrder`)
#   - returns carry an at-most-once per-line custody claim
#     (`return:line:{lineId}`, a `SyncLockPort` lock) and an append-only act
#     ledger
#   - refunds cross a provider boundary where a retry can move money twice;
#     `POST /orders/:id/refunds` exposes a CLIENT-SUPPLIED idempotencyKey
#     backed by a DB unique constraint (`UQ_refund_records_order_idempotency`)
#   - invoice issuance holds a per-order lock (`invoice:issue:{orderId}`)
#
# ===========================================================================
# WHAT THIS SCENARIO DOES AND DOES NOT DRIVE, AND WHY (read before editing)
# ===========================================================================
#
# There is NO cancel-order HTTP endpoint (apps/api carries none — verified by
# grep across apps/api/src). Cancellation is exclusively SOURCE-driven: an
# order-sync re-ingest observes `incoming.status === 'cancelled' &&
# priorStatus !== 'cancelled'` and enqueues `marketplace.offer.stockRestore`
# (order-ingestion.service.ts). The Allegro stub this stand's orders are
# minted from (stubs/allegro/server.mjs) deliberately has NO endpoint to flip
# an already-minted order to CANCELLED after the fact — its own comment says
# why: "Neither status nor fulfillment.status may be CANCELLED, or the order
# ingests as cancelled" (i.e. a mutation would arrive as pre-cancelled on
# first read, never as a genuine BOUGHT -> CANCELLED transition). Adding a
# mutate endpoint to the stub would need a container image rebuild + a
# redeploy of the SHARED `lab-allegro-stub` container mid-campaign, which
# risks invalidating whatever the sibling scenarios on this stand (#3006,
# #3001, #2979) are doing with it — out of bounds for this run.
#
# So this scenario enqueues the REAL consequence job
# (`marketplace.offer.stockRestore`, the exact job type and payload shape the
# transition-detection hook enqueues) directly, against REAL ingested orders
# (real `identifier_mappings`, real reservation holds, real destination
# mappings — pushed through the Allegro stub and polled exactly the way F1
# does). This exercises the function under test —
# `OfferStockRestoreService.restoreStockForCancelledOrder`'s release-then-
# restore sequence — for real, on real state; what it does NOT exercise is
# the marketplace-status-transition TRIGGER itself. Reported as a named scope
# cut, not hidden.
#
# Invoice/fiscal-receipt issuance: THIS STAND HAS NO Invoicing- OR
# Fiscalization-CAPABLE CONNECTION (verified via `GET /v1/connections` —
# perf-prestashop/perf-woocommerce/perf-allegro-a/perf-allegro-b/
# perf-webhook-ingress carry none). Provisioning one needs real remote sandbox
# credentials (KSeF or eparagony.pl) held by the operator, not this harness,
# and eparagony's own registerTransaction blocks on a ~1-minute poll per
# registration — a poor fit for a load arm regardless. HOWEVER:
# `InvoiceService.issueInvoice` acquires the per-order `invoice:issue:{orderId}`
# lock BEFORE it ever resolves the destination's Invoicing capability
# (invoice.service.ts:290-297 — the tax-rate gate, then the lock, then
# `issueLocked`) — so the LOCK'S SCOPE (per-order, not per-connection) can be
# measured empirically even against a non-Invoicing connection; only the
# REALISTIC HOLD DURATION (a live provider round-trip) cannot. This arm is run
# and reported as a bounded diagnostic — see "What this did not establish".
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$LIB_DIR/../.." && pwd)"
LIB_LOG_PREFIX="f12"
# shellcheck disable=SC1091
source "$LIB_DIR/lib.sh"
# shellcheck disable=SC1091
source "$LIB_DIR/drivers/order-feed.sh"

require_tools node jq curl docker

DRIVER_JS="$LIB_DIR/drivers/post-sale-flows.mjs"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.lab}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    --strict) MODE="strict" ;;
    *) die "unknown argument: $arg (expected --smoke or --strict)" ;;
  esac
done

: "${ALLEGRO_A_CONNECTION_ID:?ALLEGRO_A_CONNECTION_ID not set - source stand-ids.env or export it}"
: "${PS_CONNECTION_ID:?PS_CONNECTION_ID not set - source stand-ids.env or export it}"
: "${WC_CONNECTION_ID:?WC_CONNECTION_ID not set - source stand-ids.env or export it}"

# Scoped to the ONE connection this scenario actually enqueues sync_jobs
# against (marketplace.orders.poll / marketplace.order.sync / the direct
# marketplace.offer.stockRestore enqueue in arm_cancellation - all via
# ALLEGRO_A_CONNECTION_ID). PS/WC never gain a sync_jobs row from anything
# this scenario does (order-destination creation happens inline inside the
# order-sync job, not as a separate enqueued job; refunds/returns/invoicing
# are synchronous HTTP writes) - including them here would fail
# guard_queue_empty on a standing, unrelated artifact: WC_CONNECTION_ID
# carries a `master.product.syncAll` row dated to this stand's ORIGINAL
# bootstrap (idempotencyKey `bootstrap:...:product:syncAll`), queued
# forever because the campaign's steady-state default keeps the runner
# off. That row is real and legitimate - not a leftover from a concurrent
# scenario - so the fix is scoping the guard to what this run is actually
# responsible for, not draining a fact this scenario does not own.
CONN_IDS_CSV="'$ALLEGRO_A_CONNECTION_ID'"

# ===========================================================================
# --smoke - cheap self-test, no stand mutation, no results directory, no
# worker recreate. Confirms the driver, the API and the DTO shapes this
# scenario depends on are all reachable before a strict run is attempted.
# ===========================================================================
run_smoke() {
  ol_login
  local out
  out="$(printf '%s\n' \
    "{\"id\":\"conn\",\"method\":\"GET\",\"path\":\"/v1/connections\"}" \
    "{\"id\":\"missing-order-refund\",\"method\":\"POST\",\"path\":\"/orders/ol_order_does-not-exist/refunds\",\"body\":{\"amount\":\"1.00\",\"currency\":\"PLN\",\"reason\":\"other\"}}" \
    | node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" race)"
  local conn_status refund_status
  conn_status="$(printf '%s\n' "$out" | jq -r 'select(.id=="conn").status')"
  refund_status="$(printf '%s\n' "$out" | jq -r 'select(.id=="missing-order-refund").status')"
  [ "$conn_status" = "200" ] || die "smoke: GET /v1/connections -> $conn_status, expected 200"
  [ "$refund_status" = "404" ] || die "smoke: refund against an unknown order -> $refund_status, expected 404"
  log "smoke ok (driver reachable, connections list 200, unknown-order refund 404)"
}

# ===========================================================================
# Stand posture capture + single EXIT trap (the F1/F3 pattern - bash's EXIT
# trap is ONE slot, so everything that must be undone lives in one function).
# ===========================================================================
ORIGINAL_REPLICAS="$(discover_worker_containers | wc -w | tr -d ' ')"
[ "$ORIGINAL_REPLICAS" -ge 1 ] || ORIGINAL_REPLICAS=1
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false

WORKER_TOUCHED=0
# Set once results_dir_init has produced a results dir (in run_strict) so the
# EXIT trap can stop a sampler that window_start started, even if this script
# dies between window_start and the window_stop that would otherwise reap it.
# Without this, a mid-window death (a `die`, a signal, an unhandled error)
# leaves sampler_start's background `while true; do sample_queue ...; done`
# loop running forever - the exact orphaned-sampler incident this fix closes
# unconditionally, independent of whatever specific run surfaced it.
F12_RESULTS_DIR=""

f12_on_exit() {
  local rc=$?
  if [ -n "$F12_RESULTS_DIR" ]; then
    sampler_stop "$F12_RESULTS_DIR"
  fi
  if [ "$WORKER_TOUCHED" = "1" ]; then
    log "restoring worker posture (runner -> $ORIGINAL_RUNNER_ENABLED, replicas -> $ORIGINAL_REPLICAS)"
    if [ -f "$ENV_FILE" ]; then
      sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED/" "$ENV_FILE" 2>/dev/null || true
    fi
    ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
        up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
      || warn "could not restore worker posture - stand left with WORKER_RUNNER_ENABLED as this run set it"
  else
    log "worker was never touched - nothing to restore there"
  fi
  release_stand_exclusive
  return "$rc"
}

# recreate_worker <runner:true|false> - ported verbatim from F1's own
# function (scenarios/f1-order-ingestion.sh), minus the lane-cap override
# arguments this scenario never uses.
recreate_worker() {
  local runner="$1" tries w hits found
  WORKER_TOUCHED=1
  [ -f "$ENV_FILE" ] || die "recreate_worker: $ENV_FILE not found"
  if grep -q '^WORKER_RUNNER_ENABLED=' "$ENV_FILE"; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$runner/" "$ENV_FILE"
  else
    printf 'WORKER_RUNNER_ENABLED=%s\n' "$runner" >> "$ENV_FILE"
  fi
  ( cd "$REPO_ROOT" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --scale "worker=$ORIGINAL_REPLICAS" worker >/dev/null 2>&1 ) \
    || die "recreate_worker: compose refused to recreate the worker service"
  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers
  found="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$found" -eq "$ORIGINAL_REPLICAS" ] || die "recreate_worker: expected $ORIGINAL_REPLICAS replica(s), found $found"
  if [ "$runner" = "true" ]; then
    for w in $WORKER_CONTAINERS; do
      tries=0
      while true; do
        hits="$(docker logs "$w" 2>&1 | grep -cF 'Starting sync job runner loop' || true)"
        [ "${hits:-0}" -eq 0 ] || break
        tries=$((tries + 1))
        [ "$tries" -lt 90 ] || die "recreate_worker: $w never logged 'Starting sync job runner loop'"
        sleep 1
      done
    done
  fi
  log "recreate_worker ok (runner=$runner, replicas=$found)"
}

# ===========================================================================
# Seeding: real ingested orders via the Allegro stub + a real poll job, the
# F1 mechanism (of_push_orders / of_enqueue_poll from drivers/order-feed.sh).
# NOT hand-crafted DB rows: every seeded order carries real identifier
# mappings and a real reservation-ledger footprint from having gone through
# OrderIngestionService.persistOrder for real.
# ===========================================================================
F12_TENANT="perf-allegro-a"

f12_wait_for_orders() {
  local since_iso="$1" want="$2" timeout_s="${3:-60}" waited=0 n
  while true; do
    n="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"createdAt\">='$since_iso'")"
    n="$(as_count "${n:-}")"
    [ -n "$n" ] && [ "$n" -ge "$want" ] && { log "f12_wait_for_orders: $n/$want ingested"; return 0; }
    waited=$((waited + 2))
    [ "$waited" -lt "$timeout_s" ] || die "f12_wait_for_orders: only ${n:-0}/$want orders ingested after ${timeout_s}s - the poll/ingest path may be stuck"
    sleep 2
  done
}

# f12_pick_orders <since_iso> <offset> <count> - echoes one internalOrderId
# per line, deterministically ordered (createdAt DESC, id ASC tie-break) so
# repeated calls with disjoint offset/count windows never hand two arms the
# same order.
f12_pick_orders() {
  local since_iso="$1" off="$2" cnt="$3" id
  # `pg_sql` folds stderr into stdout (lib.sh's own documented shape), so an
  # error string here would otherwise be silently read as an order id by
  # every caller downstream. A malformed row is DROPPED, never trusted and
  # never fatal from inside this function - `die` here would run inside the
  # command-substitution subshell the caller wraps this in and its `exit`
  # would not reach the main script (docs/lessons.md: "command substitution
  # is a subshell"). The caller's own row-count check is what actually
  # enforces "enough real orders were found".
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    case "$id" in
      ol_order_*) printf '%s\n' "$id" ;;
      *) warn "f12_pick_orders: dropping unexpected row [$id] (expected an internalOrderId, ol_order_*) - the SQL query may have failed and pg_sql folded the error into its output" ;;
    esac
  done < <(pg_sql "SELECT \"internalOrderId\" FROM order_records WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"createdAt\">='$since_iso' AND \"recordStatus\"='ready' AND \"cancelledAt\" IS NULL ORDER BY \"createdAt\" DESC, \"internalOrderId\" ASC OFFSET $off LIMIT $cnt")
}

# ===========================================================================
# Arm 1: cancellation. Enqueues the REAL marketplace.offer.stockRestore job
# (see the file-header note on why the marketplace-transition trigger itself
# is out of reach on this stand) for a batch of real orders, plus a
# genuinely-concurrent DOUBLE enqueue for one order (two distinct
# idempotencyKeys, same internalOrderId+connectionId) to test whether the
# release-then-restore sequence double-applies under real concurrent
# execution.
# ===========================================================================
f12_enqueue_stock_restore() {
  local order_id="$1" tag="$2"
  local key="f12:stockRestore:$order_id:$tag:$(date +%s%3N)"
  enqueue_perf_job 'marketplace.offer.stockRestore' "$ALLEGRO_A_CONNECTION_ID" \
    "{\"schemaVersion\":1,\"internalOrderId\":\"$order_id\"}" "$key" >/dev/null
  printf '%s' "$key"
}

arm_cancellation() {
  local out_dir="$1"; shift
  local -a order_ids=("$@")
  local dup_order="${order_ids[0]}"
  local -a keys=()

  log "arm_cancellation: enqueueing ${#order_ids[@]} marketplace.offer.stockRestore job(s), plus a genuinely concurrent double-enqueue for $dup_order"
  local before_ts
  before_ts="$(iso_now)"

  local oid
  for oid in "${order_ids[@]}"; do
    keys+=("$(f12_enqueue_stock_restore "$oid" single)")
  done
  # The double-apply race: two DISTINCT sync_jobs rows (different
  # idempotencyKeys, so neither is deduped against the other) targeting the
  # SAME order+connection. Both become 'queued' with nextRunAt<=now at the
  # same instant, so the runner's next claim tick can and typically does
  # start both in the SAME tick - genuine concurrent execution of
  # restoreStockForCancelledOrder for one order, not a sequential retry.
  local dup_key_a dup_key_b
  dup_key_a="$(f12_enqueue_stock_restore "$dup_order" dup-a)"
  dup_key_b="$(f12_enqueue_stock_restore "$dup_order" dup-b)"
  keys+=("$dup_key_a" "$dup_key_b")

  cap_perf_job_attempts

  local total="${#keys[@]}" waited=0 done_n=0
  while true; do
    local in_csv
    in_csv="$(printf "'%s'," "${keys[@]}")"; in_csv="${in_csv%,}"
    done_n="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"idempotencyKey\" IN ($in_csv) AND status IN ('succeeded','dead')")"
    done_n="$(as_count "${done_n:-}")"
    [ -n "$done_n" ] && [ "$done_n" -ge "$total" ] && break
    waited=$((waited + 3))
    [ "$waited" -lt 300 ] || { warn "arm_cancellation: only ${done_n:-0}/$total stockRestore jobs settled after 300s"; break; }
    sleep 3
  done
  local after_ts
  after_ts="$(iso_now)"

  local in_csv rows_json
  in_csv="$(printf "'%s'," "${keys[@]}")"; in_csv="${in_csv%,}"
  rows_json="$(pg_sql "SELECT COALESCE(jsonb_agg(jsonb_build_object('idempotencyKey',\"idempotencyKey\",'status',status,'outcome',outcome,'lastError',\"lastError\",'attempts',attempts,'lastAttemptDurationMs',\"lastAttemptDurationMs\")),'[]'::jsonb) FROM sync_jobs WHERE \"idempotencyKey\" IN ($in_csv)")"

  local succeeded dead
  succeeded="$(printf '%s' "$rows_json" | jq '[.[] | select(.status=="succeeded")] | length')"
  dead="$(printf '%s' "$rows_json" | jq '[.[] | select(.status=="dead")] | length')"

  # Double-apply evidence: pull both duplicate jobs' own worker log lines
  # (MarketplaceOfferStockRestoreHandler logs `released=... offersRestored=...`
  # per job id, keyed by the job's own row id - resolved from sync_jobs by
  # idempotencyKey since the enqueue response did not carry it back here).
  local dup_ids dup_log
  dup_ids="$(pg_sql "SELECT string_agg(id::text, '|') FROM sync_jobs WHERE \"idempotencyKey\" IN ('$dup_key_a','$dup_key_b')")"
  dup_log=""
  local w
  for w in $WORKER_CONTAINERS; do
    dup_log="$dup_log$(docker logs "$w" 2>&1 | grep -E "stockRestore job (${dup_ids:-NONE})" || true)
"
  done

  jq -n --argjson rows "$rows_json" --argjson total "$total" --argjson succeeded "$succeeded" --argjson dead "${dead:-0}" \
    --arg before "$before_ts" --arg after "$after_ts" --arg dupOrder "$dup_order" --arg dupLog "$dup_log" \
    '{flow:"cancellation", total:$total, succeeded:$succeeded, dead:$dead,
      errorRate: (if $total>0 then ($dead/$total) else null end),
      windowStart:$before, windowEnd:$after, duplicateApplyOrder:$dupOrder,
      duplicateApplyWorkerLog:$dupLog, rows:$rows}' \
    > "$out_dir/arm-cancellation.json"
  log "arm_cancellation: $succeeded/$total succeeded, $dead dead"
}

# ===========================================================================
# Arm 2: returns. Seeds one operator_authored return per order via
# POST /returns/record, then:
#   - a LOCK-CONTENTION race: N concurrent dispose(restock) calls on ONE
#     line (return:line:{lineId}) - on this stand PrestaShop is the
#     InventoryMaster and refuses adjustInventory outright (#2369 not yet
#     built), so every restock is `restockBlocked`; the lock/counter
#     behaviour is still real and still measured.
#   - a COUNTER-CORRECTNESS race: N concurrent dispose(scrap) calls on a
#     SECOND line - scrap never crosses the master boundary, so this is the
#     one place on this stand a real double-apply (quantityScrapped ending
#     up over-counted) would be directly observable.
#   - a POOL throughput/error-rate pass: receive-then-dispose(scrap) across
#     many DISTINCT lines/orders at bounded concurrency.
# ===========================================================================
f12_record_return() {
  local order_id="$1" qty="$2"
  local body
  body="$(jq -n --arg oid "$order_id" --arg cid "$ALLEGRO_A_CONNECTION_ID" --argjson qty "$qty" \
    '{internalOrderId:$oid, sourceConnectionId:$cid, lines:[{reason:"other", quantityAdvised:$qty}]}')"
  ol_api POST /returns/record "$body"
}

f12_return_line_id() {
  local return_id="$1"
  ol_api GET "/returns/$return_id" | jq -r '.lines[0].id'
}

arm_returns() {
  local out_dir="$1"; shift
  local -a order_ids=("$@")
  local n="${#order_ids[@]}"
  [ "$n" -ge 3 ] || die "arm_returns needs at least 3 orders"

  local race_restock_order="${order_ids[0]}" race_scrap_order="${order_ids[1]}"
  local -a pool_orders=("${order_ids[@]:2}")
  local race_qty=15

  log "arm_returns: seeding ${n} operator-authored return(s)"
  local restock_return restock_line scrap_return scrap_line
  restock_return="$(f12_record_return "$race_restock_order" "$race_qty" | jq -r '.returnId')"
  restock_line="$(f12_return_line_id "$restock_return")"
  scrap_return="$(f12_record_return "$race_scrap_order" "$race_qty" | jq -r '.returnId')"
  scrap_line="$(f12_return_line_id "$scrap_return")"

  # Receive the full advised quantity on both race lines BEFORE the race, so
  # every concurrent dispose call is contending on the SAME available budget
  # rather than each seeing a different partial receipt.
  ol_api POST "/returns/$restock_return/lines/$restock_line/receive" "{\"quantity\":$race_qty}" >/dev/null
  ol_api POST "/returns/$scrap_return/lines/$scrap_line/receive" "{\"quantity\":$race_qty}" >/dev/null

  # --- Race 1: return:line:{lineId} lock contention, restock (blocked path) ---
  local restock_ndjson restock_out i
  restock_ndjson="$(mktemp)"
  for ((i = 0; i < race_qty; i++)); do
    jq -nc --arg id "restock-$i" --arg path "/returns/$restock_return/lines/$restock_line/dispose" \
      '{id:$id, method:"POST", path:$path, body:{quantity:1, disposition:"restock"}}'
  done > "$restock_ndjson"
  restock_out="$out_dir/race-restock.ndjson"
  node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" race < "$restock_ndjson" > "$restock_out"
  local restock_final
  restock_final="$(ol_api GET "/returns/$restock_return")"

  # --- Race 2: same lock, scrap (no master boundary - the real double-apply check) ---
  local scrap_ndjson scrap_out
  scrap_ndjson="$(mktemp)"
  for ((i = 0; i < race_qty; i++)); do
    jq -nc --arg id "scrap-$i" --arg path "/returns/$scrap_return/lines/$scrap_line/dispose" \
      '{id:$id, method:"POST", path:$path, body:{quantity:1, disposition:"scrap"}}'
  done > "$scrap_ndjson"
  scrap_out="$out_dir/race-scrap.ndjson"
  node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" race < "$scrap_ndjson" > "$scrap_out"
  local scrap_final
  scrap_final="$(ol_api GET "/returns/$scrap_return")"

  local scrap_2xx scrap_quantity_scrapped
  scrap_2xx="$(jq -s '[.[] | select(.ok)] | length' "$scrap_out")"
  scrap_quantity_scrapped="$(printf '%s' "$scrap_final" | jq '.lines[0].quantityScrapped')"
  local double_apply_finding="none"
  if [ "$scrap_quantity_scrapped" != "$scrap_2xx" ]; then
    double_apply_finding="MISMATCH: $scrap_2xx dispose(scrap) call(s) answered 2xx but quantityScrapped=$scrap_quantity_scrapped (expected equal) - possible lost update or double-apply on the return-line counter"
    warn "$double_apply_finding"
  fi
  if [ "$scrap_quantity_scrapped" -gt "$race_qty" ]; then
    double_apply_finding="DOUBLE-APPLY: quantityScrapped=$scrap_quantity_scrapped exceeds quantityAdvised=$race_qty on return $scrap_return line $scrap_line"
    warn "$double_apply_finding"
  fi

  # --- Pool: throughput/error-rate across many distinct lines, alongside a
  # background order-ingestion push (kicked off by the caller before this
  # function runs - see run_strict).
  log "arm_returns: pool pass over ${#pool_orders[@]} order(s), concurrency=8"
  local pool_ndjson pool_out oid ret_id line_id
  pool_ndjson="$(mktemp)"
  local -a pool_lines=()
  for oid in "${pool_orders[@]}"; do
    ret_id="$(f12_record_return "$oid" 1 | jq -r '.returnId')"
    line_id="$(f12_return_line_id "$ret_id")"
    ol_api POST "/returns/$ret_id/lines/$line_id/receive" '{"quantity":1}' >/dev/null
    pool_lines+=("$ret_id:$line_id")
    jq -nc --arg id "$ret_id" --arg path "/returns/$ret_id/lines/$line_id/dispose" \
      '{id:$id, method:"POST", path:$path, body:{quantity:1, disposition:"scrap"}}'
  done > "$pool_ndjson"
  pool_out="$out_dir/pool-dispose.ndjson"
  node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" pool 8 < "$pool_ndjson" > "$pool_out"

  local pool_total pool_ok pool_p50 pool_p95
  pool_total="$(jq -s 'length' "$pool_out")"
  pool_ok="$(jq -s '[.[] | select(.ok)] | length' "$pool_out")"
  pool_p50="$(jq -s '[.[].durationMs] | sort | .[length/2|floor]' "$pool_out")"
  pool_p95="$(jq -s '[.[].durationMs] | sort | .[(length*0.95)|floor]' "$pool_out")"

  local restock_total restock_2xx restock_409 restock_p50 restock_p95
  restock_total="$(jq -s 'length' "$restock_out")"
  restock_2xx="$(jq -s '[.[] | select(.ok)] | length' "$restock_out")"
  restock_409="$(jq -s '[.[] | select(.status==409)] | length' "$restock_out")"
  restock_p50="$(jq -s '[.[].durationMs] | sort | .[length/2|floor]' "$restock_out")"
  restock_p95="$(jq -s '[.[].durationMs] | sort | .[(length*0.95)|floor]' "$restock_out")"

  jq -n \
    --argjson restockRace "$(jq -s . "$restock_out")" \
    --argjson restockFinalLine "$(printf '%s' "$restock_final" | jq '.lines[0]')" \
    --argjson scrapRace "$(jq -s . "$scrap_out")" \
    --argjson scrapFinalLine "$(printf '%s' "$scrap_final" | jq '.lines[0]')" \
    --arg doubleApplyFinding "$double_apply_finding" \
    --argjson raceQty "$race_qty" \
    --argjson restockTotal "$restock_total" --argjson restock2xx "$restock_2xx" --argjson restock409 "$restock_409" \
    --argjson restockP50 "$restock_p50" --argjson restockP95 "$restock_p95" \
    --argjson poolTotal "$pool_total" --argjson poolOk "$pool_ok" --argjson poolP50 "$pool_p50" --argjson poolP95 "$pool_p95" \
    '{flow:"returns", lockName:"return:line:{lineId}",
      restockRace:{qty:$raceQty, total:$restockTotal, ok:$restock2xx, contended409:$restock409,
                   p50Ms:$restockP50, p95Ms:$restockP95, finalLine:$restockFinalLine, raw:$restockRace},
      scrapRace:{qty:$raceQty, finalLine:$scrapFinalLine, doubleApplyFinding:$doubleApplyFinding, raw:$scrapRace},
      pool:{total:$poolTotal, ok:$poolOk, errorRate:(if $poolTotal>0 then (($poolTotal-$poolOk)/$poolTotal) else null end), p50Ms:$poolP50, p95Ms:$poolP95}}' \
    > "$out_dir/arm-returns.json"
  log "arm_returns: restock race ok=$restock_2xx/$restock_total 409=$restock_409 (p50=${restock_p50}ms p95=${restock_p95}ms); scrap race finding=$double_apply_finding; pool ok=$pool_ok/$pool_total"
}

# ===========================================================================
# Arm 3: refunds. POST /orders/:id/refunds exposes a CLIENT-SUPPLIED
# idempotencyKey backed by UQ_refund_records_order_idempotency - the one
# post-sale flow in this scenario where the AC's "genuinely concurrent
# same-key calls" is directly reachable over HTTP with no scope cut at all.
# ===========================================================================
arm_refunds() {
  local out_dir="$1"; shift
  local -a order_ids=("$@")
  local n="${#order_ids[@]}"
  [ "$n" -ge 2 ] || die "arm_refunds needs at least 2 orders"
  local race_order="${order_ids[0]}"
  local -a pool_orders=("${order_ids[@]:1}")
  local race_n=15

  log "arm_refunds: genuinely-concurrent SAME-idempotencyKey race ($race_n callers, one order)"
  local shared_key="f12-shared-key-$(date +%s%3N)"
  local race_ndjson race_out i
  race_ndjson="$(mktemp)"
  for ((i = 0; i < race_n; i++)); do
    jq -nc --arg id "refund-race-$i" --arg path "/orders/$race_order/refunds" --arg key "$shared_key" \
      '{id:$id, method:"POST", path:$path, body:{amount:"10.00", currency:"PLN", reason:"other", idempotencyKey:$key}}'
  done > "$race_ndjson"
  race_out="$out_dir/race-refund-idempotency.ndjson"
  node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" race < "$race_ndjson" > "$race_out"

  local race_2xx race_409 race_other
  race_2xx="$(jq -s '[.[] | select(.status==201)] | length' "$race_out")"
  race_409="$(jq -s '[.[] | select(.status==409)] | length' "$race_out")"
  race_other="$(jq -s '[.[] | select(.status!=201 and .status!=409)] | length' "$race_out")"

  local persisted_refund_count
  persisted_refund_count="$(ol_api GET "/orders/$race_order/refunds" | jq '[.[] | select(.idempotencyKey=="'"$shared_key"'" or true)] | length')"
  # Note: RefundRecordResponseDto does not echo idempotencyKey back (see the
  # DTO), so the count above is simply "how many refund rows exist on this
  # order at all" - this order is used ONLY for the race, so any count other
  # than 1 on an order that received exactly one race is itself the
  # double-apply signal.
  local double_apply_finding="none"
  if [ "$race_2xx" != "1" ] || [ "${persisted_refund_count:-0}" != "1" ]; then
    double_apply_finding="MISMATCH: $race_2xx of $race_n concurrent same-idempotencyKey refund calls answered 201 (expected exactly 1), and $persisted_refund_count refund row(s) exist on order $race_order (expected exactly 1) - the idempotency guarantee did NOT hold under genuine concurrency"
    warn "$double_apply_finding"
  fi

  log "arm_refunds: pool throughput/error-rate over ${#pool_orders[@]} distinct order(s), concurrency=10"
  local pool_ndjson pool_out oid
  pool_ndjson="$(mktemp)"
  for oid in "${pool_orders[@]}"; do
    jq -nc --arg id "$oid" --arg path "/orders/$oid/refunds" --arg key "f12-pool-$oid" \
      '{id:$id, method:"POST", path:$path, body:{amount:"5.00", currency:"PLN", reason:"withdrawal", idempotencyKey:$key}}'
  done > "$pool_ndjson"
  pool_out="$out_dir/pool-refund.ndjson"
  node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" pool 10 < "$pool_ndjson" > "$pool_out"

  local pool_total pool_ok pool_p50 pool_p95
  pool_total="$(jq -s 'length' "$pool_out")"
  pool_ok="$(jq -s '[.[] | select(.ok)] | length' "$pool_out")"
  pool_p50="$(jq -s '[.[].durationMs] | sort | .[length/2|floor]' "$pool_out")"
  pool_p95="$(jq -s '[.[].durationMs] | sort | .[(length*0.95)|floor]' "$pool_out")"

  jq -n \
    --argjson raceN "$race_n" --argjson race2xx "$race_2xx" --argjson race409 "$race_409" --argjson raceOther "$race_other" \
    --arg doubleApplyFinding "$double_apply_finding" --argjson persistedCount "${persisted_refund_count:-0}" \
    --argjson raceRaw "$(jq -s . "$race_out")" \
    --argjson poolTotal "$pool_total" --argjson poolOk "$pool_ok" --argjson poolP50 "$pool_p50" --argjson poolP95 "$pool_p95" \
    '{flow:"refunds", idempotencyKeyBackedBy:"UQ_refund_records_order_idempotency",
      race:{callers:$raceN, succeeded201:$race2xx, contended409:$race409, otherStatus:$raceOther,
            persistedRowsOnOrder:$persistedCount, doubleApplyFinding:$doubleApplyFinding, raw:$raceRaw},
      pool:{total:$poolTotal, ok:$poolOk, errorRate:(if $poolTotal>0 then (($poolTotal-$poolOk)/$poolTotal) else null end), p50Ms:$poolP50, p95Ms:$poolP95}}' \
    > "$out_dir/arm-refunds.json"
  log "arm_refunds: race 201=$race_2xx 409=$race_409 other=$race_other (finding=$double_apply_finding); pool ok=$pool_ok/$pool_total"
}

# ===========================================================================
# Arm 4 (DIAGNOSTIC ONLY - see file header): invoice-lock scope, not hold
# duration. No Invoicing-capable connection exists on this stand, so every
# attempt fails past the lock; what is measured is whether the per-order
# lock (invoice:issue:{orderId}) contends ACROSS connection ids for the SAME
# order, which is the ADR-041 invariant this lock exists to enforce.
# ===========================================================================
arm_invoice_lock_diagnostic() {
  local out_dir="$1" order_id="$2"
  log "arm_invoice_lock_diagnostic: $order_id, 20 concurrent POST /invoices across PS+WC connection ids (neither Invoicing-capable on this stand)"
  local ndjson out i conn
  ndjson="$(mktemp)"
  for ((i = 0; i < 20; i++)); do
    conn=$([ $((i % 2)) -eq 0 ] && echo "$PS_CONNECTION_ID" || echo "$WC_CONNECTION_ID")
    jq -nc --arg id "invoice-$i" --arg oid "$order_id" --arg cid "$conn" \
      '{id:$id, method:"POST", path:"/invoices", body:{connectionId:$cid, orderId:$oid}}'
  done > "$ndjson"
  out="$out_dir/race-invoice-lock.ndjson"
  node "$DRIVER_JS" "$OL_API_URL" "$OL_TOKEN" race < "$ndjson" > "$out"

  local total contended other_status
  total="$(jq -s 'length' "$out")"
  contended="$(jq -s '[.[] | select(.responseErrorField=="InvoiceIssueContendedException" or .status==409)] | length' "$out")"
  other_status="$(jq -s '[.[] | select(.status!=409)] | .[0].status' "$out")"

  jq -n --argjson total "$total" --argjson contended "$contended" --arg otherStatus "$other_status" --argjson raw "$(jq -s . "$out")" \
    '{flow:"invoice-lock-diagnostic", lockName:"invoice:issue:{orderId}",
      note:"DIAGNOSTIC ONLY - no Invoicing-capable connection on this stand, so the capability check inside issueLocked() fails immediately after the lock is taken. This measures the LOCK SCOPE (per-order across connections), never a realistic hold duration under a live provider round-trip.",
      total:$total, contended409:$contended, firstNonContendedStatus:$otherStatus, raw:$raw}' \
    > "$out_dir/arm-invoice-lock-diagnostic.json"
  log "arm_invoice_lock_diagnostic: $contended/$total contended (409), first non-contended status=$other_status"
}

# ===========================================================================
# Strict run
# ===========================================================================
run_strict() {
  guard_stand_exclusive "f12-post-sale-flows"
  trap f12_on_exit EXIT
  ol_login

  guard_build
  guard_demo_mode_off
  guard_connection_budget
  guard_pool_recorded
  guard_log_level
  guard_perf_max_attempts
  guard_scheduler_off

  recreate_worker true
  guard_runner_state enabled
  guard_queue_empty "$CONN_IDS_CSV"

  local dir
  dir="$(results_dir_init f12-post-sale-flows main)"
  F12_RESULTS_DIR="$dir"
  local extra_manifest
  extra_manifest="$(jq -n '{scenario:"f12-post-sale-flows", note:"cancellation drives the real stockRestore job directly (no stub mutate endpoint - see file header); invoice arm is a bounded lock-scope diagnostic (no Invoicing-capable connection on this stand)"}')"
  window_start "$dir" f12-post-sale-flows "$CONN_IDS_CSV" 0 "$extra_manifest"

  local seed_since
  seed_since="$(iso_now)"
  # Clear OpenLinker's OWN persisted poll cursor for this connection BEFORE
  # resetting the stub's event sequence. `of_new_run` only resets the stub;
  # a cursor left over from a prior attempt against this same connection
  # compares against the freshly-zeroed stub sequence and never catches up,
  # which stalls f12_wait_for_orders at 0/N indefinitely (the exact failure
  # a prior attempt hit). This is a fix to this scenario's own harness, not
  # to the product under test - see of_reset_cursor's header for why that
  # distinction matters here.
  of_reset_cursor "$ALLEGRO_A_CONNECTION_ID"
  of_new_run "f12-$(date +%s)"
  local seed_n=75
  of_push_orders "$F12_TENANT" "$seed_n" 1 1 >/dev/null
  of_enqueue_poll "$ALLEGRO_A_CONNECTION_ID" "f12-seed"
  # 90s is nowhere near enough here, unlike F1's Allegro-only timing: each
  # seeded order's marketplace.order.sync child creates a REAL destination
  # order on BOTH PrestaShop and WooCommerce inline (not a separate job),
  # under the `realtime` lane's per-scope cap of 2 - measured live at ~1
  # order every 6-7s for this connection, so 75 orders is genuinely a
  # ~9-10 minute ingest, not a stuck pipeline (a first attempt at 90s
  # timed out at 13/75, climbing steadily the whole time).
  f12_wait_for_orders "$seed_since" "$seed_n" 720

  # Captured via command substitution, NOT `< <(f12_pick_orders ...)`: `die`
  # inside a process substitution only kills that subshell (its `exit` never
  # reaches the main script), which would silently truncate the id list
  # instead of aborting the run - the same "command substitution is a
  # subshell" trap docs/lessons.md already names for a different function.
  local cancel_ids_raw return_ids_raw refund_ids_raw
  cancel_ids_raw="$(f12_pick_orders "$seed_since" 0 20)"
  return_ids_raw="$(f12_pick_orders "$seed_since" 20 20)"
  refund_ids_raw="$(f12_pick_orders "$seed_since" 40 20)"
  local -a cancel_ids=() return_ids=() refund_ids=()
  while IFS= read -r id; do [ -n "$id" ] && cancel_ids+=("$id"); done <<< "$cancel_ids_raw"
  while IFS= read -r id; do [ -n "$id" ] && return_ids+=("$id"); done <<< "$return_ids_raw"
  while IFS= read -r id; do [ -n "$id" ] && refund_ids+=("$id"); done <<< "$refund_ids_raw"
  local invoice_diag_order="${refund_ids[-1]}"

  [ "${#cancel_ids[@]}" -ge 20 ] || die "seeding shortfall: only ${#cancel_ids[@]}/20 orders available for the cancellation arm"
  [ "${#return_ids[@]}" -ge 3 ] || die "seeding shortfall: only ${#return_ids[@]}/20 orders available for the returns arm"
  [ "${#refund_ids[@]}" -ge 2 ] || die "seeding shortfall: only ${#refund_ids[@]}/20 orders available for the refunds arm"

  # Background ordinary ingestion, running ALONGSIDE the post-sale arms below
  # (#2980 AC: "at least one arm runs a post-sale flow alongside order
  # ingestion"). A second, distinct stub tenant push+poll cycle - fresh
  # orders arriving and being ingested for real while the arms below hammer
  # cancellation/returns/refunds on the FIRST batch.
  local bg_since
  bg_since="$(iso_now)"
  (
    of_push_orders "$F12_TENANT" 15 1 1 >/dev/null
    of_enqueue_poll "$ALLEGRO_A_CONNECTION_ID" "f12-bg-ingest" >/dev/null
  ) &
  local bg_pid=$!

  arm_cancellation "$dir" "${cancel_ids[@]}"
  arm_returns "$dir" "${return_ids[@]}"
  arm_refunds "$dir" "${refund_ids[@]}"
  arm_invoice_lock_diagnostic "$dir" "$invoice_diag_order"

  wait "$bg_pid" || warn "background ingestion push/poll exited non-zero"
  f12_wait_for_orders "$bg_since" 15 180

  local bg_ingested
  bg_ingested="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"createdAt\">='$bg_since'")"
  jq -n --arg since "$bg_since" --argjson ingested "$(as_count "${bg_ingested:-0}")" \
    '{note:"ordinary order ingestion driven concurrently alongside the returns/refunds/invoice arms above", since:$since, ordersIngested:$ingested}' \
    > "$dir/arm-background-ingestion.json"

  window_stop "$dir"

  # Verdict: this scenario writes its OWN verdict rather than run_post_guards
  # (that chain's k6/destination-create guards assume a k6-driven or
  # single-destination-sync shape neither the returns/refunds HTTP arms nor
  # the direct-enqueue cancellation arm are). DISCARDED iff a double-apply
  # was actually observed - the run measured something real either way, but
  # a double-apply changes what the numbers MEAN (see #2980's own AC: report
  # it at the top, do not fix it inside this run).
  local reasons=()
  local returns_finding refunds_finding
  returns_finding="$(jq -r '.scrapRace.doubleApplyFinding' "$dir/arm-returns.json")"
  refunds_finding="$(jq -r '.race.doubleApplyFinding' "$dir/arm-refunds.json")"
  [ "$returns_finding" = "none" ] || reasons+=("returns double-apply: $returns_finding")
  [ "$refunds_finding" = "none" ] || reasons+=("refunds double-apply: $refunds_finding")

  if [ "${#reasons[@]}" -eq 0 ]; then
    verdict_write "$dir" VALID
  else
    verdict_write "$dir" DISCARDED "${reasons[@]}"
  fi

  log "results: $dir"
  log "verdict: $(verdict_read "$dir" | head -1)"
}

case "$MODE" in
  smoke) run_smoke ;;
  strict) run_strict ;;
esac
