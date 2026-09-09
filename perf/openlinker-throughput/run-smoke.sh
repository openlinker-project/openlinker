#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
set -a
# shellcheck disable=SC1091
. ./stand-ids.env
set +a
export PS_WS_KEY="$PS_WEBSERVICE_KEY"
export OL_API_URL="${OL_API_URL:-http://127.0.0.1:19000}"
exec ./scenarios/f11-concurrent-multichannel.sh --smoke
