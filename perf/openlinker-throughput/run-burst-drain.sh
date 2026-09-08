#!/usr/bin/env bash
#
# Task 2 runner (#2840): burst above capacity, then drain below it.
#
# Rates are derived from arm B's MEASURED drain of ~986 orders/h
# (results-mixed-load-fixed-2026-09-08.md § 2.2):
#   burst  50/min = 3 000/h = 3.04x drain
#   drain   8/min =   480/h = 0.49x drain
# MIXED_ORDERS_PER_MIN is an integer count per one-minute tick, so the
# reachable rates are multiples of 60/h and neither target is expressible
# exactly; both roundings are toward the stated multiple, not away from it.
#
# The destination fault is OFF (MIXED_FAULT_AT_SECS=0). A fault guarantees a
# backlog and would confound the one thing this window is measuring - whether
# the queue converges once the offered rate drops below capacity. #2978 and
# arm B already cover fault behaviour.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PS_CONTAINER="${PS_CONTAINER:-lab-prestashop}"
export PS_MYSQL_CONTAINER="${PS_MYSQL_CONTAINER:-lab-mysql}"
export WC_CONTAINER="${WC_CONTAINER:-lab-woocommerce}"
export PG_CONTAINER="${PG_CONTAINER:-lab-postgres}"
export REDIS_CONTAINER="${REDIS_CONTAINER:-lab-redis}"
export OL_API_CONTAINER="${OL_API_CONTAINER:-lab-api}"
export OL_API_URL="${OL_API_URL:-http://127.0.0.1:19000}"
export OL_ADMIN_USER="${OL_ADMIN_USER:-admin}"
export OL_ADMIN_PASSWORD="${OL_ADMIN_PASSWORD:-admin}"
export WORKER_CONTAINERS="${WORKER_CONTAINERS-lab-worker-1}"

# shellcheck disable=SC1091
source "$HERE/stand-ids.env"
export PS_CONNECTION_ID WC_CONNECTION_ID ALLEGRO_A_CONNECTION_ID ALLEGRO_B_CONNECTION_ID WEBHOOK_CONNECTION_ID

BURST_SECS="${BURST_SECS:-1800}"
DRAIN_SECS="${DRAIN_SECS:-5400}"
export MIXED_RAMP="${MIXED_RAMP:-burst:50:$BURST_SECS,drain:8:$DRAIN_SECS}"
export MIXED_SAMPLE_INTERVAL_SECS="${MIXED_SAMPLE_INTERVAL_SECS:-30}"
export MIXED_FAULT_AT_SECS="${MIXED_FAULT_AT_SECS:-0}"
export MIXED_TENANT="${MIXED_TENANT:-perf-allegro-a}"
# No artificial starting backlog: the burst must be the only thing that makes
# one, or AC1 cannot distinguish a queue the burst built from one it inherited.
export MIXED_PRIME_ORDERS="${MIXED_PRIME_ORDERS:-1}"
# The lock has no heartbeat and this window is hours long.
export OL_STAND_LOCK_TTL_SECS="${OL_STAND_LOCK_TTL_SECS:-$(( BURST_SECS + DRAIN_SECS + 5400 ))}"

exec bash "$HERE/scenarios/sustained-mixed-load.sh"
