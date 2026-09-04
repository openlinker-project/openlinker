#!/usr/bin/env bash
#
# Stand bootstrap for the performance measurement programme (#2860, epic #2840).
# See `usage()` below (or `./bootstrap.sh --help`) for the full description,
# the sources of truth this script ports from, and usage.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration. Defaults point at the `lab` stand (#2854); override per stand.
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

# Internal hostnames as seen from the api/worker containers on the compose network.
PS_INTERNAL_URL="${PS_INTERNAL_URL:-http://prestashop}"
WC_INTERNAL_URL="${WC_INTERNAL_URL:-https://wc-tls}"
ALLEGRO_STUB_URL="${ALLEGRO_STUB_URL:-http://allegro-stub:8080}"

# How many distinct Allegro offer ids each stub tenant mints. This IS the
# product-pool size #2847 records for the PrestaShop tax-cache decay term, and
# it must match the stub's own offer-id space (#2856).
ALLEGRO_OFFER_POOL_SIZE="${ALLEGRO_OFFER_POOL_SIZE:-200}"

OUT_FILE="${OUT_FILE:-$(dirname "$0")/stand-ids.env}"
UNDO_FILE="${UNDO_FILE:-$(dirname "$0")/stand-bootstrap-undo.txt}"

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
# ---------------------------------------------------------------------------
log()  { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap] WARN  %s\n' "$*" >&2; }
die()  { printf '[bootstrap] FATAL %s\n' "$*" >&2; exit 1; }

FOUND=()      # things already present
CREATED=()    # things this run wrote
GAPS=()       # things missing that --verify-only reports

found()   { FOUND+=("$1");   log "FOUND   $1"; }
created() { CREATED+=("$1"); log "CREATED $1"; printf '%s\n' "$1" >> "$UNDO_FILE"; }
gap()     { GAPS+=("$1");    warn "MISSING $1"; }

would() {
  if [ "$DRY_RUN" = 1 ]; then log "DRY-RUN would: $*"; return 0; fi
  return 1
}

# MySQL over docker exec. The password lives in the container's own environment,
# so it is read once rather than passed on the host command line.
#
# Two forms, deliberately kept apart. `ps_sql` is lenient - it folds stderr into
# stdout and always exits 0 - which is correct for a PROBE (a SELECT whose
# absence is the answer, not a failure), but was wrong for a WRITE: with the
# same leniency, a failed INSERT/DELETE/UPDATE reported success and the script
# reached "stand is bootstrapped" without ever having granted permissions,
# bound the shop, or turned on PS_WEBSERVICE. `ps_sql_write` is strict - no
# stderr fold, no swallowed exit code - and `die`s on the first failure.
PS_MYSQL_PWD=""
ps_sql() {
  docker exec -i -e MYSQL_PWD="$PS_MYSQL_PWD" "$PS_MYSQL_CONTAINER" \
    mysql -uroot -N -B "$PS_DB" -e "$1" 2>&1 | grep -v '^mysql: \[Warning\]' || true
}

ps_sql_write() {
  docker exec -i -e MYSQL_PWD="$PS_MYSQL_PWD" "$PS_MYSQL_CONTAINER" \
    mysql -uroot -N -B "$PS_DB" -e "$1" \
    || die "MySQL write failed: $1"
}

wc_wp() {
  docker exec -i "$WC_CONTAINER" wp --allow-root --no-debug --path="$WC_PATH" "$@" 2>/dev/null
}

pg_sql() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "$1"
}

OL_TOKEN=""
# `-f` alone hides the response body on a 4xx/5xx, which is exactly where a
# stand bootstrap tends to fail (a rejected field name, a validation error) -
# so this captures body+status separately and prints the body before dying.
ol_api() {
  local method="$1" path="$2" body="${3:-}" resp status resp_body
  if [ -n "$body" ]; then
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$OL_API_URL$path" \
      -H "Authorization: Bearer $OL_TOKEN" -H 'Content-Type: application/json' -d "$body")"
  else
    resp="$(curl -sS -w '\n%{http_code}' -X "$method" "$OL_API_URL$path" -H "Authorization: Bearer $OL_TOKEN")"
  fi
  status="${resp##*$'\n'}"
  resp_body="${resp%$'\n'*}"
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    die "$method $path -> HTTP $status: $resp_body"
  fi
  printf '%s' "$resp_body"
}

json_field() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }

# ---------------------------------------------------------------------------
# Step 0 - preflight
# ---------------------------------------------------------------------------
step_preflight() {
  log "--- preflight ---"
  for tool in docker curl python3; do
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
WS_RESOURCES="products combinations stock_availables orders order_details customers addresses carriers order_carriers order_states specific_prices product_options product_option_values tax_rules taxes"

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
  created "WooCommerce REST key (${WC_CK:0:10}...)"
}

# ---------------------------------------------------------------------------
# Step 5 - OpenLinker connections
# ---------------------------------------------------------------------------
ol_login() {
  # The API answers `access_token`; older builds answered `accessToken`. Accept
  # either, matching perf/prestashop-baseline/run-scenario.sh:24-28.
  OL_TOKEN="$(curl -fsS -X POST "$OL_API_URL/v1/auth/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$OL_ADMIN_USER\",\"password\":\"$OL_ADMIN_PASSWORD\"}" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("access_token") or d.get("accessToken") or "")')"
  [ -n "$OL_TOKEN" ] || die "login failed at $OL_API_URL as $OL_ADMIN_USER"
}

# Look a connection up by name; echo its id or nothing.
# GET /v1/connections takes no pagination parameters and answers a plain array;
# an unexpected `limit` is rejected with 400 "property limit should not exist".
ol_connection_id_by_name() {
  ol_api GET "/v1/connections" \
    | python3 -c "import json,sys
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get('items',[])
print(next((c['id'] for c in items if c.get('name')=='$1'), ''))"
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

  ol_ensure_connection WC_CONN_ID 'perf-woocommerce' "$(cat <<JSON
{"name":"perf-woocommerce","platformType":"woocommerce",
 "enabledCapabilities":["OrderProcessorManager"],
 "config":{"siteUrl":"$WC_INTERNAL_URL"},
 "credentials":{"consumerKey":"${WC_CK:-}","consumerSecret":"${WC_CS:-}"}}
JSON
)"

  # Two Allegro tenants, differing only by accessToken. Credentials deliberately
  # carry accessToken ONLY - no expiresAt, no refreshToken, no clientId/secret -
  # so ensureFreshToken short-circuits and no request is ever made to the
  # hardcoded real allegro.pl token host (#2856).
  #
  # enabledCapabilities is OrderSource only. Adding OfferManager would arm
  # marketplace.offers.sync, whose task declares no requiredCapability, turning
  # a clean 404 into a retryable CapabilityNotEnabledException that burns ten
  # attempts (#2856).
  ol_ensure_connection ALLEGRO_A_ID 'perf-allegro-a' "$(cat <<JSON
{"name":"perf-allegro-a","platformType":"allegro",
 "enabledCapabilities":["OrderSource"],
 "config":{"environment":"production","apiBaseUrl":"$ALLEGRO_STUB_URL"},
 "credentials":{"accessToken":"stub-token-a"}}
JSON
)"

  ol_ensure_connection ALLEGRO_B_ID 'perf-allegro-b' "$(cat <<JSON
{"name":"perf-allegro-b","platformType":"allegro",
 "enabledCapabilities":["OrderSource"],
 "config":{"environment":"production","apiBaseUrl":"$ALLEGRO_STUB_URL"},
 "credentials":{"accessToken":"stub-token-b"}}
JSON
)"
}

# ---------------------------------------------------------------------------
# Step 6 - Offer identifier mappings for the Allegro tenants
#
# Without these every stub order fails item resolution
# (order-item-ref-resolver.service.ts:56-81), persists as 'awaiting_mapping',
# never reaches a destination create, and burns ten retry attempts over roughly
# 30 hours. The offer-id space must match the stub's (#2856).
# ---------------------------------------------------------------------------
seed_offer_mappings_for() {
  local conn_id="$1" tenant="$2" existing
  [ -n "$conn_id" ] || { warn "no connection id for tenant $tenant - skipping offer mappings"; return 0; }
  existing="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"entityType\"='Offer' AND \"connectionId\"='$conn_id'")"
  if [ "${existing:-0}" -ge "$ALLEGRO_OFFER_POOL_SIZE" ]; then
    found "Offer mappings for $tenant ($existing rows)"; return 0
  fi
  if [ "$VERIFY_ONLY" = 1 ]; then gap "Offer mappings for $tenant (have ${existing:-0}, need $ALLEGRO_OFFER_POOL_SIZE)"; return 0; fi
  would "seed $ALLEGRO_OFFER_POOL_SIZE Offer mappings for $tenant" && return 0

  # Each mapping points at a live, non-stale ProductVariant. A stale one would
  # resolve as 'source_deleted' rather than a usable item.
  local variants
  variants="$(pg_sql "SELECT COUNT(*) FROM product_variants WHERE \"isStale\" = false")"
  [ "${variants:-0}" -gt 0 ] || die "no non-stale product_variants exist - seed the catalogue before the mappings"

  pg_sql "INSERT INTO identifier_mappings (id, \"entityType\", \"internalId\", \"externalId\", \"platformType\", \"connectionId\", \"createdAt\", \"updatedAt\")
          SELECT gen_random_uuid(), 'Offer', v.id, '${tenant}-offer-' || g.n, 'allegro', '$conn_id', NOW(), NOW()
          FROM generate_series(1, $ALLEGRO_OFFER_POOL_SIZE) AS g(n)
          JOIN LATERAL (
            SELECT id FROM product_variants WHERE \"isStale\" = false
            ORDER BY id OFFSET ((g.n - 1) % $variants) LIMIT 1
          ) AS v ON true
          ON CONFLICT DO NOTHING" >/dev/null
  created "$ALLEGRO_OFFER_POOL_SIZE Offer mappings for $tenant"
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
  for pair in "perf-prestashop:${PS_CONN_ID:-}" "perf-woocommerce:${WC_CONN_ID:-}"; do
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
  step_woocommerce
  step_connections
  step_offer_mappings
  step_verify_connections

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

main
