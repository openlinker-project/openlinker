#!/usr/bin/env bash
#
# run-retest.sh <scenario.sh> [args...] - the #2840 clean-window retest's
# stand-identity wrapper.
#
# It is not a scenario. It exports the `lab` stand's container names and API
# coordinates, sources the generated `stand-ids.env`, and forwards to a
# scenario under `scenarios/`. Every measurement decision stays in the
# scenario; this file exists so a multi-phase run (see `run-retest-chain.sh`)
# does not repeat twelve exports per phase.
#
# NOTHING here is hard-coded that `bootstrap.sh` generates. Connection ids and
# the PrestaShop webservice key come from `stand-ids.env`, which is generated
# and gitignored - committing a copy of them would put a stand credential in
# the repository and would go stale the first time anyone re-bootstraps.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PS_CONTAINER="${PS_CONTAINER:-lab-prestashop}"
export PS_MYSQL_CONTAINER="${PS_MYSQL_CONTAINER:-lab-mysql}"
export WC_CONTAINER="${WC_CONTAINER:-lab-woocommerce}"
export PG_CONTAINER="${PG_CONTAINER:-lab-postgres}"
export REDIS_CONTAINER="${REDIS_CONTAINER:-lab-redis}"
export OL_API_CONTAINER="${OL_API_CONTAINER:-lab-api}"
export OL_API_URL="${OL_API_URL:-http://127.0.0.1:19000}"
export OL_ADMIN_USER="${OL_ADMIN_USER:-admin}"
export OL_ADMIN_PASSWORD="${OL_ADMIN_PASSWORD:-admin}"

# `${VAR-default}`, NOT `${VAR:-default}`. The colon form substitutes the
# default when the variable is unset OR EMPTY, and an explicitly-empty
# WORKER_CONTAINERS is the documented way to make lib.sh discover the replicas
# itself (`_ensure_worker_containers` branches on `[ -z "$WORKER_CONTAINERS" ]`).
# Under the colon form a 3-replica run silently pins itself to lab-worker-1 and
# every per-worker guard - the degradation count included - inspects one worker
# of three and reports a third of the truth, with nothing in the output saying
# so. Same trap `limiter-ab.sh` records against its own ARM_SPECS.
export WORKER_CONTAINERS="${WORKER_CONTAINERS-lab-worker-1}"

# Defaults to this checkout's own generated file. `STAND_IDS_FILE` overrides it,
# which is needed whenever the scenario is run from a DIFFERENT working tree
# than the one that bootstrapped the stand - a normal situation on a machine
# carrying several worktrees, and the same reason the scenarios discover the
# stand's compose project from the running worker's labels rather than assuming
# it is the checkout they were launched from.
STAND_IDS="${STAND_IDS_FILE:-$SCRIPT_DIR/stand-ids.env}"
[ -f "$STAND_IDS" ] || {
  echo "run-retest.sh: stand ids not found at $STAND_IDS.
  Run bootstrap.sh (it generates the file, which is gitignored), or point
  STAND_IDS_FILE at the checkout that did." >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
. "$STAND_IDS"
set +a

exec "$SCRIPT_DIR/scenarios/$1" "${@:2}"
