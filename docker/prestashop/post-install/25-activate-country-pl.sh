#!/bin/sh
# Activate the Poland (PL) country in the dev shop (#1446).
# PrestaShop ships PL as a country row but leaves it inactive by default, so
# order sync for a PL buyer address fails with "country exists but is not
# active". Thin wrapper that execs the PHP companion — see
# 25-activate-country-pl.php for the actual ObjectModel-based logic. Idempotent.
set -e

if ! command -v php >/dev/null 2>&1; then
    echo "FATAL: php CLI not found in container; cannot run country activation seed" >&2
    exit 1
fi

# Run as www-data (matches the install phase on docker_run.sh:89). See
# 20-set-default-currency.sh for rationale (cache ownership).
exec runuser -g www-data -u www-data -- php -d memory_limit=256M /tmp/post-install-lib/25-activate-country-pl.php
