#!/usr/bin/env bash
#
# WooCommerce-side catalogue seeder, and the OpenLinker mapping that resolves
# against it (#3025).
#
# Why this exists, stated plainly. `WooCommerceOrderProcessorAdapter.
# resolveLineItems` needs a WooCommerce `Product`/`ProductVariant`
# identifier_mappings row for every OL product/variant an order's line
# items reference - and unlike PrestaShop (whose ProductMaster capability is
# enabled on every perf connection and auto-syncs its own real catalogue),
# `perf-woocommerce` is created with `enabledCapabilities: [
# "OrderProcessorManager"]` alone (bootstrap.sh step_connections) - no
# ProductMaster, so nothing ever writes a WooCommerce Product mapping at
# all. Every order fanned out to WooCommerce as a destination therefore dies
# at line-item resolution with "No WC product mapping for OL product ...",
# and - because OrderSyncService fans destinations out under
# Promise.allSettled - the job still reports outcome 'ok' while WooCommerce
# receives nothing. That is not evidence about the WooCommerce integration;
# it is evidence nothing has ever reached it.
#
# The seed-catalogue.sh 10k pool (F5's read-path fixture) cannot fix this
# either way: it mints identifier_mappings rows whose externalId is a
# SYNTHETIC STRING shared verbatim across both the PrestaShop and
# WooCommerce connections ('PERFSEED-EXT-PROD-{tag}-{n}') - present but
# non-numeric, so WooCommerce's own `toPositiveInt` guard refuses it as
# "Corrupted mapping" (the OTHER resolveLineItems failure branch). Neither
# of those synthetic ids names a real product anywhere, on either shop, and
# that pool is deliberately never touched by a real order create (see its
# own header note in seed-catalogue.sh) - so widening its expression alone
# would not unblock a single real order.
#
# The actual target is the pool bootstrap.sh's own `seed_offer_mappings_for`
# already selects (see its header comment, "AN OFFER MUST POINT AT A PRODUCT
# THE DESTINATION ACTUALLY HAS", #2847): every non-stale product_variants row
# whose PRODUCT already carries a real, NUMERIC PrestaShop external id -
# i.e. exactly the products a real order's line items can ever resolve to,
# whether they arrived via an actual ProductMaster sync (`ol_product_*`) or
# via seed-shop-catalogue.sh's cloned real-shop catalogue
# (`perfseed_product_s*`). This script reads that SAME set straight out of
# identifier_mappings/product_variants - it never depends on which seeder
# populated it - clones ONE simple WooCommerce product per distinct product
# (via the WC PHP API, `WC_Product_Simple`, the docker/woocommerce/
# 01-seed-wc-data.sh precedent - no HTTP auth needed), and writes the
# matching identifier_mappings rows in the ADAPTER's own shapes:
#   Product        -> the WC post id, decimal string   (toPositiveInt)
#   ProductVariant -> 'product:' || wcId, synthetic     (isSyntheticVariantExternalId)
# every one of a product's non-stale variants pointing at the SAME simple WC
# product - WooCommerce gets no real variation of its own, which is fine:
# resolveLineItems only ever needs `product_id` (+ an OPTIONAL
# `variation_id`, left unset for a synthetic mapping) to build a valid line
# item, not a commercially accurate one.
#
# Idempotent and REPAIR-shaped rather than generation-shaped (the
# seed-shop-catalogue.sh "generation, refuse unless FORCE_SEED" pattern does
# not fit a pool this script does not own the size of): every run creates
# only the products still missing a WooCommerce mapping and leaves the rest
# alone, exactly like bootstrap.sh's own found/gap/created seeding.
#
# Usage: ./seed-wc-catalogue.sh
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="seed-wc-catalogue"

SKU_PREFIX="PERFWC-"
CEILING_SECS="${CEILING_SECS:-300}"

require_connections
log "targeting connection $WC_CONNECTION_ID (PrestaShop-real product pool sourced from $PS_CONNECTION_ID)"
START="$(epoch)"

# ---------------------------------------------------------------------------
# Candidates: one row per PS-real product, carrying every non-stale variant
# id it owns. Mirrors bootstrap.sh's `real_clause` / `usable` query exactly
# (see its own header comment), grouped up to product grain because a
# WooCommerce Product mapping is per-PRODUCT while every one of the
# product's variants needs its own (synthetic) ProductVariant row.
# ---------------------------------------------------------------------------
CANDIDATES_JSON="$(pg_sql "
  SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.\"olId\"), '[]'::jsonb)
  FROM (
    SELECT
      p.id AS \"olId\", p.sku, p.name, p.price,
      jsonb_agg(pv.id) AS \"variantIds\"
    FROM products p
    JOIN identifier_mappings m
      ON m.\"entityType\"='Product' AND m.\"connectionId\"='$PS_CONNECTION_ID'
     AND m.\"internalId\"=p.id AND m.\"externalId\" ~ '^[0-9]+\$'
    JOIN product_variants pv ON pv.\"productId\"=p.id AND pv.\"isStale\"=false
    GROUP BY p.id, p.sku, p.name, p.price
  ) row
")"

N_CANDIDATES="$(jq 'length' <<<"$CANDIDATES_JSON")"
[ "${N_CANDIDATES:-0}" -gt 0 ] || die "seed-wc-catalogue: no non-stale product_variants map to a real (numeric-id) PrestaShop product - install/sync the PrestaShop catalogue first (bootstrap.sh step_connections, or seed-shop-catalogue.sh)."

EXISTING_WC_JSON="$(pg_sql "SELECT COALESCE(jsonb_agg(\"internalId\"),'[]'::jsonb) FROM identifier_mappings WHERE \"entityType\"='Product' AND \"connectionId\"='$WC_CONNECTION_ID'")"
TO_CREATE_JSON="$(jq -c --argjson existing "$EXISTING_WC_JSON" \
  '[ .[] | select((.olId as $id | ($existing | index($id))) == null) ]' <<<"$CANDIDATES_JSON")"
N_TO_CREATE="$(jq 'length' <<<"$TO_CREATE_JSON")"

log "PrestaShop-real products: $N_CANDIDATES total, $N_TO_CREATE lacking a WooCommerce mapping"

if [ "$N_TO_CREATE" = 0 ]; then
  log "found: every destination-resolvable product already carries a WooCommerce mapping - nothing to do"
else
  # ---------------------------------------------------------------------------
  # Clone via the WC PHP API (wp eval), not raw SQL against wp_posts/
  # wp_postmeta: WooCommerce's own save() path is what stamps every meta row
  # (including wp_wc_product_meta_lookup, which its own product queries read)
  # correctly across versions - the same reasoning docker/woocommerce/
  # 01-seed-wc-data.sh already relies on. The plan crosses via `docker cp`
  # rather than a `wp eval` argument: WP-CLI's argv has no room for an N-row
  # JSON blob, and the container's docker-exec user cannot remove a
  # docker-cp'd file it does not own, so cleanup runs as uid 0 explicitly.
  # ---------------------------------------------------------------------------
  PLAN_LOCAL="$(mktemp)"
  trap 'rm -f "$PLAN_LOCAL"' EXIT
  jq -c --arg prefix "$SKU_PREFIX" \
    '[ .[] | {olId, sku: ($prefix + .olId), name: ("Perf WC " + .name), price: ((.price // 0) | tostring), stock: 100} ]' \
    <<<"$TO_CREATE_JSON" > "$PLAN_LOCAL"

  docker cp "$PLAN_LOCAL" "$WC_CONTAINER:/tmp/perf-wc-plan.json" \
    || die "seed-wc-catalogue: docker cp of the product plan into $WC_CONTAINER failed"
  # docker cp preserves the copying HOST user's ownership/mode (0600, this
  # host's uid) - the container's wp-cli process runs as a DIFFERENT uid
  # (bitnami's non-root default) and cannot read it back without this: found
  # live as a silent "Permission denied" PHP warning wc_wp's own stderr
  # redirect (2>/dev/null) would otherwise have hidden completely.
  docker exec -u 0 -i "$WC_CONTAINER" chmod 644 /tmp/perf-wc-plan.json \
    || die "seed-wc-catalogue: could not make the product plan readable inside $WC_CONTAINER"

  # NOT via wc_wp - that helper redirects stderr to /dev/null, which is
  # exactly what hid the docker-cp ownership mismatch (a silent PHP warning,
  # empty output, no diagnostic anywhere) the first time this ran live.
  WP_EVAL_OUT="$(mktemp)"
  if ! docker exec -i "$WC_CONTAINER" wp --allow-root --no-debug --path="$WC_PATH" eval '
    $plan = json_decode(file_get_contents("/tmp/perf-wc-plan.json"), true);
    if (!is_array($plan)) { fwrite(STDERR, "unreadable plan\n"); exit(1); }
    $out = array();
    foreach ($plan as $row) {
      $p = new WC_Product_Simple();
      $p->set_name($row["name"]);
      $p->set_sku($row["sku"]);
      $p->set_regular_price((string) $row["price"]);
      $p->set_manage_stock(true);
      $p->set_stock_quantity((int) $row["stock"]);
      $p->set_status("publish");
      $id = $p->save();
      $out[] = array("olId" => $row["olId"], "wcId" => (int) $id);
    }
    echo json_encode($out);
  ' > "$WP_EVAL_OUT" 2>&1; then
    cat "$WP_EVAL_OUT" >&2
    die "seed-wc-catalogue: wp eval product creation failed (output above) - nothing was mapped."
  fi
  docker exec -u 0 -i "$WC_CONTAINER" rm -f /tmp/perf-wc-plan.json || true

  CREATED_JSON="$(tail -1 "$WP_EVAL_OUT")"
  rm -f "$WP_EVAL_OUT"
  N_CREATED="$(jq 'length' <<<"$CREATED_JSON" 2>/dev/null || printf 0)"
  [ "${N_CREATED:-0}" = "$N_TO_CREATE" ] \
    || die "seed-wc-catalogue: asked WooCommerce to create $N_TO_CREATE product(s), it reports $N_CREATED - raw output: $CREATED_JSON. Nothing was mapped."

  # ---------------------------------------------------------------------------
  # Project the (olId -> wcId) result onto identifier_mappings: one Product
  # row per product, one (synthetic) ProductVariant row per variant that
  # product's candidate row carried.
  # ---------------------------------------------------------------------------
  # Two explicit passes rather than one shape-mixing query, both driven off
  # the same $CREATED_JSON x $TO_CREATE_JSON join, so there is exactly one
  # source of truth for "which wcId does this olId now have".
  PRODUCT_ROWS_TSV="$(jq -r '.[] | [.olId, (.wcId|tostring)] | @tsv' <<<"$CREATED_JSON")"
  # `isSyntheticVariantExternalId` (woocommerce-variant-id.ts) tests only the
  # `product:` PREFIX - resolveLineItems never parses what follows it (a
  # synthetic mapping resolves `product_id` from the separate `Product` row
  # and leaves `variation_id` unset either way) - so every variant of one OL
  # product can legitimately point at the SAME simple WC product, as long as
  # each row's externalId is still distinct enough to satisfy
  # identifier_mappings' own (entityType, platformType, connectionId,
  # externalId) uniqueness. `#<ordinal>` is appended for exactly that: a
  # WC-facing seller cannot tell these variants apart on this stand (a real
  # multi-variant integration would model them as WC variations of a
  # WC_Product_Variable instead), which is an accepted simplification for a
  # load-test fixture that only needs the order to be CREATABLE.
  VARIANT_ROWS_TSV="$(jq -r --argjson plan "$TO_CREATE_JSON" '
    (map({(.olId): .wcId}) | add // {}) as $wcIdByProduct
    | $plan[] | . as $row
    | ($wcIdByProduct[$row.olId]) as $wcId
    | select($wcId != null)
    | ($row.variantIds | to_entries[]) as $e
    | [$e.value, ("product:" + ($wcId|tostring) + "#" + ($e.key|tostring))] | @tsv
  ' <<<"$CREATED_JSON")"

  seed_sql <<SQL
BEGIN;

CREATE TEMP TABLE perf_wc_products (ol_id text, wc_id text) ON COMMIT DROP;
COPY perf_wc_products FROM STDIN;
${PRODUCT_ROWS_TSV}
\.

CREATE TEMP TABLE perf_wc_variants (variant_id text, external_id text) ON COMMIT DROP;
COPY perf_wc_variants FROM STDIN;
${VARIANT_ROWS_TSV}
\.

INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId", "createdAt", "updatedAt")
SELECT 'Product', ol_id, wc_id, 'woocommerce', '${WC_CONNECTION_ID}'::uuid, now(), now()
FROM perf_wc_products;

INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId", "createdAt", "updatedAt")
SELECT 'ProductVariant', variant_id, external_id, 'woocommerce', '${WC_CONNECTION_ID}'::uuid, now(), now()
FROM perf_wc_variants;

COMMIT;
SQL

  log "mapped $N_CREATED WooCommerce product(s) ($(printf '%s\n' "$VARIANT_ROWS_TSV" | grep -c . || true) variant mapping row(s))"
fi

ELAPSED=$(( $(epoch) - START ))
seed_check_ceiling "WooCommerce catalogue ($N_TO_CREATE product(s) created this run)" "$ELAPSED" "$CEILING_SECS"

# ---------------------------------------------------------------------------
# Referential check, the seed-shop-catalogue.sh precedent: a mapping row
# count proves nothing on its own (that is the whole defect being fixed) -
# take the external ids OpenLinker now holds for WooCommerce and ask
# WooCommerce how many of them resolve to a real product.
# ---------------------------------------------------------------------------
N_OL_MAP="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"entityType\"='Product' AND \"connectionId\"='$WC_CONNECTION_ID'")"
N_OL_VARMAP="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"entityType\"='ProductVariant' AND \"connectionId\"='$WC_CONNECTION_ID' AND \"externalId\" LIKE 'product:%'")"
DANGLING="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"entityType\"='Product' AND \"connectionId\"='$WC_CONNECTION_ID' AND \"externalId\" !~ '^[0-9]+\$'")"
[ "$DANGLING" = 0 ] || die "seed-wc-catalogue: referential check: $DANGLING WooCommerce Product mapping(s) carry a non-numeric externalId - those name no WooCommerce product."

MAPPED_IDS_JSON="$(pg_sql "SELECT COALESCE(jsonb_agg(\"externalId\"),'[]'::jsonb) FROM identifier_mappings WHERE \"entityType\"='Product' AND \"connectionId\"='$WC_CONNECTION_ID'")"
RESOLVED="$(printf '%s' "$MAPPED_IDS_JSON" | wc_wp eval '
  $ids = json_decode(file_get_contents("php://stdin"), true);
  $n = 0;
  foreach ($ids as $id) { if (wc_get_product((int) $id)) { $n++; } }
  echo $n;
' 2>/dev/null || printf 'unknown')"
SAMPLED="$(jq 'length' <<<"$MAPPED_IDS_JSON")"
log "referential check: $RESOLVED of $SAMPLED mapped WooCommerce product(s) resolve to a real wc_get_product() row"
[ "$RESOLVED" = "$SAMPLED" ] \
  || die "seed-wc-catalogue: referential check FAILED: only $RESOLVED of $SAMPLED Product mappings name a product WooCommerce holds"

log "seed-wc-catalogue done in ${ELAPSED}s: identifier_mappings Product=$N_OL_MAP ProductVariant(synthetic)=$N_OL_VARMAP, all referentially verified"
