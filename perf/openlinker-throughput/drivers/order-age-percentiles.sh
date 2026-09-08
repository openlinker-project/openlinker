#!/usr/bin/env bash
#
# Per-order END-TO-END AGE percentiles (#2840).
#
# The operator-visible number, and the one a burst-then-drain window exists to
# produce: what does the Nth order in a spike actually experience.
#
# The measure is `order_records."createdAt" - order_records."placedAt"`:
#   placedAt  the SOURCE's own placement instant, denormalised onto the row at
#             write time by #1985.
#   createdAt when the order became visible in OpenLinker.
# So this is placement -> visible in OpenLinker, which is exactly the quantity
# a competitor means by "orders appear within N minutes", and exactly the
# quantity the order-arrival-latency window reports as its headline total. The
# two reports are therefore in the same units on purpose.
#
# It is NOT the job service time. A summary p50 over `lastAttemptDurationMs`
# spans every ATTEMPTED row including requeued partial attempts, so it moves
# when the retry mix moves and cannot be substituted for this.
#
# Orders are bucketed by WHEN THEY WERE PLACED, not by when they completed:
# "what did an order placed during the burst experience" is the question, and
# bucketing by completion would put a burst order that finished during the
# drain into the drain's bucket and flatter both.
#
# Usage:
#   order-age-percentiles.sh <src_conn> <window_start_iso> [phase_boundary_iso]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib.sh"

SRC="${1:?usage: order-age-percentiles.sh <src_conn> <window_start_iso> [phase_boundary_iso]}"
WS="${2:?window start iso}"
BOUNDARY="${3:-}"

age_stats() {
  local label="$1" extra="$2"
  pg_sql "SELECT
      COUNT(*),
      COALESCE(ROUND(MIN(EXTRACT(EPOCH FROM (\"createdAt\"-\"placedAt\")))::numeric,1)::text,'-'),
      COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (\"createdAt\"-\"placedAt\")))::numeric,1)::text,'-'),
      COALESCE(ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (\"createdAt\"-\"placedAt\")))::numeric,1)::text,'-'),
      COALESCE(ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (\"createdAt\"-\"placedAt\")))::numeric,1)::text,'-'),
      COALESCE(ROUND(MAX(EXTRACT(EPOCH FROM (\"createdAt\"-\"placedAt\")))::numeric,1)::text,'-')
    FROM order_records
    WHERE \"sourceConnectionId\"='$SRC'
      AND \"createdAt\" >= '$WS'
      AND \"placedAt\" IS NOT NULL
      $extra" \
  | awk -F'|' -v l="$label" '{printf "   %-26s n=%-6s min=%-8s p50=%-9s p90=%-9s p95=%-9s max=%s\n", l, $1, $2, $3, $4, $5, $6}'
}

echo "-- per-order end-to-end age, seconds (placedAt -> createdAt, i.e. placement -> visible in OpenLinker)"
age_stats "all window orders" ""
if [ -n "$BOUNDARY" ]; then
  age_stats "placed during burst" "AND \"placedAt\" < '$BOUNDARY'"
  age_stats "placed during drain" "AND \"placedAt\" >= '$BOUNDARY'"
fi

echo
echo "-- what the Nth order placed in the window experienced (ordered by placedAt)"
pg_sql "WITH w AS (
    SELECT ROW_NUMBER() OVER (ORDER BY \"placedAt\") AS n,
           ROUND(EXTRACT(EPOCH FROM (\"createdAt\"-\"placedAt\"))::numeric,1) AS age_s
    FROM order_records
    WHERE \"sourceConnectionId\"='$SRC' AND \"createdAt\" >= '$WS' AND \"placedAt\" IS NOT NULL)
  SELECT n, age_s FROM w WHERE n IN (1,10,100,250,500,1000,1500,2000) ORDER BY n" \
  | awk -F'|' 'BEGIN{printf "   %-10s %s\n","order #","age_s"} {printf "   %-10s %s\n",$1,$2}'

echo
echo "-- orders PLACED in the window that are still not visible (never completed)"
# Counted from the stub's own minted total is impossible here (this driver does
# not talk to the stub), so this reports the shape it can: orders whose row
# exists but whose recordStatus is not `ready`. A missing row cannot be counted
# from order_records at all, which is stated rather than silently omitted.
pg_sql "SELECT \"recordStatus\", COUNT(*) FROM order_records
        WHERE \"sourceConnectionId\"='$SRC' AND \"createdAt\" >= '$WS'
        GROUP BY \"recordStatus\" ORDER BY 2 DESC" \
  | awk -F'|' '{printf "   %-20s %s\n",$1,$2}'
