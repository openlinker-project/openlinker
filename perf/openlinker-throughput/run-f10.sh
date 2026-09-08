#!/usr/bin/env bash
#
# F10 run wrapper (#2978). Chunked deliberately: thirteen windows in one
# invocation is roughly an hour of held lock, and a failure at window eleven
# would cost the ten before it. Each chunk takes and releases the stand lock
# on its own and shares one RUN_LABEL, so the results land in one directory.
#
#   ./run-f10.sh destination   baseline D1 D2a D2b D3 D4
#   ./run-f10.sh marketplace   M1 M2 M2t M3
#   ./run-f10.sh infra         I1 I2 I3
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PS_CONTAINER=lab-prestashop PS_MYSQL_CONTAINER=lab-mysql WC_CONTAINER=lab-woocommerce
export PG_CONTAINER=lab-postgres REDIS_CONTAINER=lab-redis OL_API_CONTAINER=lab-api
export WORKER_CONTAINERS=lab-worker-1 OL_API_URL=http://127.0.0.1:19000
export OL_ADMIN_USER=admin OL_ADMIN_PASSWORD=admin
# shellcheck disable=SC1091
source "$HERE/stand-ids.env"
export PS_CONNECTION_ID WC_CONNECTION_ID ALLEGRO_A_CONNECTION_ID ALLEGRO_B_CONNECTION_ID

export RUN_LABEL="${RUN_LABEL:-f10-2026-09-07}"

case "${1:?usage: run-f10.sh destination|marketplace|infra|all}" in
  destination) FAULTS="baseline,D1,D2a,D2b,D3,D4" ;;
  marketplace) FAULTS="M1,M2,M2t,M3" ;;
  infra)       FAULTS="I1,I2,I3" ;;
  all)         FAULTS="baseline,D1,D2a,D2b,D3,D4,M1,M2,M2t,M3,I1,I2,I3" ;;
  *)           FAULTS="$1" ;;
esac

exec bash "$HERE/scenarios/f10-dependency-failure.sh" --faults="$FAULTS"
