#!/usr/bin/env bash
#
# Set-based catalogue seeder (#2849). Products + variants + inventory_items
# across the two ProductMaster/InventoryMaster-capable connections the lab
# stand already carries (PS + WC, #2854/bootstrap.sh), plus the
# identifier_mappings rows that both master sweeps (#2218/#2219) need to see
# ANY work at all - see the header note below, "the identifier_mappings
# recipe is the load-bearing half" (verbatim from #2849's own issue body).
#
# Seeded ONCE, independent of the order-side dataset size: F2 (#2848) needs
# >=2 InventoryMaster scopes and F5's four catalogue-side sites (#2843) need
# a ~10k-product catalogue with variants, but neither scales with the order
# count. Re-run with a bigger PRODUCT_COUNT and FORCE_SEED=1 to grow it.
#
# Usage: PRODUCT_COUNT=10000 ./seed-catalogue.sh
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="seed-catalogue"

PRODUCT_COUNT="${PRODUCT_COUNT:-10000}"
SEED_OFFSET="${SEED_OFFSET:-0}"
GEN="${SEED_GEN:-1}"
CEILING_SECS="${CEILING_SECS:-120}"

require_connections
refuse_unless_forced "product" "SELECT COUNT(*) FROM products WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'" >/dev/null

log "seeding $PRODUCT_COUNT products (offset=$SEED_OFFSET, gen=$GEN, rng=$SEED_RNG) across connections $PS_CONNECTION_ID (prestashop) / $WC_CONNECTION_ID (woocommerce)"
START="$(epoch)"

seed_sql <<SQL
BEGIN;
SELECT setseed($SEED_RNG);

-- One row per product: variant_count in {1,2,3} (avg 2), matching #2849's
-- "~10 000-product catalogue with variants" rather than one synthetic
-- variant each - a fixed 1 would leave the multi-variant offer/publish paths
-- (#824/#1065/#1836) permanently untested at this row count.
CREATE TEMP TABLE perfseed_products AS
SELECT
  gs.n,
  '${PREFIX}_product_g${GEN}_' || gs.n AS id,
  (1 + (gs.n % 3))::int AS variant_count
FROM generate_series(${SEED_OFFSET} + 1, ${SEED_OFFSET} + ${PRODUCT_COUNT}) AS gs(n);

INSERT INTO products (id, name, sku, price, currency, "taxRate", "taxRateCountry", "taxRateReadAt", "createdAt", "updatedAt")
SELECT
  id,
  'Perfseed product ' || n,
  '${PREFIX^^}-SKU-' || n,
  round((10 + (n % 490) + random())::numeric, 2),
  'PLN',
  '23', 'PL', now(),
  now(), now()
FROM perfseed_products;

CREATE TEMP TABLE perfseed_variants AS
SELECT
  p.id AS "productId",
  p.n,
  v.v,
  p.id || '_v' || v.v AS id
FROM perfseed_products p
CROSS JOIN LATERAL generate_series(1, p.variant_count) AS v(v);

INSERT INTO product_variants (id, "productId", sku, attributes, ean, price, "taxRate", "taxRateCountry", "taxRateReadAt", "createdAt", "updatedAt")
SELECT
  id, "productId",
  '${PREFIX^^}-VAR-' || n || '-' || v,
  jsonb_build_object('size', (ARRAY['S','M','L','XL'])[1 + (v % 4)]),
  lpad((5900000000000 + n * 10 + v)::text, 13, '0'),
  round((10 + (n % 490) + random())::numeric, 2),
  '23', 'PL', now(), now(), now()
FROM perfseed_variants;

-- Both connections claim every seeded variant (F2's >=2 InventoryMaster
-- scopes requirement) - inventory_items.sourceConnectionId is TEXT, not a
-- FK, so no cast is needed against the connection uuid.
INSERT INTO inventory_items (id, "productId", "productVariantId", "availableQuantity", "sourceConnectionId", "updatedAt")
SELECT
  '${PREFIX}_inv_' || conn.tag || '_' || v.id,
  v."productId", v.id,
  (10 + (v.n % 200))::int,
  conn.id,
  now()
FROM perfseed_variants v
CROSS JOIN (VALUES ('${PS_CONNECTION_ID}', 'ps'), ('${WC_CONNECTION_ID}', 'wc')) AS conn(id, tag);

-- identifier_mappings - the load-bearing half (#2849): both master sweeps
-- (master.product.syncFromSweep / master.inventory.syncFromSweep) page
-- CORE_ENTITY_TYPE.Product through listExternalIdsByConnection, and see
-- ZERO work on a connection with no 'Product' mapping regardless of catalogue
-- row count. So every product AND every variant gets one mapping row per
-- connection, entityType 'Product' / 'ProductVariant' respectively.
INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId", "createdAt", "updatedAt")
SELECT
  'Product', p.id,
  '${PREFIX^^}-EXT-PROD-' || conn.tag || '-' || p.n,
  conn.platform, conn.id::uuid, now(), now()
FROM perfseed_products p
CROSS JOIN (VALUES ('${PS_CONNECTION_ID}', 'ps', 'prestashop'), ('${WC_CONNECTION_ID}', 'wc', 'woocommerce')) AS conn(id, tag, platform);

INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId", "createdAt", "updatedAt")
SELECT
  'ProductVariant', v.id,
  '${PREFIX^^}-EXT-VAR-' || conn.tag || '-' || v.n || '-' || v.v,
  conn.platform, conn.id::uuid, now(), now()
FROM perfseed_variants v
CROSS JOIN (VALUES ('${PS_CONNECTION_ID}', 'ps', 'prestashop'), ('${WC_CONNECTION_ID}', 'wc', 'woocommerce')) AS conn(id, tag, platform);

COMMIT;
SQL

ELAPSED=$(( $(epoch) - START ))
seed_check_ceiling "catalogue ($PRODUCT_COUNT products)" "$ELAPSED" "$CEILING_SECS"

vacuum_analyze_reset products product_variants inventory_items identifier_mappings

# Post-seed distribution assertion (#2849 AC: "a post-seed query checks the
# actual distribution against it within a stated tolerance"), rather than a
# prose claim of "realistic".
N_PRODUCTS="$(pg_sql "SELECT COUNT(*) FROM products WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'")"
N_VARIANTS="$(pg_sql "SELECT COUNT(*) FROM product_variants WHERE id LIKE '${PREFIX}\\_product\\_%' ESCAPE '\\'")"
N_INV="$(pg_sql "SELECT COUNT(*) FROM inventory_items WHERE id LIKE '${PREFIX}\\_inv\\_%' ESCAPE '\\'")"
N_MAP="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"externalId\" LIKE '${PREFIX^^}-EXT-%'")"
AVG_VARIANTS_PER_PRODUCT="$(pg_sql "SELECT round(${N_VARIANTS}::numeric / NULLIF(${N_PRODUCTS},0), 3)")"

log "distribution: products=$N_PRODUCTS variants=$N_VARIANTS (avg ${AVG_VARIANTS_PER_PRODUCT}/product, target 2.0 +/- 0.1) inventory_items=$N_INV (target 2x variants, both connections) identifier_mappings=$N_MAP (target 2x(products+variants))"

EXPECT_INV=$(( N_VARIANTS * 2 ))
EXPECT_MAP=$(( (N_PRODUCTS + N_VARIANTS) * 2 ))
[ "$N_INV" -eq "$EXPECT_INV" ] || warn "distribution check: inventory_items=$N_INV, expected exactly $EXPECT_INV (variants x 2 connections)"
[ "$N_MAP" -eq "$EXPECT_MAP" ] || warn "distribution check: identifier_mappings=$N_MAP, expected exactly $EXPECT_MAP ((products+variants) x 2 connections)"

log "seed-catalogue done in ${ELAPSED}s: products=$N_PRODUCTS variants=$N_VARIANTS inventory_items=$N_INV identifier_mappings=$N_MAP rng_seed=$SEED_RNG"
