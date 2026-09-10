#!/usr/bin/env bash
#
# Stand bootstrap for the performance measurement programme (#2860, epic #2840).
# See `usage()` below (or `./bootstrap.sh --help`) for the full description,
# the sources of truth this script ports from, and usage.
#
# Sources `lib.sh` (#2841) for every helper that script also needs: log/warn/
# die, the ps_sql/pg_sql/wc_wp/ol_api/ol_login family, and json_field. #2841's
# whole argument is that a second copy of any of those is how a run silently
# lies about the conditions it was taken under - so this script owns nothing
# lib.sh already owns, and PS_CONTAINER/PG_CONTAINER/etc below are read by
# both, not duplicated between them.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Configuration. Defaults point at the `lab` stand (#2854); override per stand.
# Set BEFORE sourcing lib.sh so its own `${VAR:-default}` lines see these
# values and do not need to repeat them.
# ---------------------------------------------------------------------------
PS_CONTAINER="${PS_CONTAINER:-lab-prestashop}"
PS_MYSQL_CONTAINER="${PS_MYSQL_CONTAINER:-lab-mysql}"
PS_DB="${PS_DB:-prestashop}"
WC_CONTAINER="${WC_CONTAINER:-lab-woocommerce}"
WC_PATH="${WC_PATH:-/opt/bitnami/wordpress}"
PG_CONTAINER="${PG_CONTAINER:-lab-postgres}"
PG_DB="${PG_DB:-openlinker}"
PG_USER="${PG_USER:-postgres}"

OL_API_URL="${OL_API_URL:-http://127.0.0.1:13000}"
OL_ADMIN_USER="${OL_ADMIN_USER:-admin}"
OL_ADMIN_PASSWORD="${OL_ADMIN_PASSWORD:-admin}"

# lib.sh's log/warn/die default to a `[lib]` prefix; this keeps bootstrap.sh's
# own `[bootstrap]` voice unchanged.
LIB_LOG_PREFIX="bootstrap"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

# Internal hostnames as seen from the api/worker containers on the compose network.
# PS_INTERNAL_URL uses the DOTTED `prestashop.lab` alias (#3046), not the bare
# `prestashop` service name - WordPress's wp_http_validate_url() refuses to
# fetch a remote image (or any URL) from a dot-less host, so a shop-publish
# scenario attaching a PrestaShop-hosted image to a WooCommerce product would
# fail every item with woocommerce_product_image_upload_error against the
# bare name. The bare name still resolves (docker-compose.lab.yml's alias is
# additive), so an operator overriding this var to the old value loses only
# the image-attach path, not connectivity.
PS_INTERNAL_URL="${PS_INTERNAL_URL:-http://prestashop.lab}"
WC_INTERNAL_URL="${WC_INTERNAL_URL:-https://wc-tls}"
ALLEGRO_STUB_URL="${ALLEGRO_STUB_URL:-http://allegro-stub:8080}"

# How many distinct Allegro offer ids each stub tenant mints. This IS the
# product-pool size #2847 records for the PrestaShop tax-cache decay term, and
# it must match the stub's own offer-id space (#2856).
ALLEGRO_OFFER_POOL_SIZE="${ALLEGRO_OFFER_POOL_SIZE:-200}"

# SCRIPT_DIR, not "$(dirname "$0")" - $0 is the CALLING script when this file
# is sourced rather than executed (lib-test.sh does exactly that), and would
# otherwise resolve these paths relative to the wrong directory.
OUT_FILE="${OUT_FILE:-$SCRIPT_DIR/stand-ids.env}"
UNDO_FILE="${UNDO_FILE:-$SCRIPT_DIR/stand-bootstrap-undo.txt}"

usage() {
  cat <<'EOF'
Stand bootstrap for the performance measurement programme (#2860, epic #2840).

Takes a freshly reset measurement stand to a state where every perf scenario
can run, with no browser step and no manual paste, and emits the ids the
harness needs into `stand-ids.env`.

Two claims in the programme cannot both be true while any of this is manual:
"a wipeable stand whose database is zeroed before each run" (#2854) and
"`run-all` executes the full campaign unattended and resumably" (#2845). An
unattended campaign cannot contain a back-office walkthrough.

IDEMPOTENT. Every step probes before it writes and reports FOUND or CREATED.
A second run against an already-bootstrapped stand changes nothing and
re-emits identical ids.

Sources of truth this script ports from, rather than reinventing:
  - PrestaShop WebService account + permissions + shop binding, including the
    PS 8.x/9.x schema detection and the `ps_webservice_account_shop` trap:
    apps/api/test/integration/helpers/prestashop-fixture.helper.ts:152-308
  - WooCommerce REST key (wc_api_hash = hash_hmac('sha256', $ck, 'wc-api')):
    docker/woocommerce/01-seed-wc-data.sh:33-53
  - MySQL-over-docker-exec pattern: perf/prestashop-baseline/seed-products.sh:27-31
  - The OL Dynamic carrier is created inside the module's install() hook:
    apps/prestashop-module/openlinker/openlinker.php installDynamicCarrier()

Usage:
  ./bootstrap.sh                 # bootstrap, writing stand-ids.env
  ./bootstrap.sh --dry-run       # print what it would do, touch nothing
  ./bootstrap.sh --verify-only   # probe and report, exit 1 on any gap
EOF
}

DRY_RUN=0
VERIFY_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
#
# log/warn/die, ps_sql/ps_sql_write, wc_wp, pg_sql, ol_api and json_field all
# now come from lib.sh (sourced above) - this is the extraction #2841 exists
# for. Only bootstrap-specific bookkeeping (the FOUND/CREATED/GAPS summary,
# `would()` for --dry-run) stays local, since lib.sh has no notion of a
# bootstrap run's found/created/gap summary.
# ---------------------------------------------------------------------------
FOUND=()      # things already present
CREATED=()    # things this run wrote
GAPS=()       # things missing that --verify-only reports

found()   { FOUND+=("$1");   log "FOUND   $1"; }
created() { CREATED+=("$1"); log "CREATED $1"; printf '%s\n' "$1" >> "$UNDO_FILE"; }
gap()     { GAPS+=("$1");    warn "MISSING $1"; }

# #3043 - the post-bootstrap capability assertion (see step_capability_assertion
# below). Three parallel indexed arrays rather than an associative one: a
# connection NAME is not a safe bash identifier/key in every bash this script
# might run under, and indexed arrays sidestep that entirely.
CAP_CHECK_NAMES=()
CAP_CHECK_IDS=()
CAP_CHECK_WANT=()   # comma-separated, matching the create/patch payload

# Called right after every `ol_ensure_connection` / capability PATCH below so
# the assertion step never has to re-derive "what was requested" - it reads
# it back from what THIS run actually asked for, not from a second copy of
# the same list.
record_expected_caps() {
  local name="$1" id="$2" want_csv="$3"
  [ -n "$id" ] || return 0  # --dry-run / --verify-only mint no id to check
  CAP_CHECK_NAMES+=("$name")
  CAP_CHECK_IDS+=("$id")
  CAP_CHECK_WANT+=("$want_csv")
}

would() {
  if [ "$DRY_RUN" = 1 ]; then log "DRY-RUN would: $*"; return 0; fi
  return 1
}

# ---------------------------------------------------------------------------
# Step 0 - preflight
# ---------------------------------------------------------------------------
step_preflight() {
  log "--- preflight ---"
  # jq joins the tool list here because lib.sh's json_field/ol_ensure_connection
  # below now parse JSON with jq rather than bootstrap.sh's former python3 -c -
  # see README "jq vs python3".
  for tool in docker curl python3 jq; do
    command -v "$tool" >/dev/null 2>&1 || die "missing host tool: $tool"
  done
  for c in "$PS_CONTAINER" "$PS_MYSQL_CONTAINER" "$WC_CONTAINER" "$PG_CONTAINER"; do
    docker inspect "$c" >/dev/null 2>&1 || die "container not running: $c (set the *_CONTAINER env vars for this stand)"
  done
  PS_MYSQL_PWD="$(docker exec "$PS_MYSQL_CONTAINER" printenv MYSQL_ROOT_PASSWORD)"
  [ -n "$PS_MYSQL_PWD" ] || die "could not read MYSQL_ROOT_PASSWORD from $PS_MYSQL_CONTAINER"
  log "preflight ok"
}

# ---------------------------------------------------------------------------
# Step 1 - PrestaShop OL module and the OL Dynamic carrier
#
# This is a CORRECTNESS precondition, not a cost-accuracy one. Every order
# create calls discoverDynamicCarrierId() first and unconditionally
# (prestashop-order-processor-manager.adapter.ts:375) and throws
# PrestashopOlCarrierMissingException when no active `external_module_name =
# 'openlinker'` carrier row exists. That row is created inside the module's
# install() hook, so a `ps_module` row alone is NOT sufficient.
#
# PS 9.0.2 occasionally bypasses the legacy install() hook on first invocation
# (docs/operations/prestashop-module-rename-migration.md). The documented
# workaround is one uninstall + install cycle, which is what the repair branch
# below does.
# ---------------------------------------------------------------------------
carrier_present() {
  local n
  n="$(ps_sql "SELECT COUNT(*) FROM ps_carrier WHERE external_module_name='openlinker' AND active=1 AND deleted=0")"
  [ "${n:-0}" -gt 0 ]
}

step_module() {
  log "--- PrestaShop OL module + carrier ---"
  if carrier_present; then
    found "OL Dynamic carrier (id_carrier=$(ps_sql "SELECT id_carrier FROM ps_carrier WHERE external_module_name='openlinker' AND active=1 AND deleted=0 LIMIT 1"))"
    return 0
  fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "OL Dynamic carrier row"; return 0; fi
  would "install the openlinker module (uninstall + install to force the legacy hook)" && return 0

  log "carrier absent - installing the module"
  docker exec -i "$PS_CONTAINER" php bin/console prestashop:module uninstall openlinker >/dev/null 2>&1 || true
  docker exec -i "$PS_CONTAINER" php bin/console prestashop:module install openlinker >/dev/null 2>&1 \
    || die "module install failed"
  carrier_present || die "module installed but the OL Dynamic carrier row is still absent - install() did not run; see docs/operations/prestashop-module-rename-migration.md"
  created "OL Dynamic carrier via module install()"
}

# ---------------------------------------------------------------------------
# Step 2 - PrestaShop WebService key
#
# Schema detection and the shop-binding trap are ported from
# prestashop-fixture.helper.ts:152-308. Without the ps_webservice_account_shop
# junction the account is unbound and every WS call answers 503 "The PrestaShop
# webservice is disabled" with PSWS-Version: 0, even with PS_WEBSERVICE on.
# ---------------------------------------------------------------------------
# Every resource `PrestashopOrderProcessorManagerAdapter.createOrder` touches,
# plus the catalogue/stock ones the master-sync paths need.
#
# `countries`, `currencies` and `carts` were MISSING until #2847, and the
# failure they produced is worth naming because it does not look like a
# permission problem: PrestaShop answers an ungranted resource with
# `Authentication failed: Invalid API key`, so the order create died reporting
# a bad credential on a connection whose own `POST /connections/:id/test` had
# just passed and whose `customers` writes were succeeding. The three are on
# the create path exactly once each -
#   countries   `PrestashopCountryResolver.resolveCountryId`, reached by
#               address provisioning (24h per-connection cache, so it fires
#               on the first order after a restart and then rarely)
#   currencies  `readPrestashopCurrencyByIso`, once per order before the cart
#   carts       `POST carts`, the cart every order is built on
# - and each is a hard stop for the whole destination arm when absent.
#
# `configurations` is a FOURTH, and it fails differently, which is why it
# survived the first three being added: the create path reads
# `GET configurations?filter[name]=[PS_CURRENCY_DEFAULT]` and tolerates a
# failure, so the order still completes. It is therefore not a hard stop - it
# is a silent tax. Measured during F1's latency arm: 4 of 4 orders spent one
# 401 there, i.e. roughly a tenth of the destination's whole 60/min rate-limit
# budget per order, on a request that can never succeed. A tolerated error is
# harder to find than a fatal one, so it is named here rather than left to be
# rediscovered.
#
# The grant below is re-applied on EVERY bootstrap run (DELETE + re-INSERT),
# so adding a name here repairs an existing stand rather than only a fresh one.
WS_RESOURCES="products combinations stock_availables orders order_details customers addresses countries currencies carts configurations carriers order_carriers order_states specific_prices product_options product_option_values tax_rules taxes"

step_webservice() {
  log "--- PrestaShop WebService key ---"
  # Detection order matches prestashop-fixture.helper.ts:152-308 (ps_api_access
  # / 8.x legacy first, ps_webservice_account / 9.x second) so a stack that
  # somehow carries both table families picks the same branch as the harness.
  local acct_table pk key_col perm_table has_method
  if [ -n "$(ps_sql "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ps_api_access' LIMIT 1")" ]; then
    acct_table=ps_api_access; pk=id_api_access; key_col=api_key
    perm_table=ps_api_access_resource; has_method=0
  elif [ -n "$(ps_sql "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ps_webservice_account' LIMIT 1")" ]; then
    acct_table=ps_webservice_account; pk=id_webservice_account; key_col='`key`'
    if [ -n "$(ps_sql "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ps_webservice_account_permission' LIMIT 1")" ]; then
      perm_table=ps_webservice_account_permission
    elif [ -n "$(ps_sql "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ps_webservice_permission' LIMIT 1")" ]; then
      perm_table=ps_webservice_permission
    else
      die "ps_webservice_account exists but no permission table found (looked for ps_webservice_account_permission, ps_webservice_permission)"
    fi
    has_method="$(ps_sql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='$perm_table' AND COLUMN_NAME='method'")"
  else
    die "no PrestaShop WebService account table found (ps_webservice_account or ps_api_access)"
  fi
  log "webservice schema: $acct_table / $perm_table (method-row=$has_method)"

  PS_WS_KEY="$(ps_sql "SELECT $key_col FROM $acct_table WHERE description='OpenLinker perf stand' LIMIT 1")"
  if [ -n "$PS_WS_KEY" ]; then
    found "PrestaShop WebService key (${PS_WS_KEY:0:8}...)"
  else
    if [ "$VERIFY_ONLY" = 1 ]; then gap "PrestaShop WebService key"; return 0; fi
    would "create a PrestaShop WebService key with $(echo $WS_RESOURCES | wc -w) resource grants" && return 0
    PS_WS_KEY="$(python3 -c 'import secrets;print(secrets.token_hex(16).upper())')"
    ps_sql_write "INSERT INTO $acct_table ($key_col, description, active) VALUES ('$PS_WS_KEY','OpenLinker perf stand',1)"
    created "PrestaShop WebService key (${PS_WS_KEY:0:8}...)"
  fi

  local acct_id
  acct_id="$(ps_sql "SELECT $pk FROM $acct_table WHERE $key_col='$PS_WS_KEY' LIMIT 1")"
  [ -n "$acct_id" ] || die "could not resolve the WebService account id"

  if [ "$VERIFY_ONLY" != 1 ] && [ "$DRY_RUN" != 1 ]; then
    # Re-grant is cheap and idempotent.
    ps_sql_write "DELETE FROM $perm_table WHERE $pk=$acct_id"
    for r in $WS_RESOURCES; do
      if [ "${has_method:-0}" -gt 0 ]; then
        for m in GET POST PUT DELETE HEAD; do
          ps_sql_write "INSERT INTO $perm_table ($pk, resource, method) VALUES ($acct_id,'$r','$m')"
        done
      else
        ps_sql_write "INSERT INTO $perm_table ($pk, resource, \`get\`,\`post\`,\`put\`,\`delete\`,\`head\`,\`all\`) VALUES ($acct_id,'$r',1,1,1,1,1,1)"
      fi
    done
    # PS 9.x: bind the account to every active shop, or every call 503s.
    if [ -n "$(ps_sql "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ps_webservice_account_shop' LIMIT 1")" ]; then
      ps_sql_write "INSERT IGNORE INTO ps_webservice_account_shop (id_webservice_account, id_shop) SELECT $acct_id, id_shop FROM ps_shop WHERE active=1"
    fi
    ps_sql_write "INSERT INTO ps_configuration (name, value, date_add, date_upd) VALUES ('PS_WEBSERVICE','1',NOW(),NOW()) ON DUPLICATE KEY UPDATE value='1', date_upd=NOW()"
  fi
}

# ---------------------------------------------------------------------------
# Step 3 - the tax rules group on the seeded catalogue
#
# The PrestaShop adapter converts gross to net on every order whose
# taxTreatment is not 'exclusive' (prestashop-order-processor-manager.adapter.ts:664),
# and the Allegro mapper always emits 'inclusive'. It then resolves the
# destination product's own tax rate and throws the non-retryable
# PrestashopTaxRateUnknownException when it cannot. This is unrelated to
# OL_TAX_RATE_STRICT_ENABLED, which is an issuance-side switch.
# ---------------------------------------------------------------------------
step_tax_group() {
  log "--- catalogue tax rules group ---"
  local zero total
  total="$(ps_sql "SELECT COUNT(*) FROM ps_product")"
  zero="$(ps_sql "SELECT COUNT(*) FROM ps_product WHERE id_tax_rules_group=0 OR id_tax_rules_group IS NULL")"
  PS_TAX_RULES_GROUP="$(ps_sql "SELECT id_tax_rules_group FROM ps_product WHERE id_tax_rules_group>0 GROUP BY id_tax_rules_group ORDER BY COUNT(*) DESC LIMIT 1")"
  log "products=$total without-tax-group=$zero dominant-group=${PS_TAX_RULES_GROUP:-none}"
  if [ "${zero:-0}" -gt 0 ]; then
    if [ -z "${PS_TAX_RULES_GROUP:-}" ]; then
      gap "$zero of $total products carry no tax rules group, and none of the rest do either - nothing to repair to; assign a tax rules group manually in the shop"
      return 0
    fi
    if [ "$VERIFY_ONLY" = 1 ]; then
      gap "$zero of $total products carry no tax rules group - every order touching one fails PrestashopTaxRateUnknownException"
      return 0
    fi
    would "set id_tax_rules_group=$PS_TAX_RULES_GROUP on the $zero products missing one" && return 0
    ps_sql_write "UPDATE ps_product SET id_tax_rules_group=$PS_TAX_RULES_GROUP WHERE id_tax_rules_group=0 OR id_tax_rules_group IS NULL"
    created "tax rules group on $zero products (set to the dominant group, id_tax_rules_group=$PS_TAX_RULES_GROUP)"
  else
    found "tax rules group on every product (id_tax_rules_group=$PS_TAX_RULES_GROUP)"
  fi
}

# ---------------------------------------------------------------------------
# Step 4 - WooCommerce REST key
#
# Ported from docker/woocommerce/01-seed-wc-data.sh:33-53. WooCommerce over
# cleartext allows OAuth 1.0a only - query-string and Basic both require
# is_ssl() - which is why the stand fronts it with the wc-tls proxy (#2854).
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Step 3b - lab-only WordPress mu-plugins (#2854, #3046).
#
# NOT bind-mounted (docker-compose.lab.yml's own comment on the woocommerce
# service explains why: bind-mounting under wp-content/ before the Bitnami
# entrypoint's first boot makes it take the "restore" branch against an
# empty volume and fail with "wp-config.php not found", verified live) - so
# they are docker-cp'd in after the container is healthy instead. Idempotent:
# a re-run just overwrites the same file with itself.
#
#   force-https.php             - makes WP's is_ssl() true behind the wc-tls
#                                  TLS-terminating proxy (#2854).
#   allow-internal-image-fetch.php - disables wp_http_validate_url()'s
#                                  private-IP block (#3046) so the shop-
#                                  publish image-upload path can fetch a
#                                  product image from a Docker-internal host.
# ---------------------------------------------------------------------------
step_woocommerce_mu_plugins() {
  log "--- WooCommerce mu-plugins ---"
  local src_dir="$SCRIPT_DIR/stand/wc-mu-plugins" f name
  [ -d "$src_dir" ] || { warn "no $src_dir - skipping mu-plugin sync"; return 0; }
  if [ "$VERIFY_ONLY" = 1 ]; then
    gap "mu-plugin sync only verified by re-running (docker cp has no dry-run probe worth trusting)"
    return 0
  fi
  would "docker cp every *.php in $src_dir into $WC_CONTAINER:/opt/bitnami/wordpress/wp-content/mu-plugins/" && return 0
  docker exec "$WC_CONTAINER" mkdir -p /opt/bitnami/wordpress/wp-content/mu-plugins
  for f in "$src_dir"/*.php; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    docker cp "$f" "$WC_CONTAINER:/opt/bitnami/wordpress/wp-content/mu-plugins/$name"
  done
  created "mu-plugins synced ($(ls "$src_dir"/*.php 2>/dev/null | wc -l | tr -d ' ') file(s))"
}

step_woocommerce() {
  log "--- WooCommerce REST key ---"
  local existing
  existing="$(wc_wp eval 'global $wpdb; echo (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}woocommerce_api_keys WHERE description = \"OpenLinker perf stand\"");' || echo 0)"
  if [ "${existing:-0}" -gt 0 ]; then
    # The consumer_key is stored hashed and cannot be read back. A re-run reuses
    # the value recorded in stand-ids.env; without it the key is rotated.
    if [ -f "$OUT_FILE" ] && grep -q '^WC_CONSUMER_KEY=' "$OUT_FILE"; then
      WC_CK="$(grep '^WC_CONSUMER_KEY=' "$OUT_FILE" | cut -d= -f2-)"
      WC_CS="$(grep '^WC_CONSUMER_SECRET=' "$OUT_FILE" | cut -d= -f2-)"
      found "WooCommerce REST key (reused from $OUT_FILE)"
      return 0
    fi
    if [ "$VERIFY_ONLY" = 1 ]; then gap "WooCommerce REST key not recoverable"; return 0; fi
    warn "a WooCommerce perf key exists but its consumer_key is stored hashed and $OUT_FILE does not carry it - rotating"
    wc_wp eval 'global $wpdb; $wpdb->delete($wpdb->prefix . "woocommerce_api_keys", ["description" => "OpenLinker perf stand"]);' || true
  fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "WooCommerce REST key"; return 0; fi
  would "create a WooCommerce REST key (read_write)" && return 0

  local json
  json="$(wc_wp eval '
    $ck = "ck_" . bin2hex(random_bytes(20));
    $cs = "cs_" . bin2hex(random_bytes(20));
    global $wpdb;
    $ok = $wpdb->insert($wpdb->prefix . "woocommerce_api_keys", [
      "user_id" => 1,
      "description" => "OpenLinker perf stand",
      "permissions" => "read_write",
      "consumer_key" => hash_hmac("sha256", $ck, "wc-api"),
      "consumer_secret" => $cs,
      "truncated_key" => substr($ck, -7),
    ]);
    if (!$ok) { fwrite(STDERR, $wpdb->last_error); exit(1); }
    echo json_encode(["consumer_key" => $ck, "consumer_secret" => $cs]);
  ' | tail -1)"
  WC_CK="$(printf '%s' "$json" | json_field consumer_key)"
  WC_CS="$(printf '%s' "$json" | json_field consumer_secret)"
  [ -n "$WC_CK" ] || die "WooCommerce key creation returned no consumer_key"
  WC_KEY_ROTATED=1
  created "WooCommerce REST key (${WC_CK:0:10}...)"
}

# ---------------------------------------------------------------------------
# Step 4b (#2847) - push a ROTATED WooCommerce key onto an existing connection.
#
# `ol_ensure_connection` is create-only, so it supplies credentials exactly
# once, at creation. `step_woocommerce` above, meanwhile, ROTATES the key
# whenever it cannot recover the plaintext from stand-ids.env - and the
# plaintext is unrecoverable by construction, because WooCommerce stores the
# consumer key hashed. So on any stand whose stand-ids.env was lost (a fresh
# worktree is enough), the two halves silently disagree: WooCommerce holds a
# new key and the OpenLinker connection still holds the old one, for ever, and
# nothing repairs it because every later step reports FOUND.
#
# Found live by F1 (#2847), whose WooCommerce destination arm answered
# `WooCommerce authentication failed - check consumer key and secret` on a
# stand that every other check called healthy. Without this step that arm is
# unrunnable and the failure looks like a stand fault rather than a bootstrap
# one.
#
# Only fires when this run actually rotated: a reused key is already the one
# the connection carries, and a needless credential write would rewrite the
# encrypted row for nothing.
step_woocommerce_credentials() {
  [ "${WC_KEY_ROTATED:-0}" = "1" ] || return 0
  [ -n "${WC_CONN_ID:-}" ] || { warn "WooCommerce key was rotated but no connection id resolved - the connection still carries the OLD key"; return 0; }
  [ "$VERIFY_ONLY" = 1 ] && { gap "WooCommerce connection credentials (key was rotated this run)"; return 0; }
  would "push the rotated WooCommerce key onto connection $WC_CONN_ID" && return 0
  ol_api PUT "/v1/connections/$WC_CONN_ID/credentials" \
    "$(jq -n --arg ck "$WC_CK" --arg cs "$WC_CS" '{credentials:{consumerKey:$ck, consumerSecret:$cs}}')" >/dev/null
  created "WooCommerce connection credentials updated to the rotated key"
}

# ---------------------------------------------------------------------------
# Step 5 - OpenLinker connections
#
# ol_login is lib.sh's (sourced above) - no local copy here any more.
# ---------------------------------------------------------------------------

# Look a connection up by name; echo its id or nothing.
# GET /v1/connections takes no pagination parameters and answers a plain array;
# an unexpected `limit` is rejected with 400 "property limit should not exist".
ol_connection_id_by_name() {
  ol_api GET "/v1/connections" \
    | jq -r --arg name "$1" 'if type == "array" then . else (.items // []) end
        | map(select(.name == $name)) | .[0].id // empty'
}

# Assigns the connection id to the variable NAMED by $1 rather than echoing it.
# Echoing would force the call into a command substitution, whose subshell
# discards the FOUND/CREATED/GAPS array updates - the summary would then
# under-report every connection it touched.
ol_ensure_connection() {
  local out_var="$1" name="$2" payload="$3" id
  id="$(ol_connection_id_by_name "$name")"
  if [ -n "$id" ]; then found "connection '$name' ($id)"; printf -v "$out_var" '%s' "$id"; return 0; fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "connection '$name'"; printf -v "$out_var" '%s' ''; return 0; fi
  if [ "$DRY_RUN" = 1 ]; then log "DRY-RUN would: create connection '$name'"; printf -v "$out_var" '%s' ''; return 0; fi
  id="$(ol_api POST /v1/connections "$payload" | json_field id)"
  [ -n "$id" ] || die "failed to create connection '$name'"
  created "connection '$name' ($id)"
  printf -v "$out_var" '%s' "$id"
}

step_connections() {
  log "--- OpenLinker connections ---"
  ol_login

  ol_ensure_connection PS_CONN_ID 'perf-prestashop' "$(cat <<JSON
{"name":"perf-prestashop","platformType":"prestashop",
 "enabledCapabilities":["ProductMaster","InventoryMaster","OrderProcessorManager"],
 "config":{"baseUrl":"$PS_INTERNAL_URL","shopId":1},
 "credentials":{"webserviceApiKey":"${PS_WS_KEY:-}"}}
JSON
)"
  record_expected_caps 'perf-prestashop' "${PS_CONN_ID:-}" 'ProductMaster,InventoryMaster,OrderProcessorManager'

  # #3046 (F16) needs ProductPublisher + CategoryProvisioner enabled here too -
  # both are in WooCommerce's own manifest (woocommerce-plugin.ts). Included
  # on CREATE directly; `ensure_woocommerce_publish_capabilities` below is the
  # idempotent PATCH half for a connection created by an earlier bootstrap run
  # (the `ensure_offer_manager` shape, generalised).
  #
  # `config.masterCatalogConnectionId` is likewise required for ProductPublisher
  # to do anything at all - found live (#3046): a shop-publish submit with it
  # absent fails every item with MASTER_CATALOG_NOT_CONFIGURED, since the
  # publish builder has no master to read name/description/price from. Points
  # at perf-prestashop, created immediately above.
  ol_ensure_connection WC_CONN_ID 'perf-woocommerce' "$(cat <<JSON
{"name":"perf-woocommerce","platformType":"woocommerce",
 "enabledCapabilities":["OrderProcessorManager","ProductPublisher","CategoryProvisioner"],
 "config":{"siteUrl":"$WC_INTERNAL_URL","masterCatalogConnectionId":"${PS_CONN_ID:-}"},
 "credentials":{"consumerKey":"${WC_CK:-}","consumerSecret":"${WC_CS:-}"}}
JSON
)"
  record_expected_caps 'perf-woocommerce' "${WC_CONN_ID:-}" 'OrderProcessorManager,ProductPublisher,CategoryProvisioner'

  # Two Allegro tenants, differing only by accessToken. Credentials deliberately
  # carry accessToken ONLY - no expiresAt, no refreshToken, no clientId/secret -
  # so ensureFreshToken short-circuits and no request is ever made to the
  # hardcoded real allegro.pl token host (#2856).
  #
  # enabledCapabilities carries OfferManager too, since #2935 (the stub is now
  # a real service on this stand - ALLEGRO_STUB_URL resolves). This is safe
  # under exactly ONE precondition, which this stand's own default already
  # satisfies and F2/F1/F6 must each verify for themselves via
  # `guard_scheduler_off`: the scheduler must stay OFF (remedy 1 of the two
  # #2935 names).
  #
  # Why that precondition is load-bearing - verified against the actual code,
  # not assumed: `allegro-offers-sync`'s scheduler task (jobType
  # marketplace.offers.sync) declares no `requiredCapability`, so it is
  # enqueued for every ACTIVE allegro connection on every tick regardless of
  # `enabledCapabilities` - capability is checked only once the job runs, via
  # `getCapabilityAdapter`. With OfferManager DISABLED, that throws the core
  # `CapabilityNotEnabledException`, which no platform retry classifier
  # recognises (each one only owns its own platform's exception hierarchy -
  # `retry-classifier-registry.service.ts`) - so it is retryable BY DEFAULT
  # and burns the full ten-attempt ladder, every tick, for ever. With
  # OfferManager ENABLED the capability check passes and the job actually
  # reaches the stub - which does not serve `/sale/offer-events` (#2856 scoped
  # the stub to the two order-ingestion endpoints only) - and gets a fast,
  # zero-latency, Allegro-shaped 404, which Allegro's OWN classifier already
  # treats as non-retryable (`allegro-retry-classifier.adapter.ts`,
  # `NON_RETRYABLE_STATUS_CODES`). So the capability state does not decide
  # whether a burn-ten-attempts failure CAN happen here - the scheduler does:
  # with it off (this stand's default, `OL_SCHEDULER_ENABLED=false` on every
  # worker container), the task is never enqueued at all and neither branch
  # above is ever reached, whatever `enabledCapabilities` says.
  ol_ensure_connection ALLEGRO_A_ID 'perf-allegro-a' "$(cat <<JSON
{"name":"perf-allegro-a","platformType":"allegro",
 "enabledCapabilities":["OrderSource","OfferManager"],
 "config":{"environment":"production","apiBaseUrl":"$ALLEGRO_STUB_URL"},
 "credentials":{"accessToken":"stub-token-a"}}
JSON
)"
  record_expected_caps 'perf-allegro-a' "${ALLEGRO_A_ID:-}" 'OrderSource,OfferManager'

  ol_ensure_connection ALLEGRO_B_ID 'perf-allegro-b' "$(cat <<JSON
{"name":"perf-allegro-b","platformType":"allegro",
 "enabledCapabilities":["OrderSource","OfferManager"],
 "config":{"environment":"production","apiBaseUrl":"$ALLEGRO_STUB_URL"},
 "credentials":{"accessToken":"stub-token-b"}}
JSON
)"
  record_expected_caps 'perf-allegro-b' "${ALLEGRO_B_ID:-}" 'OrderSource,OfferManager'

  # perf-webhook-ingress (#2842) - a connection whose ONLY job is to be a
  # legal target for a signed POST /webhooks/prestashop/:connectionId. It
  # reuses perf-prestashop's config shape (same stub PrestaShop, same
  # webservice key) so nothing new has to be provisioned, but declares
  # `enabledCapabilities: ["OrderSource"]` ALONE - deliberately different
  # from perf-prestashop's ["ProductMaster","InventoryMaster",
  # "OrderProcessorManager"]. `InboundRoutingPolicyService.resolveRoute`
  # (libs/core/src/sync/application/services/inbound-routing-policy.service.ts)
  # gates the `order` domain on `OrderSource` and the `product` domain on
  # `ProductMaster` - so on THIS connection an `order.*` webhook event is
  # routable (job_enqueued) while a `product.*` one is not (deadlettered),
  # which is exactly the split probe P3/P4 needs (see the F3 scenario
  # script's differential-probe section). Measuring against perf-prestashop
  # itself would not show this split: it has no `OrderSource` at all, so
  # EVERY order event on it deadletters and the "routed" arm of the burst
  # would silently measure a one-insert transaction instead of the real
  # two-insert gate.
  ol_ensure_connection WEBHOOK_CONN_ID 'perf-webhook-ingress' "$(cat <<JSON
{"name":"perf-webhook-ingress","platformType":"prestashop",
 "enabledCapabilities":["OrderSource"],
 "config":{"baseUrl":"$PS_INTERNAL_URL","shopId":1},
 "credentials":{"webserviceApiKey":"${PS_WS_KEY:-}"}}
JSON
)"
  record_expected_caps 'perf-webhook-ingress' "${WEBHOOK_CONN_ID:-}" 'OrderSource'

  # ---------------------------------------------------------------------
  # #3043 - the five connections the F14-F18 sibling scenarios need.
  # ---------------------------------------------------------------------

  # F14 (#3044) - invoice half. The already-shipped fixed-latency
  # `InvoicingPort` stub (#3006), reachable at its INTERNAL container port
  # 19082 (the published INVOICING_STUB_HOST_PORT is host-only and irrelevant
  # here - service-to-service traffic never touches it). Requires
  # OL_INVOICING_STUB_ENABLED=true on both api and worker
  # (docker-compose.lab.yml default since #3043); step_verify_connections
  # treats a failed test here as conditional, same as Allegro, since the
  # plugin registering is an env-var precondition this script cannot itself
  # confirm from outside the containers.
  ol_ensure_connection INVOICING_CONN_ID 'perf-invoicing' "$(cat <<JSON
{"name":"perf-invoicing","platformType":"invoicing-stub",
 "enabledCapabilities":["Invoicing"],
 "config":{"apiBaseUrl":"http://invoicing-stub:19082"}}
JSON
)"
  record_expected_caps 'perf-invoicing' "${INVOICING_CONN_ID:-}" 'Invoicing'

  # F14 (#3044) - fiscal half. The REAL eparagony.pl adapter
  # (@openlinker/integrations-eparagony, always registered - no gate),
  # pointed at both its documented test-mode overrides
  # (config.apiBaseUrl/authBaseUrl, both `EparagonyHttpClient`-enforced
  # https) at the TLS front's own hostname, `eparagony-stub-tls` -
  # DELIBERATELY NOT the bare "eparagony-stub" the compose service's plain
  # HTTP backend already answers to (container_name: lab-eparagony-stub):
  # Docker's embedded DNS resolves "eparagony-stub" to THAT container, whose
  # only listener is the plain-HTTP port 19084 - an https request there
  # gets ECONNREFUSED on 443, found live. posId is mandatory per
  # EparagonyAdapterFactory; clientId/clientSecret are dummy values the stub
  # never validates.
  ol_ensure_connection EPARAGONY_CONN_ID 'perf-eparagony' "$(cat <<JSON
{"name":"perf-eparagony","platformType":"eparagony",
 "enabledCapabilities":["Fiscalization"],
 "config":{"environment":"sandbox","posId":"stub-pos-1",
  "apiBaseUrl":"https://eparagony-stub-tls","authBaseUrl":"https://eparagony-stub-tls"},
 "credentials":{"clientId":"stub-client-id","clientSecret":"stub-client-secret"}}
JSON
)"
  record_expected_caps 'perf-eparagony' "${EPARAGONY_CONN_ID:-}" 'Fiscalization'

  # F18 (#3048) - the REAL Erli adapter (@openlinker/integrations-erli,
  # always registered), pointed at the network-aliased stub
  # `erli-stub.erli.dev` - the one hostname shape `isAllowedErliBaseUrl`
  # (an SSRF allowlist with no test-mode escape hatch) accepts. See
  # stubs/erli/README.md for why an alias, not a bare service name.
  ol_ensure_connection ERLI_CONN_ID 'perf-erli' "$(cat <<JSON
{"name":"perf-erli","platformType":"erli",
 "enabledCapabilities":["OrderSource","OfferManager"],
 "config":{"baseUrl":"https://erli-stub.erli.dev"},
 "credentials":{"apiKey":"stub-erli-api-key"}}
JSON
)"
  record_expected_caps 'perf-erli' "${ERLI_CONN_ID:-}" 'OrderSource,OfferManager'

  # F15 (#3045) - a DEDICATED lab-only ShippingProviderManager adapter
  # (@openlinker/integrations-shipping-stub, #3043) rather than the real
  # InPost/DPD Polska adapters, neither of which supports a base-URL
  # override - see stubs/shipping/README.md. Plain HTTP, no TLS front
  # needed (this adapter enforces no https/host policy of its own).
  # Requires OL_SHIPPING_STUB_ENABLED=true (docker-compose.lab.yml default).
  ol_ensure_connection SHIPPING_CONN_ID 'perf-shipping' "$(cat <<JSON
{"name":"perf-shipping","platformType":"shipping-stub",
 "enabledCapabilities":["ShippingProviderManager"],
 "config":{"apiBaseUrl":"http://shipping-stub:19086"}}
JSON
)"
  record_expected_caps 'perf-shipping' "${SHIPPING_CONN_ID:-}" 'ShippingProviderManager'

  # #3043 AC - "record whether FulfillmentExecutor is reachable at all".
  # `openlinker.oms.v1` (@openlinker/oms) has advertised it since #2409, so
  # this connection PROVES reachability - `requiresCredentials: false`
  # (ADR-055), no credentials block needed. No sibling F14-F18 scenario
  # actually drives fulfilment through it; it exists so the finding below is
  # demonstrated, not merely asserted from reading the manifest.
  ol_ensure_connection OMS_CONN_ID 'perf-openlinker-oms' "$(cat <<JSON
{"name":"perf-openlinker-oms","platformType":"openlinker",
 "enabledCapabilities":["FulfillmentExecutor"],
 "config":{}}
JSON
)"
  record_expected_caps 'perf-openlinker-oms' "${OMS_CONN_ID:-}" 'FulfillmentExecutor'
}

# ---------------------------------------------------------------------------
# Step 5b (#2935) - ensure OfferManager on Allegro connections created by an
# EARLIER bootstrap run.
#
# `ol_ensure_connection` is create-only (see its own docblock) - it never
# updates an existing row, so a connection created before #2935 landed
# (`enabledCapabilities: ["OrderSource"]` only) would otherwise never gain
# OfferManager just because this script was re-run. This step is the PATCH
# half: idempotent, and safe under the same precondition step_connections'
# own comment states - the scheduler must stay off (verified independently
# by every scenario's own `guard_scheduler_off`, not by this script, which
# has no container access to check it).
# ---------------------------------------------------------------------------
ensure_offer_manager() {
  local conn_id="$1" tenant="$2" caps has_it
  [ -n "$conn_id" ] || { warn "no connection id for tenant $tenant - skipping OfferManager check"; return 0; }
  caps="$(ol_api GET "/v1/connections/$conn_id" | jq -r '(.enabledCapabilities // []) | join(",")')"
  has_it="$(printf '%s' "$caps" | grep -c '\bOfferManager\b' || true)"
  if [ "${has_it:-0}" -ge 1 ]; then found "OfferManager on $tenant"; return 0; fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "OfferManager not enabled on $tenant (has: ${caps:-<none>})"; return 0; fi
  would "enable OfferManager on $tenant (has: ${caps:-<none>})" && return 0
  ol_api PATCH "/v1/connections/$conn_id" "$(jq -cn --arg caps "$caps" \
    '{enabledCapabilities: (($caps | split(",") | map(select(length > 0))) + ["OfferManager"])}')" >/dev/null
  created "OfferManager enabled on $tenant"
}

step_allegro_offer_manager() {
  log "--- Allegro OfferManager capability ---"
  ensure_offer_manager "${ALLEGRO_A_ID:-}" 'perf-allegro-a'
  ensure_offer_manager "${ALLEGRO_B_ID:-}" 'perf-allegro-b'
}

# ---------------------------------------------------------------------------
# Step 5c (#3043, F16) - ensure ProductPublisher + CategoryProvisioner on
# perf-woocommerce created by an EARLIER bootstrap run, generalising
# ensure_offer_manager above to a list of capability names rather than one.
# ---------------------------------------------------------------------------
ensure_capabilities_present() {
  local conn_id="$1" tenant="$2" caps missing want
  shift 2
  [ -n "$conn_id" ] || { warn "no connection id for tenant $tenant - skipping capability check"; return 0; }
  caps="$(ol_api GET "/v1/connections/$conn_id" | jq -r '(.enabledCapabilities // []) | join(",")')"
  missing=()
  for want in "$@"; do
    if ! printf '%s' "$caps" | grep -q "\\b${want}\\b"; then
      missing+=("$want")
    fi
  done
  if [ "${#missing[@]}" -eq 0 ]; then found "$* on $tenant"; return 0; fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "${missing[*]} not enabled on $tenant (has: ${caps:-<none>})"; return 0; fi
  would "enable ${missing[*]} on $tenant (has: ${caps:-<none>})" && return 0
  ol_api PATCH "/v1/connections/$conn_id" "$(jq -cn --arg caps "$caps" --argjson add "$(printf '%s\n' "${missing[@]}" | jq -R . | jq -s .)" \
    '{enabledCapabilities: (($caps | split(",") | map(select(length > 0))) + $add)}')" >/dev/null
  created "${missing[*]} enabled on $tenant"
}

step_woocommerce_publish_capabilities() {
  log "--- WooCommerce ProductPublisher/CategoryProvisioner capability ---"
  ensure_capabilities_present "${WC_CONN_ID:-}" 'perf-woocommerce' ProductPublisher CategoryProvisioner
  ensure_woocommerce_master_catalog
  ensure_prestashop_shop_url_alias
}

# Idempotent ps_shop_url row for the PS_INTERNAL_URL hostname (#3046).
#
# PrestaShop's webservice dispatcher redirects a single-resource GET
# (`/api/products/25`) to the shop's CANONICAL registered domain
# (`ps_shop_url.main=1`, PS_DOMAIN's `localhost:19080`) whenever the
# request's Host header doesn't match ANY registered ps_shop_url.domain row -
# even with valid Basic Auth. List-style queries (`?filter[...]`) do NOT
# trigger this (verified live). `PS_INTERNAL_URL` (the dotted `prestashop.lab`
# alias WordPress's own dot-less-host check requires, see the comment above
# its declaration) is never registered by the image's own install - only
# PS_DOMAIN's value is - so every single-resource read the WooCommerce
# publish path makes (`getProduct`) 301-redirected to `localhost:19080`,
# which no in-network container can reach. Registering it as an ADDITIONAL
# (main=0) domain fixes the redirect without touching the canonical one.
ensure_prestashop_shop_url_alias() {
  local host existing
  host="$(printf '%s' "$PS_INTERNAL_URL" | sed -E 's#^[a-z]+://##; s#/.*$##; s#:[0-9]+$##')"
  [ -n "$host" ] || { warn "could not parse a hostname out of PS_INTERNAL_URL=$PS_INTERNAL_URL - skipping ps_shop_url alias check"; return 0; }
  existing="$(ps_sql "SELECT COUNT(*) FROM ps_shop_url WHERE domain='$host' OR domain_ssl='$host'")"
  if [ "${existing:-0}" -gt 0 ]; then found "ps_shop_url row for '$host' (webservice single-resource reads resolve without a redirect)"; return 0; fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "no ps_shop_url row for '$host' - single-resource webservice GETs (e.g. /api/products/:id) 301-redirect to the canonical shop domain"; return 0; fi
  would "register ps_shop_url domain='$host' (main=0, active=1) for shop 1" && return 0
  ps_sql_write "INSERT INTO ps_shop_url (id_shop, domain, domain_ssl, physical_uri, virtual_uri, main, active) VALUES (1, '$host', '$host', '/', '', 0, 1)"
  created "ps_shop_url alias registered for '$host'"
}

# Idempotent PATCH half for config.masterCatalogConnectionId (#3046), for a
# perf-woocommerce created by an earlier bootstrap run that predates this
# key. `ConnectionRepository.update` REPLACES `config` wholesale (never a
# deep merge), so this reads the CURRENT config back and merges client-side -
# a bare `{config: {masterCatalogConnectionId: ...}}` patch would silently
# wipe `siteUrl`. Never overwrites an operator-set value that differs from
# perf-prestashop's id - only fills the gap when the key is absent.
ensure_woocommerce_master_catalog() {
  local conn_id="${WC_CONN_ID:-}" current_config current
  [ -n "$conn_id" ] || { warn "no connection id for perf-woocommerce - skipping masterCatalogConnectionId check"; return 0; }
  current_config="$(ol_api GET "/v1/connections/$conn_id" | jq -c '.config // {}')"
  current="$(printf '%s' "$current_config" | jq -r '.masterCatalogConnectionId // empty')"
  if [ -n "$current" ]; then found "masterCatalogConnectionId on perf-woocommerce ($current)"; return 0; fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "perf-woocommerce has no config.masterCatalogConnectionId"; return 0; fi
  would "set config.masterCatalogConnectionId=${PS_CONN_ID:-} on perf-woocommerce" && return 0
  ol_api PATCH "/v1/connections/$conn_id" "$(jq -cn --argjson cfg "$current_config" --arg ps "${PS_CONN_ID:-}" '{config: ($cfg + {masterCatalogConnectionId: $ps})}')" >/dev/null
  created "masterCatalogConnectionId set on perf-woocommerce (${PS_CONN_ID:-})"
}

# ---------------------------------------------------------------------------
# Step 6 - Offer identifier mappings for the Allegro tenants
#
# Without these every stub order fails item resolution
# (order-item-ref-resolver.service.ts:56-81), persists as 'awaiting_mapping',
# never reaches a destination create, and burns ten retry attempts over roughly
# 30 hours. The offer-id space must match the stub's (#2856).
# ---------------------------------------------------------------------------
# AN OFFER MUST POINT AT A PRODUCT THE DESTINATION ACTUALLY HAS (#2847)
#
# The original seeder pointed every offer at any non-stale `product_variants`
# row. That is not enough for a DESTINATION-CREATE path, and F1 found out the
# expensive way: `seed-catalogue.sh` writes 10 000 OL products plus matching
# `identifier_mappings` rows whose external ids are synthetic strings
# (`PERFSEED-EXT-PROD-ps-*`, `PERFSEED-EXT-PROD-wc-*`) - it seeds OL's own
# tables and the MAPPINGS, never a product in either shop. It was built for the
# read-path scenarios, where nothing crosses to a shop and that is fine.
#
# An order whose line resolves to one of those products reaches the destination
# adapter and dies there:
#
#   PrestaShop   GET products/PERFSEED-EXT-PROD-ps-10000 -> Resource not found
#                (the tax-rate chain, before any order is created)
#   WooCommerce  Corrupted mapping: "PERFSEED-EXT-PROD-wc-10000" is not a
#                valid positive integer WC ID
#
# and because `OrderSyncService` fans out under `Promise.allSettled`, the job
# still records `outcome: 'ok'` while the shop receives nothing.
#
# The WooCommerce half of that (a real order fanning out to a WooCommerce
# connection with NO numeric Product mapping at all, "No WC product mapping
# for OL product ...") is #3025 - `seed/seed-wc-catalogue.sh` closes it by
# cloning one real WooCommerce product per distinct PS-real product this
# selection below can reach, and mapping it under `WC_CONNECTION_ID`. Run it
# once after this step (and again any time the PS-real pool grows) so a
# dual-destination order-ingestion measurement is not silently missing its
# WooCommerce half.
#
# The target set is therefore variants whose product carries a NUMERIC
# PrestaShop external id - a real `id_product` in the shop's own catalogue,
# which on this stand is the six products bootstrap itself installs (20-25,
# eleven non-stale positions). A numeric test rather than a hardcoded list, so
# a stand that later grows a real catalogue picks it up automatically.
#
# Note what this means for #2856's seeded-mapping contract ("the offer pool and
# the distinct-product count are the same number"): it CANNOT hold on a stand
# with six real products, and the warning below says so with the real figure
# rather than letting a reader assume 200. A destination-create measurement has
# to state its true distinct-product count, because that is what the PrestaShop
# tax chain's 24h per-(connection, product, country) cache decays against.
seed_offer_mappings_for() {
  local conn_id="$1" tenant="$2" rows distinct usable want
  [ -n "$conn_id" ] || { warn "no connection id for tenant $tenant - skipping offer mappings"; return 0; }

  # Variants whose product is REAL at the PrestaShop destination.
  local real_clause=""
  if [ -n "${PS_CONN_ID:-}" ]; then
    real_clause="AND EXISTS (SELECT 1 FROM identifier_mappings m
                             WHERE m.\"entityType\"='Product' AND m.\"connectionId\"='$PS_CONN_ID'
                               AND m.\"internalId\"=pv.\"productId\" AND m.\"externalId\" ~ '^[0-9]+\$')"
  fi
  usable="$(pg_sql "SELECT COUNT(*) FROM product_variants pv WHERE pv.\"isStale\" = false $real_clause")"
  [ "${usable:-0}" -gt 0 ] || die "no non-stale product_variants map to a real (numeric-id) PrestaShop product - install the module's catalogue before the offer mappings"

  # The most distinct targets this stand can support. Comparing against the
  # pool size alone would report a permanent gap on a stand whose real
  # catalogue is smaller than the pool, and a permanent gap trains people to
  # ignore the summary.
  want="$ALLEGRO_OFFER_POOL_SIZE"
  [ "$usable" -ge "$want" ] || want="$usable"

  rows="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"entityType\"='Offer' AND \"connectionId\"='$conn_id'")"
  distinct="$(pg_sql "SELECT COUNT(DISTINCT im.\"internalId\") FROM identifier_mappings im
                      JOIN product_variants pv ON pv.id = im.\"internalId\"
                      WHERE im.\"entityType\"='Offer' AND im.\"connectionId\"='$conn_id'
                        AND pv.\"isStale\" = false $real_clause")"
  if [ "${rows:-0}" -ge "$ALLEGRO_OFFER_POOL_SIZE" ] && [ "${distinct:-0}" -ge "$want" ]; then
    found "Offer mappings for $tenant ($rows rows over $distinct destination-resolvable variant(s); stand supports $usable)"; return 0
  fi
  if [ "$VERIFY_ONLY" = 1 ]; then
    gap "Offer mappings for $tenant (have ${rows:-0} rows over ${distinct:-0} destination-resolvable variant(s), need $ALLEGRO_OFFER_POOL_SIZE rows over $want)"; return 0
  fi
  would "seed/repair $ALLEGRO_OFFER_POOL_SIZE Offer mappings for $tenant over $want destination-resolvable variant(s)" && return 0

  if [ "$usable" -lt "$ALLEGRO_OFFER_POOL_SIZE" ]; then
    warn "only $usable variant(s) resolve to a real PrestaShop product, fewer than the offer pool $ALLEGRO_OFFER_POOL_SIZE - offers will SHARE targets and the distinct-product count will NOT equal the offer pool. Any destination-create measurement must record the real figure (#2856's seeded-mapping contract cannot hold here)."
  fi

  # DELETE-then-insert rather than ON CONFLICT DO NOTHING: the repair case has
  # rows whose externalId already exists but whose internalId points somewhere
  # unusable, and DO NOTHING would leave every one of them exactly as it was.
  pg_sql "DELETE FROM identifier_mappings WHERE \"entityType\"='Offer' AND \"connectionId\"='$conn_id'" >/dev/null
  pg_sql "INSERT INTO identifier_mappings (id, \"entityType\", \"internalId\", \"externalId\", \"platformType\", \"connectionId\", \"createdAt\", \"updatedAt\")
          SELECT gen_random_uuid(), 'Offer', v.id, '${tenant}-offer-' || g.n, 'allegro', '$conn_id', NOW(), NOW()
          FROM generate_series(1, $ALLEGRO_OFFER_POOL_SIZE) AS g(n)
          JOIN LATERAL (
            SELECT pv.id FROM product_variants pv
            WHERE pv.\"isStale\" = false $real_clause
            ORDER BY pv.id OFFSET ((g.n - 1) % $usable) LIMIT 1
          ) AS v ON true
          ON CONFLICT DO NOTHING" >/dev/null
  distinct="$(pg_sql "SELECT COUNT(DISTINCT \"internalId\") FROM identifier_mappings WHERE \"entityType\"='Offer' AND \"connectionId\"='$conn_id'")"
  created "$ALLEGRO_OFFER_POOL_SIZE Offer mappings for $tenant over ${distinct} destination-resolvable variant(s)"
}

step_offer_mappings() {
  log "--- Allegro Offer identifier mappings ---"
  seed_offer_mappings_for "${ALLEGRO_A_ID:-}" 'perf-allegro-a'
  seed_offer_mappings_for "${ALLEGRO_B_ID:-}" 'perf-allegro-b'
}

# ---------------------------------------------------------------------------
# Step 7 - verify each connection, and emit stand-ids.env
#
# Allegro registers no credentials-shape validator (allegro-plugin.ts), so a
# malformed credential payload passes create and only fails later at first
# adapter construction. A connection test is therefore the real check - but the
# Allegro one is CONDITIONAL, because the stub (#2856) may not exist yet.
# ---------------------------------------------------------------------------
# The test endpoint answers HTTP 200 with `{"success": false, "message": ...}`
# for a connection that cannot be reached at all, so the HTTP status says
# nothing. Read the `success` field.
connection_test() {
  local id="$1" body
  body="$(ol_api POST "/v1/connections/$id/test" 2>/dev/null || printf '{}')"
  CONNECTION_TEST_MESSAGE="$(printf '%s' "$body" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: d={}
print(d.get("message","no response"))' 2>/dev/null || printf 'unparseable response')"
  printf '%s' "$body" | python3 -c 'import sys,json
try: sys.exit(0 if json.load(sys.stdin).get("success") is True else 1)
except Exception: sys.exit(1)'
}

step_verify_connections() {
  log "--- connection tests ---"
  local name id
  for pair in "perf-prestashop:${PS_CONN_ID:-}" "perf-woocommerce:${WC_CONN_ID:-}" "perf-webhook-ingress:${WEBHOOK_CONN_ID:-}"; do
    name="${pair%%:*}"; id="${pair##*:}"
    [ -n "$id" ] || continue
    if connection_test "$id"; then
      log "connection test ok: $name"
    else
      gap "connection test FAILED: $name ($id) - $CONNECTION_TEST_MESSAGE"
    fi
  done
  # Allegro is conditional: the stub (#2856) may not be running yet, and a
  # connection that cannot reach it is expected rather than a bootstrap failure.
  for pair in "perf-allegro-a:${ALLEGRO_A_ID:-}" "perf-allegro-b:${ALLEGRO_B_ID:-}"; do
    name="${pair%%:*}"; id="${pair##*:}"
    [ -n "$id" ] || continue
    if connection_test "$id"; then
      log "connection test ok: $name"
    else
      warn "connection test failed for $name - $CONNECTION_TEST_MESSAGE (expected while the Allegro stub is not running)"
    fi
  done
  # #3043's five new connections are likewise conditional: OL_INVOICING_STUB_
  # ENABLED / OL_SHIPPING_STUB_ENABLED being false, one of the three new stub
  # containers not up yet, or (perf-openlinker-oms) no connection tester ever
  # registered for a credential-less plugin are all expected failure modes
  # this script cannot distinguish from outside the containers - so, like
  # Allegro above, a failed test here warns rather than gaps the run.
  for pair in \
    "perf-invoicing:${INVOICING_CONN_ID:-}" \
    "perf-eparagony:${EPARAGONY_CONN_ID:-}" \
    "perf-erli:${ERLI_CONN_ID:-}" \
    "perf-shipping:${SHIPPING_CONN_ID:-}" \
    "perf-openlinker-oms:${OMS_CONN_ID:-}"
  do
    name="${pair%%:*}"; id="${pair##*:}"
    [ -n "$id" ] || continue
    if connection_test "$id"; then
      log "connection test ok: $name"
    else
      warn "connection test failed for $name - $CONNECTION_TEST_MESSAGE (expected while its stub/gate is not yet up)"
    fi
  done
}

# ---------------------------------------------------------------------------
# Step 8 (#3043) - the post-bootstrap capability assertion the issue's own AC
# requires: "fails loudly when any connection's enabledCapabilities differs
# from what was requested". Reads every connection this run created OR
# confirmed back via GET and compares its enabledCapabilities, AS A SET, to
# what `record_expected_caps` recorded at create/patch time - never assuming
# the create/patch payload was honoured verbatim (a stale cache, a partial
# patch, or a capability the manifest silently refused would all otherwise
# go unnoticed).
# ---------------------------------------------------------------------------
step_capability_assertion() {
  log "--- capability assertion ---"
  [ "$DRY_RUN" = 1 ] && { log "DRY-RUN - skipping capability assertion (nothing was written)"; return 0; }
  local i name id want_csv have_csv want_sorted have_sorted
  for i in "${!CAP_CHECK_IDS[@]}"; do
    name="${CAP_CHECK_NAMES[$i]}"
    id="${CAP_CHECK_IDS[$i]}"
    want_csv="${CAP_CHECK_WANT[$i]}"
    have_csv="$(ol_api GET "/v1/connections/$id" 2>/dev/null | jq -r '(.enabledCapabilities // []) | sort | join(",")' 2>/dev/null || printf '')"
    want_sorted="$(printf '%s' "$want_csv" | tr ',' '\n' | sort | paste -sd, -)"
    if [ "$have_csv" = "$want_sorted" ]; then
      found "capabilities match on $name ($want_csv)"
    else
      gap "capability MISMATCH on $name ($id): requested [$want_csv], connection reports [${have_csv:-<unreadable>}]"
    fi
  done
}

step_emit() {
  [ "$DRY_RUN" = 1 ] && { log "DRY-RUN would write $OUT_FILE"; return 0; }
  [ "$VERIFY_ONLY" = 1 ] && return 0
  # Called only once every step above reported zero gaps (see main()). A run
  # that found real gaps must never leave a stand-ids.env on disk: #2841's
  # harness sources this file unconditionally and #2845's runner is
  # unattended and resumable, so a file written by a failed bootstrap would
  # be picked up and measured against a stand nobody confirmed.
  cat > "$OUT_FILE" <<ENV
# Generated by perf/openlinker-throughput/bootstrap.sh - do not edit by hand.
# Regenerate by re-running bootstrap.sh; it is idempotent.
GENERATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PS_CONNECTION_ID=${PS_CONN_ID:-}
WC_CONNECTION_ID=${WC_CONN_ID:-}
ALLEGRO_A_CONNECTION_ID=${ALLEGRO_A_ID:-}
ALLEGRO_B_CONNECTION_ID=${ALLEGRO_B_ID:-}
WEBHOOK_CONNECTION_ID=${WEBHOOK_CONN_ID:-}
INVOICING_CONNECTION_ID=${INVOICING_CONN_ID:-}
EPARAGONY_CONNECTION_ID=${EPARAGONY_CONN_ID:-}
ERLI_CONNECTION_ID=${ERLI_CONN_ID:-}
SHIPPING_CONNECTION_ID=${SHIPPING_CONN_ID:-}
OMS_CONNECTION_ID=${OMS_CONN_ID:-}
PS_WEBSERVICE_KEY=${PS_WS_KEY:-}
WC_CONSUMER_KEY=${WC_CK:-}
WC_CONSUMER_SECRET=${WC_CS:-}
PS_TAX_RULES_GROUP=${PS_TAX_RULES_GROUP:-}
ALLEGRO_OFFER_POOL_SIZE=${ALLEGRO_OFFER_POOL_SIZE}
ENV
  log "wrote $OUT_FILE"
}

# ---------------------------------------------------------------------------
main() {
  [ "$DRY_RUN" = 1 ] && log "DRY RUN - nothing will be written"
  [ "$VERIFY_ONLY" = 1 ] && log "VERIFY ONLY - probing, nothing will be written"
  step_preflight
  step_module
  step_webservice
  step_tax_group
  step_woocommerce_mu_plugins
  step_woocommerce
  step_connections
  # After step_connections (the connection must exist to be patched) and
  # before step_verify_connections (whose WooCommerce test is exactly what a
  # stale credential fails) - #2847.
  step_woocommerce_credentials
  step_allegro_offer_manager
  step_woocommerce_publish_capabilities
  step_offer_mappings
  step_verify_connections
  step_capability_assertion

  log "--- summary ---"
  log "found:   ${#FOUND[@]}"
  log "created: ${#CREATED[@]}"
  if [ "${#GAPS[@]}" -gt 0 ]; then
    log "gaps:    ${#GAPS[@]}"
    for g in "${GAPS[@]}"; do printf '  - %s\n' "$g"; done
    exit 1
  fi

  step_emit
  log "stand is bootstrapped"
}

# Only auto-run when EXECUTED, not when sourced - this is what lets
# lib-test.sh (#2841) source this file to exercise its argument parsing and
# `would()` without touching a real stand. `./bootstrap.sh` still runs `main`
# exactly as before, since BASH_SOURCE[0] equals $0 in that case.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main
fi
