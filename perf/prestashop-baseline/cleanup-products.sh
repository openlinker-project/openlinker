#!/usr/bin/env bash
# Remove every product seeded by seed-products.sh, plus the OpenLinker-side
# rows those products created (identifier mappings, product/variant/inventory
# projections). Matches ONLY on the PERFBASE- reference prefix, so it can
# never touch demo data.
#
# Usage: ./cleanup-products.sh [--dry-run]
set -euo pipefail

DRY="${1:-}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-ol-demo-fresh-mysql}"
PG_CONTAINER="${PG_CONTAINER:-ol-demo-fresh-postgres}"
DB="${PS_DB:-prestashop}"
PREFIX="PERFBASE-"

ps_sql() {
  docker exec -i "$MYSQL_CONTAINER" sh -c \
    "exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N -B $DB" 2>&1 | grep -v '^mysql: \[Warning\]' || true
}

echo "== PrestaShop side =="
ps_sql <<SQL
SELECT CONCAT('products_matching=', COUNT(*)) FROM ps_product WHERE reference LIKE '${PREFIX}%';
SQL

if [ "$DRY" = "--dry-run" ]; then
  echo "(dry run: nothing deleted)"
else
  ps_sql <<SQL
SET SESSION sql_mode='';
CREATE TEMPORARY TABLE perf_del AS
  SELECT id_product FROM ps_product WHERE reference LIKE '${PREFIX}%';
CREATE TEMPORARY TABLE perf_del_pa AS
  SELECT id_product_attribute FROM ps_product_attribute WHERE reference LIKE '${PREFIX}%';

DELETE pac FROM ps_product_attribute_combination pac JOIN perf_del_pa d ON d.id_product_attribute = pac.id_product_attribute;
DELETE pas FROM ps_product_attribute_shop pas JOIN perf_del_pa d ON d.id_product_attribute = pas.id_product_attribute;
DELETE pa FROM ps_product_attribute pa JOIN perf_del_pa d ON d.id_product_attribute = pa.id_product_attribute;
DELETE sa FROM ps_stock_available sa JOIN perf_del d ON d.id_product = sa.id_product;
DELETE cp FROM ps_category_product cp JOIN perf_del d ON d.id_product = cp.id_product;
DELETE pl FROM ps_product_lang pl JOIN perf_del d ON d.id_product = pl.id_product;
DELETE psh FROM ps_product_shop psh JOIN perf_del d ON d.id_product = psh.id_product;
DELETE p FROM ps_product p JOIN perf_del d ON d.id_product = p.id_product;

SELECT CONCAT('products_remaining=', COUNT(*)) FROM ps_product WHERE reference LIKE '${PREFIX}%';
SELECT CONCAT('combinations_remaining=', COUNT(*)) FROM ps_product_attribute WHERE reference LIKE '${PREFIX}%';
SQL
fi

echo "== OpenLinker side =="
# Seeded products are identifiable in OL by their SKU / reference.
PG_SQL="
SELECT 'variants_matching=' || COUNT(*) FROM product_variants WHERE sku LIKE '${PREFIX}%';
SELECT 'products_matching=' || COUNT(*) FROM products WHERE sku LIKE '${PREFIX}%';
"
if [ "$DRY" != "--dry-run" ]; then
  PG_SQL="$PG_SQL
WITH doomed AS (SELECT id FROM products WHERE sku LIKE '${PREFIX}%')
DELETE FROM inventory_items WHERE \"productId\" IN (SELECT id FROM doomed);
WITH doomed AS (SELECT id FROM products WHERE sku LIKE '${PREFIX}%')
DELETE FROM product_variants WHERE \"productId\" IN (SELECT id FROM doomed);
DELETE FROM identifier_mappings WHERE \"internalId\" IN (SELECT id FROM products WHERE sku LIKE '${PREFIX}%');
DELETE FROM products WHERE sku LIKE '${PREFIX}%';
SELECT 'products_remaining=' || COUNT(*) FROM products WHERE sku LIKE '${PREFIX}%';
"
fi
docker exec -i "$PG_CONTAINER" sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<< "$PG_SQL"

echo "Done."
