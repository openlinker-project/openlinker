#!/bin/sh
# Make the shop reachable from the app-tier containers on the compose network (#1368).
# Thin wrapper that execs the PHP companion — see 40-configure-container-network.php
# for the actual ObjectModel-based logic. Idempotent.
set -e

if ! command -v php >/dev/null 2>&1; then
    echo "FATAL: php CLI not found in container; cannot run container-network config" >&2
    exit 1
fi

# Run as www-data (matches the install phase on docker_run.sh:89). See
# 20-set-default-currency.sh for rationale (cache ownership).
exec runuser -g www-data -u www-data -- php -d memory_limit=256M /tmp/post-install-lib/40-configure-container-network.php
