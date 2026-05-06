#!/bin/sh
# Set PLN as the dev shop's default currency (#521).
# Thin wrapper that execs the PHP companion — see 20-set-default-currency.php
# for the actual ObjectModel-based logic. Idempotent.
set -e

if ! command -v php >/dev/null 2>&1; then
    echo "FATAL: php CLI not found in container; cannot run currency seed" >&2
    exit 1
fi

# Run as www-data (matches the install phase on docker_run.sh:89). PrestaShop's
# legacy bootstrap warms `var/cache/prod/` on first call; if we run as root the
# cache files end up root-owned and Apache (www-data) hits 500s on every page.
exec runuser -g www-data -u www-data -- php -d memory_limit=256M /tmp/post-install-lib/20-set-default-currency.php
