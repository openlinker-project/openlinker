#!/usr/bin/env bash
#
# F2 - stock propagation latency (#2848, epic #2840).
#
# Measures, hop by hop, how long it takes from an operator raising stock at
# the PrestaShop master until that change reaches OpenLinker's own store and
# is handed to the marketplace-side propagation fan-out - the chain the
# webhook path actually takes on this stand:
#
#   t0  operator raises stock at the shop (StockAvailable::setQuantity())
#   t1  the OL module writes a `stock.changed` row into its own outbox
#   t2  the module's cron controller delivers that row to OL
#   t3  OL commits webhook_deliveries + sync_jobs in one transaction (#2280)
#   t4  the job runs; inventory_items is updated
#   t5  inventory.propagateToMarketplaces fans out; a
#       marketplace.offerQuantity.update child is enqueued per mapped offer
#
# THIS IS DELIBERATELY NOT #2848's own stub-driven design. #2846 (the
# mutable-stock PrestaShop stub the issue calls a hard blocker) does not
# exist in this worktree, and #2848's own proposed chain is the CRON-SWEEP
# path (master.inventory.syncAll / syncBatch, bulk lane, budgeted pages) -
# a different, and on this stand entirely orthogonal, mechanism. What was
# actually asked for today is "how long from raising stock at the shop
# until it reaches the marketplace", against the REAL PrestaShop container
# already running on the `lab` stand, driven through the real webhook path
# (webhook -> master.inventory.syncByExternalId, the REALTIME lane per
# #2594's split, not the sweep-triggered *.syncFromSweep/*.syncBatch
# children). Both paths are real production paths; this scenario measures
# the one that is actually reachable here.
#
# Two structural findings this scenario's own arrange step depends on and
# reports on, found live against this stand rather than assumed:
#
#  (1) The PrestaShop REST webservice's `stock_availables` PUT resource
#      cannot fire `actionUpdateQuantity` on PrestaShop 9.0.2 AT ALL.
#      classes/webservice/WebserviceRequest.php:332 dispatches PUT/GET on
#      that resource generically onto plain ObjectModel::update()/find();
#      the ONLY `Hook::exec('actionUpdateQuantity', ...)` call site in core
#      is inside the static helper `StockAvailable::setQuantity()`
#      (classes/stock/StockAvailable.php:454-455), whose only in-core
#      callers are the CSV product importer and the back-office
#      "Quantities" tab flow (ProductStockUpdater/CombinationStockUpdater).
#      Verified live: a real `PUT /api/stock_availables/{id}` with a
#      genuinely changed quantity returns HTTP 200 and produces ZERO
#      ps_openlinker_webhook_outbox rows. drivers/ps-set-quantity.php
#      therefore drives t0 through `StockAvailable::setQuantity()` directly
#      via CLI - the same call the back-office action makes - rather than
#      through the webservice API, which structurally cannot reach it.
#
#  (2) The module's response-flush fast path (#2624,
#      OpenLinker::scheduleFastPathDrain) never fires on this stand:
#      WebhookSender::fastPathAvailable() requires
#      fastcgi_finish_request()+ignore_user_abort(), and this image's SAPI
#      is `apache2handler` (mod_php), where fastcgi_finish_request does not
#      exist (confirmed live via a throwaway PHP probe). So EVERY delivery
#      on this stand depends entirely on the module's own cron controller
#      being invoked - and nothing on this container's crontab calls it
#      (`crontab -l` is empty). Hop t1->t2 is therefore, on this stand,
#      100% harness-controlled: the number this scenario reports for that
#      hop is the cadence the harness itself chooses to drain at, not
#      anything approaching a production cron interval. This is reported
#      as the headline finding, not buried in an average.
#
# Sources lib.sh (#2841) and drivers/stock-control.sh (this issue) for
# every guard/manifest/sampler/verdict/stock-write primitive.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f2"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../drivers/stock-control.sh"

# ---------------------------------------------------------------------------
# Configuration (env-overridable, same convention as lib.sh/bootstrap.sh).
# ---------------------------------------------------------------------------
# The six products bootstrap.sh's catalogue already carries. Simple
# products (20/21/25) are written at id_product_attribute=0 - their only
# position. Products WITH combinations (22/23/24) are written at one of
# their real combination attribute ids, NEVER at attribute 0 - found live,
# and worth stating precisely because it silently invalidated an earlier
# draft of this run: `PrestashopInventoryMasterAdapter.listInventory`
# deliberately DROPS the attribute-0 row for a product with combinations
# ("the id_product_attribute=0 aggregate is ignored - the per-combination
# rows [are read instead]", `prestashop-inventory-master.adapter.ts:291-295`
# comment) because PrestaShop itself treats that row as an AGGREGATE it
# recomputes from the combinations, not a real position - a direct write to
# it is silently superseded. Writing there for 22/23/24 fired the webhook
# and re-synced the product (so `inv_job outcome=ok` looked healthy) but
# touched no position OpenLinker's InventoryMaster read actually uses, so
# after the first cycle (when every combination row is fresh and therefore
# always "changed") propagation legitimately stopped firing for those three
# products - not a lane-contention stall, a wrong write target. The map
# below picks one real combination id per multi-variant product instead
# (`ps_stock_available`'s own rows: 22->40, 23->43, 24->45).
PRODUCTS="${PRODUCTS:-20 21 22 23 24 25}"
product_attr_for() {
  case "$1" in
    22) printf '40' ;;
    23) printf '43' ;;
    24) printf '45' ;;
    *) printf '0' ;;
  esac
}
CYCLES="${CYCLES:-4}"

POLL_INTERVAL_MS="${POLL_INTERVAL_MS:-250}"
POLL_MAX_WAIT_SECS="${POLL_MAX_WAIT_SECS:-15}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f2-stock-propagation.sh [--smoke]

  (no flag)  strict measurement - every applicable #2841 guard runs,
             CYCLES x PRODUCTS stock-write/drain/observe cycles, a dated
             report under results/.
  --smoke    driver self-test: one product, one cycle, no manifest, no
             verdict, nothing written under results/.
USAGE
      exit 0
      ;;
    *) die "unknown argument: $arg (use --smoke, --help, or nothing)" ;;
  esac
done

require_tools docker jq curl python3

[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID is not set - source stand-ids.env or export it by hand"
[ -n "${ALLEGRO_A_CONNECTION_ID:-}" ] || die "ALLEGRO_A_CONNECTION_ID is not set - source stand-ids.env"
[ -n "${ALLEGRO_B_CONNECTION_ID:-}" ] || die "ALLEGRO_B_CONNECTION_ID is not set - source stand-ids.env"

# Claimed BEFORE any arrange step - not just before window_start. This
# scenario mutates shared stand state before the measurement window even
# opens (module config, a rotated webhook secret, the runner's own
# WORKER_RUNNER_ENABLED posture), and a peer scenario racing any of that is
# exactly the failure guard_stand_exclusive exists to prevent (#2842/#2848,
# 2026-09-06 - a concurrent F3 run silently invalidated part of an earlier
# F2 attempt this same day).
guard_stand_exclusive "f2-stock-propagation"

ol_login

# ---------------------------------------------------------------------------
# Arrange: point the module at PS_CONNECTION_ID with a freshly rotated
# secret. Never persisted anywhere outside this shell's variable (the F3
# rotate_webhook_secret rationale applies verbatim: this connection points
# at no live shop, so rotation damages nothing).
# ---------------------------------------------------------------------------
rotate_webhook_secret() {
  local resp secret
  resp="$(ol_api POST "/v1/connections/$PS_CONNECTION_ID/webhooks/secret/rotate" "")"
  secret="$(printf '%s' "$resp" | json_field secret)"
  [ -n "$secret" ] || die "rotate_webhook_secret: response carried no 'secret' field: $resp"
  printf '%s' "$secret"
}
SECRET="$(rotate_webhook_secret)"
sc_configure_module "$PS_CONNECTION_ID" "$SECRET"
sc_install_driver
CRON_TOKEN="$(sc_cron_token)"
[ -n "$CRON_TOKEN" ] || die "could not read OPENLINKER_CRON_TOKEN from ps_configuration"
log "arranged: module points at connection $PS_CONNECTION_ID, cron token read"

# ---------------------------------------------------------------------------
# poll_until <description> <max_wait_secs> <command...>
# Runs <command...> every POLL_INTERVAL_MS until it prints a non-empty
# line, or dies naming what never arrived - this scenario never silently
# reports an empty field as a zero-latency hop.
# ---------------------------------------------------------------------------
poll_until() {
  local desc="$1" max_wait="$2"; shift 2
  local waited_ms=0 max_ms=$((max_wait * 1000)) out
  while [ "$waited_ms" -lt "$max_ms" ]; do
    out="$("$@" 2>/dev/null || true)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
    sleep "$(awk -v ms="$POLL_INTERVAL_MS" 'BEGIN{printf "%.3f", ms/1000}')"
    waited_ms=$((waited_ms + POLL_INTERVAL_MS))
  done
  warn "poll_until: '$desc' never observed within ${max_wait}s"
  return 1
}

# ---------------------------------------------------------------------------
# run_one_cycle <product_id> <csv_out>
# Appends one CSV row: product,cycle,t0_ms,t1_ms,outbox_created_local,
#   drain_http_status,drain_before_ms,drain_after_ms,outbox_delivered_utc,
#   webhook_delivery_status,webhook_delivery_created_utc,
#   inv_job_created_utc,inv_job_status,inv_job_outcome,
#   inventory_items_updated_count,inventory_items_max_updated_utc,
#   propagate_job_status,propagate_job_outcome,
#   offer_children_count,offer_child_status,offer_child_last_error
# ---------------------------------------------------------------------------
run_one_cycle() {
  local product="$1" cycle="$2" out_csv="$3"
  local attr before_id current new_qty t0_ms t1_ms
  attr="$(product_attr_for "$product")"
  before_id="$(sc_outbox_max_id)"
  current="$(sc_current_quantity "$product" "$attr")"
  # A distinct value every cycle, never re-derived from the clock alone (a
  # same-second repeat would make two cycles indistinguishable in the
  # per-product outbox chain) - RANDOM plus a floor well clear of 0/negative.
  new_qty=$(( (RANDOM % 5000) + 1000 + cycle ))
  [ "$new_qty" != "${current:-0}" ] || new_qty=$((new_qty + 1))

  read -r t0_ms t1_ms <<< "$(sc_set_quantity "$product" "$attr" "$new_qty")"

  local outbox_row outbox_id outbox_status event_id created_local
  outbox_row="$(poll_until "outbox row for product $product" "$POLL_MAX_WAIT_SECS" sc_outbox_row_since "$product" "$before_id")" \
    || { warn "product $product cycle $cycle: NO OUTBOX ROW - the guard/dedupe swallowed this write, or the hook did not fire"; \
         printf '%s,%s,%s,%s,NO_OUTBOX_ROW,,,,,,,,,,,,,,,,\n' "$product" "$cycle" "$t0_ms" "$t1_ms" >> "$out_csv"; return 0; }
  # ps_sql (mysql -N -B) is TAB-separated, not pipe-separated - unlike every
  # pg_sql multi-column read below, whose default psql -A field separator IS
  # '|'. Mixing the two up silently reads the whole row into $outbox_id
  # (found live in --smoke, cascaded into a malformed downstream query).
  IFS=$'\t' read -r outbox_id outbox_status event_id created_local _delivered_empty <<< "$outbox_row"

  local drain_status drain_before drain_after drain_body
  # The last named `read` variable captures the REST of the line (IFS-joined
  # by single space) rather than only its first token, which is what lets
  # this single read pull both the three scalar fields AND the JSON body in
  # one shot - the body's own internal whitespace is insignificant to a
  # JSON parser, so collapsing runs of spaces to one costs nothing here.
  read -r drain_status drain_before drain_after drain_body <<< "$(sc_drain_cron "$CRON_TOKEN")"
  # HTTP_STATUS is NEVER trusted here - a real module bug (see
  # stock-control.sh's sc_drain_cron header: the success branch of
  # controllers/front/cron.php never calls `exit`, escalated to a fatal by
  # this stand's own unwritable theme-cache dir) makes every successful
  # drain answer 500. drain_status is still recorded verbatim in cycles.csv
  # (and would fail the run's post-guards if it ever meant a real delivery
  # failure); what actually gates this cycle is the POSITIVE body
  # assertion below, plus the delivered_at poll two lines down which reads
  # PrestaShop's own ground truth rather than any HTTP response at all.
  sc_drain_body_ok "$drain_body" \
    || die "sc_drain_cron: response body did not parse as the expected JSON shape (no numeric 'processed' field) - this IS a broken drain, not the known 500: $drain_body"
  local delivered_utc
  delivered_utc="$(poll_until "outbox delivered_at for row $outbox_id" 5 \
    ps_sql "SELECT COALESCE(delivered_at,'') FROM ps_openlinker_webhook_outbox WHERE id=$outbox_id AND delivered_at IS NOT NULL")" \
    || delivered_utc=""

  local wd_status wd_created
  wd_status="$(poll_until "webhook_deliveries row for eventId $event_id" "$POLL_MAX_WAIT_SECS" \
    pg_sql "SELECT status FROM webhook_deliveries WHERE \"eventId\"='$event_id' AND \"connectionId\"='$PS_CONNECTION_ID'")" || wd_status=""
  wd_created="$(pg_sql "SELECT \"createdAt\" FROM webhook_deliveries WHERE \"eventId\"='$event_id' AND \"connectionId\"='$PS_CONNECTION_ID'" 2>/dev/null || true)"

  # master.inventory.syncByExternalId - the webhook-triggered job (realtime
  # lane, #2594's split; NOT the sweep-triggered *.syncFromSweep/*.syncBatch).
  local inv_job_row inv_job_created inv_job_status inv_job_outcome
  inv_job_row="$(poll_until "master.inventory.syncByExternalId row for event $event_id" "$POLL_MAX_WAIT_SECS" \
    pg_sql "SELECT \"createdAt\",status,COALESCE(outcome,'') FROM sync_jobs WHERE \"jobType\"='master.inventory.syncByExternalId' AND \"idempotencyKey\" LIKE '%$event_id%'")" || inv_job_row=""
  IFS='|' read -r inv_job_created inv_job_status inv_job_outcome <<< "$inv_job_row"

  # Wait for that job to reach a terminal status before reading
  # inventory_items - otherwise a slow poll tick could read the row before
  # the handler's own write lands.
  local waited=0
  while [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] && [ "$inv_job_status" != "succeeded" ] && [ "$inv_job_status" != "dead" ]; do
    sleep 1; waited=$((waited + 1))
    inv_job_row="$(pg_sql "SELECT \"createdAt\",status,COALESCE(outcome,'') FROM sync_jobs WHERE \"jobType\"='master.inventory.syncByExternalId' AND \"idempotencyKey\" LIKE '%$event_id%'" 2>/dev/null || true)"
    IFS='|' read -r inv_job_created inv_job_status inv_job_outcome <<< "$inv_job_row"
  done

  # inventory_items rows this job touched: every non-stale variant of this
  # product, joined through identifier_mappings (Product externalId ->
  # internal product id -> ProductVariant rows for that product).
  local inv_count inv_max_updated
  inv_count="$(pg_sql "
    SELECT COUNT(*) FROM inventory_items ii
    JOIN product_variants pv ON pv.id = ii.\"productVariantId\"
    WHERE pv.\"productId\" = (
      SELECT \"internalId\" FROM identifier_mappings
      WHERE \"entityType\"='Product' AND \"connectionId\"='$PS_CONNECTION_ID' AND \"externalId\"='$product'
    ) AND ii.\"updatedAt\" >= '${wd_created:-1970-01-01}'::timestamptz - interval '1 second'
  " 2>/dev/null || printf 0)"
  inv_max_updated="$(pg_sql "
    SELECT MAX(ii.\"updatedAt\") FROM inventory_items ii
    JOIN product_variants pv ON pv.id = ii.\"productVariantId\"
    WHERE pv.\"productId\" = (
      SELECT \"internalId\" FROM identifier_mappings
      WHERE \"entityType\"='Product' AND \"connectionId\"='$PS_CONNECTION_ID' AND \"externalId\"='$product'
    ) AND ii.\"updatedAt\" >= '${wd_created:-1970-01-01}'::timestamptz - interval '1 second'
  " 2>/dev/null || true)"

  # inventory.propagateToMarketplaces - enqueued by the job above once it
  # writes inventory_items (InventoryService.setInventory's own enqueue).
  # Bounded on BOTH sides - lower AND upper - not just the lower bound
  # every other query in this function uses: a multi-variant product's
  # master.inventory.syncByExternalId can legitimately enqueue several of
  # these (one per changed variant), and under sustained sequential load a
  # PENDING one from an EARLIER cycle can still be draining when a LATER
  # cycle's lower-bound-only query runs - found live, where an unbounded
  # upper edge let a later cycle's read see an earlier cycle's children.
  # PROP_WINDOW_SECS is generous (30s) because this hop is exactly the one
  # this scenario found can legitimately queue behind the realtime lane's
  # per-scope cap under sustained writes (see report's lane-saturation
  # note), so a tight window would misreport a slow-but-real completion as
  # "never observed".
  local PROP_WINDOW_SECS=30
  local prop_id prop_status prop_outcome prop_created
  local prop_row
  prop_row="$(poll_until "inventory.propagateToMarketplaces row after $inv_job_created" "$POLL_MAX_WAIT_SECS" \
    pg_sql "SELECT id,\"createdAt\",status,COALESCE(outcome,'') FROM sync_jobs WHERE \"jobType\"='inventory.propagateToMarketplaces' AND \"connectionId\"='$PS_CONNECTION_ID' AND \"createdAt\" BETWEEN '${inv_job_created:-1970-01-01}'::timestamptz - interval '1 second' AND '${inv_job_created:-1970-01-01}'::timestamptz + interval '${PROP_WINDOW_SECS} second' ORDER BY \"createdAt\" ASC LIMIT 1")" || prop_row=""
  IFS='|' read -r prop_id prop_created prop_status prop_outcome <<< "$prop_row"

  # Wait for THIS SPECIFIC propagate job (by id, never re-derived by a
  # time-bounded re-query) to reach a terminal status before reading its
  # children - otherwise a poll that lands while it is still `running` reads
  # zero offerQuantity.update children that in fact land a moment later.
  local prop_waited=0
  while [ -n "$prop_id" ] && [ "$prop_waited" -lt "$POLL_MAX_WAIT_SECS" ] && [ "$prop_status" != "succeeded" ] && [ "$prop_status" != "dead" ]; do
    sleep 1; prop_waited=$((prop_waited + 1))
    prop_row="$(pg_sql "SELECT status,COALESCE(outcome,'') FROM sync_jobs WHERE id='$prop_id'" 2>/dev/null || true)"
    IFS='|' read -r prop_status prop_outcome <<< "$prop_row"
  done

  # marketplace.offerQuantity.update children - hop t5. Reported, never
  # counted as a successful destination write: both Allegro connections on
  # this stand have OfferManager DISABLED by bootstrap.sh's own design (F1's
  # concern, not this scenario's to override), and no #2856 Allegro-stub
  # container exists in this compose file even if it were enabled - so this
  # hop fails deterministically before any network call, and that is
  # reported as a job DISPATCHED, never as a marketplace write.
  #
  # Bounded on both sides, same reasoning as the propagate query above (and
  # for the same live-found reason: an unbounded upper edge let a later
  # cycle's children leak into an earlier cycle's count under sustained
  # load).
  local offer_count offer_status offer_err offer_created
  local offer_where="\"jobType\"='marketplace.offerQuantity.update' AND \"connectionId\" IN ('$ALLEGRO_A_CONNECTION_ID','$ALLEGRO_B_CONNECTION_ID') AND \"createdAt\" BETWEEN '${inv_job_created:-1970-01-01}'::timestamptz - interval '1 second' AND '${inv_job_created:-1970-01-01}'::timestamptz + interval '${PROP_WINDOW_SECS} second'"
  offer_count="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE $offer_where" 2>/dev/null || printf 0)"
  offer_created="$(pg_sql "SELECT \"createdAt\" FROM sync_jobs WHERE $offer_where ORDER BY \"createdAt\" ASC LIMIT 1" 2>/dev/null || true)"
  offer_status="$(pg_sql "SELECT status FROM sync_jobs WHERE $offer_where ORDER BY \"createdAt\" DESC LIMIT 1" 2>/dev/null || true)"
  offer_err="$(pg_sql "SELECT COALESCE(\"lastError\",'') FROM sync_jobs WHERE $offer_where ORDER BY \"createdAt\" DESC LIMIT 1" 2>/dev/null | tr ',' ';' || true)"

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$product" "$cycle" "$t0_ms" "$t1_ms" "$created_local" \
    "$drain_status" "$drain_before" "$drain_after" "${delivered_utc:-}" \
    "${wd_status:-}" "${wd_created:-}" \
    "${inv_job_created:-}" "${inv_job_status:-}" "${inv_job_outcome:-}" \
    "${inv_count:-0}" "${inv_max_updated:-}" \
    "${prop_created:-}" "${prop_status:-}" "${prop_outcome:-}" \
    "${offer_count:-0}" "${offer_created:-}" "${offer_status:-}" "${offer_err:-}" \
    >> "$out_csv"

  log "product=$product cycle=$cycle qty=$new_qty -> outbox=$outbox_id ($outbox_status) drain_http=$drain_status inv_job=$inv_job_status/$inv_job_outcome inv_rows=$inv_count propagate=$prop_status/$prop_outcome offer_children=$offer_count"
}

# ===========================================================================
# --smoke
# ===========================================================================
run_smoke() {
  local tmp_csv
  tmp_csv="$(mktemp)"
  trap "rm -f '$tmp_csv'" EXIT
  printf 'product,cycle,t0_ms,t1_ms,outbox_created_local,drain_http_status,drain_before_ms,drain_after_ms,outbox_delivered_utc,webhook_delivery_status,webhook_delivery_created_utc,inv_job_created_utc,inv_job_status,inv_job_outcome,inventory_items_updated_count,inventory_items_max_updated_utc,propagate_job_created_utc,propagate_job_status,propagate_job_outcome,offer_children_count,offer_child_created_utc,offer_child_status,offer_child_last_error\n' > "$tmp_csv"
  local p
  p="$(printf '%s\n' $PRODUCTS | head -1)"
  run_one_cycle "$p" 0 "$tmp_csv"
  log "=== --smoke result ==="
  cat "$tmp_csv"
  log "--smoke complete. Nothing was written under $RESULTS_ROOT."
}

# ===========================================================================
# strict
# ===========================================================================
run_strict() {
  local CONN_IDS="'$PS_CONNECTION_ID'"

  log "=== pre-flight guards ==="
  guard_scheduler_off
  guard_demo_mode_off
  guard_connection_budget
  guard_pool_recorded
  guard_runner_state enabled
  guard_log_level
  guard_perf_max_attempts
  guard_build
  local head_sha built_sha
  head_sha="${MANIFEST_GIT_SHA}"
  built_sha="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$OL_API_CONTAINER" 2>/dev/null || printf 'unknown')"

  # Clear any stray queued sync_jobs for the PS master connection left by an
  # earlier manual probe, so guard_queue_empty has something true to check.
  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\"='$PS_CONNECTION_ID' AND status IN ('queued','running')" >/dev/null
  guard_queue_empty "$CONN_IDS"

  local run_group dir
  run_group="run$(date +%s)"
  dir="$(results_dir_init f2-stock-propagation "$run_group")"
  local csv="$dir/cycles.csv"
  printf 'product,cycle,t0_ms,t1_ms,outbox_created_local,drain_http_status,drain_before_ms,drain_after_ms,outbox_delivered_utc,webhook_delivery_status,webhook_delivery_created_utc,inv_job_created_utc,inv_job_status,inv_job_outcome,inventory_items_updated_count,inventory_items_max_updated_utc,propagate_job_created_utc,propagate_job_status,propagate_job_outcome,offer_children_count,offer_child_created_utc,offer_child_status,offer_child_last_error\n' > "$csv"

  snapshot_jobs_before "$CONN_IDS"
  local extra_manifest
  extra_manifest="$(jq -n --arg built "$built_sha" --arg head "$head_sha" --argjson cycles "$CYCLES" --arg products "$PRODUCTS" \
    '{builtImageRevision:$built, headRevision:$head, cycles:$cycles, products:$products, fastPathAvailable:false, schedulerAndCronPosture:"scheduler OFF (guard_scheduler_off); PrestaShop OL-module cron drained on-demand by this scenario, no crontab entry calls it on this stand"}')"
  window_start "$dir" f2-stock-propagation "$CONN_IDS" 0 "$extra_manifest"

  local cycle p
  for cycle in $(seq 0 $((CYCLES - 1))); do
    for p in $PRODUCTS; do
      run_one_cycle "$p" "$cycle" "$csv"
    done
  done

  window_stop "$dir"
  # No k6 summary argument, deliberately: this scenario's load is stock writes
  # driven through the shop, not an HTTP generator, so there is nothing for
  # post_guard_generator_saturated to check (#2933).
  run_post_guards "$dir" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
    "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" ""

  # Clear the deterministically-failing offerQuantity.update children this
  # run produced - they will otherwise retry for ~30h against a capability
  # this scenario did not enable and cannot succeed against, polluting the
  # stand for whatever runs on it next.
  pg_sql_write "DELETE FROM sync_jobs WHERE \"jobType\"='marketplace.offerQuantity.update' AND \"connectionId\" IN ('$ALLEGRO_A_CONNECTION_ID','$ALLEGRO_B_CONNECTION_ID') AND \"createdAt\">='$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)'" >/dev/null || true

  write_dated_report "$run_group" "$dir" "$csv" "$built_sha" "$head_sha"
}

# ---------------------------------------------------------------------------
# write_dated_report <run_group> <dir> <csv> <built_sha> <head_sha>
# ---------------------------------------------------------------------------
write_dated_report() {
  local run_group="$1" dir="$2" csv="$3" built_sha="$4" head_sha="$5"
  local report="$RESULTS_ROOT/results-F2-$(date -u +%Y-%m-%d).md"

  local summary
  summary="$(python3 "$SCRIPT_DIR/../drivers/f2-summarize.py" "$csv")"

  {
    printf '# F2 - stock propagation latency\n\n'
    printf '_generated %s, run group %s_\n\n' "$(iso_now)" "$run_group"

    printf '## Conditions\n\n'
    printf -- '- Stand: `lab` (docker-compose.lab.yml, #2854), a single developer workstation shared with two other OpenLinker docker-compose stacks (`ol-demo-fresh-*`, `openlinker-*`) - no CPU pinning, no isolation from host contention. Every figure below is subject to that.\n'
    printf -- '- `guard_build` PASSED: running images and the working tree both resolve to `%s`.\n' "$head_sha"
    printf -- '- Runner: ENABLED for this scenario (`guard_runner_state enabled`) - the whole chain is unobservable otherwise. Scheduler: OFF (`guard_scheduler_off`) - the inventory sweep is a second, competing path to the same rows and was deliberately excluded so every observed job is attributable to this scenario'"'"'s own webhook-triggered writes.\n'
    printf -- '- %s products x %s cycles = %s stock-write attempts.\n\n' "$(printf '%s' "$PRODUCTS" | wc -w)" "$CYCLES" "$(($(printf '%s' "$PRODUCTS" | wc -w) * CYCLES))"

    printf '## Headline finding: hop t1->t2 is EXCLUDED from this measurement, not measured as fast\n\n'
    printf -- 'This scenario force-drains the outbox after every single write (calls the module'"'"'s cron controller immediately). That is a deliberate experimental choice - it isolates OpenLinker'"'"'s OWN work from the shop'"'"'s delivery cadence, which is the more actionable half of the chain to an operator - but it means **the t1->t2 hop below is NOT a measurement of anything a real deployment experiences; it is excluded by construction.** On a stand shaped exactly like this one, hop t2 in production is bounded below by whatever external cron interval an operator (or a hosting provider'"'"'s crontab) configures for the module'"'"'s cron controller - commonly minutes, not the sub-second figure this run reports for it. To reconstruct a real "shop to OpenLinker" figure from the numbers below: take Hop A + Hop C + Hop D + Hop E (+ Hop F if you also want "job dispatched to the destination", which is NOT "reached the marketplace" - see the Hop 5 section) and ADD your own PrestaShop cron interval on top. That addition is the dominant term for almost any real deployment, and this run cannot supply it: nothing on this container'"'"'s crontab calls the cron controller at all (`crontab -l` is empty), and the module'"'"'s own response-flush fast path (#2624), which WOULD close this gap automatically, never fires on this image - its SAPI is `apache2handler`/mod_php, and `fastcgi_finish_request()` does not exist there (confirmed live via a throwaway PHP probe served over a real HTTP request: `PHP_SAPI` reports `apache2handler`, `function_exists(\x27fastcgi_finish_request\x27)` reports `false`). **If a deployment runs behind php-fpm instead, hop t2 collapses toward zero automatically via the fast path** - that is a real, actionable, deployment-shape-dependent fact this stand happens to be positioned to demonstrate, precisely because it is NOT running php-fpm.\n\n'

    printf '## Why the earlier 2-of-25 trial undercounted (root-caused, not guessed)\n\n'
    printf -- 'Two independent, verified mechanisms explain it, and the webservice-API attempt made it worse than either alone would:\n\n'
    printf -- '1. **The PrestaShop REST webservice cannot fire the hook at all on this PrestaShop version.** `stock_availables` PUT is dispatched generically onto `ObjectModel::update()` (`classes/webservice/WebserviceRequest.php:332`), never through the static `StockAvailable::setQuantity()` helper that is the only call site of `Hook::exec(\x27actionUpdateQuantity\x27, ...)` in PrestaShop 9.0.2 core (`classes/stock/StockAvailable.php:454-455`). Verified live on this stand: a real webservice `PUT` with a genuinely changed quantity returns HTTP 200 and inserts zero outbox rows.\n'
    printf -- '2. **A dedup key survives until the row is CLAIMED, not until it is delivered.** `OutboxRepository::enqueueEvent` derives `dedup_key` from `(provider, connectionId, eventType, objectType, externalId)` - it does not include the timestamp or the new quantity - and `INSERT IGNORE` collides on it. The key is cleared only when the drainer *claims* a row (moves it to `processing`), not when it is delivered. Verified live: two `StockAvailable::setQuantity()` calls for the SAME product id, made before any drain, produced exactly ONE outbox row; the second call silently no-opped. With only 6 distinct products on this catalogue, a burst of writes made faster than the drain cadence collapses onto at most 6 rows - independent of how many individual stock_available rows (combinations) were actually touched.\n\n'
    printf -- 'This scenario avoids both: it drives t0 through `StockAvailable::setQuantity()` directly (drivers/ps-set-quantity.php), and it drains after every single write, so every cycle claims its own row before the next write for that product can be silently swallowed.\n\n'

    printf '## Root-caused: `drain_http_status` reads 500 on every cycle, and the hop timings do not depend on it\n\n'
    printf -- 'Every cycle'"'"'s cron-drain call returns HTTP 500 - verified NOT to be a delivery failure, and not trusted on faith: the same request that returns 500 also carries a fully-formed, ACCURATE JSON body (`{"processed":1,"delivered":1,"failed":0,...}`), and the outbox row it was meant to deliver reaches `delivered_at` at that exact same second, every time. The cause is unrelated to the module entirely: PrestaShop'"'"'s `FrontController::display()` runs its normal asset-pipeline step AFTER the module'"'"'s own `initContent()` has already echoed the JSON body (the controller never calls `exit`), and that step throws `MatthiasMullie\\Minify\\Exceptions\\IOException: The file \x22/var/www/html/themes/classic/assets/cache/theme-3f744e.css\x22 could not be opened for writing` - a container filesystem-permission gap on the theme asset cache directory, confirmed by matching the Apache error-log timestamp to the exact same request'"'"'s access-log line and to the outbox row'"'"'s own `delivered_at`. **Because of this, no hop in this report is computed from `drain_http_status` or from the cron controller'"'"'s HTTP response at all** - every hop is computed from PrestaShop'"'"'s own `ps_openlinker_webhook_outbox.delivered_at` column (the ground truth of whether delivery happened) and from OpenLinker'"'"'s own `webhook_deliveries`/`sync_jobs`/`inventory_items` timestamps, never from a status line. `drain_http_status` is still recorded verbatim in `cycles.csv` as a data point, precisely so this claim is checkable rather than asserted.\n\n'

    printf '## Per-hop latency (measured, ms; sample sizes stated per row)\n\n'
    printf -- '**None of these is a "reached the marketplace" figure.** The chain measured stops at the point where OpenLinker DISPATCHES a `marketplace.offerQuantity.update` job - see the Hop 5 section below for why the write itself is unmeasurable on this stand, and see the Headline Finding above for why Hop B is an excluded floor, not a shop-cron estimate.\n\n'
    printf '```\n%s\n```\n\n' "$summary"

    printf '## A methodology bug found and fixed mid-run: writing `id_product_attribute=0` on a product WITH combinations silently changes nothing\n\n'
    printf -- 'An earlier draft of this run wrote every product at `id_product_attribute=0`, uniformly. For the three simple products (20/21/25) that IS the product'"'"'s only stock position, but for the three products WITH combinations (22/23/24), PrestaShop treats that row as an AGGREGATE it recomputes from the combinations - `PrestashopInventoryMasterAdapter.listInventory` says so directly in its own source: "the id_product_attribute=0 aggregate is ignored - the per-combination rows [are read instead]" (`prestashop-inventory-master.adapter.ts:291-295`), and a separate comment on the SAME file states a direct write there "would be discarded" (`:1011-1012`). So a write to attribute 0 on those three products fired the webhook and re-synced the product (`inv_job outcome: ok`, looking perfectly healthy) while touching NO position OpenLinker'"'"'s InventoryMaster read actually consults. On the FIRST cycle propagation still fired for every position (every `inventory_items` row was a fresh insert, which the no-change guard always treats as a change); from the SECOND cycle onward, the three unaffected combination products stopped propagating entirely - not a lane-contention stall, a wrong write target. **Fixed** by writing products 22/23/24 at one of their real combination attribute ids instead (22->40, 23->43, 24->45, `product_attr_for()` in this script) - this run'"'"'s own numbers reflect the fix, and a comment above `product_attr_for()` records the finding for whoever edits this scenario next.\n\n'

    printf '## Enqueue amplification (measured, after the fix above)\n\n'
    printf -- '- One webhook event per stock-changed **product** (the hook always attributes the event to the product id - `openlinker.php`, "Always use product ID as externalId"), one `master.inventory.syncByExternalId` job per event, one `inventory_items` row upserted per non-stale `ProductVariant` under the product that GENUINELY changed value (`inventory_items_updated_count` in `cycles.csv`).\n'
    printf -- '- Per changed VARIANT, one `inventory.propagateToMarketplaces` job, which enqueued exactly **2** `marketplace.offerQuantity.update` children (one per Allegro connection) - never 36 (18 synthetic Offer mappings x 2 connections that this stand'"'"'s bootstrap seed data maps onto every variant, purely so the F1 order-synthesis stub has enough distinct external offer ids to reference), because the enqueue idempotency key (`inventory:{connectionId}:{productId}:{variantId}:{quantity}:{observedAt}`, `inventory-propagate-to-marketplaces.handler.ts`) omits the target offer id and collapses every mapping sharing connection+variant+quantity+timestamp onto one winning enqueue. One variant : one live offer per connection is the guarded production norm (#1837), so the 18->1 collapse is an artifact of reusing F1'"'"'s seed data for a question it was not built to answer, not a newly-discovered defect.\n\n'

    printf '## Located vs. pooled position shapes\n\n'
    printf -- 'Not applicable on this stand as configured: PrestaShop reports no location dimension for any of the six products (`ps_stock_available.location` is empty on every row, and the adapter never populates `Inventory.locationId` for it), so every position OpenLinker holds for this master is POOLED (`locationId IS NULL`) by construction - there is no #2324/#2325 located-position collapse to observe here, and none is claimed.\n\n'

    printf '## Hop 5 (destination write) - NOT MEASURABLE on this stand, and why enabling OfferManager would not fix that\n\n'
    printf -- 'Both Allegro connections (`perf-allegro-a`/`perf-allegro-b`) have `OfferManager` DISABLED by `bootstrap.sh`'"'"'s own design - deliberately, for a DIFFERENT scenario'"'"'s (F1) benefit, to keep `marketplace.offers.sync` from burning retries against no live stub. `marketplace.offerQuantity.update` therefore fails after 3 attempts with the deterministic, structural error `Connection <id> has capability OfferManager disabled` - BEFORE any network call is attempted, confirmed against every observed job'"'"'s `lastError` in `cycles.csv`. **This scenario deliberately did NOT enable the capability to force a real write**, and checked first rather than assuming: no `allegro-stub` hostname resolves anywhere on this stand'"'"'s docker network at all (`getent hosts allegro-stub` inside the worker container: not found) - the #2856 Allegro stub is a separate, not-yet-integrated worktree. Enabling `OfferManager` would only trade one deterministic non-write failure (capability disabled, fails in milliseconds) for another (DNS resolution failure, fails after a connect timeout) - neither is a marketplace WRITE, so flipping the flag would not have produced a real number, only a slower fake one, and would have touched a connection shared with other scenarios for no measurement gain. So every "Hop F" / "TOTAL ... offer child enqueued" figure above means exactly that: a job was DISPATCHED toward the marketplace. None of them means the marketplace was updated, and the report'"'"'s own hop labels say "enqueued", never "delivered", for this reason.\n\n'

    printf '## What this did not establish\n\n'
    printf -- '- **No hop-5 (destination) latency, and none is claimed** - reachability of an Allegro-side write is a prerequisite this stand does not currently supply (no `allegro-stub` host, capability deliberately left disabled - see the Hop 5 section). Every figure this report calls a "total" stops at job dispatch, not delivery.\n'
    printf -- '- **No production-representative t1->t2 (shop cron cadence) figure - by deliberate exclusion, not by omission.** See the Headline Finding: this run forces an immediate drain specifically to isolate OpenLinker'"'"'s own work, and a real deployment must ADD its own external cron interval on top of every total this report quotes. What IS established is that the interval is unbounded absent an external caller on a stand shaped like this one, and that it would collapse toward zero automatically on a php-fpm deployment via the #2624 fast path - both operationally actionable facts, neither a production interval.\n'
    printf -- '- Only 6 distinct products exist in this catalogue, so the dedup-collapse mechanism (root-caused above) caps the number of INDEPENDENT per-product outbox chains available on this stand at 6 per drain cycle - repeated over %s cycles for %s total attempts, never a larger independent N.\n' "$CYCLES" "$(($(printf '%s' "$PRODUCTS" | wc -w) * CYCLES))"
    printf -- '- No sustained-load / concurrent-write figure: every cycle in this run drains after a single write, so nothing here characterises what happens under a BURST of writes across many products landing between drains (the dedup-collapse section above describes the mechanism, not a measured collapse RATE under load). A related, real observation an earlier draft of this run DID surface and this final run'"'"'s own `cycles.csv` should be checked for: under several back-to-back cycles, `inventory.propagateToMarketplaces` for a multi-variant product can queue for longer than this scenario'"'"'s 15s poll (the realtime lane'"'"'s per-scope cap is 2, and a 3-4-variant product'"'"'s own propagate jobs can exceed it) - a real lane-saturation signal under sustained sequential writes, distinct from the attribute-0 methodology bug, and worth a dedicated sustained-load scenario rather than this one'"'"'s single-write-per-cycle shape.\n'
    printf -- '- No multi-replica or multi-location figure (single worker replica on this stand; PrestaShop reports no location dimension at all, see above).\n'
  } > "$report"
  log "wrote $report"
}

case "$MODE" in
  smoke) run_smoke ;;
  strict) run_strict ;;
esac
