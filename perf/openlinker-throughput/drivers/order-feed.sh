#!/usr/bin/env bash
#
# F1 driver library (#2847, epic #2840) - order-arrival primitives against the
# Allegro upstream stub (#2856, wired onto the `lab` stand by #2935). Sourced
# by scenarios/f1-order-ingestion.sh, never run standalone.
#
# Every generic guard/manifest/results primitive lives in lib.sh, per that
# file's own rule; this library owns only what is specific to (a) pushing
# orders into the stub, (b) asking OpenLinker to go and look, and (c) telling
# whether the stub still had work left to hand over - none of which lib.sh
# has a reason to know about.
#
# Requires the caller to have already sourced lib.sh (uses its pg_sql /
# enqueue_perf_job / log / warn / die / iso_now / require_tools).
#
# ---------------------------------------------------------------------------
# THE SHAPE OF "ARRIVAL RATE" ON THIS PATH, AND WHY IT IS NOT A k6 SCRIPT
# ---------------------------------------------------------------------------
# #2847 proposes `drivers/order-feed.js` driving a `ramping-arrival-rate`
# executor. That shape does not describe this path, and adopting it would
# have produced a number about the driver rather than about OpenLinker.
#
# OpenLinker never observes the instant an order appears at the marketplace.
# It observes a PAGE, once per poll tick: `AllegroOrderSourceAdapter.
# listOrderFeed` reads `GET /order/events?from={cursor}&limit=100` exactly
# once per `marketplace.orders.poll` job - `OrderIngestionService.ingestOrders`
# has no loop and no page budget. So an order pushed into the stub at
# t=0.001s and one pushed at t=0.999s are, to OpenLinker, the same arrival:
# both are simply rows in whatever page the next tick reads.
#
# The independent variable OpenLinker actually experiences is therefore
#
#     offered rate = min(page limit, backlog) / poll interval
#
# and both terms are things this driver sets explicitly: `of_push_orders`
# controls the backlog, `of_enqueue_poll` controls the interval. A k6
# arrival-rate executor firing `POST /__stub/tenants/{t}/orders` would vary
# a third term that no OpenLinker code path can see.
#
# The consequence for the generator-saturation question (#2933, the F3
# lesson) is that the k6-shaped guard has nothing to check here - a single
# `POST .../orders` with `count: 400` mints the whole backlog in one request,
# before the window even opens, so the pusher is structurally incapable of
# being the bottleneck. The question that guard exists to answer -
# "was the instrument, rather than the system, the ceiling?" - still applies
# and is answered instead by `post_guard_feed_starved` (lib.sh, this issue):
# a run whose stub RAN DRY offered less load than it could have, so its
# achieved rate is a floor on the offered rate and not the system's ceiling.
#
set -euo pipefail

# The stub's HOST-published address. The harness runs on the host, so this is
# 127.0.0.1:19081 (docker-compose.lab.yml) and NOT the `http://allegro-stub:8080`
# service address the api/worker containers use - same host-vs-network-namespace
# distinction F3's TARGET_URL and F2's OL_API_INTERNAL_URL each carry.
OF_STUB_URL="${OF_STUB_URL:-http://127.0.0.1:19081}"

# The cursor row OpenLinker persists for an Allegro order feed. Fixed by the
# scheduler task's own payload (`allegro-scheduler-tasks.ts`, generatePayload:
# `cursorKey: 'allegro.orders.lastEventId'`), restated here because
# `of_backlog` and the scenario's own reset both key on it.
OF_CURSOR_KEY="${OF_CURSOR_KEY:-allegro.orders.lastEventId}"

# The page limit the real scheduler task passes. Restated rather than invented:
# `allegro-scheduler-tasks.ts` hardcodes `limit: 100` with no env var, so a run
# that passed anything else would be measuring a configuration no deployment
# can reach.
OF_POLL_LIMIT="${OF_POLL_LIMIT:-100}"

# ---------------------------------------------------------------------------
# of_curl <method> <path> [json-body]
# Dies on a non-2xx, printing the body - the same reasoning as lib.sh's
# `ol_api`: a stub refusal is exactly where a scenario tends to fail, and
# `curl -f` alone would hide the message that says why.
# ---------------------------------------------------------------------------
of_curl() {
  local method="$1" path="$2" body="${3:-}" resp status resp_body
  if [ -n "$body" ]; then
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$OF_STUB_URL$path" \
      -H 'Content-Type: application/json' -d "$body")"
  else
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$OF_STUB_URL$path")"
  fi
  status="${resp##*$'\n'}"
  resp_body="${resp%$'\n'*}"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    die "stub $method $path -> HTTP $status: $resp_body"
  fi
  printf '%s' "$resp_body"
}

# of_config - the stub's own resolved configuration. Read into the manifest
# rather than restated from docker-compose.lab.yml, so the manifest asserts
# against the stub's RUNNING state (its own README makes this the point of
# the endpoint) instead of against what somebody believed it was started with.
of_config() { of_curl GET /__stub/config; }

of_health() { of_curl GET /__stub/health; }

# ---------------------------------------------------------------------------
# of_new_run [run_id] - start a fresh stub run, resetting every tenant's
# event/order history and counters.
#
# This is NOT optional housekeeping. The child job's Redis dedupe key is
# `marketplace:{connectionId}:order:{eventKey}` with a 7-day TTL
# (`order-ingestion.service.ts`, `redis-streams-job-enqueue.service.ts`), and
# `eventKey` is the stub's own event id. Repeating this scenario inside that
# window without a new run id re-mints the identical keys the previous run
# already reserved, so every enqueue silently no-ops - `n = 0`, the cursor
# still commits, and nothing in the result distinguishes a fully-deduped tick
# from a fresh one (the stub's README states this in its own words).
# ---------------------------------------------------------------------------
of_new_run() {
  local run_id="${1:-}" body='{}'
  [ -z "$run_id" ] || body="$(jq -n --arg r "$run_id" '{runId:$r}')"
  of_curl POST /__stub/run "$body" | jq -r '.runId'
}

# ---------------------------------------------------------------------------
# of_push_orders <tenant> <count> [line_items_per_order] [events_per_order]
# Echoes the number of orders the stub reports it minted.
#
# Minted orders sit in the stub's in-memory event list until something polls
# for them; the stub never pushes. That is what makes backlog depth an
# independent variable this scenario sets rather than a property it inherits.
# ---------------------------------------------------------------------------
of_push_orders() {
  local tenant="$1" count="$2" lines="${3:-1}" events="${4:-1}" body resp minted
  body="$(jq -n --argjson c "$count" --argjson l "$lines" --argjson e "$events" \
    '{count:$c, lineItemsPerOrder:$l, eventsPerOrder:$e}')"
  resp="$(of_curl POST "/__stub/tenants/$tenant/orders" "$body")"
  # `.minted | length` rather than echoing the request's own `count` back -
  # the stub answers with the list it ACTUALLY minted, and trusting the
  # request would report a number the stub never confirmed. The field is
  # `minted` (server.mjs), not `orders`; getting that wrong reads as "the stub
  # minted 0" on a push that in fact succeeded, which is how it was found.
  minted="$(printf '%s' "$resp" | jq -r '(.minted // []) | length')"
  [ "${minted:-0}" -eq "$count" ] \
    || warn "of_push_orders: asked for $count order(s) on $tenant, stub minted ${minted:-0}"
  printf '%s' "${minted:-0}"
}

of_stats() { of_curl GET "/__stub/tenants/$1/stats"; }

# of_request_count <tenant> <key> - one endpoint's served-request count, e.g.
# `of_request_count perf-allegro-a 'GET /order/events'`. Absent means the
# endpoint was never reached, which is 0 here (the stub only creates a key on
# first use), NOT "unknown" - and that distinction is safe only because the
# same call site always reads a key the stub is known to create.
of_request_count() {
  of_stats "$1" | jq -r --arg k "$2" '.requestCounts[$k] // 0'
}

# ---------------------------------------------------------------------------
# of_seq <event_id> - the monotone per-tenant sequence number inside a stub
# event id. Ids are `{runId}-{6-digit-seq}` (`server.mjs`, and deliberately
# NOT a bare decimal so OpenLinker's own `compareOrderCursors` regression
# guard reads them as `unrecognised` rather than as a regression).
#
# Echoes nothing for an id this function cannot parse. A caller must treat
# that as UNKNOWN and never as 0 - reading an unparseable cursor as sequence
# zero would report a fully-drained feed as a full backlog.
# ---------------------------------------------------------------------------
of_seq() {
  local id="${1:-}"
  case "$id" in
    *-[0-9][0-9][0-9][0-9][0-9][0-9]) printf '%s' "$((10#${id##*-}))" ;;
    *) printf '' ;;
  esac
}

# ---------------------------------------------------------------------------
# of_backlog <tenant> <connection_id>
#
# How many minted events OpenLinker has NOT yet consumed: the stub's own head
# sequence minus the sequence OpenLinker's persisted `connection_cursors` row
# has committed. Echoes `unknown` when either side cannot be parsed.
#
# Why this number is load-bearing rather than diagnostic: it is the whole
# evidence for `post_guard_feed_starved`. A throughput arm whose backlog
# reaches 0 while its window is still open stopped offering load, so its
# achieved rate is a statement about this driver and not about OpenLinker -
# the same failure that nearly published F3's generator ceiling as the
# system's (#2933), arriving through a different door.
#
# `unknown` on a run whose stub has minted nothing yet is correct and
# expected (there is no head to compare against); a caller in a measured
# window must treat `unknown` as a reason to refuse, never as "fine".
# ---------------------------------------------------------------------------
of_backlog() {
  local tenant="$1" conn="$2" head_id head_seq cur_id cur_seq
  head_id="$(of_stats "$tenant" | jq -r '.currentCursor // empty')"
  [ -n "$head_id" ] || { printf 'unknown'; return 0; }
  head_seq="$(of_seq "$head_id")"
  [ -n "$head_seq" ] || { printf 'unknown'; return 0; }

  cur_id="$(pg_sql "SELECT COALESCE(value,'') FROM connection_cursors WHERE \"connectionId\"='$conn' AND \"cursorKey\"='$OF_CURSOR_KEY'" 2>/dev/null || printf '')"
  # No cursor row at all is a REAL, meaningful state, not an error: nothing
  # has been consumed, so the whole head is backlog.
  [ -n "$cur_id" ] || { printf '%s' "$head_seq"; return 0; }
  cur_seq="$(of_seq "$cur_id")"
  [ -n "$cur_seq" ] || { printf 'unknown'; return 0; }

  # A cursor from a PREVIOUS stub run compares meaninglessly against this
  # run's head (each run restarts the sequence at 0), so a negative result is
  # reported as unknown rather than clamped to 0 - clamping would silently
  # claim a drained feed on exactly the run-mismatch this catches.
  if [ "$cur_seq" -gt "$head_seq" ]; then printf 'unknown'; return 0; fi
  printf '%s' "$((head_seq - cur_seq))"
}

# ---------------------------------------------------------------------------
# of_enqueue_poll <connection_id> <tag>
#
# Enqueue one `marketplace.orders.poll` job by hand, with the payload the
# real Allegro scheduler task generates (`allegro-scheduler-tasks.ts`:
# `{schemaVersion: 1, cursorKey: 'allegro.orders.lastEventId', limit: 100}`).
#
# THE SCHEDULER IS DELIBERATELY NOT USED, and this is the single most
# consequential methodology choice in F1. Turning `OL_SCHEDULER_ENABLED` on
# would fire the Allegro poll cron - and, on this stand, every OTHER default-on
# task with it, including the PrestaShop master sweeps, whose parents share
# the `fan-out` lane with `marketplace.orders.poll` itself
# (`handler-registration.service.ts`) at 8 total / 4 per scope. #2847's own
# acceptance criteria name that co-tenancy as a contaminant to control for.
#
# So the harness owns the poll cadence outright. The cost is stated rather
# than hidden: the poll-WAIT term this run reports is a cadence this script
# chose, not one any deployment experiences, exactly as F2 reports its
# t1->t2 hop as excluded-by-construction. The real cadences are recorded in
# the manifest separately, as DERIVED figures read from the plugin defaults
# and the worker's own environment.
#
# The idempotency key carries a caller-supplied tag plus a millisecond
# timestamp. The real task's key is `marketplace:{id}:orders:poll:{ts}` at
# second resolution; at the cadences a throughput arm drives, two polls can
# legitimately land inside one second, and a colliding key would silently
# dedupe the second one away (`isExisting: true`) while the run went on
# believing it had offered another page.
# ---------------------------------------------------------------------------
of_enqueue_poll() {
  local conn="$1" tag="${2:-f1}" key
  key="marketplace:$conn:orders:poll:$tag:$(date +%s%3N)"
  enqueue_perf_job 'marketplace.orders.poll' "$conn" \
    "{\"schemaVersion\":1,\"cursorKey\":\"$OF_CURSOR_KEY\",\"limit\":$OF_POLL_LIMIT}" "$key" >/dev/null
  printf '%s' "$key"
}
