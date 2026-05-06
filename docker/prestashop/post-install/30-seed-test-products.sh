#!/bin/sh
# Seed the dev shop with five real-data fixtures from Allegro listings (#521).
# Thin wrapper that execs the PHP companion — see 30-seed-test-products.php
# for the actual ObjectModel-based logic. Idempotent.
set -e

if ! command -v php >/dev/null 2>&1; then
    echo "FATAL: php CLI not found in container; cannot run product seed" >&2
    exit 1
fi

exec php -d memory_limit=256M /tmp/post-install-lib/30-seed-test-products.php
