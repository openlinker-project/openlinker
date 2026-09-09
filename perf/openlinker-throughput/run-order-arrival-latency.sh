#!/usr/bin/env bash
#
# Task 1 runner (#2840): F1's serial latency arm with the scheduler ON, so
# hop A is the real */1 poll wait rather than a cadence the harness chose.
#
# Exports the `lab` stand's container names the way run-retest.sh /
# run-f10.sh do, so the scenario invocation itself stays one line.
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
export PS_CONNECTION_ID WC_CONNECTION_ID ALLEGRO_A_CONNECTION_ID ALLEGRO_B_CONNECTION_ID

# The measurement's own knobs.
export F1_SCHEDULER_ON=1
export LATENCY_SAMPLES="${LATENCY_SAMPLES:-25}"
# The lock carries no heartbeat, so it must outlast the whole run: 25 serial
# samples at up to ~60s of poll wait plus the ladder, plus arrange/teardown.
export OL_STAND_LOCK_TTL_SECS="${OL_STAND_LOCK_TTL_SECS:-5400}"

exec bash "$HERE/scenarios/f1-order-ingestion.sh" --latency-only
