#!/usr/bin/env bash
#
# F11 - concurrent multi-channel load (#2979, epic #2840).
#
# Every measurement in #2840 up to this issue drove ONE channel at a time.
# That is not a small simplification: the outbound rate limiter keys its
# pacing bucket on connectionId ALONE (http-transport-factory.ts:150), the
# realtime lane's per-scope cap of 2 was measured with one channel (#2975),
# and #2977's replica-scaling correction was likewise taken on one channel.
# This scenario drives TWO real channels simultaneously through the same
# worker/Redis/Postgres-pool infrastructure and reports whether the
# aggregate scales, holds or collapses; whether either channel is starved;
# which resource binds first, with evidence; and whether the per-connection
# rate limit still holds per connection when two connections pace through
# the same Redis at once.
#
# ---------------------------------------------------------------------------
# SCOPE CUT #1 - TWO channels, not three, and why (stated here, not only in
# the PR, because a reader six months from now opens this file, not the
# review thread)
# ---------------------------------------------------------------------------
# The issue names Allegro + Erli + WooCommerce as the three intended
# channels. Neither Erli nor WooCommerce is reachable on this stand today:
#
#  - Erli: no stub exists anywhere in this repository, and building one was
#    explicitly evaluated and REJECTED for this same epic
#    (docs' decision-erli-inbox-cliff-2026-09-05.md, #2865) - Erli's own
#    base-URL policy (erli-base-url.policy.ts) hard-refuses any host that is
#    not a real https://*.erli.pl or *.erli.dev, so it cannot even be
#    pointed at a local stub without DNS tricks a perf harness has no
#    business attempting. Real Erli needs the vendor's own sandbox
#    agreement, which is out of scope for this issue.
#  - WooCommerce: perf/openlinker-throughput/seed/seed-shop-catalogue.sh is
#    PrestaShop-only today (no WooCommerce seeding code exists on
#    perf-programme-2840). The branch doing that work
#    (3024-3025-f5-seeding-and-wc-mappings) has no PR yet and is still in
#    flight, so a WooCommerce arm would measure an empty catalogue.
#
# So this is a two-channel arm, reported as exactly that, never dressed up
# as "three channels, one degraded".
#
# ---------------------------------------------------------------------------
# SCOPE CUT #2 - WHAT the second channel is, and why NOT two Allegro
# connections
# ---------------------------------------------------------------------------
# The cheapest, zero-new-risk way to get "two connections contending for one
# worker" is two Allegro connections on the stub's existing multi-tenant
# support. That was considered and rejected: it answers a narrower question
# than #2979 asks. Two same-platform connections can only ever exercise
# connection-SCOPING (Redis key isolation, per-scope lane slots) - it cannot
# surface anything platform-adapter-SHAPED, which is exactly what the
# issue's "Why" section is worried about (a platform-specific batching/
# caching quirk interacting badly with a second tenant of the SAME platform
# vs. a structurally different adapter). Reported as "two channels" while
# secretly meaning "two connections of one platform" would also be exactly
# the kind of silent scope-narrowing this programme's own conventions exist
# to prevent (see results/README's "a report that cannot be reproduced from
# its own recipe is a claim, not a measurement").
#
# So channel 2 here is PrestaShop acting as its own order SOURCE - a
# genuine, structurally different `OrderSourcePort` implementation
# (webhook + date_upd-watermark poll reconciliation) from Allegro's
# event-journal stub. Channel 2's orders are minted via PrestaShop's own
# WEBSERVICE API (drivers/ps-order-source.sh) - customer -> address ->
# cart -> order - rather than raw SQL (too easy to write a row OL's adapter
# cannot parse, or corrupt a shop other scenarios also read from) or a full
# browser checkout (no Selenium/Playwright machinery on this stand). A
# webservice write that gets a required field wrong answers an explicit 400
# naming the field - safer feedback than either extreme, and stated in the
# driver's own header as needing live iteration to finish getting right.
#
# ---------------------------------------------------------------------------
# THE SELF-REFERENTIAL LOOP THIS SCENARIO IS DESIGNED TO AVOID
# ---------------------------------------------------------------------------
# PrestaShop-as-source (a NEW connection, PS_SOURCE_CONNECTION_ID) and
# PrestaShop-as-destination (the EXISTING perf-prestashop connection,
# PS_CONNECTION_ID) point at the SAME physical shop. If the destination
# connection's OrderProcessorManager stayed enabled, a channel-2 order would
# get written BACK into the very shop it was read from, as a genuinely new
# native order - which the source connection would then discover on its
# NEXT poll and destine again, forever: an uncontrolled feedback loop
# amplifying against a MySQL container three other agents may be sharing
# right now. There is no per-source destination-routing mechanism in this
# codebase to prevent it structurally (no fulfilment router is configured
# on this stand), so this scenario prevents it the same way F1 already
# prevents its own single-destination bias: by disabling the PrestaShop
# destination connection's `OrderProcessorManager` capability for the
# WHOLE run (both baselines and the concurrent window), leaving Allegro's
# and channel 2's orders to destine to WooCommerce alone - a different
# physical system, so no loop is possible.
#
# The cost, stated rather than hidden: this makes the re-taken Allegro
# baseline (Allegro -> WooCommerce) methodologically DIFFERENT from #2977's
# original Allegro -> PrestaShop baseline. The two numbers are not directly
# comparable; what IS comparable, and what this scenario exists to produce,
# is solo-vs-concurrent WITHIN this one session, on one consistent
# destination.
#
# ---------------------------------------------------------------------------
# WHAT THIS SCENARIO DOES NOT MEASURE
# ---------------------------------------------------------------------------
# The full order-ingest-to-destination-creation latency chain (F1's t0..t6)
# is NOT reproduced here - this is a throughput/contention scenario, not a
# latency-hop reconstruction, and F1 already owns that question for the
# single-channel case. What is measured is: order arrival -> order_records
# persisted (ingestion throughput), per channel and combined, plus the
# post-window guards/manifest evidence for naming what bound first.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB_LOG_PREFIX="f11"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../drivers/order-feed.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../drivers/ps-order-source.sh"

# ---------------------------------------------------------------------------
# Configuration (env-overridable, same convention as f1/lib.sh)
# ---------------------------------------------------------------------------
# The stub tenant this scenario pushes its Allegro backlog into. It MUST be the
# tenant the connection in ALLEGRO_SOURCE_CONNECTION_ID authenticates as, or the
# backlog lands somewhere that connection cannot read and the arm measures an
# empty feed.
#
# The previous default, `perf-f11-allegro`, was wrong in BOTH directions and
# unrunnable (#2840, 2026-09-10): the lab stub is started with
# `STUB_TENANTS: stub-token-a=perf-allegro-a,stub-token-b=perf-allegro-b` and
# nothing anywhere provisions a third tenant, so arm 1 died on
# `unknown tenant perf-f11-allegro` before the window opened - and had that
# tenant existed, `perf-allegro-a`'s bearer token would still have read a
# different tenant's feed. Any earlier run of this scenario must have had
# SOURCE_TENANT exported by hand, which is why the defect survived.
SOURCE_TENANT="${SOURCE_TENANT:-perf-allegro-a}"
PSO_TAG="${PSO_TAG:-f11}"

# Each arm's backlog must outlast its window at the highest offered rate, or
# post_guard_feed_starved (Allegro side) / a starved PrestaShop-source count
# discards the run - see f1's identical reasoning. Kept modest by default
# because channel 2's backlog costs one full webservice round-trip PER
# order (no bulk-push primitive exists for a native PrestaShop order).
THROUGHPUT_BACKLOG="${THROUGHPUT_BACKLOG:-150}"
THROUGHPUT_WINDOW_SECS="${THROUGHPUT_WINDOW_SECS:-300}"
POLL_CADENCE_SECS="${POLL_CADENCE_SECS:-10}"

# The starvation threshold classify_channel_contention (lib.sh) applies: a
# concurrent-vs-solo throughput drop of this % or more reads "starved".
STARVATION_THRESHOLD_PCT="${STARVATION_THRESHOLD_PCT:-20}"

MODE="strict"
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    -h|--help)
      cat <<'USAGE'
Usage: f11-concurrent-multichannel.sh [--smoke]

  (no flag)   strict measurement - both solo baselines (re-taken in THIS
              session), then the concurrent window, with per-channel and
              aggregate reporting, starvation classification, and a dated
              report under results/.
  --smoke     driver self-test only: resolves PrestaShop reference ids,
              pushes ONE PrestaShop-source order end to end, prints the
              result. No window, no manifest, no verdict. This is the
              validation step the setup process requires BEFORE any shared
              stand time is requested for the real windows - it still needs
              guard_stand_exclusive, because pushing one real order into a
              shared PrestaShop container is itself a stand mutation.
USAGE
      exit 0
      ;;
    *) die "unknown argument: $arg (use --smoke, --help, or nothing)" ;;
  esac
done

require_tools docker jq curl awk

[ -n "${ALLEGRO_A_CONNECTION_ID:-}" ] || die "ALLEGRO_A_CONNECTION_ID is not set - source stand-ids.env (bootstrap.sh) or export it by hand"
[ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID is not set - source stand-ids.env"
[ -n "${WC_CONNECTION_ID:-}" ] || die "WC_CONNECTION_ID is not set - source stand-ids.env"
ALLEGRO_SOURCE_CONNECTION_ID="${SOURCE_CONNECTION_ID:-$ALLEGRO_A_CONNECTION_ID}"

# ===========================================================================
# guard_stand_exclusive FIRST, before ANY state mutation - this scenario
# creates a new connection, disables the shared PrestaShop destination's
# capability, and pushes real orders into a shared shop. A peer racing any
# of that invalidates both runs (#2842/#2848's own lesson).
# ===========================================================================
guard_stand_exclusive "f11-concurrent-multichannel"

ol_login

connection_json() { ol_api GET "/v1/connections/$1"; }

# ---------------------------------------------------------------------------
# Posture capture, for the single EXIT trap (bash has ONE trap slot -
# guard_stand_exclusive already claimed it, so f11_on_exit below calls
# release_stand_exclusive itself at the end, exactly as f1 does).
# ---------------------------------------------------------------------------
ORIGINAL_PS_CAPS="$(connection_json "$PS_CONNECTION_ID" | jq -c '.enabledCapabilities // []')"
ORIGINAL_PS_CONFIG="$(connection_json "$PS_CONNECTION_ID" | jq -c '.config // {}')"
log "posture at start: perf-prestashop caps=$ORIGINAL_PS_CAPS"

CONNECTIONS_TOUCHED=0
PS_SOURCE_CONNECTION_ID=""
RESULTS_DIR_MADE=""
# Declared here (empty) rather than only in strict mode below, so the EXIT
# trap's `${d:-}` loop never hits an unbound-variable error under `set -u`
# when MODE=smoke (or any early-die path) exits before strict mode assigns
# these - an unbound var inside the trap aborts the trap itself, which means
# release_stand_exclusive() never runs and the stand lock leaks permanently.
# Found the hard way: a --smoke run that died in pso_resolve_refs left
# perf:stand:exclusive stuck under a since-dead PID.
RESULTS_DIR_ALLEGRO_SOLO=""
RESULTS_DIR_PS_SOLO=""
RESULTS_DIR_CONCURRENT_A=""
RESULTS_DIR_CONCURRENT_B=""
RESULTS_DIR_CONCURRENT_AGG=""

restore_curl() {
  local method="$1" path="$2" body="${3:-}"
  [ -n "${RESTORE_TOKEN:-}" ] || return 0
  curl -sS -o /dev/null -X "$method" "$OL_API_URL$path" \
    -H "Authorization: Bearer $RESTORE_TOKEN" -H 'Content-Type: application/json' \
    ${body:+-d "$body"} 2>/dev/null || true
}

f11_on_exit() {
  local rc=$?
  # Stop every sampler this run may have started, whatever the exit path.
  for d in "$RESULTS_DIR_ALLEGRO_SOLO" "$RESULTS_DIR_PS_SOLO" "$RESULTS_DIR_CONCURRENT_A" "$RESULTS_DIR_CONCURRENT_B" "$RESULTS_DIR_CONCURRENT_AGG"; do
    [ -n "${d:-}" ] && sampler_stop "$d" 2>/dev/null || true
  done

  if [ "$CONNECTIONS_TOUCHED" = "0" ]; then
    log "nothing was changed on the stand - no restore needed"
    release_stand_exclusive
    return $rc
  fi

  log "restoring stand posture"
  RESTORE_TOKEN="$(curl -sS -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}" 2>/dev/null \
    | jq -r '.access_token // .accessToken // empty' 2>/dev/null || printf '')"
  [ -n "$RESTORE_TOKEN" ] || warn "could not log in to restore perf-prestashop's capabilities - it is left with OrderProcessorManager disabled"

  # Restore the shared destination connection to exactly what it was.
  restore_curl PATCH "/v1/connections/$PS_CONNECTION_ID" \
    "$(jq -n --argjson c "$ORIGINAL_PS_CAPS" --argjson g "$ORIGINAL_PS_CONFIG" '{enabledCapabilities:$c, config:$g}' 2>/dev/null || printf '')"

  # The new PrestaShop-source connection did not exist before this run.
  # There is no DELETE /v1/connections/:id endpoint in this codebase
  # (connection.controller.ts has GET/POST/PATCH only), so full removal is
  # not available - disabling it is the closest available "leave it as I
  # found it" (a disabled, inert connection rather than a live one still
  # polling a shop it should not be). Recorded as an accepted residual
  # state rather than a silent gap.
  if [ -n "$PS_SOURCE_CONNECTION_ID" ]; then
    restore_curl PATCH "/v1/connections/$PS_SOURCE_CONNECTION_ID/disable" ""
    log "perf-prestashop-source ($PS_SOURCE_CONNECTION_ID) disabled - no DELETE endpoint exists to remove it outright"
  fi

  release_stand_exclusive
  return $rc
}
trap f11_on_exit EXIT

# set_destination <connection_id> <on|off> - identical reasoning to f1's own
# helper: toggles the capability rather than `status`, because a status
# flip into `active` fires the taxonomy-sync bootstrap (#2084/#2085) this
# run does not want to add noise from.
set_destination() {
  local conn="$1" state="$2" caps
  caps="$(connection_json "$conn" | jq -c '.enabledCapabilities // []')"
  if [ "$state" = "on" ]; then
    caps="$(printf '%s' "$caps" | jq -c '. + ["OrderProcessorManager"] | unique')"
  else
    caps="$(printf '%s' "$caps" | jq -c 'map(select(. != "OrderProcessorManager"))')"
  fi
  CONNECTIONS_TOUCHED=1
  ol_api PATCH "/v1/connections/$conn" "$(jq -n --argjson c "$caps" '{enabledCapabilities:$c}')" >/dev/null
  log "set_destination $conn -> $state (caps now $caps)"
}

# ---------------------------------------------------------------------------
# f11_ensure_source_connection - get-or-create the NEW PrestaShop-as-source
# connection. Idempotent by name, the bootstrap.sh convention
# (ol_connection_id_by_name / ol_ensure_connection), reimplemented locally
# because those helpers live in bootstrap.sh, a setup script this scenario
# does not want to re-run wholesale.
#
# ONLY OrderSource is enabled - no ProductMaster/InventoryMaster/
# OrderProcessorManager - so this connection can never itself become a
# destination and cannot collide with perf-prestashop's own master-sync
# claims (#1904's rival-claimant guard governs ProductMaster/InventoryMaster
# collisions, which this sidesteps by not claiming either).
# ---------------------------------------------------------------------------
f11_ensure_source_connection() {
  local name="perf-prestashop-source" existing
  existing="$(ol_api GET "/v1/connections" | jq -r --arg n "$name" \
    'if type=="array" then . else (.items // []) end | map(select(.name==$n)) | .[0].id // empty')"
  if [ -n "$existing" ]; then
    log "found connection '$name' ($existing)" >&2
    printf '%s' "$existing"
    return 0
  fi
  local base_url
  base_url="$(connection_json "$PS_CONNECTION_ID" | jq -r '.config.baseUrl // empty')"
  [ -n "$base_url" ] || die "f11_ensure_source_connection: perf-prestashop has no config.baseUrl to copy"
  local ws_key="${PS_WS_KEY:-${PS_WEBSERVICE_KEY:-}}"
  [ -n "$ws_key" ] || die "f11_ensure_source_connection: no PrestaShop webservice key available (PS_WS_KEY/PS_WEBSERVICE_KEY) - source stand-ids.env"
  CONNECTIONS_TOUCHED=1
  local id
  id="$(ol_api POST /v1/connections "$(jq -n --arg u "$base_url" --arg k "$ws_key" \
    '{name:"perf-prestashop-source", platformType:"prestashop",
      enabledCapabilities:["OrderSource"],
      config:{baseUrl:$u, shopId:1},
      credentials:{webserviceApiKey:$k}}')" | jq -r '.id // empty')"
  [ -n "$id" ] || die "f11_ensure_source_connection: connection create returned no id"
  log "created connection 'perf-prestashop-source' ($id)" >&2
  printf '%s' "$id"
}

# ===========================================================================
# --smoke: driver self-test, no window, no manifest. This is the ONE
# validation call the setup process requires before requesting a shared
# stand window - and it still mutates the stand (a real order lands in
# ps_orders), so it runs behind guard_stand_exclusive above like everything
# else in this file, not as an exception to it.
# ===========================================================================
if [ "$MODE" = "smoke" ]; then
  log "=== smoke: resolving PrestaShop reference ids ==="
  pso_resolve_refs
  pso_ensure_customer "$PSO_TAG"
  log "=== smoke: pushing ONE PrestaShop-source order ==="
  order_id="$(pso_push_one_order "$PSO_TAG")"
  log "smoke ok: created native PrestaShop order id=$order_id"
  log "ps_orders count is now $(pso_orders_count)"
  exit 0
fi

# ===========================================================================
# Strict mode from here: create the second connection, disable the shared
# destination for the self-loop reason above, then run the three windows.
# ===========================================================================
PS_SOURCE_CONNECTION_ID="$(f11_ensure_source_connection)"
pso_resolve_refs
pso_ensure_customer "$PSO_TAG"

set_destination "$PS_CONNECTION_ID" off

CONN_IDS_ALL="'$ALLEGRO_SOURCE_CONNECTION_ID','$PS_SOURCE_CONNECTION_ID'"

guard_queue_empty "$CONN_IDS_ALL"
guard_scheduler_off
guard_demo_mode_off
guard_connection_budget
guard_pool_recorded
guard_build
guard_runner_state enabled
guard_log_level
guard_perf_max_attempts

snapshot_jobs_before "$CONN_IDS_ALL"
RUN_LABEL="run$(date +%s)"
RESULTS_DIR_ALLEGRO_SOLO="$(results_dir_init f11-concurrent-multichannel "$RUN_LABEL-solo-allegro")"
RESULTS_DIR_PS_SOLO="$(results_dir_init f11-concurrent-multichannel "$RUN_LABEL-solo-prestashop")"
RESULTS_DIR_CONCURRENT_A="$(results_dir_init f11-concurrent-multichannel "$RUN_LABEL-concurrent-allegro")"
RESULTS_DIR_CONCURRENT_B="$(results_dir_init f11-concurrent-multichannel "$RUN_LABEL-concurrent-prestashop")"
RESULTS_DIR_CONCURRENT_AGG="$(results_dir_init f11-concurrent-multichannel "$RUN_LABEL-concurrent-aggregate")"
RESULTS_DIR_MADE=1

# ---------------------------------------------------------------------------
# f11_orders_ingested_since <sourceConnectionId> <since_iso> - the
# THROUGHPUT figure both baselines and the concurrent arm read: order_records
# rows attributed to this SOURCE connection, created in the window. This is
# ingestion throughput (arrival -> order_records persisted), deliberately
# NOT full ingest-to-destination-creation - see the file header's "what this
# does not measure".
# ---------------------------------------------------------------------------
f11_orders_ingested_since() {
  local conn="$1" since_iso="$2"
  as_count "$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"sourceConnectionId\"='$conn' AND \"createdAt\">='$since_iso'" 2>/dev/null | tr -d '[:space:]')"
}

# ===========================================================================
# ARM 1 - Allegro solo baseline (RE-TAKEN in this session, not quoted from
# #2977 - and methodologically Allegro->WooCommerce here, not
# Allegro->PrestaShop, per the self-loop scope cut above).
# ===========================================================================
log "=== ARM 1: Allegro solo baseline ==="
of_new_run "f11-a1-$(date +%s)" >/dev/null
of_push_orders "$SOURCE_TENANT" "$THROUGHPUT_BACKLOG" 1 1 >/dev/null
window_start "$RESULTS_DIR_ALLEGRO_SOLO" f11-concurrent-multichannel "$CONN_IDS_ALL" 0 \
  '{"arm":"solo-allegro","destination":"woocommerce-only","arrivalRatePerSec":null}'
sampler_start "$RESULTS_DIR_ALLEGRO_SOLO" "'$ALLEGRO_SOURCE_CONNECTION_ID'"
ARM1_START_ISO="$(iso_now)"
t_end=$(( $(epoch) + THROUGHPUT_WINDOW_SECS ))
while [ "$(epoch)" -lt "$t_end" ]; do
  of_enqueue_poll "$ALLEGRO_SOURCE_CONNECTION_ID" "f11-a1" >/dev/null
  sleep "$POLL_CADENCE_SECS"
done
sampler_stop "$RESULTS_DIR_ALLEGRO_SOLO"
window_stop "$RESULTS_DIR_ALLEGRO_SOLO"
manifest_set_sync_jobs_end "$RESULTS_DIR_ALLEGRO_SOLO"
ARM1_COUNT="$(f11_orders_ingested_since "$ALLEGRO_SOURCE_CONNECTION_ID" "$ARM1_START_ISO")"
ARM1_RATE_PER_HOUR="$(awk -v n="$ARM1_COUNT" -v s="$THROUGHPUT_WINDOW_SECS" 'BEGIN{printf "%.2f", n*3600/s}')"
log "ARM1 (Allegro solo): $ARM1_COUNT orders in ${THROUGHPUT_WINDOW_SECS}s = $ARM1_RATE_PER_HOUR/h"
run_post_guards "$RESULTS_DIR_ALLEGRO_SOLO" "'$ALLEGRO_SOURCE_CONNECTION_ID'" "$ARM1_START_ISO" \
  "$(date -d "$ARM1_START_ISO" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ARM1_START_ISO" +%s)" "$(epoch)"

reset_between_repeats "'$ALLEGRO_SOURCE_CONNECTION_ID'" "'allegro.orders.lastEventId'"

# ===========================================================================
# ARM 2 - PrestaShop-source solo baseline.
# ===========================================================================
log "=== ARM 2: PrestaShop-source solo baseline ==="
window_start "$RESULTS_DIR_PS_SOLO" f11-concurrent-multichannel "'$PS_SOURCE_CONNECTION_ID'" 0 \
  '{"arm":"solo-prestashop-source","destination":"woocommerce-only"}'
sampler_start "$RESULTS_DIR_PS_SOLO" "'$PS_SOURCE_CONNECTION_ID'"
ARM2_START_ISO="$(iso_now)"
pso_push_orders "$THROUGHPUT_BACKLOG" "f11-a2" >/dev/null
t_end=$(( $(epoch) + THROUGHPUT_WINDOW_SECS ))
while [ "$(epoch)" -lt "$t_end" ]; do
  pso_enqueue_poll "$PS_SOURCE_CONNECTION_ID" "f11-a2" >/dev/null
  sleep "$POLL_CADENCE_SECS"
done
sampler_stop "$RESULTS_DIR_PS_SOLO"
window_stop "$RESULTS_DIR_PS_SOLO"
manifest_set_sync_jobs_end "$RESULTS_DIR_PS_SOLO"
ARM2_COUNT="$(f11_orders_ingested_since "$PS_SOURCE_CONNECTION_ID" "$ARM2_START_ISO")"
ARM2_RATE_PER_HOUR="$(awk -v n="$ARM2_COUNT" -v s="$THROUGHPUT_WINDOW_SECS" 'BEGIN{printf "%.2f", n*3600/s}')"
log "ARM2 (PrestaShop-source solo): $ARM2_COUNT orders in ${THROUGHPUT_WINDOW_SECS}s = $ARM2_RATE_PER_HOUR/h"
run_post_guards "$RESULTS_DIR_PS_SOLO" "'$PS_SOURCE_CONNECTION_ID'" "$ARM2_START_ISO" \
  "$(date -d "$ARM2_START_ISO" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ARM2_START_ISO" +%s)" "$(epoch)"

reset_between_repeats "'$PS_SOURCE_CONNECTION_ID'" "'prestashop.orders.dateUpd'"

# ===========================================================================
# ARM 3 - CONCURRENT window. Both channels driven at once. Three samplers
# (Allegro-only, PrestaShop-source-only, combined) into three directories -
# sample_queue (lib.sh) already accepts an arbitrary conn_ids filter, so no
# lib.sh change was needed to get per-channel breakdown: three calls to the
# SAME function, pointed at three scopes.
# ===========================================================================
log "=== ARM 3: CONCURRENT (Allegro + PrestaShop-source) ==="
of_new_run "f11-a3-$(date +%s)" >/dev/null
of_push_orders "$SOURCE_TENANT" "$THROUGHPUT_BACKLOG" 1 1 >/dev/null
pso_push_orders "$THROUGHPUT_BACKLOG" "f11-a3" >/dev/null
window_start "$RESULTS_DIR_CONCURRENT_AGG" f11-concurrent-multichannel "$CONN_IDS_ALL" 0 \
  '{"arm":"concurrent","destination":"woocommerce-only","channels":["allegro","prestashop-source"]}'
sampler_start "$RESULTS_DIR_CONCURRENT_A" "'$ALLEGRO_SOURCE_CONNECTION_ID'"
sampler_start "$RESULTS_DIR_CONCURRENT_B" "'$PS_SOURCE_CONNECTION_ID'"
sampler_start "$RESULTS_DIR_CONCURRENT_AGG" "$CONN_IDS_ALL"
ARM3_START_ISO="$(iso_now)"
t_end=$(( $(epoch) + THROUGHPUT_WINDOW_SECS ))
while [ "$(epoch)" -lt "$t_end" ]; do
  of_enqueue_poll "$ALLEGRO_SOURCE_CONNECTION_ID" "f11-a3" >/dev/null
  pso_enqueue_poll "$PS_SOURCE_CONNECTION_ID" "f11-a3" >/dev/null
  sleep "$POLL_CADENCE_SECS"
done
sampler_stop "$RESULTS_DIR_CONCURRENT_A"
sampler_stop "$RESULTS_DIR_CONCURRENT_B"
sampler_stop "$RESULTS_DIR_CONCURRENT_AGG"
window_stop "$RESULTS_DIR_CONCURRENT_AGG"
manifest_set_sync_jobs_end "$RESULTS_DIR_CONCURRENT_AGG"

ARM3_ALLEGRO_COUNT="$(f11_orders_ingested_since "$ALLEGRO_SOURCE_CONNECTION_ID" "$ARM3_START_ISO")"
ARM3_PS_COUNT="$(f11_orders_ingested_since "$PS_SOURCE_CONNECTION_ID" "$ARM3_START_ISO")"
ARM3_ALLEGRO_RATE="$(awk -v n="$ARM3_ALLEGRO_COUNT" -v s="$THROUGHPUT_WINDOW_SECS" 'BEGIN{printf "%.2f", n*3600/s}')"
ARM3_PS_RATE="$(awk -v n="$ARM3_PS_COUNT" -v s="$THROUGHPUT_WINDOW_SECS" 'BEGIN{printf "%.2f", n*3600/s}')"
ARM3_AGG_RATE="$(awk -v a="$ARM3_ALLEGRO_RATE" -v b="$ARM3_PS_RATE" 'BEGIN{printf "%.2f", a+b}')"
log "ARM3 concurrent: allegro=$ARM3_ALLEGRO_COUNT ($ARM3_ALLEGRO_RATE/h) prestashop-source=$ARM3_PS_COUNT ($ARM3_PS_RATE/h) aggregate=$ARM3_AGG_RATE/h"

run_post_guards "$RESULTS_DIR_CONCURRENT_AGG" "$CONN_IDS_ALL" "$ARM3_START_ISO" \
  "$(date -d "$ARM3_START_ISO" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ARM3_START_ISO" +%s)" "$(epoch)"

# ===========================================================================
# STARVATION CLASSIFICATION - the check the issue itself names as the one
# that matters most ("an aggregate that holds while one channel gets
# nothing is the failure"). classify_channel_contention (lib.sh, #2979)
# reads unparseable/zero rates as "unknown", never as a silent "held".
# ===========================================================================
ALLEGRO_VERDICT="$(classify_channel_contention "$ARM1_RATE_PER_HOUR" "$ARM3_ALLEGRO_RATE" "$STARVATION_THRESHOLD_PCT")"
PS_VERDICT="$(classify_channel_contention "$ARM2_RATE_PER_HOUR" "$ARM3_PS_RATE" "$STARVATION_THRESHOLD_PCT")"
log "starvation check: allegro solo=$ARM1_RATE_PER_HOUR/h concurrent=$ARM3_ALLEGRO_RATE/h -> $ALLEGRO_VERDICT"
log "starvation check: prestashop-source solo=$ARM2_RATE_PER_HOUR/h concurrent=$ARM3_PS_RATE/h -> $PS_VERDICT"

# ---------------------------------------------------------------------------
# BINDING-CONSTRAINT EVIDENCE - read straight off the manifest/timeseries
# this run already wrote, never inferred from the throughput number alone
# (#2979's own acceptance criterion). Peak per-connection `running`
# sync_jobs count during the concurrent window, against the documented
# realtime lane caps (total=4, perScope=2, sync-job.runner.ts) - if BOTH
# channels are simultaneously pegged at perScope while the lane total is
# saturated, that is direct evidence the LANE, not either destination's
# rate limit, is what a third channel would queue behind.
# ---------------------------------------------------------------------------
f11_peak_running() {
  local conn="$1"
  as_count "$(pg_sql "SELECT MAX(c) FROM (SELECT COUNT(*) c FROM sync_jobs WHERE \"connectionId\"='$conn' AND status='running' GROUP BY \"lockedAt\") x" 2>/dev/null | tr -d '[:space:]')"
}
PEAK_RUNNING_ALLEGRO="$(f11_peak_running "$ALLEGRO_SOURCE_CONNECTION_ID")"
PEAK_RUNNING_PS="$(f11_peak_running "$PS_SOURCE_CONNECTION_ID")"
LIMITER_DEGRADED_LOGGED="unknown"
if grep -q 'rate_limiter_degraded_entered' "$RESULTS_DIR_CONCURRENT_AGG"/*.log 2>/dev/null; then
  LIMITER_DEGRADED_LOGGED="yes"
else
  LIMITER_DEGRADED_LOGGED="no (or logs unavailable to this scan)"
fi
log "binding-constraint evidence: peak running (allegro)=${PEAK_RUNNING_ALLEGRO:-unknown} (prestashop-source)=${PEAK_RUNNING_PS:-unknown}; realtime lane caps total=4 perScope=2; limiter-degraded log seen=$LIMITER_DEGRADED_LOGGED"

jq -n \
  --arg allegroSolo "$ARM1_RATE_PER_HOUR" --arg psSolo "$ARM2_RATE_PER_HOUR" \
  --arg allegroConcurrent "$ARM3_ALLEGRO_RATE" --arg psConcurrent "$ARM3_PS_RATE" \
  --arg aggregateConcurrent "$ARM3_AGG_RATE" \
  --arg allegroVerdict "$ALLEGRO_VERDICT" --arg psVerdict "$PS_VERDICT" \
  --arg peakRunningAllegro "${PEAK_RUNNING_ALLEGRO:-unknown}" --arg peakRunningPs "${PEAK_RUNNING_PS:-unknown}" \
  --arg limiterDegraded "$LIMITER_DEGRADED_LOGGED" \
  '{
    labelled: "measured",
    scopeCut: "two channels (Allegro stub + PrestaShop-as-source), not three - Erli/WooCommerce unreachable on this stand, see file header",
    baselines: {allegroSoloPerHour: $allegroSolo, prestashopSourceSoloPerHour: $psSolo},
    concurrent: {allegroPerHour: $allegroConcurrent, prestashopSourcePerHour: $psConcurrent, aggregatePerHour: $aggregateConcurrent},
    starvation: {allegro: $allegroVerdict, prestashopSource: $psVerdict, thresholdPct: '"$STARVATION_THRESHOLD_PCT"'},
    bindingConstraintEvidence: {peakRunningAllegro: $peakRunningAllegro, peakRunningPrestashopSource: $peakRunningPs, realtimeLaneCaps: "total=4 perScope=2 (sync-job.runner.ts)", limiterDegradedLogSeen: $limiterDegraded}
  }' > "$RESULTS_DIR_CONCURRENT_AGG/f11-summary.json"
log "wrote $RESULTS_DIR_CONCURRENT_AGG/f11-summary.json"

log "=== F11 done. See $RESULTS_DIR_CONCURRENT_AGG for the aggregate window and its two per-channel siblings. ==="
