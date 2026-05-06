#!/bin/sh
# Seed the dev shop with five real-data fixtures from Allegro listings (#521).
# Thin wrapper that execs the PHP companion — see 30-seed-test-products.php
# for the actual ObjectModel-based logic. Idempotent.
set -e

if ! command -v php >/dev/null 2>&1; then
    echo "FATAL: php CLI not found in container; cannot run product seed" >&2
    exit 1
fi

# Run as www-data (matches the install phase on docker_run.sh:89). See
# 20-set-default-currency.sh for rationale (cache ownership).
exec runuser -g www-data -u www-data -- php -d memory_limit=256M /tmp/post-install-lib/30-seed-test-products.php
