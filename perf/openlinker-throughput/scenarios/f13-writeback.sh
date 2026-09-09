#!/usr/bin/env bash
#
# F13 - marketplace write-back latency (#3001, epic #2840).
#
# Every prior flow in this campaign (F1/F2/F3/F5/F7/F10, the
# perf/prestashop-baseline catalogue-read campaign) measures what
# OpenLinker INGESTS and how fast it PROCESSES it. Not one measures a
# write-back TO the marketplace, and that is the one axis this industry
# publishes commitments for (Apilo: waybill within 15 min, shipment status
# hourly, payments hourly). This scenario measures four legs:
#
#   Leg 1  Waybill/tracking write-back  - event-driven, no cron at all.
#           `OrderLifecycleRelayService.relay()` fired synchronously by
#           `ShipmentDispatchNotificationService.notifyDispatched` (the
#           #837/#769 operator path, also fired automatically by #838's
#           shipment-status poll and by the InPost webhook once #768 lands).
#   Leg 2  Shipment-status write-back   - `marketplace.shipment.statusSync`
#           (cron `0 */15 * * * *`, cursor `allegro.shipmentStatus.scanOffset`).
#           Pulls carrier tracking, then relays a transition through the SAME
#           primitive as Leg 1.
#   Leg 3  Fulfillment-status read-back - `marketplace.fulfillment.statusSync`
#           (cron `0 */15 * * * *`, cursor `prestashop.fulfillmentStatus.scanOffset`,
#           `updatedSinceDays` default 30). Reads PrestaShop's own order state
#           for every mirrored, recently-active order record on one page.
#   Leg 4  Payment-status write-back    - NOT measured. See "Leg 4" section.
#
# THE STUB DOES NOT SERVE EVERY ENDPOINT THESE LEGS NEED (#2856's own
# README, "what it deliberately does not serve"). It serves GET /me,
# GET /order/events, GET /order/checkout-forms/{id}, PUT
# /sale/offer-quantity-change-commands/{id}, POST order synthesis, fault
# injection and stats. It serves NEITHER the fulfillment-status PUT
# (`/order/checkout-forms/{id}/fulfillment`) NOR the shipment-tracking GET
# (`/shipment-management/shipments/{id}`) that Legs 1 and 2 need - both fall
# through to the stub's unserved-route 404 catch-all (`notFound()`, which
# never calls `delay()`). What this DOES and does NOT establish is stated at
# every hop and summarised in the report's own "what this did not
# establish" section - the same discipline F2's Hop 5 uses for the one
# marketplace endpoint the stub DOES serve.
#
# Leg 3 is different in kind: it calls the REAL PrestaShop container on this
# stand, not a stub. `PrestashopOrderProcessorAdapter.getFulfillmentStatus`
# treats a 404 (order not found) as a clean `{status: null}` rather than
# throwing (verified by reading the adapter source), so a genuine PrestaShop
# webservice round-trip is exercised per record WITHOUT needing a single
# real PrestaShop order to exist. This is what lets Leg 3 answer the
# incidental "474s p50, every 15 minutes, ~53% duty cycle on one bulk slot"
# finding from `results-sustained-mixed-load-2026-09-08.md` §3.1 without
# reproducing that run's 50,006-product catalogue or 2,003,176-row
# order_records history: `OrderRecordRepository.findMany`'s own source
# comment states the `destinationConnectionId` / `syncStatus` filter is a
# JSONB CONTAINMENT scan with "no GIN index today - acceptable at v1 scale
# (<=30k rows in the typical 30-day window)" - i.e. the query is a
# candidate for scaling with TOTAL order_records row count, independent of
# how many rows the filter actually matches. This scenario tests exactly
# that hypothesis directly against the source, at two table volumes, while
# holding the number of records genuinely PROCESSED (and therefore the
# number of real PrestaShop calls made) constant across both.
#
# NO PRODUCTION CODE IS TOUCHED. Every measurement drives the shipped
# services through their own public seams (the HTTP API, and direct
# `sync_jobs` enqueues carrying the identical payload shape the real
# scheduler tasks build) - this is a measurement-harness change only.
#
# Sources lib.sh (#2841) for every guard/manifest/sampler/verdict primitive,
# and follows scenarios/f2-stock-propagation.sh's stage-chain method. Leg 2's
# capability toggle (`leg2_enable_shipping_capability`/`leg2_restore_capabilities`,
# restored on exit) is NOT the f1-order-ingestion.sh `set_destination` API-PATCH
# idiom - see the leg2 comment block below for why that path is unavailable here.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
# LAB_COMPOSE_DIR - override for the worktree that physically holds the
# `lab` docker-compose project's api/worker services. In a single-worktree
# stand this equals REPO_ROOT and nothing changes. On a multi-agent campaign
# the `lab` project can be re-anchored onto a DIFFERENT worktree the moment
# any scenario there rebuilds+recreates api/worker (`docker inspect
# lab-worker-1 --format '{{index .Config.Labels
# "com.docker.compose.project.working_dir"}}'` tells the truth) - running a
# recreate from the wrong worktree's docker-compose.lab.yml/.env.lab risks
# swapping bind-mount source paths out from under whichever scenario the
# project is actually anchored to. Found live (2026-09-09): the shared
# stand's api/worker had been re-anchored onto a sibling campaign agent's
# worktree by its own rebuild; this scenario's own worktree carried no
# `.env.lab` at all. Left unset, behaviour is identical to before this
# override existed.
LAB_COMPOSE_DIR="${LAB_COMPOSE_DIR:-$REPO_ROOT}"
ENV_FILE="$LAB_COMPOSE_DIR/.env.lab"
LIB_LOG_PREFIX="f13"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

# ---------------------------------------------------------------------------
# Configuration (env-overridable, same convention as every sibling scenario).
# ---------------------------------------------------------------------------
CYCLES_LEG1="${CYCLES_LEG1:-20}"          # notify-dispatched samples
LEG2_M_VALUES="${LEG2_M_VALUES:-5 50}"    # non-terminal shipments per scan
LEG2_REPEATS="${LEG2_REPEATS:-3}"         # repeats per M value
LEG3_MATCH_COUNT="${LEG3_MATCH_COUNT:-100}"      # order_records genuinely processed, BOTH volumes
LEG3_NOISE_COUNT="${LEG3_NOISE_COUNT:-10000}"    # extra non-matching rows, LARGE volume only
LEG3_REPEATS="${LEG3_REPEATS:-3}"

POLL_INTERVAL_SECS="${POLL_INTERVAL_SECS:-1}"
POLL_MAX_WAIT_SECS="${POLL_MAX_WAIT_SECS:-120}"

RUN_TAG="f13_$$_$(date +%s)"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f13-writeback.sh [--smoke]

  (no flag)  strict measurement - every applicable #2841 guard runs, all
             three measurable legs, a dated report under results/.
  --smoke    driver self-test: one cycle of leg 1 only, no manifest, no
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

guard_stand_exclusive "f13-writeback"

ol_login

# The stand's worker runner posture is read from the RUNNING container
# rather than assumed - a peer scenario (this campaign found #2980's own
# run) may have left WORKER_RUNNER_ENABLED=false behind it, and
# `guard_runner_state enabled` only CHECKS, it never enables. Captured here,
# before the trap below, mirroring f4-claim-contention.sh's posture-capture
# discipline: this scenario may not be the thing that brought the stand up,
# so the value restored on exit must be what was really running, not a
# guess. RUNNER_TOGGLED tracks whether THIS run actually flipped anything,
# so a stand that was already enabled is never needlessly recreated on exit.
RUNNER_TOGGLED=0
ORIGINAL_RUNNER_ENABLED="$(docker exec "$(discover_worker_containers | awk '{print $1}')" printenv WORKER_RUNNER_ENABLED 2>/dev/null || printf '')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || \
  ORIGINAL_RUNNER_ENABLED="$(awk -F= '/^WORKER_RUNNER_ENABLED=/{print $2; exit}' "$ENV_FILE" 2>/dev/null || printf 'false')"
[ -n "$ORIGINAL_RUNNER_ENABLED" ] || ORIGINAL_RUNNER_ENABLED=false
log "stand worker-runner posture at scenario start: WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED (restored on exit if this run changes it)"

# ---------------------------------------------------------------------------
# timed_post <path> - one authenticated POST, timing captured by curl itself
# (never the shell's own clock, which would additionally charge fork/exec
# overhead to the measurement). Echoes "status\tms\tbody".
# ---------------------------------------------------------------------------

# pg_sql_write_besteffort <sql> - lib.sh's `pg_sql_write` is FATAL by design
# ("a write that silently no-ops must never read as success"), which is
# wrong for a cleanup step run from inside the EXIT trap: bash does not
# re-enter a trap that is already running, so a `die()` part-way through
# `f13_on_exit` would abort the REST of the trap - including
# `release_stand_exclusive` - and leak the stand lock for the rest of its
# TTL. Found live (2026-09-09): an autovacuum on `sync_jobs` (10 rows,
# nothing to do with this scenario's own load) transiently held the table
# past `statement_timeout` while a --smoke run's cleanup was mid-trap, and
# the lock leaked. Cleanup is not a correctness boundary - a leftover
# f13-tagged row is caught by the next run's own guard_queue_empty /
# distinctly-tagged inserts, never silently miscounted - so every trap-time
# write goes through this instead, warning rather than dying.
pg_sql_write_besteffort() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -c "$1" >/dev/null 2>&1 \
    || warn "pg_sql_write_besteffort: cleanup statement failed (non-fatal, trap continues): $1"
}

# f13_set_runner_enabled <true|false> - recreate ONLY the worker service at
# its CURRENT replica count with WORKER_RUNNER_ENABLED flipped. `--no-deps`
# so postgres/redis/prestashop/allegro-stub are never touched (mirrors
# f4-claim-contention.sh's `scale_workers`, minus the replica-count change
# this scenario has no reason to make). `die`s on a genuine failure to
# recreate - this only ever runs from run_strict's own pre-flight, never
# from the EXIT trap, so dying here cannot skip a cleanup step.
f13_set_runner_enabled() {
  local runner="$1" replicas w tries hits
  replicas="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$replicas" -ge 1 ] || replicas=1
  if grep -q '^WORKER_RUNNER_ENABLED=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$runner/" "$ENV_FILE"
  else
    printf 'WORKER_RUNNER_ENABLED=%s\n' "$runner" >> "$ENV_FILE"
  fi
  ( cd "$LAB_COMPOSE_DIR" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --scale "worker=$replicas" worker >/dev/null 2>&1 ) \
    || die "f13_set_runner_enabled: compose refused to recreate the worker service at runner=$runner"

  # lib.sh's own container-discovery cache is stale by construction: the
  # container just got recreated under a fresh id.
  WORKER_CONTAINERS=""
  WORKER_CONTAINERS_RESOLVED=0
  _ensure_worker_containers

  if [ "$runner" = "true" ]; then
    for w in $WORKER_CONTAINERS; do
      tries=0
      # `grep -c`, never `grep -q` - `grep -q` exits on its first match and
      # SIGPIPEs `docker logs` mid-write, which `set -o pipefail` turns into
      # a false failure once the log is long enough to outlive the pipe
      # (the documented #2842 lesson, carried over verbatim from f4).
      while true; do
        hits="$(docker logs "$w" 2>&1 | grep -cF 'Starting sync job runner loop' || true)"
        [ "${hits:-0}" -eq 0 ] || break
        tries=$((tries + 1))
        [ "$tries" -lt 60 ] || die "f13_set_runner_enabled: $w never logged 'Starting sync job runner loop'"
        sleep 1
      done
    done
  else
    sleep 5
  fi
  log "worker runner set to WORKER_RUNNER_ENABLED=$runner (containers: [$WORKER_CONTAINERS])"
}

# f13_restore_runner - EXIT-trap-safe counterpart. Never `die`s (mirrors
# f4-claim-contention.sh's own restore, written out longhand for the same
# reason: a `die` inside an already-running EXIT trap skips every statement
# after it, including `release_stand_exclusive`). A no-op unless THIS run
# actually flipped the flag.
f13_restore_runner() {
  [ "${RUNNER_TOGGLED:-0}" = "1" ] || return 0
  log "restoring stand worker-runner posture: WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED"
  if [ -f "$ENV_FILE" ]; then
    sed -i "s/^WORKER_RUNNER_ENABLED=.*/WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED/" "$ENV_FILE" 2>/dev/null || true
  fi
  local replicas
  replicas="$(discover_worker_containers | wc -w | tr -d ' ')"
  [ "$replicas" -ge 1 ] || replicas=1
  ( cd "$LAB_COMPOSE_DIR" && docker compose -f docker-compose.lab.yml --env-file .env.lab -p lab \
      up -d --no-deps --scale "worker=$replicas" worker >/dev/null 2>&1 ) \
    || warn "f13_restore_runner: could not restore the worker runner posture - stand left at WORKER_RUNNER_ENABLED=true [$(discover_worker_containers)]"
}

timed_post() {
  local path="$1" tmp status_and_time status t ms body
  tmp="$(mktemp)"
  status_and_time="$(curl -sS -o "$tmp" -w '%{http_code} %{time_total}' -X POST \
    "$OL_API_URL$path" -H "Authorization: Bearer $OL_TOKEN")"
  status="${status_and_time%% *}"
  t="${status_and_time##* }"
  ms="$(awk -v t="$t" 'BEGIN{printf "%.0f", t*1000}')"
  body="$(cat "$tmp")"
  rm -f "$tmp"
  printf '%s\t%s\t%s\n' "$status" "$ms" "$body"
}

# ===========================================================================
# Leg 1 - waybill/tracking write-back (event-driven, no cron).
#
# Setup per cycle is the MINIMUM that makes `OrderLifecycleRelayService.relay`
# resolve Allegro as a target and reach `write({type:'dispatched'})`:
#   - an `order_records` row (so the response's `source` field labels the
#     outcome correctly rather than reading `absent` for want of a
#     `sourceConnectionId` - `ShipmentDispatchNotificationService.
#     resolveSourceOutcome` reads it, not the relay itself)
#   - an `identifier_mappings` row of entityType='Order' pointing this
#     internal order id at ALLEGRO_A_CONNECTION_ID (the relay resolves
#     participants via `IIdentifierMappingService.getExternalIds`, never via
#     `order_records`)
#   - a `Shipment` row at status='generated' (the #837 at-most-once gate)
#     whose `connectionId` is PS - PS is used here purely as a resolvable
#     "carrier" for `resolveCarrierHint` (best-effort, never fatal); it must
#     NOT be Allegro's own connection id, or the relay's own-carrier-as-
#     origin exclusion (ADR-027, ShipmentDispatchNotificationService's own
#     header) would exclude Allegro from the target set.
#
# t0/t1 bracket exactly the `POST .../notify-dispatched` call - the WHOLE
# call is synchronous (no queued job, no cursor, nothing to await
# separately), so there is exactly one hop to report, not a chain. That is
# stated as a finding, not an omission: an event-driven leg with no
# scheduled backstop for a single order has no second timestamp to bracket
# against on this stand.
# ===========================================================================
leg1_run_cycle() {
  local i="$1" csv="$2"
  local order_id="f13wb_${RUN_TAG}_ord_${i}"
  local shipment_id="f13wb_${RUN_TAG}_ship_${i}"
  local external_id="f13wb-ext-${RUN_TAG}-${i}"

  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    VALUES
      ('$order_id','$ALLEGRO_A_CONNECTION_ID'::uuid,
       '{\"totals\":{\"currency\":\"PLN\",\"total\":10.00}}'::jsonb,
       '[]'::jsonb,'ready',now(),now())" >/dev/null

  pg_sql_write "INSERT INTO identifier_mappings
      (id,\"entityType\",\"internalId\",\"externalId\",\"platformType\",\"connectionId\",\"createdAt\",\"updatedAt\")
    VALUES
      (gen_random_uuid(),'Order','$order_id','$external_id','allegro','$ALLEGRO_A_CONNECTION_ID'::uuid,now(),now())" >/dev/null

  pg_sql_write "INSERT INTO shipments
      (id,\"orderId\",\"connectionId\",direction,\"shippingMethod\",status,\"createdAt\",\"updatedAt\")
    VALUES
      ('$shipment_id','$order_id','$PS_CONNECTION_ID'::uuid,'outbound','kurier','generated',now(),now())" >/dev/null

  local status ms body outcome source dest0
  IFS=$'\t' read -r status ms body <<< "$(timed_post "/v1/shipments/$shipment_id/notify-dispatched")"
  outcome="$(printf '%s' "$body" | jq -r '.outcome // "NA"' 2>/dev/null || printf 'NA')"
  source="$(printf '%s' "$body" | jq -r '.source // "NA"' 2>/dev/null || printf 'NA')"
  dest0="$(printf '%s' "$body" | jq -r '.destinations[0].status // "none"' 2>/dev/null || printf 'NA')"

  printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$i" "$shipment_id" "$status" "$ms" "$outcome" "$source" "$dest0" "$order_id" >> "$csv"
  log "leg1 cycle=$i shipment=$shipment_id http=$status ms=$ms outcome=$outcome source=$source dest0=$dest0"
}

leg1_cleanup() {
  pg_sql_write_besteffort "DELETE FROM shipments WHERE id LIKE 'f13wb_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM identifier_mappings WHERE \"internalId\" LIKE 'f13wb_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM order_records WHERE \"internalOrderId\" LIKE 'f13wb_${RUN_TAG}_%'"
}

# ===========================================================================
# Leg 2 - shipment-status write-back, READ HALF ONLY (see report: the PUSH
# half is unreachable on this stand and is reported as such, never silently
# relabelled as "measured").
#
# `ShippingProviderManager` is not enabled on ALLEGRO_A_CONNECTION_ID by
# default on this stand (verified live via GET /v1/connections/:id before
# writing this scenario). It is a REAL, dispatched capability at the runtime
# `getCapabilityAdapter` layer (Allegro's manifest + dispatch table both
# carry it, and ShipmentStatusSyncService resolves it there) but it is
# DELIBERATELY ABSENT from `CoreCapabilityValues`, the closed list the
# connection-update DTO's `@IsIn(CoreCapabilityValues)` validates
# `enabledCapabilities` against - so unlike `OrderProcessorManager`
# (f1-order-ingestion.sh's `set_destination` idiom), this capability can
# NEVER be set via an ordinary API PATCH; the DTO validation rejects it
# unconditionally with a 400 (verified live). We therefore bypass the API
# layer entirely and write `connections."enabledCapabilities"` directly via
# Postgres, mirroring this script's own established `pg_sql_write`
# (fatal, arrange-phase) / `pg_sql_write_besteffort` (non-fatal, exit-trap)
# discipline used elsewhere (e.g. the `DELETE FROM shipments ...` cleanups).
# Restores the original list on exit.
# ===========================================================================
LEG2_ORIGINAL_CAPS=""
LEG2_CAPS_TOUCHED=0

allegro_connection_json() {
  ol_api GET "/v1/connections/$ALLEGRO_A_CONNECTION_ID"
}

leg2_enable_shipping_capability() {
  LEG2_ORIGINAL_CAPS="$(pg_sql "SELECT \"enabledCapabilities\"::text FROM connections WHERE id = '$ALLEGRO_A_CONNECTION_ID'")"
  local new_caps
  new_caps="$(printf '%s' "$LEG2_ORIGINAL_CAPS" | jq -c '. + ["ShippingProviderManager"] | unique')"
  LEG2_CAPS_TOUCHED=1
  pg_sql_write "UPDATE connections SET \"enabledCapabilities\" = '$new_caps'::jsonb WHERE id = '$ALLEGRO_A_CONNECTION_ID'"
  log "leg2: enabled ShippingProviderManager on $ALLEGRO_A_CONNECTION_ID via direct DB write (was $LEG2_ORIGINAL_CAPS) - not reachable via API PATCH, see comment above"
}

leg2_restore_capabilities() {
  [ "$LEG2_CAPS_TOUCHED" -eq 1 ] || return 0
  pg_sql_write_besteffort "UPDATE connections SET \"enabledCapabilities\" = '$LEG2_ORIGINAL_CAPS'::jsonb WHERE id = '$ALLEGRO_A_CONNECTION_ID'" \
    || warn "leg2_restore_capabilities: could not restore $ALLEGRO_A_CONNECTION_ID.enabledCapabilities to $LEG2_ORIGINAL_CAPS - fix by hand"
  log "leg2: restored enabledCapabilities on $ALLEGRO_A_CONNECTION_ID to $LEG2_ORIGINAL_CAPS"
}

# leg2_run_one <m> <run> <csv> - seeds $m non-terminal outbound Allegro
# shipments, enqueues one `marketplace.shipment.statusSync` job carrying the
# IDENTICAL payload shape the real scheduler task builds
# (allegro-scheduler-tasks.ts), waits for it to reach a terminal sync_jobs
# status, and records `lastAttemptDurationMs` - the column that excludes
# queue wait and heartbeat overhead, i.e. genuine EXECUTION time
# (sync-job.orm-entity.ts's own docblock).
leg2_run_one() {
  local m="$1" run="$2" csv="$3"
  local prefix="f13ss_${RUN_TAG}_m${m}_r${run}"

  pg_sql_write "INSERT INTO shipments
      (id,\"orderId\",\"connectionId\",direction,\"shippingMethod\",status,\"providerShipmentId\",\"createdAt\",\"updatedAt\")
    SELECT '${prefix}_'||gs, '${prefix}_ord_'||gs, '$ALLEGRO_A_CONNECTION_ID'::uuid,
           'outbound','kurier','dispatched','${prefix}_prov_'||gs, now(), now()
    FROM generate_series(1,$m) gs" >/dev/null

  local idem="f13:shipstatus:${prefix}"
  enqueue_perf_job 'marketplace.shipment.statusSync' "$ALLEGRO_A_CONNECTION_ID" \
    "{\"schemaVersion\":1,\"limit\":$((m + 10)),\"cursorKey\":\"f13.shipstatus.${prefix}\"}" "$idem" >/dev/null
  cap_perf_job_attempts

  local status='' dur='' outcome='' waited=0
  while [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ]; do
    IFS='|' read -r status dur outcome <<< "$(pg_sql "SELECT status,COALESCE(\"lastAttemptDurationMs\"::text,''),COALESCE(outcome,'') FROM sync_jobs WHERE \"idempotencyKey\"='$idem'" 2>/dev/null || true)"
    if [ "$status" = "succeeded" ] || [ "$status" = "dead" ]; then break; fi
    sleep "$POLL_INTERVAL_SECS"
    waited=$((waited + POLL_INTERVAL_SECS))
  done

  printf '%s,%s,%s,%s,%s\n' "$m" "$run" "${dur:-NA}" "${status:-NA}" "${outcome:-NA}" >> "$csv"
  log "leg2 m=$m run=$run status=${status:-NA} outcome=${outcome:-NA} lastAttemptDurationMs=${dur:-NA}"

  pg_sql_write "DELETE FROM shipments WHERE id LIKE '${prefix}_%'" >/dev/null || true
}

leg2_cleanup() {
  pg_sql_write_besteffort "DELETE FROM shipments WHERE id LIKE 'f13ss_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f13:shipstatus:f13ss_${RUN_TAG}_%'"
}

# ===========================================================================
# Leg 3 - fulfillment-status read-back, at two order_records TABLE volumes,
# with the PROCESSED count held constant at LEG3_MATCH_COUNT in both -
# isolating whether the containment-scan query (no GIN index, per the
# repository's own source comment) is what scales with catalogue/order
# volume, independent of how many records are actually acted on per run.
#
# Every "matching" row carries a `syncStatus` entry with an externalOrderId
# that names NO real PrestaShop order - `PrestashopOrderProcessorAdapter.
# getFulfillmentStatus` turns that 404 into a clean `{status:null}` (verified
# by reading the adapter source before relying on it), so each matching row
# costs one genuine PrestaShop webservice round-trip without needing a
# single real order to exist, and produces no side effect (no Shipment row,
# no relay call) since `status === null` short-circuits to `skipped`.
# ===========================================================================
leg3_seed_matching() {
  local prefix="$1" n="$2"
  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    SELECT
      '${prefix}_'||gs,
      '$ALLEGRO_A_CONNECTION_ID'::uuid,
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'destinationConnectionId','$PS_CONNECTION_ID',
        'status','synced',
        'externalOrderId', (900000000 + gs)::text
      )),
      'ready', now(), now()
    FROM generate_series(1,$n) gs" >/dev/null
}

leg3_seed_noise() {
  local prefix="$1" n="$2"
  # Deliberately does NOT match the filter (recordStatus != 'ready'), so it
  # inflates total order_records ROW COUNT without inflating the number of
  # PrestaShop calls the job makes - the one variable this arm isolates.
  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    SELECT
      '${prefix}_'||gs,
      '$ALLEGRO_A_CONNECTION_ID'::uuid,
      '{}'::jsonb,
      '[]'::jsonb,
      'awaiting_mapping', now(), now()
    FROM generate_series(1,$n) gs" >/dev/null
}

# leg3_run_one <volume_label> <match_prefix> <run> <csv>
leg3_run_one() {
  local volume_label="$1" match_prefix="$2" run="$3" csv="$4"
  local idem="f13:fulfillstatus:${match_prefix}:r${run}"
  local total_rows
  total_rows="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE 'f13ff_${RUN_TAG}_%'" 2>/dev/null || printf 'NA')"

  enqueue_perf_job 'marketplace.fulfillment.statusSync' "$PS_CONNECTION_ID" \
    "{\"schemaVersion\":1,\"limit\":${LEG3_MATCH_COUNT},\"cursorKey\":\"f13.fulfillstatus.${match_prefix}.r${run}\",\"updatedSinceDays\":30}" "$idem" >/dev/null
  cap_perf_job_attempts

  local status='' dur='' outcome='' waited=0
  while [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ]; do
    IFS='|' read -r status dur outcome <<< "$(pg_sql "SELECT status,COALESCE(\"lastAttemptDurationMs\"::text,''),COALESCE(outcome,'') FROM sync_jobs WHERE \"idempotencyKey\"='$idem'" 2>/dev/null || true)"
    if [ "$status" = "succeeded" ] || [ "$status" = "dead" ]; then break; fi
    sleep "$POLL_INTERVAL_SECS"
    waited=$((waited + POLL_INTERVAL_SECS))
  done

  printf '%s,%s,%s,%s,%s,%s\n' "$volume_label" "$run" "$total_rows" "${dur:-NA}" "${status:-NA}" "${outcome:-NA}" >> "$csv"
  log "leg3 volume=$volume_label run=$run total_rows=$total_rows status=${status:-NA} outcome=${outcome:-NA} lastAttemptDurationMs=${dur:-NA}"
}

leg3_cleanup() {
  pg_sql_write_besteffort "DELETE FROM order_records WHERE \"internalOrderId\" LIKE 'f13ff_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM sync_jobs WHERE \"idempotencyKey\" LIKE 'f13:fulfillstatus:f13ff_${RUN_TAG}_%'"
}

# ---------------------------------------------------------------------------
# One trap for every arm's state - bash's EXIT trap is a single slot (the
# F4/#2842 lesson: a second `trap ... EXIT` REPLACES the first and leaves
# guard_stand_exclusive's own release un-run). Idempotent: every statement is
# `|| true`/best-effort, so a partial run's cleanup cannot itself die.
# ---------------------------------------------------------------------------
f13_on_exit() {
  leg1_cleanup
  leg2_cleanup
  leg2_restore_capabilities
  leg3_cleanup
  f13_restore_runner
  release_stand_exclusive
}
trap f13_on_exit EXIT

# ===========================================================================
# --smoke
# ===========================================================================
run_smoke() {
  local tmp_csv
  tmp_csv="$(mktemp)"
  printf 'cycle,shipment_id,http_status,ms,outcome,source,dest0_status,order_id\n' > "$tmp_csv"
  leg1_run_cycle 0 "$tmp_csv"
  log "=== --smoke result (leg 1 only) ==="
  cat "$tmp_csv"
  rm -f "$tmp_csv"
  log "--smoke complete. Nothing was written under $RESULTS_ROOT."
}

# ===========================================================================
# strict
# ===========================================================================
run_strict() {
  local CONN_IDS="'$PS_CONNECTION_ID','$ALLEGRO_A_CONNECTION_ID'"

  log "=== pre-flight guards ==="
  guard_scheduler_off
  guard_demo_mode_off
  guard_connection_budget
  guard_pool_recorded
  if [ "$ORIGINAL_RUNNER_ENABLED" != "true" ]; then
    log "worker runner is currently disabled (WORKER_RUNNER_ENABLED=$ORIGINAL_RUNNER_ENABLED) - enabling it for this run's window, restored on exit"
    f13_set_runner_enabled true
    RUNNER_TOGGLED=1
  fi
  guard_runner_state enabled
  guard_log_level
  guard_perf_max_attempts
  guard_build
  local head_sha built_sha
  head_sha="${MANIFEST_GIT_SHA}"
  built_sha="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$OL_API_CONTAINER" 2>/dev/null || printf 'unknown')"

  pg_sql_write "DELETE FROM sync_jobs WHERE \"connectionId\" IN ($CONN_IDS) AND status IN ('queued','running')" >/dev/null
  guard_queue_empty "$CONN_IDS"

  local run_group dir
  run_group="run$(date +%s)"
  dir="$(results_dir_init f13-writeback "$run_group")"

  local leg1_csv="$dir/leg1-waybill-relay.csv"
  local leg2_csv="$dir/leg2-shipment-status-scan.csv"
  local leg3_csv="$dir/leg3-fulfillment-status-scan.csv"
  printf 'cycle,shipment_id,http_status,ms,outcome,source,dest0_status,order_id\n' > "$leg1_csv"
  printf 'm,run,last_attempt_duration_ms,status,outcome\n' > "$leg2_csv"
  printf 'volume,run,total_order_records_rows,last_attempt_duration_ms,status,outcome\n' > "$leg3_csv"

  snapshot_jobs_before "$CONN_IDS"
  local extra_manifest
  extra_manifest="$(jq -n --arg built "$built_sha" --arg head "$head_sha" \
    --argjson cyclesLeg1 "$CYCLES_LEG1" --arg leg2M "$LEG2_M_VALUES" --argjson leg2Repeats "$LEG2_REPEATS" \
    --argjson leg3Match "$LEG3_MATCH_COUNT" --argjson leg3Noise "$LEG3_NOISE_COUNT" --argjson leg3Repeats "$LEG3_REPEATS" \
    '{builtImageRevision:$built, headRevision:$head, cyclesLeg1:$cyclesLeg1,
      leg2MValues:$leg2M, leg2Repeats:$leg2Repeats,
      leg3MatchCount:$leg3Match, leg3NoiseCount:$leg3Noise, leg3Repeats:$leg3Repeats,
      cronCadences:{
        "marketplace.shipment.statusSync":"0 */15 * * * * (allegro-scheduler-tasks.ts, OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON default)",
        "marketplace.fulfillment.statusSync":"0 */15 * * * * (prestashop-scheduler-tasks.ts, OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_INTERVAL_CRON default)"
      },
      note:"legs 2 and 3 measure EXECUTION duration of a directly-enqueued job carrying the identical payload shape the real scheduler task builds - the scheduler itself stays OFF (guard_scheduler_off) for the whole window, so the cadence above is a CONFIGURED FACT quoted for comparison, never a measured interval"
     }')"
  window_start "$dir" f13-writeback "$CONN_IDS" 0 "$extra_manifest"

  log "=== leg 1: waybill/tracking write-back ($CYCLES_LEG1 cycles) ==="
  local i
  for i in $(seq 1 "$CYCLES_LEG1"); do
    leg1_run_cycle "$i" "$leg1_csv"
  done

  log "=== leg 2: shipment-status scan (read half; push unreachable on this stand) ==="
  leg2_enable_shipping_capability
  local m run
  for m in $LEG2_M_VALUES; do
    for run in $(seq 1 "$LEG2_REPEATS"); do
      leg2_run_one "$m" "$run" "$leg2_csv"
    done
  done
  leg2_restore_capabilities
  LEG2_CAPS_TOUCHED=0   # done here; f13_on_exit's copy becomes a no-op

  log "=== leg 3: fulfillment-status read-back (small volume, $LEG3_MATCH_COUNT matching rows) ==="
  local small_prefix="f13ff_${RUN_TAG}_small"
  leg3_seed_matching "$small_prefix" "$LEG3_MATCH_COUNT"
  for run in $(seq 1 "$LEG3_REPEATS"); do
    leg3_run_one "small" "$small_prefix" "$run" "$leg3_csv"
  done

  # Deletes the SMALL arm's own matching rows before seeding the LARGE arm -
  # both volumes share the WHERE clause's match shape (recordStatus='ready'
  # + syncStatus containment), so leaving the small batch in place would let
  # its 100 rows compete with the large batch's 100 for the SAME limit=100
  # page, silently breaking the "processed count held constant" isolation
  # this leg exists to provide.
  pg_sql_write "DELETE FROM order_records WHERE \"internalOrderId\" LIKE '${small_prefix}_%'" >/dev/null

  log "=== leg 3: fulfillment-status read-back (large volume, +$LEG3_NOISE_COUNT noise rows) ==="
  local large_prefix="f13ff_${RUN_TAG}_large"
  leg3_seed_matching "$large_prefix" "$LEG3_MATCH_COUNT"
  leg3_seed_noise "${large_prefix}_noise" "$LEG3_NOISE_COUNT"
  for run in $(seq 1 "$LEG3_REPEATS"); do
    leg3_run_one "large" "$large_prefix" "$run" "$leg3_csv"
  done

  window_stop "$dir"
  # No k6 summary, deliberately (#2933): every leg here drives one HTTP call
  # or one directly-enqueued job at a time, never a load generator.
  run_post_guards "$dir" "$CONN_IDS" "$(date -u -d "@$WINDOW_START_EPOCH" +%Y-%m-%dT%H:%M:%SZ)" \
    "$WINDOW_START_EPOCH" "$WINDOW_STOP_EPOCH" ""

  write_dated_report "$run_group" "$dir" "$leg1_csv" "$leg2_csv" "$leg3_csv" "$built_sha" "$head_sha"
}

# ---------------------------------------------------------------------------
# write_dated_report <run_group> <dir> <leg1_csv> <leg2_csv> <leg3_csv> <built_sha> <head_sha>
# ---------------------------------------------------------------------------
write_dated_report() {
  local run_group="$1" dir="$2" leg1_csv="$3" leg2_csv="$4" leg3_csv="$5" built_sha="$6" head_sha="$7"
  local report="$RESULTS_ROOT/results-F13-$(date -u +%Y-%m-%d).md"
  local verdict
  verdict="$(verdict_read "$dir" | head -1)"

  local summary
  summary="$(python3 "$SCRIPT_DIR/../drivers/f13-summarize.py" "$leg1_csv" "$leg2_csv" "$leg3_csv")"

  {
    printf '# F13 - marketplace write-back latency\n\n'
    printf '_generated %s, run group %s_\n\n' "$(iso_now)" "$run_group"

    printf '## Conditions\n\n'
    printf -- '- Stand: `lab` (docker-compose.lab.yml), a single developer workstation shared with concurrent scenario runs on this campaign - no CPU pinning, no isolation from host contention. Every figure below is subject to that.\n'
    printf -- '- `guard_build` result: running images and the working tree resolve to `%s` (built: `%s`).\n' "$head_sha" "$built_sha"
    printf -- '- Runner: ENABLED (`guard_runner_state enabled`) - the whole chain is unobservable otherwise. Scheduler: OFF (`guard_scheduler_off`) for the WHOLE window - legs 2 and 3 measure a directly-enqueued job carrying the identical payload shape the real scheduler task builds (see manifest `cronCadences` / `note`), never a job the cron itself fired.\n'
    printf -- '- Verdict: **%s** (see verdict.txt in this run dir for the full guard record).\n\n' "$verdict"

    printf '## Leg 1 - waybill/tracking write-back (event-driven, no cron)\n\n'
    printf -- 'Measured via `POST /shipments/:id/notify-dispatched` (#837/#769) against a synthetic order/shipment pointed at `ALLEGRO_A_CONNECTION_ID` as the sole relay target - see the scenario script header for exactly what minimum setup makes `OrderLifecycleRelayService.relay()` reach `AllegroOrderSourceAdapter.write({type:%sdispatched%s})`. The call is fully synchronous end to end (no queued job, no cursor), so there is exactly **one** hop to report, not a chain - that is the honest shape of an event-driven leg with no scheduled backstop for a single order, not an incomplete breakdown.\n\n' "'" "'"
    printf -- '**This IS a stub artefact, stated plainly**: the Allegro stub (#2856) does not serve the fulfillment-status PUT this write needs (`/order/checkout-forms/{id}/fulfillment`), so every call falls through to the stub'"'"'s unserved-route 404 catch-all, which never calls `delay()`. The number below is therefore OpenLinker'"'"'s own dispatch + adapter + HTTP-client overhead against a marketplace-shaped upstream answering as fast as it can - i.e. a LOWER BOUND on the real Allegro round-trip, not a genuine sandbox figure. No #2861-shaped probe exists for this endpoint to compare against.\n\n'
    printf '```\n%s\n```\n\n' "$(printf '%s\n' "$summary" | awk '/^LEG1/{p=1} /^LEG2/{p=0} p')"

    printf '## Leg 2 - shipment-status write-back (`marketplace.shipment.statusSync`)\n\n'
    printf -- 'Configured cadence: `0 */15 * * * *` (`OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON`, page limit `OL_ALLEGRO_SHIPMENT_STATUS_SYNC_PAGE_LIMIT` default 50) - a CONFIGURED FACT, quoted for comparison, never measured as a latency in this report.\n\n'
    printf -- '**Only the READ half is measured; the PUSH half is explicitly unreachable on this stand, not silently substituted.** `ShipmentStatusSyncService.sync` pulls each non-terminal shipment'"'"'s tracking via `getTracking()` and relays a transition to the marketplace only when that read reports one. The Allegro stub serves no shipment-tracking endpoint at all (`/shipment-management/shipments/{id}` is unserved), so `getTracking()` fails for every shipment before any status can be observed, `diffPatch` therefore never computes a change, and the relay branch this leg exists to measure NEVER FIRES in this run. What IS measured is the scan+per-shipment dispatch cost of the READ side: `ShippingProviderManager` was not enabled on `ALLEGRO_A_CONNECTION_ID` by default on this stand (verified live before this scenario ran). It is a real, dispatched capability at the runtime `getCapabilityAdapter` layer but is deliberately absent from the closed `CoreCapabilityValues` list the connection-update API validates `enabledCapabilities` against (verified live: an ordinary PATCH is rejected unconditionally with a 400), so it is enabled for the duration of this leg only via a direct Postgres write to `connections.'"'"'enabledCapabilities'"'"'`, mirroring this script'"'"'s own `pg_sql_write`/`pg_sql_write_besteffort` cleanup-write discipline, then restored the same way. Reported as `last_attempt_duration_ms` from `sync_jobs` (execution time only - excludes queue wait, per that column'"'"'s own docblock), at %s and %s non-terminal shipments per scan (n=%s repeats each).\n\n' "$(printf '%s' "$LEG2_M_VALUES" | awk '{print $1}')" "$(printf '%s' "$LEG2_M_VALUES" | awk '{print $2}')" "$LEG2_REPEATS"
    printf -- '**The write component IS the same primitive Leg 1 measures.** Both this leg'"'"'s relay branch and Leg 1'"'"'s `notify-dispatched` call end at the identical `OrderLifecycleRelayService.relay() -> AllegroOrderSourceAdapter.write({type:%sdispatched%s})`; only the TRIGGER differs (a carrier-tracking transition here, an operator/API call in Leg 1). Leg 1'"'"'s measured relay-call latency is therefore the honest stand-in for this leg'"'"'s unreachable push component; what this leg supplies ON TOP is the discovery-scan cost that would precede it in production.\n\n' "'" "'"
    printf '```\n%s\n```\n\n' "$(printf '%s\n' "$summary" | awk '/^LEG2/{p=1} /^LEG3/{p=0} p')"

    printf '## Leg 3 - fulfillment-status read-back (`marketplace.fulfillment.statusSync`)\n\n'
    printf -- 'Configured cadence: `0 */15 * * * *` (`OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_INTERVAL_CRON`, `updatedSinceDays` default 30) - a CONFIGURED FACT, never measured as a latency here.\n\n'
    printf -- '**This leg calls the REAL PrestaShop container, not a stub** - `PrestashopOrderProcessorAdapter.getFulfillmentStatus` treats a `PrestashopResourceNotFoundException` as a clean `{status:null}` rather than throwing (read from the adapter source before relying on it), so every "matching" seeded row costs one genuine PrestaShop webservice `GET /orders/{id}` round-trip with no real order needing to exist, and produces no side effect (no Shipment row, no relay) because a null status short-circuits to `skipped`.\n\n'
    printf -- '**The incidental finding this leg investigates**: `results-sustained-mixed-load-2026-09-08.md` §3.1 recorded this exact job at **p50 474 s** every 15 minutes (~53%% duty cycle on one `bulk` slot) on a connection carrying a 50,006-product catalogue and a 2,003,176-row `order_records` history. `OrderRecordRepository.findMany`'"'"'s own source comment states the `destinationConnectionId`/`syncStatus` filter is a JSONB CONTAINMENT scan with "no GIN index today", i.e. a candidate for scaling with TOTAL table row count rather than with the number of rows the filter actually matches. This scenario tests that directly: `%s` matching rows are seeded and processed IDENTICALLY in both arms (limit=`%s`, offset=0), and the LARGE arm additionally carries `+%s` non-matching noise rows purely to inflate the table'"'"'s total row count. If duration scales between the two arms despite an IDENTICAL number of records processed and PrestaShop calls made, the query'"'"'s lack of an index is the mechanism; if it does not, the 474s figure is dominated by something else (most likely PrestaShop'"'"'s own per-call latency under that installation'"'"'s specific load, which this stand'"'"'s much smaller catalogue cannot reproduce in absolute terms).\n\n' "$LEG3_MATCH_COUNT" "$LEG3_MATCH_COUNT" "$LEG3_NOISE_COUNT"
    printf '```\n%s\n```\n\n' "$(printf '%s\n' "$summary" | awk '/^LEG3/{p=1} p')"

    printf '## Leg 4 - payment-status write-back: NOT MEASURED, and why\n\n'
    printf -- '`PaymentStatusReader` (`libs/core/src/invoicing/domain/ports/capabilities/`) is core-agnostic: "a provider payment webhook is only a TRIGGER, core always re-reads authoritatively via this capability rather than trusting the webhook body". Both halves of that chain need a real invoicing/payment provider - KSeF, inFakt, or Subiekt nexo are the only shipped adapters, and none is configured on this stand (`bootstrap.sh` provisions PrestaShop, WooCommerce and two Allegro connections only - no invoicing connection exists, and none of the three providers has a stub or fake on this campaign). A provider webhook cannot be synthesised without a real provider standing behind it to answer the re-read `PaymentStatusReader.getPaymentStatus`-equivalent call authoritatively - fabricating one would be exactly the "estimate dressed as measurement" this campaign exists to avoid. **Explicitly reported unmeasurable, not silently skipped.** A future measurement needs either a real sandbox credential for one of the three providers, or a purpose-built fake payment-provider stub mirroring #2856'"'"'s own shape for Allegro - neither exists today.\n\n'

    printf '## What was measured versus what is a configured fact - the one rule this report must never blur\n\n'
    printf -- '| Figure | Measured latency, or configured cadence? |\n|---|---|\n'
    printf -- '| Leg 1 waybill relay call (median/p90 above) | **Measured** - a real HTTP call timed by curl, against the real running services |\n'
    printf -- '| Leg 2 shipment-status scan duration (per M, above) | **Measured** - `sync_jobs.lastAttemptDurationMs` on a directly-enqueued job |\n'
    printf -- '| Leg 2 "every 15 minutes" | **Configured** - `OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON` default, read from source, not observed firing |\n'
    printf -- '| Leg 3 fulfillment-status scan duration (small/large, above) | **Measured** - `sync_jobs.lastAttemptDurationMs` on a directly-enqueued job |\n'
    printf -- '| Leg 3 "every 15 minutes" | **Configured** - `OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_INTERVAL_CRON` default, read from source, not observed firing |\n'
    printf -- '| Leg 3'"'"'s 474 s p50 (cited above for context) | **Measured, but by a DIFFERENT run** (`results-sustained-mixed-load-2026-09-08.md`, a different dataset entirely) - never re-measured at that scale here |\n'
    printf -- '| Leg 4 anything | **Not measured, and not estimated** - see Leg 4 section |\n\n'

    printf '## What figures are artefacts of the stub'"'"'s fixed/absent behaviour, and what would survive a real marketplace\n\n'
    printf -- '- **Leg 1'"'"'s measured relay-call latency is a stub artefact on the MARKETPLACE side, but a genuine measurement of OpenLinker'"'"'s OWN dispatch/adapter/HTTP-client overhead.** The stub'"'"'s 404 answers with no configured delay, so the number is a LOWER BOUND on a real Allegro round-trip - it would very likely be larger, never smaller, against production Allegro. What survives unchanged against a real marketplace: the identity of the call path (`notify-dispatched -> relay() -> write()`), the DB writes either side of it, and the fact that this leg has no scheduled backstop.\n'
    printf -- '- **Leg 2'"'"'s measured number is a stub artefact TWICE OVER** - it never reaches the network at all in the failure mode it hits (a capability-resolution-adjacent early exception, not a round trip), and even if it did, the stub serves no tracking endpoint. Genuinely unrepresentative of a real Allegro-Delivery tracking pull; what IS representative is the scan/per-item DISPATCH machinery (page read, per-item loop, DB writes) this leg exercises identically to a real deployment.\n'
    printf -- '- **Leg 3 is the one leg NOT dependent on the stub at all** - it calls the real PrestaShop container on this stand. Its ABSOLUTE numbers are still stand-specific (this catalogue is far smaller than the 50,006-product one the 474s figure came from), but its SCALING FINDING (does duration move between the small/large arms) is a direct, stub-independent measurement that would reproduce on any PrestaShop installation exhibiting the same query plan.\n\n'

    printf '## What this did not establish\n\n'
    printf -- '- **No genuine Allegro-sandbox latency for either the fulfillment-status PUT or the shipment-tracking GET** - the stub serves neither endpoint, so Legs 1 and 2 report OpenLinker-side overhead against a fast-failing upstream, never a real marketplace round-trip. No #2861-shaped probe exists for either endpoint to compare against.\n'
    printf -- '- **No confirmation that a shipment-status TRANSITION ever reaches the marketplace on this stand** - Leg 2'"'"'s push half never fires (see Leg 2 section); the report leans on Leg 1'"'"'s shared-primitive measurement as the honest stand-in, but that is a substitution, not a direct measurement of leg 2'"'"'s own push path.\n'
    printf -- '- **No payment-status figure of any kind, measured or estimated** (Leg 4).\n'
    printf -- '- **No reproduction of the 474s p50 figure at the ORIGINAL scale** (50,006 products, 2,003,176 order_records rows) - this stand'"'"'s catalogue and history are far smaller; Leg 3 establishes SCALING BEHAVIOUR, not the original absolute figure.\n'
    printf -- '- **No sustained-load figure for any of the three legs** - every sample here runs against an otherwise-idle stand (scheduler off, no concurrent scenario); §3.1'"'"'s 474s figure was itself measured DURING a sustained mixed-load run, so contention with other traffic is a real, unmeasured variable this report does not isolate.\n'
    printf -- '- **No multi-replica figure** (single worker replica on this stand for the whole window).\n'
  } > "$report"
  log "wrote $report"
}

case "$MODE" in
  smoke) run_smoke ;;
  strict) run_strict ;;
esac
