#!/usr/bin/env bash
#
# F17 - returns and refunds under load (#3047, epic #2840).
#
# The whole returns aggregate (#2327/#2330/#2332/#2370) has never been
# measured: both Allegro returns-ingestion scheduler tasks default OFF
# (#2330 - the endpoint is [BETA], every test fixture-driven), so nothing
# has ever driven a return through this stand. `ReturnsAuthority` (A5) is
# enabled on no connection and advertised by no manifest, so it cannot be
# assigned at all yet (docs/architecture-overview.md § Returns names this a
# reachability gap, not data loss) - this scenario does not touch it, since
# none of the three mechanisms below need it (A5 governs `return.decline`
# only).
#
# Driven from the extended Allegro stub (#3043's `/order/customer-returns`
# + `POST /__stub/tenants/:t/returns` seed), never the real endpoint - its
# cursor ordering guarantees are undocumented and it is `[BETA]`
# (SPIKE-2289 risk 6, CONCEDED), so measuring against it would measure
# ITS uncertainty, not OpenLinker's.
#
# Three arms:
#   A. The two-pass ingestion shape (#2330), timed separately. Pass 1
#      (`marketplace.returns.poll`, fan-out) discovers N seeded returns and
#      fans out one `marketplace.return.sync` child per return; pass 2
#      (`marketplace.returns.statusSync`, bulk) re-reads OL's own
#      non-terminal returns through the source, because the feed can only
#      report EXISTENCE, never a status transition (module docblock,
#      returns-job-payloads.types.ts).
#   B. Custody writes under load, including a blocked restock (#2370). One
#      operator-authored return (`POST /returns/record`, against a real
#      internal order) with two lines: one against a REAL PrestaShop SKU
#      (restock succeeds, quantityRestocked moves) and one against a SKU
#      that resolves to no product at all (restock is BLOCKED - the act is
#      persisted, the counter does not move, the units stay in
#      `quantityReceived` until an operator attests). Both outcomes in one
#      arm, since a custody guard with only one direction has never
#      actually been exercised.
#   C. The orphan reconcile (#2332) against a seeded orphan population. K
#      returns whose `orderId` will NEVER resolve (permanent orphans) plus
#      one whose `orderId` WILL resolve, but only once an
#      `identifier_mappings` row for it is created AFTER the return was
#      already ingested (the "order ingested later" shape #2332 exists
#      for). `returns.orphan.reconcile` must attribute the resolvable one
#      and leave the K permanent orphans alone - both directions of the
#      same guard.
#
# WHAT THIS DOES NOT MEASURE, restated so it cannot be misquoted: the real
# Allegro customer-returns endpoint's throughput, latency, or cursor
# behaviour. Every figure is a statement about OpenLinker's own two-pass
# ingestion, custody write path, and orphan-reconcile sweep against a
# declared stub - never about Allegro's real [BETA] endpoint, whose risks
# (SPIKE-2289) remain entirely unretired by this scenario.
#
# Usage: ./f17-returns.sh [--smoke]
#   (default)  all three arms, a dated report under results/
#   --smoke    arm A pass 1 only, 2 returns - proves the plumbing
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f17"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

: "${ALLEGRO_A_CONNECTION_ID:?ALLEGRO_A_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first}"

ALLEGRO_STUB_URL="${ALLEGRO_STUB_URL:-http://127.0.0.1:${ALLEGRO_STUB_HOST_PORT:-19081}}"
ARM_A_RETURNS="${ARM_A_RETURNS:-10}"
ARM_C_ORPHANS="${ARM_C_ORPHANS:-10}"
POLL_MAX_WAIT_SECS="${POLL_MAX_WAIT_SECS:-60}"

if [ "$SMOKE" = 1 ]; then
  ARM_A_RETURNS=2
  warn "SMOKE MODE - arm A pass 1 only, 2 returns. Not a measurement."
fi

curl -sS --max-time 5 "$ALLEGRO_STUB_URL/__stub/health" >/dev/null \
  || die "allegro-stub not reachable at $ALLEGRO_STUB_URL/__stub/health - is the lab stand up?"

# `/__stub/run` resets every tenant's return/order history, counters and
# faults (stubs/allegro/README.md) - without it, `tenant.customerReturns`
# keeps every return this scenario (and every earlier run of it, and any
# other scenario's own seeding) has EVER minted on this container's
# lifetime, since nothing else ever clears it. A fresh cursor then
# re-discovers the whole accumulated backlog on every poll, and the
# resulting fan-out (dozens of `marketplace.return.sync` children
# contending for the same `realtime`-lane slots) starves THIS run's own
# handful of returns - found live: pass 1 went from 8/10 ingested in one
# run to 0/10 in the next, entirely from backlog growth, not from
# anything OpenLinker's own ingestion path did wrong.
curl -sS --max-time 5 -X POST "$ALLEGRO_STUB_URL/__stub/run" -H 'Content-Type: application/json' -d '{}' >/dev/null \
  || die "could not reset allegro-stub state via POST $ALLEGRO_STUB_URL/__stub/run"

# The stub reset above rewinds `tenant.returnCounter` to 0, so the NEXT
# return this scenario mints is again `stub-return-perf-allegro-a-1`,
# `-2`, ... - colliding with the deterministic
# `jobdedup:marketplace:{connectionId}:return:{eventKey}` Redis dedup key
# (architecture-overview.md § 22 Returns) a PRIOR run already wrote for
# that same literal id. `/__stub/run` cannot know about this key - it
# lives entirely in OpenLinker, not the stub - so without clearing it too,
# every re-ingestion attempt against a low-numbered id reads "already
# enqueued (idempotent)" and does nothing: found live, ingestion staying
# at 0/N even immediately after a stub reset.
mapfile -t f17_stale_dedup_keys < <(redis_cli --scan --pattern "jobdedup:marketplace:${ALLEGRO_A_CONNECTION_ID}:return:*" 2>/dev/null || true)
if [ "${#f17_stale_dedup_keys[@]}" -gt 0 ]; then
  redis_cli DEL "${f17_stale_dedup_keys[@]}" >/dev/null
  log "cleared ${#f17_stale_dedup_keys[@]} stale return-ingestion dedup key(s) left over from earlier runs"
fi
# The Redis key above is only a fast-path pre-check (ADR-005) - the DURABLE
# guard is `sync_jobs.idempotencyKey`'s own unique index, and a prior run's
# rows are still sitting on the exact same key (the low-numbered return ids
# a stub reset reissues), so `JobIntakeConsumer`'s
# `INSERT ... ON CONFLICT DO NOTHING` silently no-ops on them - found live:
# the intake consumer logged "processed... persisted to database" for
# every one of this run's returns, yet not a single new row appeared in
# `sync_jobs`, because every one of them collided with an old row from an
# earlier session. Clearing BOTH layers is what makes a stub reset actually
# mean "start over" for OpenLinker's own bookkeeping, not just the stub's.
f17_stale_jobs="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"jobType\"='marketplace.return.sync' AND \"connectionId\"='$ALLEGRO_A_CONNECTION_ID'")"
pg_sql_write "DELETE FROM sync_jobs WHERE \"jobType\"='marketplace.return.sync' AND \"connectionId\"='$ALLEGRO_A_CONNECTION_ID'" >/dev/null
log "cleared ${f17_stale_jobs:-0} stale marketplace.return.sync sync_jobs row(s) left over from earlier runs"

ol_login

RESULTS_DIR="$(results_dir_init f17-returns "$([ "$SMOKE" = 1 ] && echo smoke || echo strict)")"

guard_stand_exclusive f17-returns
guard_scheduler_off
guard_runner_state enabled

RUN_TAG="$(epoch)_$$"

pg_sql_write_besteffort() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -c "$1" >/dev/null 2>&1 \
    || warn "pg_sql_write_besteffort: cleanup statement failed (non-fatal, trap continues): $1"
}

f17_cleanup() {
  pg_sql_write_besteffort "DELETE FROM return_lines WHERE \"returnId\" IN (SELECT id FROM returns WHERE \"externalOrderId\" LIKE 'f17-${RUN_TAG}-%' OR \"internalOrderId\" LIKE 'f17_${RUN_TAG}_%')"
  pg_sql_write_besteffort "DELETE FROM returns WHERE \"externalOrderId\" LIKE 'f17-${RUN_TAG}-%' OR \"internalOrderId\" LIKE 'f17_${RUN_TAG}_%'"
  pg_sql_write_besteffort "DELETE FROM identifier_mappings WHERE \"internalId\" LIKE 'f17_${RUN_TAG}_%' OR \"externalId\" LIKE 'f17-${RUN_TAG}-%'"
  pg_sql_write_besteffort "DELETE FROM order_records WHERE \"internalOrderId\" LIKE 'f17_${RUN_TAG}_%'"
  release_stand_exclusive
}
trap f17_cleanup EXIT

# enqueue_job <job_type> <connection_id> <payload_json> <idem_key> - insert +
# block until THAT job reaches a terminal status (never poll a data table
# instead - see f15-shipping.sh's own header for why that is unsound when a
# per-connection sweep lock is involved).
enqueue_job() {
  local job_type="$1" conn_id="$2" payload="$3" idem_key="$4" job_id waited status
  job_id="$(pg_sql "INSERT INTO sync_jobs
      (\"jobType\",\"connectionId\",\"payloadJson\",\"status\",\"idempotencyKey\",\"attempts\",\"maxAttempts\",\"nextRunAt\")
    VALUES
      ('$job_type','$conn_id'::uuid,'$payload'::jsonb,'queued','$idem_key',0,1,now())
    RETURNING id" | head -1)"
  [ -n "$job_id" ] || die "enqueue_job: INSERT ... RETURNING id returned nothing for $idem_key"
  waited=0
  while :; do
    status="$(pg_sql "SELECT status FROM sync_jobs WHERE id='$job_id'")"
    [ "$status" != "succeeded" ] && [ "$status" != "dead" ] || break
    waited=$((waited + 1))
    [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] || { warn "enqueue_job: job $job_id ($idem_key, $job_type) still $status after ${POLL_MAX_WAIT_SECS}s"; break; }
    sleep 1
  done
  [ "$status" = "succeeded" ] || warn "enqueue_job: job $job_id ($idem_key, $job_type) ended status=$status, not succeeded"
  printf '%s' "$job_id"
}

ARM_RESULTS_FILE="$RESULTS_DIR/arm-results.txt"
: > "$ARM_RESULTS_FILE"

window_start "$RESULTS_DIR" f17-returns "'$ALLEGRO_A_CONNECTION_ID'" "$SMOKE" '{}'

# ===========================================================================
# Arm A - two-pass ingestion, timed separately.
# ===========================================================================
log "--- arm A: two-pass returns ingestion ($ARM_A_RETURNS returns) ---"
a_prefix="f17-${RUN_TAG}-armA"
curl -sS --max-time 10 -X POST "$ALLEGRO_STUB_URL/__stub/tenants/perf-allegro-a/returns" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --argjson count "$ARM_A_RETURNS" --arg prefix "$a_prefix" '{count:$count, itemsPerReturn:1, orderIdPrefix:$prefix}')" >/dev/null \
  || die "could not seed $ARM_A_RETURNS returns via $ALLEGRO_STUB_URL"

t0="$(date +%s%3N)"
enqueue_job 'marketplace.returns.poll' "$ALLEGRO_A_CONNECTION_ID" \
  "$(jq -nc --argjson lim "$ARM_A_RETURNS" --arg ck "f17.${RUN_TAG}.returns.lastReturnId" '{schemaVersion:1, cursorKey:$ck, limit:$lim}')" \
  "f17:armA:poll:${RUN_TAG}" >/dev/null

# Pass 1's own job succeeding means the FAN-OUT happened; the children
# (`marketplace.return.sync`) run asynchronously afterward, so pass 1
# throughput is measured against the returns actually landing in the
# `returns` table, not against the poll job's own completion.
waited=0
ingested_count=0
while :; do
  ingested_count="$(pg_sql "SELECT COUNT(*) FROM returns WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"externalOrderId\" LIKE '${a_prefix}-%'")"
  [ "${ingested_count:-0}" -ge "$ARM_A_RETURNS" ] && break
  waited=$((waited + 1))
  [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] || { warn "arm A pass 1: only $ingested_count/$ARM_A_RETURNS returns ingested after ${POLL_MAX_WAIT_SECS}s"; break; }
  sleep 1
done
t1="$(date +%s%3N)"
pass1_ms=$((t1 - t0))
pass1_per_hour=$(awk -v ms="$pass1_ms" -v n="$ingested_count" 'BEGIN{printf "%.1f", (ms>0)?(n*3600000.0/ms):0}')
log "arm A pass 1: $ingested_count/$ARM_A_RETURNS returns ingested in ${pass1_ms}ms => ${pass1_per_hour}/hour"
printf 'armA-pass1-ingestion ingested=%s total=%s elapsedMs=%s perHour=%s\n' \
  "$ingested_count" "$ARM_A_RETURNS" "$pass1_ms" "$pass1_per_hour" >> "$ARM_RESULTS_FILE"

if [ "$SMOKE" = 0 ]; then
  log "--- arm A pass 2: lifecycle re-read (marketplace.returns.statusSync) ---"
  t0="$(date +%s%3N)"
  enqueue_job 'marketplace.returns.statusSync' "$ALLEGRO_A_CONNECTION_ID" \
    "$(jq -nc --arg ck "f17.${RUN_TAG}.returns.statusSync.scanOffset" '{schemaVersion:1, limit:100, cursorKey:$ck, lookbackDays:30}')" \
    "f17:armA:statusSync:${RUN_TAG}" >/dev/null
  t1="$(date +%s%3N)"
  pass2_ms=$((t1 - t0))
  log "arm A pass 2: re-read OL's own non-terminal returns in ${pass2_ms}ms (page bound 100, lookback 30d - see worker log for scanned/updated/failed counts)"
  printf 'armA-pass2-lifecycle elapsedMs=%s\n' "$pass2_ms" >> "$ARM_RESULTS_FILE"
else
  log "--- arm A pass 2: skipped (smoke mode) ---"
fi

# ===========================================================================
# Arm B - custody writes under load, including a blocked restock.
# ===========================================================================
ARM_B_OK=0
if [ "$SMOKE" = 0 ]; then
  log "--- arm B: custody writes, including a blocked restock ---"
  b_order_id="f17_${RUN_TAG}_armB"
  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    VALUES
      ('$b_order_id','$ALLEGRO_A_CONNECTION_ID'::uuid,
       '{\"totals\":{\"currency\":\"PLN\",\"total\":10.00}}'::jsonb,
       '[]'::jsonb,'ready',now(),now())" >/dev/null
  pg_sql_write "INSERT INTO identifier_mappings
      (id,\"entityType\",\"internalId\",\"externalId\",\"platformType\",\"connectionId\",\"createdAt\",\"updatedAt\")
    VALUES
      (gen_random_uuid(),'Order','$b_order_id','f17-${RUN_TAG}-armB-ext','allegro','$ALLEGRO_A_CONNECTION_ID'::uuid,now(),now())" >/dev/null

  record_resp="$(ol_api POST /v1/returns/record "$(jq -n --arg oid "$b_order_id" --arg cid "$ALLEGRO_A_CONNECTION_ID" '
    {internalOrderId:$oid, sourceConnectionId:$cid, lines:[
      {sku:"OL-CANON-SX740LE", reason:"defective", quantityAdvised:1},
      {sku:"F17-NONEXISTENT-SKU-XYZ", reason:"defective", quantityAdvised:1}
    ]}')")"
  b_return_id="$(printf '%s' "$record_resp" | json_field returnId)"
  [ -n "$b_return_id" ] || die "arm B: POST /returns/record returned no returnId: $record_resp"
  log "arm B: opened return $b_return_id (operator_authored) against order $b_order_id"

  b_good_line="$(pg_sql "SELECT id FROM return_lines WHERE \"returnId\"='$b_return_id' AND sku='OL-CANON-SX740LE'")"
  b_bad_line="$(pg_sql "SELECT id FROM return_lines WHERE \"returnId\"='$b_return_id' AND sku='F17-NONEXISTENT-SKU-XYZ'")"
  [ -n "$b_good_line" ] && [ -n "$b_bad_line" ] || die "arm B: could not resolve both line ids for return $b_return_id"

  ol_api POST "/v1/returns/$b_return_id/lines/$b_good_line/receive" '{"quantity":1}' >/dev/null
  ol_api POST "/v1/returns/$b_return_id/lines/$b_bad_line/receive" '{"quantity":1}' >/dev/null

  good_dispose="$(ol_api POST "/v1/returns/$b_return_id/lines/$b_good_line/dispose" '{"quantity":1,"disposition":"restock"}')"
  bad_dispose="$(ol_api POST "/v1/returns/$b_return_id/lines/$b_bad_line/dispose" '{"quantity":1,"disposition":"restock"}')"

  good_blocked="$(printf '%s' "$good_dispose" | jq -r '.restockBlocked // empty')"
  bad_blocked="$(printf '%s' "$bad_dispose" | jq -r '.restockBlocked // empty')"
  good_restocked="$(pg_sql "SELECT \"quantityRestocked\" FROM return_lines WHERE id='$b_good_line'")"
  bad_restocked="$(pg_sql "SELECT \"quantityRestocked\" FROM return_lines WHERE id='$b_bad_line'")"

  log "arm B: good SKU dispose - restockBlocked=${good_blocked:-<none>} quantityRestocked=$good_restocked"
  log "arm B: bad SKU dispose - restockBlocked=${bad_blocked:-<none>} quantityRestocked=$bad_restocked"

  if [ -z "$good_blocked" ] && [ "$good_restocked" = "1" ] && [ -n "$bad_blocked" ] && [ "$bad_restocked" = "0" ]; then
    ARM_B_OK=1
    log "arm B VALID: a real SKU restocks cleanly (quantityRestocked=1, no block) and a SKU resolving to no product is BLOCKED (quantityRestocked stays 0, the act is persisted but the counter never moves - #2370's own rule)"
  else
    warn "arm B DISCARDED: expected good=(blocked=<none>,restocked=1) bad=(blocked=<non-empty>,restocked=0), got good=(blocked=${good_blocked:-<none>},restocked=$good_restocked) bad=(blocked=${bad_blocked:-<none>},restocked=$bad_restocked)"
  fi
  printf 'armB-custody-blocked-restock goodBlocked=%s goodRestocked=%s badBlocked=%s badRestocked=%s ok=%s\n' \
    "${good_blocked:-none}" "$good_restocked" "${bad_blocked:-none}" "$bad_restocked" "$ARM_B_OK" >> "$ARM_RESULTS_FILE"
else
  log "--- arm B: skipped (smoke mode) ---"
fi

# ===========================================================================
# Arm C - orphan reconcile against a seeded orphan population.
# ===========================================================================
ARM_C_OK=0
if [ "$SMOKE" = 0 ]; then
  log "--- arm C: orphan reconcile ($ARM_C_ORPHANS permanent orphans + 1 resolvable) ---"
  c_prefix="f17-${RUN_TAG}-armC"
  # K permanent orphans - orderId this stand will never ingest an order for.
  curl -sS --max-time 10 -X POST "$ALLEGRO_STUB_URL/__stub/tenants/perf-allegro-a/returns" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --argjson count "$ARM_C_ORPHANS" --arg prefix "${c_prefix}-orphan" '{count:$count, itemsPerReturn:1, orderIdPrefix:$prefix}')" >/dev/null

  # One RESOLVABLE return - its orderId will get an identifier_mappings row
  # only AFTER ingestion, the "order ingested later" shape #2332 exists for.
  # `orderId` is `{orderIdPrefix}-{tenant.returnCounter}`, and returnCounter
  # is a TENANT-WIDE cumulative counter (already advanced by the K orphans
  # just seeded above, plus any earlier run this session) - a first draft
  # hardcoded a "-1" suffix and the reconcile correctly found nothing to
  # attribute, because nothing in `returns` ever carried that exact
  # externalOrderId. The seed response's `minted` array carries only the
  # RETURN id (`stub-return-{tenant}-{counter}`, never the order id), but
  # the counter value is its own trailing segment, so the real orderId is
  # reconstructed from it rather than guessed.
  c_seed_resp="$(curl -sS --max-time 10 -X POST "$ALLEGRO_STUB_URL/__stub/tenants/perf-allegro-a/returns" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg prefix "${c_prefix}-resolvable" '{count:1, itemsPerReturn:1, orderIdPrefix:$prefix}')")"
  c_minted_return_id="$(printf '%s' "$c_seed_resp" | jq -r '.minted[0] // empty')"
  [ -n "$c_minted_return_id" ] || die "arm C: could not read the resolvable return's minted id from: $c_seed_resp"
  c_return_counter="${c_minted_return_id##*-}"
  c_resolvable_ext="${c_prefix}-resolvable-${c_return_counter}"

  enqueue_job 'marketplace.returns.poll' "$ALLEGRO_A_CONNECTION_ID" \
    "$(jq -nc --arg ck "f17.${RUN_TAG}.armC.returns.lastReturnId" '{schemaVersion:1, cursorKey:$ck, limit:200}')" \
    "f17:armC:poll:${RUN_TAG}" >/dev/null

  c_total=$((ARM_C_ORPHANS + 1))
  waited=0
  c_ingested=0
  while :; do
    c_ingested="$(pg_sql "SELECT COUNT(*) FROM returns WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"externalOrderId\" LIKE '${c_prefix}-%'")"
    [ "${c_ingested:-0}" -ge "$c_total" ] && break
    waited=$((waited + 1))
    [ "$waited" -lt "$POLL_MAX_WAIT_SECS" ] || { warn "arm C: only $c_ingested/$c_total returns ingested after ${POLL_MAX_WAIT_SECS}s"; break; }
    sleep 1
  done

  before_orphans="$(pg_sql "SELECT COUNT(*) FROM returns WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"externalOrderId\" LIKE '${c_prefix}-%' AND \"internalOrderId\" IS NULL")"
  log "arm C: $c_ingested/$c_total returns ingested, $before_orphans orphaned (expected: all $c_total, since neither order exists yet)"

  # NOW the resolvable order "gets ingested" - the identifier_mappings row
  # #2332's reconcile actually reads (existence proven via mappings, not
  # `orders` - architecture-overview.md § 22 Returns).
  c_order_id="f17_${RUN_TAG}_armC"
  pg_sql_write "INSERT INTO order_records
      (\"internalOrderId\",\"sourceConnectionId\",\"orderSnapshot\",\"syncStatus\",\"recordStatus\",\"createdAt\",\"updatedAt\")
    VALUES
      ('$c_order_id','$ALLEGRO_A_CONNECTION_ID'::uuid,
       '{\"totals\":{\"currency\":\"PLN\",\"total\":10.00}}'::jsonb,
       '[]'::jsonb,'ready',now(),now())" >/dev/null
  pg_sql_write "INSERT INTO identifier_mappings
      (id,\"entityType\",\"internalId\",\"externalId\",\"platformType\",\"connectionId\",\"createdAt\",\"updatedAt\")
    VALUES
      (gen_random_uuid(),'Order','$c_order_id','$c_resolvable_ext','allegro','$ALLEGRO_A_CONNECTION_ID'::uuid,now(),now())" >/dev/null

  t0="$(date +%s%3N)"
  enqueue_job 'returns.orphan.reconcile' "$ALLEGRO_A_CONNECTION_ID" \
    "$(jq -nc --arg ck "f17.${RUN_TAG}.armC.orphan.scanOffset" '{schemaVersion:1, limit:200, cursorKey:$ck}')" \
    "f17:armC:reconcile:${RUN_TAG}" >/dev/null
  t1="$(date +%s%3N)"
  reconcile_ms=$((t1 - t0))
  reconcile_per_sec=$(awk -v ms="$reconcile_ms" -v n="$c_total" 'BEGIN{printf "%.2f", (ms>0)?(n*1000.0/ms):0}')

  resolvable_now="$(pg_sql "SELECT \"internalOrderId\" FROM returns WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"externalOrderId\"='$c_resolvable_ext'")"
  permanent_orphans_after="$(pg_sql "SELECT COUNT(*) FROM returns WHERE \"sourceConnectionId\"='$ALLEGRO_A_CONNECTION_ID' AND \"externalOrderId\" LIKE '${c_prefix}-orphan-%' AND \"internalOrderId\" IS NULL")"

  log "arm C: after reconcile (${reconcile_ms}ms, ~${reconcile_per_sec}/sec against $c_total candidates) - resolvable return internalOrderId=${resolvable_now:-<null>}, permanent orphans still orphaned=$permanent_orphans_after/$ARM_C_ORPHANS"

  if [ "${resolvable_now:-}" = "$c_order_id" ] && [ "${permanent_orphans_after:-0}" -eq "$ARM_C_ORPHANS" ]; then
    ARM_C_OK=1
    log "arm C VALID: the resolvable return was attributed to $c_order_id once its identifier_mappings row existed, and every permanent orphan (no such row exists or ever will) was correctly left alone"
  else
    warn "arm C DISCARDED: expected resolvable internalOrderId=$c_order_id and permanentOrphansAfter=$ARM_C_ORPHANS, got resolvable=${resolvable_now:-<null>} permanentOrphansAfter=${permanent_orphans_after:-0}"
  fi
  printf 'armC-orphan-reconcile total=%s elapsedMs=%s perSec=%s resolvableAttributed=%s permanentOrphansAfter=%s ok=%s\n' \
    "$c_total" "$reconcile_ms" "$reconcile_per_sec" "$([ "${resolvable_now:-}" = "$c_order_id" ] && echo yes || echo no)" "${permanent_orphans_after:-0}" "$ARM_C_OK" >> "$ARM_RESULTS_FILE"
else
  log "--- arm C: skipped (smoke mode) ---"
fi

window_stop "$RESULTS_DIR"

# ---------------------------------------------------------------------------
# Verdict - arms B (blocked-vs-clean restock) and C (attributed-vs-orphan)
# are this scenario's own correctness guards, each already exercising both
# directions internally. Arm A is a throughput measurement and never gates
# the verdict.
# ---------------------------------------------------------------------------
if [ "$SMOKE" = 1 ]; then
  log "smoke run - no verdict written (never produces a measurement, per this scenario's own header)"
elif [ "$ARM_B_OK" = "1" ] && [ "$ARM_C_OK" = "1" ]; then
  verdict_write "$RESULTS_DIR" VALID
elif [ "$ARM_B_OK" != "1" ]; then
  verdict_write "$RESULTS_DIR" DISCARDED "arm-b-custody-blocked-restock-failed"
else
  verdict_write "$RESULTS_DIR" DISCARDED "arm-c-orphan-reconcile-attribution-failed"
fi

log "results: $RESULTS_DIR"
cat "$ARM_RESULTS_FILE"
