#!/usr/bin/env bash
#
# F5 - operator read path at row count (#2843, epic #2840).
#
# Measures the routes an operator actually browses (orders list + filtered
# list, order detail, products list + detail, jobs dashboard, plus the app
# shell's own nav-probe fan-out) at three dataset sizes, using the #2849
# set-based seeders. Sources lib.sh (#2841) for every guard/manifest/sampler
# primitive and seed/seed-lib.sh (#2849) for pg_sql/seed_sql/refuse helpers -
# this script owns none of that.
#
# Unlike F2/F3, this scenario is READ-ONLY and NEVER purges or requires an
# empty sync_jobs queue: the whole point (#2843's own AC) is to measure
# against a real seeded history, not a purged fixture. `guard_queue_empty`
# and `guard_runner_state` are therefore deliberately NOT called.
#
# Usage: ./f5-read-path.sh [--smoke]
#   (default)  three size steps (10k/100k/1M order_records), each seeded,
#              analyzed, measured via k6, and captured via pg_stat_statements
#              + representative EXPLAIN.
#   --smoke    one tiny size step (200 orders) - proves the moving parts,
#              produces no dated report.
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_LOG_PREFIX="f5"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"
SEED_DIR="$SCRIPT_DIR/../seed"
# shellcheck disable=SC1091
source "$SEED_DIR/seed-lib.sh"
DRIVERS_DIR="$SCRIPT_DIR/../drivers"

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

K6_IMAGE="${K6_IMAGE:-grafana/k6:1.0.0}"
OL_API_INTERNAL_PORT="${OL_API_INTERNAL_PORT:-3000}"
STATEMENT_TIMEOUT_MS="${STATEMENT_TIMEOUT_MS:-30000}"
SAMPLE_SIZE="${SAMPLE_SIZE:-200}"

resolve_docker_network() {
  local net
  net="$(docker inspect -f '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "$OL_API_CONTAINER" 2>/dev/null | head -1)"
  [ -n "$net" ] || die "resolve_docker_network: could not read a network for $OL_API_CONTAINER - is it running?"
  printf '%s' "$net"
}
K6_NETWORK="${K6_NETWORK:-$(resolve_docker_network)}"
TARGET_URL="http://$OL_API_CONTAINER:$OL_API_INTERNAL_PORT/v1"

require_connections
CONN_IDS_CSV="'$PS_CONNECTION_ID','$WC_CONNECTION_ID'"

if [ "$SMOKE" = 1 ]; then
  SIZES=(200)
  LABELS=(smoke)
  TARGET_RATE=3; RAMP_UP_SECS=5; PLATEAU_SECS=10; RAMP_DOWN_SECS=3; PAGE_SHELL_RATE=1
else
  SIZES=(10000 100000 1000000)
  LABELS=(10k 100k 1M)
  # Resume/repair a single size step (#2843: the additive-sizing contract
  # means once the dataset has grown past a size, that size can never be
  # honestly re-measured in the SAME invocation - a later step in the
  # default array would silently measure a smaller label against a bigger
  # table). F5_ONLY_SIZE + F5_ONLY_LABEL together override the whole array
  # to one entry, e.g. F5_ONLY_SIZE=1000000 F5_ONLY_LABEL=1M to redo just
  # the 1M step after fixing something the earlier steps already measured
  # correctly.
  if [ -n "${F5_ONLY_SIZE:-}" ]; then
    [ -n "${F5_ONLY_LABEL:-}" ] || die "F5_ONLY_SIZE set without F5_ONLY_LABEL"
    SIZES=("$F5_ONLY_SIZE")
    LABELS=("$F5_ONLY_LABEL")
  fi
  TARGET_RATE="${TARGET_RATE:-20}"
  RAMP_UP_SECS="${RAMP_UP_SECS:-15}"
  PLATEAU_SECS="${PLATEAU_SECS:-60}"
  RAMP_DOWN_SECS="${RAMP_DOWN_SECS:-10}"
  PAGE_SHELL_RATE="${PAGE_SHELL_RATE:-2}"
fi

# ---------------------------------------------------------------------------
# statement_timeout on the API's OWN db role (#2843 AC) - the runaway query
# is issued by the api's pool connection, not by a session this scenario
# controls, so a client-side timeout bounds nothing. ALTER ROLE ... SET
# applies to NEW sessions only, so the api is restarted to pick it up -
# acceptable here because this is a read-only scenario with nothing in
# flight to lose.
# ---------------------------------------------------------------------------
apply_statement_timeout() {
  pg_sql_write "ALTER ROLE \"$PG_USER\" SET statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'" >/dev/null
  log "statement_timeout=${STATEMENT_TIMEOUT_MS}ms set on role $PG_USER - restarting $OL_API_CONTAINER so its pool picks it up"
  docker restart "$OL_API_CONTAINER" >/dev/null
  # A readiness POLL, not a retry of ol_login itself: ol_login DIES on a
  # failed attempt (it is written for the "the API must already be up"
  # case), so looping on it directly would exit(1) the WHOLE SCRIPT the
  # first time it caught the container mid-restart, silently - the process
  # simply vanishes with no FATAL line, because die's stderr is what a naive
  # retry loop is tempted to redirect away. Poll a raw curl status instead,
  # which only ever returns a number, then call ol_login exactly once for
  # real once the API answers.
  local tries=0 http_status ready=0
  while [ "$ready" = 0 ]; do
    http_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 \
      -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
      -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}" 2>/dev/null || printf '000')"
    case "$http_status" in
      200|201) ready=1 ;;
      *)
        tries=$((tries + 1))
        [ "$tries" -lt 60 ] || die "apply_statement_timeout: $OL_API_CONTAINER did not answer login (last status=$http_status) within 60x2s after restart"
        sleep 2
        ;;
    esac
  done
  ol_login
  log "apply_statement_timeout ok ($OL_API_CONTAINER back up, logged in, ${tries} readiness poll(s))"
}

# sample_ids <out_json> - a small id pool for k6's order_detail/product_detail
# routes, drawn with ORDER BY random() (a one-time setup cost, outside the
# measurement window - not the thing being measured).
sample_ids() {
  local out="$1" order_ids product_ids
  order_ids="$(pg_sql "SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT \"internalOrderId\" AS x FROM order_records WHERE \"internalOrderId\" LIKE 'perfseed_ord_%' ORDER BY random() LIMIT $SAMPLE_SIZE) t")"
  product_ids="$(pg_sql "SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT id AS x FROM products WHERE id LIKE 'perfseed_product_%' ORDER BY random() LIMIT $SAMPLE_SIZE) t")"
  jq -n --argjson o "$order_ids" --argjson p "$product_ids" '{orderIds: $o, productIds: $p}' > "$out"
  local n_o n_p
  n_o="$(jq '.orderIds | length' "$out")"; n_p="$(jq '.productIds | length' "$out")"
  [ "$n_o" -gt 0 ] || die "sample_ids: 0 order ids sampled - did seed-orders.sh run?"
  [ "$n_p" -gt 0 ] || die "sample_ids: 0 product ids sampled - did seed-catalogue.sh run?"
  log "sample_ids ok (orderIds=$n_o productIds=$n_p)"
}

# top_queries <out_file> - top 20 by total_time, EXCLUDING this scenario's
# own sampler query and its seeder statements BY QUERY TEXT (#2843 AC:
# "the sampler's own statements are excluded ... and recorded in the
# manifest as excluded").
EXCLUDED_QUERY_PATTERNS=(
  '%connection_sync_status%'
  '%sync_jobs%WHERE%connectionId%IN%'
  '%perfseed%'
  '%pg_stat_statements%'
  '%VACUUM%'
)
top_queries() {
  local out="$1" where clause
  clause=""
  for p in "${EXCLUDED_QUERY_PATTERNS[@]}"; do
    clause="$clause AND query NOT ILIKE '$p'"
  done
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -F $'\t' -c \
    "SELECT calls, round(total_exec_time::numeric,2) AS total_ms, round(mean_exec_time::numeric,3) AS mean_ms, left(query,300) FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' $clause ORDER BY total_exec_time DESC LIMIT 20" \
    > "$out" 2>&1 || warn "top_queries: pg_stat_statements read failed - is the extension created? (see $out)"
}

# explain_representative <out_file> - the #2843 documented-unindexed sites
# this dataset can actually exercise this week (order-side + the two
# catalogue-side sites #2849 already seeds - identifier_mappings paged scan,
# inventory grouping is EXCLUDED per the issue's own text: "an operator-run
# diagnostic rather than a page on the operator read path"). offer_mappings
# ILIKE search and destination_categories trigram search need Offer /
# DestinationCategory rows this pass does not seed - deferred, named in the
# report rather than silently skipped.
explain_representative() {
  local out="$1"
  {
    echo "=== orders health=needs_attention filter (order-record.repository.ts HAS_FAILED/NOT_MAPPING_OR_DELETED, non-sargable jsonb containment) ==="
    docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM order_records rec WHERE NOT (rec.\"recordStatus\"='awaiting_mapping') AND NOT (rec.\"recordStatus\"='source_deleted') AND rec.\"syncStatus\" @> '[{\"status\":\"failed\"}]'::jsonb ORDER BY rec.\"createdAt\" DESC LIMIT 20" 2>&1
    echo
    echo "=== identifier_mappings paged scan (identifier-mapping.repository.ts findByEntityTypeAndConnection - ordered by externalId, NOT indexed for this partition, #2219) ==="
    docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM identifier_mappings WHERE \"entityType\"='Product' AND \"connectionId\"='$PS_CONNECTION_ID' ORDER BY \"externalId\" ASC LIMIT 500 OFFSET 0" 2>&1
    echo
    echo "=== products list (products.controller.ts listProducts base query) ==="
    docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM products ORDER BY \"createdAt\" DESC LIMIT 20 OFFSET 0" 2>&1
    echo
    echo "=== sync_jobs dashboard list (status='dead' filter, the jobs dashboard's own probe shape) ==="
    docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM sync_jobs WHERE status='dead' ORDER BY \"createdAt\" DESC LIMIT 20" 2>&1
    echo
    echo "=== DEFERRED (no data seeded this pass, named rather than silently skipped) ==="
    echo "offer_mappings ILIKE search (offer-mapping.repository.ts:429-438) - needs Offer/OfferMapping rows, not part of #2849's catalogue seed"
    echo "destination_categories trigram search (destination-category.repository.ts:146) - needs DestinationCategory rows, not part of #2849's catalogue seed"
    echo "inventory_items.findDuplicatePositions (:627) - EXCLUDED PER #2843's OWN TEXT: 'an operator-run diagnostic rather than a page on the operator read path'"
  } > "$out"
}

run_k6() {
  local ids_file="$1" label="$2" summary_out="$3" raw_out="$4" ids_dir summary_dir
  ids_dir="$(cd "$(dirname "$ids_file")" && pwd)"
  summary_dir="$(cd "$(dirname "$summary_out")" && pwd)"
  docker run --rm --network "$K6_NETWORK" --user "$(id -u):$(id -g)" \
    -v "$ids_dir":/ids -v "$summary_dir":/results -v "$DRIVERS_DIR":/drivers:ro \
    -e "API_BASE_URL=$TARGET_URL" \
    -e "TOKEN=$OL_TOKEN" \
    -e "IDS_FILE=/ids/$(basename "$ids_file")" \
    -e "DATASET_LABEL=$label" \
    -e "TARGET_RATE=$TARGET_RATE" -e "RAMP_UP_SECS=$RAMP_UP_SECS" -e "PLATEAU_SECS=$PLATEAU_SECS" -e "RAMP_DOWN_SECS=$RAMP_DOWN_SECS" \
    -e "PAGE_SHELL_RATE=$PAGE_SHELL_RATE" \
    "$K6_IMAGE" run \
      --summary-export="/results/$(basename "$summary_out")" \
      --out "json=/results/$(basename "$raw_out")" \
      /drivers/read-path.js
}

# ---------------------------------------------------------------------------
# Per-route sample-size honesty (coordinator review, post smoke-run).
#
# A percentile computed over a handful of samples is not a percentile - it
# is an order statistic of a tiny set that LOOKS like one ("p95 of n=3 is
# the second-largest of three numbers"). Below MIN_N_FOR_PERCENTILE this
# report prints the RAW per-request observations instead of a percentile
# table row, so a thin route is visibly thin rather than quietly reported
# as a plausible-looking number. Below MIN_N_FOR_STABLE_P99, percentiles ARE
# printed (n is enough for p50/p95 to mean something) but p99 is flagged as
# unstable - order-statistics folklore puts a trustworthy tail estimate
# around n>=100 for the 99th percentile specifically.
#
# k6's own default `ramping-arrival-rate` load is CONSTANT across dataset
# sizes (same TARGET_RATE/PLATEAU_SECS/weight at 10k, 100k and 1M), so n per
# route is a property of (rate x duration x weight), not of row count - it
# does not shrink as the dataset grows. That is asserted here, not assumed:
# every route's n is READ from this run's own k6-summary.json and reported,
# never carried over from a different size step.
# ---------------------------------------------------------------------------
MIN_N_FOR_PERCENTILE="${MIN_N_FOR_PERCENTILE:-30}"
MIN_N_FOR_STABLE_P99="${MIN_N_FOR_STABLE_P99:-100}"

# All named Trend metrics k6-summary.json carries, in the order the report
# should render them - page_shell_total FIRST (#2843 coordinator review:
# "lead with that one... the shell total is the symptom, the per-route
# split is the diagnosis"), then the six browse-mix routes, then the
# page-shell's own per-request breakdown.
REPORT_METRICS=(
  page_shell_total_duration_ms
  route_orders_list_duration_ms
  route_orders_list_needs_attention_duration_ms
  route_order_detail_duration_ms
  route_products_list_duration_ms
  route_product_detail_duration_ms
  route_sync_jobs_list_duration_ms
  page_shell_request_duration_ms
)

# emit_route_report <summary_json> <raw_json> <out_txt>
emit_route_report() {
  local summary="$1" raw="$2" out="$3" m n p50 p95 p99 note raws
  {
    printf '# Per-route latency - MIN_N_FOR_PERCENTILE=%s, MIN_N_FOR_STABLE_P99=%s\n\n' \
      "$MIN_N_FOR_PERCENTILE" "$MIN_N_FOR_STABLE_P99"
    for m in "${REPORT_METRICS[@]}"; do
      n="$(jq -r --arg k "$m" '.metrics[$k].count // 0' "$summary" 2>/dev/null || echo 0)"
      if [ "${n:-0}" -eq 0 ]; then
        printf '%-55s n=0 (metric absent - route never sampled this window)\n' "$m"
        continue
      fi
      if [ "$n" -lt "$MIN_N_FOR_PERCENTILE" ]; then
        raws="$(jq -r --arg m "$m" 'select(.type=="Point" and .metric==$m) | .data.value' "$raw" 2>/dev/null | tr '\n' ' ')"
        printf '%-55s n=%-5s BELOW threshold (%s) - raw observations (ms): %s\n' "$m" "$n" "$MIN_N_FOR_PERCENTILE" "$raws"
      else
        p50="$(jq -r --arg k "$m" '.metrics[$k].med' "$summary")"
        p95="$(jq -r --arg k "$m" '.metrics[$k]["p(95)"]' "$summary")"
        p99="$(jq -r --arg k "$m" '.metrics[$k]["p(99)"]' "$summary")"
        note=""
        [ "$n" -lt "$MIN_N_FOR_STABLE_P99" ] && note=" (p99 UNSTABLE: n<$MIN_N_FOR_STABLE_P99)"
        printf '%-55s n=%-5s p50=%-8.2f p95=%-8.2f p99=%-8.2f%s\n' "$m" "$n" "$p50" "$p95" "$p99" "$note"
      fi
    done
  } > "$out"
  log "wrote $out"
}

# ---------------------------------------------------------------------------
# run_size <target_orders> <label>
# ---------------------------------------------------------------------------
run_size() {
  local target="$1" label="$2" dir sync_jobs_at_start n_orders n_lines n_syncjobs

  log "=== size step: target=$target label=$label ==="
  TARGET_ORDERS="$target" bash "$SEED_DIR/seed-orders.sh"

  # Fresh stats + reset right before the window (#2843/#2849 AC), even if
  # this step's seed call was a no-op (dataset already at/above target from
  # an earlier invocation of this script) - the seed script only resets
  # stats when IT does the inserting.
  pg_sql_write "VACUUM ANALYZE order_records" >/dev/null
  pg_sql_write "VACUUM ANALYZE order_line_items" >/dev/null
  pg_sql_write "SELECT pg_stat_statements_reset()" >/dev/null 2>&1 || true

  apply_statement_timeout

  dir="$(results_dir_init f5-read-path "$label")"
  sample_ids "$dir/sample-ids.json"

  n_orders="$(pg_sql "SELECT COUNT(*) FROM order_records WHERE \"internalOrderId\" LIKE 'perfseed_ord_%'")"
  n_lines="$(pg_sql "SELECT COUNT(*) FROM order_line_items WHERE \"orderRecordId\" LIKE 'perfseed_ord_%'")"
  n_syncjobs="$(pg_sql "SELECT COUNT(*) FROM sync_jobs")"

  # #3024 - the additive seeder above is a no-op once the dataset is already
  # at/above target (its own header comment says so), so a step run out of
  # order (F5_ONLY_SIZE resuming a single step, or a re-run against a stand
  # a bigger step already grew) would otherwise silently measure the WRONG
  # row count under this label and still report VALID - nothing about that
  # produces a non-2xx response for the "did k6 stay mostly within 2xx"
  # check below to catch. Checked here, BEFORE `extra` is assembled and
  # BEFORE window_start (#3025 review, SUGGESTION - moved up from after
  # `extra`): the assembly below uses `--argjson n_orders "$n_orders"`, which
  # requires a syntactically valid JSON number, so a failed pg_sql read
  # (empty `$n_orders`) used to abort THIS FUNCTION inside jq with a bare
  # "Invalid numeric literal" - never reaching check_row_count_target's own
  # "actual is not a readable row count" branch at all, despite that branch
  # being unit-tested (lib-test.sh: `check_row_count_target '' 10000`).
  # Running the guard first makes that branch genuinely reachable here and
  # gives the actionable diagnostic instead of a jq parse error. A
  # known-mismeasured arm never pays for a k6 window it cannot honestly
  # report: refuse the arm rather than measure it (#3024 AC - shrinking the
  # table back down is the alternative, and is not this scenario's call to
  # make on a table seed-orders.sh documents as shared/additive across
  # steps).
  local row_count_check
  row_count_check="$(check_row_count_target "$n_orders" "$target" "${F5_ROW_COUNT_TOLERANCE_PCT:-1}")"
  if [ "$row_count_check" != "ok" ]; then
    warn "size step target=$target label=$label: $row_count_check"
    # A minimal, empty-safe extra: `--arg` (string) tolerates a blank
    # `$n_orders` where `--argjson` (this branch's whole reason for existing)
    # would refuse to build at all.
    local discard_extra
    discard_extra="$(jq -n --arg label "$label" --argjson target "$target" --arg n_orders "$n_orders" \
      '{f5: {datasetLabel: $label, targetOrders: $target, rowCounts: {order_records: $n_orders}}}')"
    manifest_write "$dir" f5-read-path "$CONN_IDS_CSV" "$SMOKE" "$discard_extra"
    verdict_write "$dir" DISCARDED "$row_count_check"
    log "size step DISCARDED: $dir ($row_count_check) - no k6 load was run against this mismeasured arm"
    return
  fi

  local extra
  extra="$(jq -n \
    --arg label "$label" --argjson target "$target" \
    --argjson n_orders "$n_orders" --argjson n_lines "$n_lines" --argjson n_syncjobs "$n_syncjobs" \
    --arg rng_seed "$SEED_RNG" --arg statement_timeout_ms "$STATEMENT_TIMEOUT_MS" \
    '{f5: {datasetLabel: $label, targetOrders: $target, rowCounts: {order_records: $n_orders, order_line_items: $n_lines, sync_jobs: $n_syncjobs}, seedRngSeed: $rng_seed, statementTimeoutMs: $statement_timeout_ms}}')"

  window_start "$dir" f5-read-path "$CONN_IDS_CSV" "$SMOKE" "$extra"
  run_k6 "$dir/sample-ids.json" "$label" "$dir/k6-summary.json" "$dir/k6-raw.json"
  window_stop "$dir"

  top_queries "$dir/top-queries.txt"
  explain_representative "$dir/explain.txt"
  emit_route_report "$dir/k6-summary.json" "$dir/k6-raw.json" "$dir/route-report.txt"

  # Simple pass/fail note (this scenario has no job dispatch, so the
  # job-oriented run_post_guards/verdict_write machinery does not apply -
  # #2843's own verdict is "did k6 complete and stay mostly within 2xx").
  # k6-summary.json's Trend/Counter entries are FLAT ({"count":N,"med":...}),
  # never nested under a `.values` key (found live, #2843: an earlier draft
  # of this line read `.value.values.count`, which is always null against
  # the real shape and silently reported total_route_requests=0 forever).
  local non2xx total
  non2xx="$(jq -r '.metrics.non_2xx_responses.count // 0' "$dir/k6-summary.json" 2>/dev/null || echo 0)"
  total="$(jq -r '[.metrics | to_entries[] | select(.key | startswith("route_")) | .value.count // 0] | add // 0' "$dir/k6-summary.json" 2>/dev/null || echo 0)"
  # Written through verdict_write rather than by hand (#3009): it is the single
  # verdict writer, and only it refuses to overwrite a SUPERSEDED verdict. A
  # hand-rolled block here could silently put VALID back on a withdrawn run.
  # The emitted file is unchanged in shape - status, generatedAt, one
  # informational reason - and carries no `guard=` lines, correctly, because
  # this scenario runs no post-guard chain.
  verdict_write "$dir" VALID "non2xx=$non2xx total_route_requests=$total"

  log "size step done: $dir (non2xx=$non2xx / $total route requests)"
}

guard_stand_exclusive "f5-operator-read"
guard_build
guard_scheduler_off
guard_demo_mode_off
guard_connection_budget
guard_pool_recorded
guard_log_level
ol_login

for i in "${!SIZES[@]}"; do
  run_size "${SIZES[$i]}" "${LABELS[$i]}"
done

log "f5-read-path done (${#SIZES[@]} size step(s): ${LABELS[*]})"
