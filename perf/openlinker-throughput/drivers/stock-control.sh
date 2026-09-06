#!/usr/bin/env bash
#
# F2 driver library (#2848, epic #2840) - stock-control primitives against
# the real PrestaShop master on the `lab` stand. Sourced by
# scenarios/f2-stock-propagation.sh, never run standalone.
#
# Every generic guard/manifest/results primitive lives in lib.sh, per that
# file's own rule; this library owns only what is specific to driving a
# PrestaShop stock write and reading the module's own outbox table -
# neither of which lib.sh (or any other scenario) has a reason to know
# about.
#
# Requires the caller to have already sourced lib.sh (uses its ps_sql /
# ps_sql_write / pg_sql / log / die / iso_now).
#
set -euo pipefail

SC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SC_PHP_DRIVER="$SC_DIR/ps-set-quantity.php"
[ -f "$SC_PHP_DRIVER" ] || die "stock-control.sh: expected driver at $SC_PHP_DRIVER"

# ---------------------------------------------------------------------------
# sc_install_driver - copy the static PHP driver into the PS container.
# Idempotent (docker cp overwrites); called once per scenario run, not per
# write, since the file never changes mid-run.
# ---------------------------------------------------------------------------
sc_install_driver() {
  docker cp "$SC_PHP_DRIVER" "$PS_CONTAINER:/tmp/ps-set-quantity.php"
  log "installed stock-write driver into $PS_CONTAINER:/tmp/ps-set-quantity.php"
}

# ---------------------------------------------------------------------------
# sc_configure_module <connection_id> <secret>
#
# Points the bind-mounted OL module at this OL API + connection + shared
# HMAC secret. Config lives in ps_configuration (MySQL), never PrestaShop's
# admin UI - the module has no CLI config command, and this is the same
# three-key set WebhookSender::sendEvent reads (OPENLINKER_BASE_URL /
# OPENLINKER_CONNECTION_ID / OPENLINKER_WEBHOOK_SECRET,
# classes/WebhookSender.php:97-99).
#
# OL_API_INTERNAL_URL is the docker-network-internal address (api:3000,
# NOT the host-published 127.0.0.1:19000 OL_API_URL) - the PS container is
# not on the host network namespace, same reasoning as F3's TARGET_URL.
# ---------------------------------------------------------------------------
OL_API_INTERNAL_URL="${OL_API_INTERNAL_URL:-http://api:3000}"

sc_configure_module() {
  local connection_id="$1" secret="$2"
  ps_sql_write "UPDATE ps_configuration SET value='$OL_API_INTERNAL_URL' WHERE name='OPENLINKER_BASE_URL'"
  ps_sql_write "UPDATE ps_configuration SET value='$connection_id' WHERE name='OPENLINKER_CONNECTION_ID'"
  ps_sql_write "UPDATE ps_configuration SET value='$secret' WHERE name='OPENLINKER_WEBHOOK_SECRET'"
  log "sc_configure_module ok (connection=$connection_id, baseUrl=$OL_API_INTERNAL_URL)"
}

# sc_cron_token - read the module's own cron token, straight from MySQL.
sc_cron_token() {
  ps_sql "SELECT value FROM ps_configuration WHERE name='OPENLINKER_CRON_TOKEN'"
}

# ---------------------------------------------------------------------------
# sc_set_quantity <id_product> <id_product_attribute> <quantity>
#
# Echoes "T0_EPOCH_MS T1_EPOCH_MS" (see ps-set-quantity.php's own header for
# why these are true UTC epoch ms and the outbox table's own created_at
# column is not).
# ---------------------------------------------------------------------------
sc_set_quantity() {
  local id_product="$1" id_attr="$2" qty="$3" out
  out="$(docker exec "$PS_CONTAINER" php /tmp/ps-set-quantity.php "$id_product" "$id_attr" "$qty")" \
    || die "sc_set_quantity: driver failed for product=$id_product attr=$id_attr qty=$qty: $out"
  local t0 t1
  t0="$(printf '%s\n' "$out" | grep -oP 'T0_EPOCH_MS=\K[0-9]+')"
  t1="$(printf '%s\n' "$out" | grep -oP 'T1_EPOCH_MS=\K[0-9]+')"
  [ -n "$t0" ] && [ -n "$t1" ] || die "sc_set_quantity: could not parse driver output: $out"
  printf '%s %s' "$t0" "$t1"
}

# sc_current_quantity <id_product> <id_product_attribute> - read PrestaShop's
# own current value, so the caller can always write a value that GENUINELY
# differs (PrestaShop's own quantity-changed check, distinct from and
# upstream of OL's own no-change guard, silently no-ops the hook otherwise -
# confirmed live on this stand: a same-value PUT produces zero outbox rows).
sc_current_quantity() {
  local id_product="$1" id_attr="$2"
  ps_sql "SELECT quantity FROM ps_stock_available WHERE id_product=$id_product AND id_product_attribute=$id_attr"
}

# ---------------------------------------------------------------------------
# sc_drain_cron - POST the module's own cron front controller, which is what
# actually delivers the outbox to OL (the response-flush fast path is
# unavailable on this stand: SAPI is apache2handler/mod_php, so
# WebhookSender::fastPathAvailable() is false - verified live, see the
# scenario script's own header). This is the ONE thing standing between an
# outbox row and OL ever seeing it, so cadence is entirely
# harness-controlled here: nothing on this stand's crontab calls this
# endpoint on its own (`docker exec lab-prestashop crontab -l` is empty).
#
# THIS ENDPOINT RETURNS HTTP 500 ON A CORRECT DELIVERY - a real module bug,
# not a stand artifact, and the two must stay distinguished. The module bug:
# `controllers/front/cron.php`'s success branch never calls `exit` after
# `echo json_encode($stats)` (every ERROR branch does), so PrestaShop's
# FrontController carries on into its ordinary page-render pipeline behind
# the JSON body. The stand condition that turns that into a fatal: this
# image's theme asset-cache directory is not writable, so the render throws
# `MatthiasMullie\Minify\Exceptions\IOException` mid-pipeline - confirmed by
# matching the Apache error-log timestamp to this exact request's access-log
# line and to the delivered outbox row's own `delivered_at`. On a shop whose
# cache dir IS writable the response would still be wrong (JSON followed by
# a full HTML page, which breaks any strict JSON parser) - the stand
# exposed the module bug, it did not cause it.
#
# Because of that, THE CALLER MUST NEVER TRUST THE HTTP STATUS - assert on
# the JSON body's own `delivered`/`failed`/`processed` fields instead (this
# function still returns the status verbatim so a caller CAN log it, but
# treats it as informational only, per the coordinator's review).
#
# Echoes "HTTP_STATUS WALL_MS_BEFORE WALL_MS_AFTER BODY" (space-then-body,
# so a caller reads the first three fields with `read` and keeps the rest).
# ---------------------------------------------------------------------------
sc_drain_cron() {
  local token="$1" before after resp status body
  before="$(($(date +%s%N) / 1000000))"
  resp="$(curl -sS -w '\n%{http_code}' -X POST \
    "http://localhost:${PRESTASHOP_HOST_PORT:-19080}/index.php?fc=module&module=openlinker&controller=cron" \
    -H "X-OpenLinker-Cron-Token: $token")"
  after="$(($(date +%s%N) / 1000000))"
  status="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  printf '%s %s %s %s' "$status" "$before" "$after" "$body"
}

# sc_drain_body_ok <body_json> - the positive assertion sc_drain_cron's own
# header says every caller must make instead of trusting HTTP_STATUS. True
# only when the body parses as JSON and carries an integer `processed` field
# (present on both delivered and empty-batch responses); a truncated or
# non-JSON body (a genuinely broken drain would produce one) fails this.
sc_drain_body_ok() {
  printf '%s' "$1" | jq -e '.processed | type == "number"' >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# sc_outbox_row_since <external_id> <after_id>
#
# Latest outbox row for the given PrestaShop external_id (=id_product; the
# hook always uses the product id, never the attribute or stock_available
# id - openlinker.php's own comment: "Always use product ID as externalId").
# `after_id` excludes rows from a previous cycle so a caller that reused the
# same product id across cycles reads the fresh row, never a stale one that
# already delivered.
#
# Echoes "id status event_id created_at delivered_at" (pipe-free columns,
# so plain `read` splits cleanly; event_id is a UUID with no spaces).
# ---------------------------------------------------------------------------
sc_outbox_row_since() {
  local external_id="$1" after_id="$2"
  ps_sql "SELECT id,status,event_id,created_at,COALESCE(delivered_at,'') FROM ps_openlinker_webhook_outbox WHERE external_id='$external_id' AND id > $after_id ORDER BY id DESC LIMIT 1"
}

# sc_outbox_max_id - the current high-water mark, so a caller can pass it as
# the "after" floor for the write it is about to make.
sc_outbox_max_id() {
  ps_sql "SELECT COALESCE(MAX(id),0) FROM ps_openlinker_webhook_outbox"
}
