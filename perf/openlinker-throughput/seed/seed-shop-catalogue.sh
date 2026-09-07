#!/usr/bin/env bash
#
# Shop-side catalogue seeder, and the OpenLinker projection that RESOLVES
# against it.
#
# Why this exists, stated plainly, because the distinction is the whole point:
# `seed-catalogue.sh` seeds OpenLinker's OWN tables and mints
# `identifier_mappings` rows whose `externalId` is a synthetic string
# (`PERFSEED-EXT-PROD-ps-1`). No such product exists in PrestaShop. Every
# measurement that resolves such a mapping into the shop therefore exercises
# the NOT-FOUND path - and `OrderSyncService` fans out under
# `Promise.allSettled`, so the job still reports `outcome: 'ok'` while the shop
# receives nothing (bootstrap.sh's own note, "Offer identifier mappings").
#
# bootstrap.sh works around that by pointing every Offer mapping at a variant
# whose product carries a NUMERIC PrestaShop external id, and warns that on a
# six-product shop the 200-offer pool collapses onto eleven variants. Its own
# comment names the fix: "A numeric test rather than a hardcoded list, so a
# stand that later grows a real catalogue picks it up automatically." This
# script grows that catalogue.
#
# The external-id shapes are the ADAPTER's, not this script's invention:
#   Product        -> String(id_product)              prestashop-product-master.adapter.ts:538
#   ProductVariant -> String(id_product_attribute)    :678
#   ProductVariant -> 'product:' || id_product        :633   (SIMPLE product, synthetic)
# The synthetic form is not cosmetic: the inventory sweep filters synthetic ids
# by that exact prefix, so a simple product mapped under a bare numeric id
# would be swept as though it had a real combination.
#
# DIVERSITY is the other half of "realistic". Cloning ONE template N times
# (the perf/prestashop-baseline/seed-products.sh shape) gives structurally
# complete rows and no variety at all - one price, one category, one
# combination count - so cache-miss behaviour, payload-size spread and
# category breadth stay unmeasurable. This clones round-robin from EVERY
# template the shop has (a mix of simple and multi-variant) and then varies
# price, category, manufacturer, name and stock per row.
#
# Variation is DETERMINISTIC arithmetic on the ordinal, never RAND(): re-running
# with the same count, offset and template set reproduces the identical
# catalogue, which is what lets a later campaign regenerate this dataset. The
# multipliers (1, 31, 13, 7919, 37, 17) are chosen coprime to the rotation
# lengths so the rotations do not phase-lock - a product's category is not a
# function of its template.
#
# Every PrestaShop row carries the `PERFSHOP-` reference prefix and every
# OpenLinker row carries the `perfseed_product_s` id prefix, so cleanup.sh can
# remove the whole generation by tag alone and can never touch demo data.
#
# Usage: SHOP_PRODUCT_COUNT=50000 ./seed-shop-catalogue.sh
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="seed-shop-catalogue"

SHOP_PRODUCT_COUNT="${SHOP_PRODUCT_COUNT:-50000}"
SHOP_SEED_OFFSET="${SHOP_SEED_OFFSET:-0}"
SHOP_PREFIX="PERFSHOP-"
# OL-side id stem. Deliberately shares the `perfseed_product_` stem with
# seed-catalogue.sh so cleanup.sh's existing products / product_variants
# patterns already match it; the trailing `s` distinguishes this generation.
OL_STEM="${PREFIX}_product_s"
CEILING_SECS="${CEILING_SECS:-900}"

require_connections
ps_mysql_pwd

# A strict MySQL runner. lib.sh's ps_sql ends in `|| true` - correct for a
# lenient probe, fatal for a seeder: a failed INSERT would print an ERROR line,
# exit 0, and the script would carry on and assert a distribution over rows
# that were never written. This captures the output instead of piping it, so
# neither the exit status nor an ERROR line can be lost to a pipeline.
ps_seed_sql() {
  local out rc=0
  out="$(docker exec -i -e MYSQL_PWD="$PS_MYSQL_PWD" "$PS_MYSQL_CONTAINER" \
          mysql -uroot -N -B "$PS_DB" 2>&1)" || rc=$?
  # No `grep -q` and no pipe: under `set -o pipefail` a grep that closes the
  # pipe early SIGPIPEs the writer and reports failure on success.
  case "$out" in
    *"ERROR "*) printf '%s\n' "$out" >&2; die "PrestaShop seed SQL reported an ERROR (above)" ;;
  esac
  [ "$rc" -eq 0 ] || { printf '%s\n' "$out" >&2; die "PrestaShop seed SQL exited $rc (above)"; }
  printf '%s\n' "$out" | sed '/^mysql: \[Warning\]/d'
}

# ---------------------------------------------------------------------------
# Template and category discovery. Whatever real rows the shop already has
# become the clone templates, so the seeded catalogue inherits the shop's OWN
# structural mix rather than one hand-picked shape.
# ---------------------------------------------------------------------------
TEMPLATE_IDS="${TEMPLATE_IDS:-}"
if [ -z "$TEMPLATE_IDS" ]; then
  TEMPLATE_IDS="$(ps_sql "SELECT GROUP_CONCAT(id_product ORDER BY id_product) FROM ps_product WHERE active=1 AND reference NOT LIKE '${SHOP_PREFIX}%'" | tail -1)"
fi
[ -n "$TEMPLATE_IDS" ] || die "no template products in ps_product - this script clones from what the shop already has"
TEMPLATE_COUNT="$(printf '%s' "$TEMPLATE_IDS" | tr ',' '\n' | grep -c . || true)"
[ "${TEMPLATE_COUNT:-0}" -gt 0 ] || die "could not count templates from [$TEMPLATE_IDS]"

LEAF_CATEGORIES="${LEAF_CATEGORIES:-}"
if [ -z "$LEAF_CATEGORIES" ]; then
  LEAF_CATEGORIES="$(ps_sql "SELECT GROUP_CONCAT(id_category ORDER BY id_category) FROM ps_category WHERE active=1 AND id_category > 2" | tail -1)"
fi
[ -n "$LEAF_CATEGORIES" ] || die "no leaf categories (id_category > 2) found"
LEAF_COUNT="$(printf '%s' "$LEAF_CATEGORIES" | tr ',' '\n' | grep -c . || true)"

MANU_COUNT="$(ps_sql "SELECT COUNT(*) FROM ps_manufacturer" | tail -1)"
MANU_COUNT="${MANU_COUNT:-0}"
MANU_SLOTS=$(( MANU_COUNT + 1 ))   # slot 0 = no manufacturer

log "templates=[$TEMPLATE_IDS] ($TEMPLATE_COUNT) leaf_categories=[$LEAF_CATEGORIES] ($LEAF_COUNT) manufacturers=$MANU_COUNT"

EXISTING_SHOP="$(ps_sql "SELECT COUNT(*) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
EXISTING_SHOP="${EXISTING_SHOP:-0}"
if [ "$EXISTING_SHOP" != "0" ] && [ "${FORCE_SEED:-0}" != "1" ]; then
  die "refuse: $EXISTING_SHOP PrestaShop product(s) already carry the '${SHOP_PREFIX}' prefix.
  A second generation under one prefix makes cleanup counts and 'which generation is this'
  both stop meaning anything, and would mint duplicate references and duplicate ean13
  barcodes - a duplicate barcode is exactly what offer linking refuses to resolve.
  Run seed/cleanup.sh first, or FORCE_SEED=1 with SHOP_SEED_OFFSET=$EXISTING_SHOP."
fi

# ---------------------------------------------------------------------------
# Column lists, read from information_schema so a PrestaShop upgrade that adds
# a column does not silently drop it from the clone.
# ---------------------------------------------------------------------------
cols_except() {
  local table="$1" skip="$2"
  ps_sql "SELECT GROUP_CONCAT(CONCAT(CHAR(96),COLUMN_NAME,CHAR(96)) ORDER BY ORDINAL_POSITION)
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA='$PS_DB' AND TABLE_NAME='$table' AND COLUMN_NAME NOT IN ($skip)" | tail -1
}
qualify() { printf '%s' "$1" | sed 's/`[^`]*`/p.&/g'; }

PROD_COLS=$(cols_except ps_product '"id_product","reference","ean13","date_add","date_upd","id_category_default","id_manufacturer","price","wholesale_price","cache_default_attribute"')
SHOP_COLS=$(cols_except ps_product_shop '"id_product","id_category_default","price","wholesale_price","cache_default_attribute","date_add","date_upd"')
LANG_COLS=$(cols_except ps_product_lang '"id_product","name","link_rewrite"')
PA_COLS=$(cols_except ps_product_attribute '"id_product_attribute","id_product","reference","ean13","price"')
PAS_COLS=$(cols_except ps_product_attribute_shop '"id_product_attribute","id_product"')
PAC_COLS=$(cols_except ps_product_attribute_combination '"id_product_attribute"')
STOCK_COLS=$(cols_except ps_stock_available '"id_stock_available","id_product","id_product_attribute","quantity","physical_quantity"')

for v in PROD_COLS SHOP_COLS LANG_COLS PA_COLS PAS_COLS PAC_COLS STOCK_COLS; do
  [ -n "${!v}" ] || die "could not read column list for $v"
done

log "seeding $SHOP_PRODUCT_COUNT PrestaShop products (offset=$SHOP_SEED_OFFSET, prefix=${SHOP_PREFIX})"
START="$(epoch)"

# ---------------------------------------------------------------------------
# PrestaShop side.
#
# The combination-id arithmetic differs from the single-template precedent:
# with several templates the combinations-per-product is NOT constant, so
# `@pabase + (n-1)*@vcount + rnk` does not hold. A materialised map assigns
# every (clone, template-combination) pair a global ROW_NUMBER instead, and
# every child table JOINS that map rather than recomputing an id - which also
# makes the assignment auditable after the fact.
#
# Each temporary table is referenced at most once per statement: MySQL cannot
# reopen a TEMPORARY table within one query, and that limitation is the reason
# the plan is materialised rather than expressed as repeated subqueries.
# ---------------------------------------------------------------------------
ps_seed_sql <<SQL
SET SESSION sql_mode='';
SET SESSION cte_max_recursion_depth = 2000000;

SET @base   := (SELECT GREATEST(MAX(id_product), 200000) + 1 FROM ps_product);
SET @pabase := (SELECT GREATEST(MAX(id_product_attribute), 200000) + 1 FROM ps_product_attribute);

CREATE TEMPORARY TABLE perf_tplmap (slot INT PRIMARY KEY, tpl INT);
INSERT INTO perf_tplmap (slot, tpl)
SELECT ROW_NUMBER() OVER (ORDER BY id_product) - 1, id_product
FROM ps_product WHERE FIND_IN_SET(id_product, '${TEMPLATE_IDS}');

CREATE TEMPORARY TABLE perf_catmap (slot INT PRIMARY KEY, cat INT);
INSERT INTO perf_catmap (slot, cat)
SELECT ROW_NUMBER() OVER (ORDER BY id_category) - 1, id_category
FROM ps_category WHERE FIND_IN_SET(id_category, '${LEAF_CATEGORIES}');

-- Slot 0 is deliberately "no manufacturer": a real catalogue has unbranded
-- rows, and a NOT NULL id_manufacturer on every product is its own distortion.
CREATE TEMPORARY TABLE perf_manumap (slot INT PRIMARY KEY, manu INT);
INSERT INTO perf_manumap (slot, manu) VALUES (0, 0);
INSERT INTO perf_manumap (slot, manu)
SELECT ROW_NUMBER() OVER (ORDER BY id_manufacturer), id_manufacturer FROM ps_manufacturer;

CREATE TEMPORARY TABLE perf_seq (n INT PRIMARY KEY);
INSERT INTO perf_seq
WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < ${SHOP_PRODUCT_COUNT})
SELECT n + ${SHOP_SEED_OFFSET} FROM s;

CREATE TEMPORARY TABLE perf_plan (
  n INT PRIMARY KEY, id_new INT, tpl INT, cat INT, manu INT,
  price DECIMAL(20,6), wholesale DECIMAL(20,6), qty INT,
  UNIQUE KEY (id_new), KEY (tpl)
);
INSERT INTO perf_plan (n, id_new, tpl, cat, manu, price, wholesale, qty)
SELECT q.n, @base + q.n, t.tpl, c.cat, m.manu,
       ROUND(4.99 + ((q.n * 7919) % 300000) / 100.0, 2),
       ROUND((4.99 + ((q.n * 7919) % 300000) / 100.0) * 0.55, 2),
       (q.n * 37) % 250
FROM perf_seq q
JOIN perf_tplmap t ON t.slot = q.n % ${TEMPLATE_COUNT}
JOIN perf_catmap c ON c.slot = (q.n * 31) % ${LEAF_COUNT}
JOIN perf_manumap m ON m.slot = (q.n * 13) % ${MANU_SLOTS};

INSERT INTO ps_product (id_product, reference, ean13, date_add, date_upd, id_category_default, id_manufacturer, price, wholesale_price, cache_default_attribute, ${PROD_COLS})
SELECT k.id_new,
       CONCAT('${SHOP_PREFIX}', LPAD(k.n, 6, '0')),
       LPAD(6000000000000 + k.n, 13, '0'),
       NOW(), NOW(), k.cat, k.manu, k.price, k.wholesale, 0, $(qualify "$PROD_COLS")
FROM perf_plan k JOIN ps_product p ON p.id_product = k.tpl;

INSERT INTO ps_product_shop (id_product, id_category_default, price, wholesale_price, cache_default_attribute, date_add, date_upd, ${SHOP_COLS})
SELECT k.id_new, k.cat, k.price, k.wholesale, 0, NOW(), NOW(), $(qualify "$SHOP_COLS")
FROM perf_plan k JOIN ps_product_shop p ON p.id_product = k.tpl;

-- Names from a small vocabulary crossed with the ordinal: varied enough that a
-- name search has something to discriminate on, and stable across re-runs.
INSERT INTO ps_product_lang (id_product, name, link_rewrite, ${LANG_COLS})
SELECT k.id_new,
       CONCAT(
         ELT(1 + (k.n % 12), 'Bawelniana','Skorzana','Ceramiczna','Drewniana','Stalowa','Szklana','Lniana','Welniana','Plastikowa','Aluminiowa','Jedwabna','Bambusowa'),
         ' ',
         ELT(1 + ((k.n DIV 12) % 10), 'koszulka','torba','kubek','lampa','krzeslo','zegar','doniczka','poduszka','ramka','koszyk'),
         ' ', LPAD(k.n, 6, '0')),
       CONCAT('perfshop-', LPAD(k.n, 6, '0')),
       $(qualify "$LANG_COLS")
FROM perf_plan k JOIN ps_product_lang p ON p.id_product = k.tpl;

-- Assigned leaf category, plus the shop home category (2) every product keeps.
INSERT INTO ps_category_product (id_category, id_product, position)
SELECT k.cat, k.id_new, 0 FROM perf_plan k;
INSERT INTO ps_category_product (id_category, id_product, position)
SELECT 2, k.id_new, 0 FROM perf_plan k WHERE k.cat <> 2;

-- One row per (clone, template combination). A clone of a SIMPLE template
-- contributes nothing here, which is what keeps the catalogue a genuine mix
-- rather than uniformly multi-variant.
CREATE TEMPORARY TABLE perf_pa_map (
  new_pa INT PRIMARY KEY, n INT, id_new INT, tpl INT, tpl_pa INT, rnk INT,
  qty INT, KEY (id_new), KEY (tpl_pa)
);
INSERT INTO perf_pa_map (new_pa, n, id_new, tpl, tpl_pa, rnk, qty)
SELECT @pabase + ROW_NUMBER() OVER (ORDER BY k.n, pa.id_product_attribute),
       k.n, k.id_new, k.tpl, pa.id_product_attribute,
       ROW_NUMBER() OVER (PARTITION BY k.n ORDER BY pa.id_product_attribute),
       0
FROM perf_plan k
JOIN ps_product_attribute pa ON pa.id_product = k.tpl;

UPDATE perf_pa_map SET qty = ((n * 17) + rnk * 11) % 180;

INSERT INTO ps_product_attribute (id_product_attribute, id_product, reference, ean13, price, ${PA_COLS})
SELECT m.new_pa, m.id_new,
       CONCAT('${SHOP_PREFIX}', LPAD(m.n, 6, '0'), '-V', m.rnk),
       LPAD(6100000000000 + (m.new_pa - @pabase), 13, '0'),
       ROUND((m.rnk - 1) * 5, 2),
       $(qualify "$PA_COLS")
FROM perf_pa_map m JOIN ps_product_attribute p ON p.id_product_attribute = m.tpl_pa;

INSERT INTO ps_product_attribute_shop (id_product_attribute, id_product, ${PAS_COLS})
SELECT m.new_pa, m.id_new, $(qualify "$PAS_COLS")
FROM perf_pa_map m JOIN ps_product_attribute_shop p ON p.id_product_attribute = m.tpl_pa;

INSERT INTO ps_product_attribute_combination (id_product_attribute, ${PAC_COLS})
SELECT m.new_pa, $(qualify "$PAC_COLS")
FROM perf_pa_map m JOIN ps_product_attribute_combination p ON p.id_product_attribute = m.tpl_pa;

-- cache_default_attribute must point at the CLONE's own combination. The
-- single-template precedent copies the template's value verbatim, leaving
-- every clone pointing at a combination that belongs to another product -
-- harmless in SQL, wrong in every read that resolves a default combination.
-- These templates all carry default_on = NULL, so "lowest combination" is the
-- rule, which is what PrestaShop itself falls back to.
CREATE TEMPORARY TABLE perf_default_pa (id_new INT PRIMARY KEY, pa INT);
INSERT INTO perf_default_pa (id_new, pa)
SELECT id_new, MIN(new_pa) FROM perf_pa_map GROUP BY id_new;

UPDATE ps_product pr JOIN perf_default_pa d ON d.id_new = pr.id_product
SET pr.cache_default_attribute = d.pa;

CREATE TEMPORARY TABLE perf_default_pa2 (id_new INT PRIMARY KEY, pa INT);
INSERT INTO perf_default_pa2 SELECT id_new, pa FROM perf_default_pa;
UPDATE ps_product_shop pr JOIN perf_default_pa2 d ON d.id_new = pr.id_product
SET pr.cache_default_attribute = d.pa;

-- Product-level stock row, then one per combination. Quantities vary per row
-- so an availability read sees a spread rather than one constant.
INSERT INTO ps_stock_available (id_product, id_product_attribute, quantity, physical_quantity, ${STOCK_COLS})
SELECT k.id_new, 0, k.qty, k.qty, $(qualify "$STOCK_COLS")
FROM perf_plan k JOIN ps_stock_available p ON p.id_product = k.tpl AND p.id_product_attribute = 0;

INSERT INTO ps_stock_available (id_product, id_product_attribute, quantity, physical_quantity, ${STOCK_COLS})
SELECT m.id_new, m.new_pa, m.qty, m.qty, $(qualify "$STOCK_COLS")
FROM perf_pa_map m JOIN ps_stock_available p ON p.id_product = m.tpl AND p.id_product_attribute = m.tpl_pa;

-- Handback: the (id_product, id_product_attribute) pairs the OpenLinker
-- projection must key on. A REAL table, not a temporary one, because the
-- OpenLinker half runs in a different process against a different database.
DROP TABLE IF EXISTS perf_shop_handback;
CREATE TABLE perf_shop_handback (
  n INT NOT NULL, id_product INT NOT NULL, id_product_attribute INT NOT NULL,
  rnk INT NOT NULL, is_synthetic TINYINT NOT NULL, ean13 VARCHAR(13) NOT NULL,
  price DECIMAL(20,6) NOT NULL, qty INT NOT NULL,
  PRIMARY KEY (id_product, id_product_attribute)
) ENGINE=InnoDB;

INSERT INTO perf_shop_handback (n, id_product, id_product_attribute, rnk, is_synthetic, ean13, price, qty)
SELECT m.n, m.id_new, m.new_pa, m.rnk, 0,
       LPAD(6100000000000 + (m.new_pa - @pabase), 13, '0'),
       k.price + ((m.rnk - 1) * 5), m.qty
FROM perf_pa_map m JOIN perf_plan k ON k.id_new = m.id_new;

-- A simple product contributes ONE synthetic variant. id_product_attribute is
-- 0 here; the OpenLinker half maps it to the adapter's 'product:<id>' form.
INSERT INTO perf_shop_handback (n, id_product, id_product_attribute, rnk, is_synthetic, ean13, price, qty)
SELECT k.n, k.id_new, 0, 1, 1, LPAD(6000000000000 + k.n, 13, '0'), k.price, k.qty
FROM perf_plan k
LEFT JOIN perf_default_pa d ON d.id_new = k.id_new
WHERE d.id_new IS NULL;

SELECT CONCAT('seeded_products=', COUNT(*)) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%';
SELECT CONCAT('seeded_combinations=', COUNT(*)) FROM ps_product_attribute WHERE reference LIKE '${SHOP_PREFIX}%';
SELECT CONCAT('handback_rows=', COUNT(*)) FROM perf_shop_handback;
SQL

PS_ELAPSED=$(( $(epoch) - START ))
log "PrestaShop side done in ${PS_ELAPSED}s"

N_SHOP="$(ps_sql "SELECT COUNT(*) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
[ "${N_SHOP:-0}" -gt 0 ] || die "PrestaShop seed produced 0 products - see the SQL output above"

# ---------------------------------------------------------------------------
# OpenLinker side. Every row is derived from the handback, so a mapping can
# only ever name an id PrestaShop actually holds.
#
# Streamed through COPY rather than generated from an ordinal: combination ids
# come from a ROW_NUMBER over the shop's own tables and are not derivable, so
# Postgres has to be told what they are.
# ---------------------------------------------------------------------------
log "exporting handback and building the OpenLinker projection"
OL_START="$(epoch)"

HANDBACK_TSV="$(mktemp)"
trap 'rm -f "$HANDBACK_TSV"' EXIT

docker exec -i -e MYSQL_PWD="$PS_MYSQL_PWD" "$PS_MYSQL_CONTAINER" \
  mysql -uroot -N -B "$PS_DB" -e \
  "SELECT n, id_product, id_product_attribute, rnk, is_synthetic, ean13, price, qty FROM perf_shop_handback ORDER BY id_product, id_product_attribute" \
  2>/dev/null > "$HANDBACK_TSV"

HANDBACK_LINES="$(wc -l < "$HANDBACK_TSV")"
[ "$HANDBACK_LINES" -gt 0 ] || die "handback export is empty - the PrestaShop half wrote nothing this script can project"
log "handback rows exported: $HANDBACK_LINES"

pg_sql_write "DROP TABLE IF EXISTS perf_shop_handback;
CREATE UNLOGGED TABLE perf_shop_handback (
  n int NOT NULL, id_product int NOT NULL, id_product_attribute int NOT NULL,
  rnk int NOT NULL, is_synthetic int NOT NULL, ean13 text NOT NULL,
  price numeric(20,6) NOT NULL, qty int NOT NULL)" >/dev/null

docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 \
  -c "\\copy perf_shop_handback FROM STDIN" < "$HANDBACK_TSV" >/dev/null \
  || die "COPY of the handback into Postgres failed"

COPIED="$(pg_sql "SELECT COUNT(*) FROM perf_shop_handback")"
[ "$COPIED" = "$HANDBACK_LINES" ] \
  || die "handback COPY landed $COPIED of $HANDBACK_LINES rows - refusing to project a partial catalogue"

pg_sql_write "CREATE INDEX ON perf_shop_handback (id_product); ANALYZE perf_shop_handback" >/dev/null

seed_sql <<SQL
BEGIN;

INSERT INTO products (id, name, sku, price, currency, "taxRate", "taxRateCountry", "taxRateReadAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (h.id_product)
  '${OL_STEM}' || h.id_product,
  'Perfshop product ' || h.n,
  '${SHOP_PREFIX}' || lpad(h.n::text, 6, '0'),
  h.price, 'PLN', '23', 'PL', now(), now(), now()
FROM perf_shop_handback h
ORDER BY h.id_product, h.id_product_attribute;

INSERT INTO product_variants (id, "productId", sku, attributes, ean, price, "taxRate", "taxRateCountry", "taxRateReadAt", "createdAt", "updatedAt")
SELECT
  '${OL_STEM}' || h.id_product || '_v' || h.id_product_attribute,
  '${OL_STEM}' || h.id_product,
  '${SHOP_PREFIX}' || lpad(h.n::text, 6, '0') || '-V' || h.rnk,
  jsonb_build_object('size', (ARRAY['S','M','L','XL'])[1 + (h.rnk % 4)]),
  h.ean13,
  h.price, '23', 'PL', now(), now(), now()
FROM perf_shop_handback h;

-- inventory_items keyed to the canonical variant (#822), quantity taken from
-- the shop's own stock row rather than invented.
INSERT INTO inventory_items (id, "productId", "productVariantId", "availableQuantity", "sourceConnectionId", "updatedAt")
SELECT
  '${PREFIX}_inv_ps_s' || h.id_product || '_v' || h.id_product_attribute,
  '${OL_STEM}' || h.id_product,
  '${OL_STEM}' || h.id_product || '_v' || h.id_product_attribute,
  h.qty,
  '${PS_CONNECTION_ID}',
  now()
FROM perf_shop_handback h;

-- identifier_mappings on the PrestaShop connection, external ids in the
-- ADAPTER's own shapes. This is the row set that makes the catalogue
-- resolvable, and the whole reason this script exists.
INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId", "createdAt", "updatedAt")
SELECT DISTINCT ON (h.id_product)
  'Product', '${OL_STEM}' || h.id_product, h.id_product::text,
  'prestashop', '${PS_CONNECTION_ID}'::uuid, now(), now()
FROM perf_shop_handback h
ORDER BY h.id_product, h.id_product_attribute;

INSERT INTO identifier_mappings ("entityType", "internalId", "externalId", "platformType", "connectionId", "createdAt", "updatedAt")
SELECT
  'ProductVariant',
  '${OL_STEM}' || h.id_product || '_v' || h.id_product_attribute,
  CASE WHEN h.is_synthetic = 1 THEN 'product:' || h.id_product ELSE h.id_product_attribute::text END,
  'prestashop', '${PS_CONNECTION_ID}'::uuid, now(), now()
FROM perf_shop_handback h;

COMMIT;
SQL

pg_sql_write "DROP TABLE IF EXISTS perf_shop_handback" >/dev/null
ps_sql "DROP TABLE IF EXISTS perf_shop_handback" >/dev/null

OL_ELAPSED=$(( $(epoch) - OL_START ))
ELAPSED=$(( $(epoch) - START ))
seed_check_ceiling "shop catalogue ($SHOP_PRODUCT_COUNT products, both sides)" "$ELAPSED" "$CEILING_SECS"

vacuum_analyze_reset products product_variants inventory_items identifier_mappings

# ---------------------------------------------------------------------------
# Post-seed assertions. The last one is the one that matters: a count of
# mappings proves nothing, since the whole defect this script exists to fix
# was a full mapping table every one of whose external ids named nothing.
# ---------------------------------------------------------------------------
N_OL_PROD="$(pg_sql "SELECT COUNT(*) FROM products WHERE id LIKE '${OL_STEM}%'")"
N_OL_VAR="$(pg_sql "SELECT COUNT(*) FROM product_variants WHERE id LIKE '${OL_STEM}%'")"
N_OL_INV="$(pg_sql "SELECT COUNT(*) FROM inventory_items WHERE \"productId\" LIKE '${OL_STEM}%'")"
N_OL_MAP="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"internalId\" LIKE '${OL_STEM}%'")"
N_MULTI="$(pg_sql "SELECT COUNT(*) FROM (SELECT \"productId\" FROM product_variants WHERE id LIKE '${OL_STEM}%' GROUP BY 1 HAVING COUNT(*) > 1) t")"
N_SIMPLE=$(( N_OL_PROD - N_MULTI ))
N_PS_COMBOS="$(ps_sql "SELECT COUNT(*) FROM ps_product_attribute WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
N_PS_STOCK="$(ps_sql "SELECT COUNT(*) FROM ps_stock_available s JOIN ps_product p ON p.id_product=s.id_product WHERE p.reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
N_DISTINCT_CAT="$(ps_sql "SELECT COUNT(DISTINCT id_category_default) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"
PRICE_RANGE="$(ps_sql "SELECT CONCAT(MIN(price),'..',MAX(price),' distinct=',COUNT(DISTINCT price)) FROM ps_product WHERE reference LIKE '${SHOP_PREFIX}%'" | tail -1)"

log "PrestaShop: products=$N_SHOP combinations=$N_PS_COMBOS stock_rows=$N_PS_STOCK distinct_default_categories=$N_DISTINCT_CAT price=$PRICE_RANGE"
log "OpenLinker: products=$N_OL_PROD variants=$N_OL_VAR (multi-variant=$N_MULTI simple=$N_SIMPLE) inventory_items=$N_OL_INV identifier_mappings=$N_OL_MAP"

# The referential check, done the only way that proves anything: take the
# external ids OpenLinker holds and ask PrestaShop how many of them exist.
DANGLING="$(pg_sql "SELECT COUNT(*) FROM identifier_mappings WHERE \"internalId\" LIKE '${OL_STEM}%' AND \"entityType\"='Product' AND \"externalId\" !~ '^[0-9]+\$'")"
[ "$DANGLING" = "0" ] || die "referential check: $DANGLING Product mapping(s) carry a non-numeric externalId - those name no PrestaShop product"

MAPPED_IDS="$(pg_sql "SELECT string_agg(\"externalId\", ',') FROM (SELECT \"externalId\" FROM identifier_mappings WHERE \"internalId\" LIKE '${OL_STEM}%' AND \"entityType\"='Product' ORDER BY \"externalId\" LIMIT 500) t")"
RESOLVED="$(ps_sql "SELECT COUNT(*) FROM ps_product WHERE FIND_IN_SET(id_product, '${MAPPED_IDS}')" | tail -1)"
SAMPLED="$(pg_sql "SELECT COUNT(*) FROM (SELECT 1 FROM identifier_mappings WHERE \"internalId\" LIKE '${OL_STEM}%' AND \"entityType\"='Product' ORDER BY \"externalId\" LIMIT 500) t")"
log "referential check: $RESOLVED of a $SAMPLED-mapping sample resolve to a real ps_product row"
[ "$RESOLVED" = "$SAMPLED" ] \
  || die "referential check FAILED: only $RESOLVED of $SAMPLED sampled Product mappings name a product PrestaShop holds"

log "seed-shop-catalogue done in ${ELAPSED}s (prestashop ${PS_ELAPSED}s, openlinker ${OL_ELAPSED}s)"
