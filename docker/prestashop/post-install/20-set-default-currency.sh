#!/bin/sh
# Set PLN as the dev shop's default currency (#521).
# Thin wrapper that execs the PHP companion — see 20-set-default-currency.php
# for the actual ObjectModel-based logic. Idempotent.
set -e

if ! command -v php >/dev/null 2>&1; then
    echo "FATAL: php CLI not found in container; cannot run currency seed" >&2
    exit 1
fi

SCRIPT_DIR=$(dirname "$0")
exec php -d memory_limit=256M "$SCRIPT_DIR/20-set-default-currency.php"
