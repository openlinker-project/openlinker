#!/usr/bin/env bash
# Seed synthetic PrestaShop products (with combinations) for the #2489
# baseline measurement.
#
# Clones one existing multi-variant product N times, straight into MySQL, so
# every child row (shop, lang, category, combinations, stock) is structurally
# complete and the webservice serves them like any other product. Every
# seeded row carries the reference prefix below, which is the ONLY thing
# cleanup-products.sh matches on.
#
# Usage: ./seed-products.sh [count]   (default 10000)
set -euo pipefail

COUNT="${1:-10000}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-ol-demo-fresh-mysql}"
DB="${PS_DB:-prestashop}"
TEMPLATE_ID="${TEMPLATE_ID:-22}"     # multi-variant template (3 combinations)
PREFIX="PERFBASE-"

# All SQL goes in over stdin: the generated column lists contain backticks and
# quotes that do not survive a `sh -c '... -e "..."'` round trip.
mysql_run() {
  docker exec -i "$MYSQL_CONTAINER" sh -c \
    "exec mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -N -B $DB" 2>&1 \
    | grep -v '^mysql: \[Warning\]'
}

# Backticked column list of a table, minus the columns each clone overrides.
cols_except() {
  local table="$1" skip="$2"
  printf 'SELECT GROUP_CONCAT(CONCAT(CHAR(96),COLUMN_NAME,CHAR(96)) ORDER BY ORDINAL_POSITION) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA="%s" AND TABLE_NAME="%s" AND COLUMN_NAME NOT IN (%s);\n' \
    "$DB" "$table" "$skip" | mysql_run | tail -1
}

qualify() { echo "$1" | sed 's/`[^`]*`/p.&/g'; }

PROD_COLS=$(cols_except ps_product '"id_product","reference","ean13","date_add","date_upd"')
SHOP_COLS=$(cols_except ps_product_shop '"id_product"')
LANG_COLS=$(cols_except ps_product_lang '"id_product","name","link_rewrite"')
CATP_COLS=$(cols_except ps_category_product '"id_product"')
PA_COLS=$(cols_except ps_product_attribute '"id_product_attribute","id_product","reference","ean13"')
PAS_COLS=$(cols_except ps_product_attribute_shop '"id_product_attribute","id_product"')
PAC_COLS=$(cols_except ps_product_attribute_combination '"id_product_attribute"')
STOCK_COLS=$(cols_except ps_stock_available '"id_stock_available","id_product","id_product_attribute"')

for v in PROD_COLS SHOP_COLS LANG_COLS CATP_COLS PA_COLS PAS_COLS PAC_COLS STOCK_COLS; do
  [ -n "${!v}" ] || { echo "FATAL: could not read column list for $v" >&2; exit 1; }
done

# A second invocation would mint a SECOND set of PERFBASE-00001... references,
# so the prefix would stop identifying one seeded generation and cleanup counts
# would stop meaning anything. Refuse unless the caller says otherwise.
EXISTING=$(printf "SELECT COUNT(*) FROM ps_product WHERE reference LIKE '%s%%';\n" "$PREFIX" | mysql_run | tail -1)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "0" ]; then
  echo "FATAL: $EXISTING products already carry the ${PREFIX} prefix." >&2
  echo "       Seeding again would create a duplicate generation under the same" >&2
  echo "       prefix. Run ./cleanup-products.sh first, or set FORCE_SEED=1 if a" >&2
  echo "       second generation really is what you want." >&2
  [ "${FORCE_SEED:-0}" = "1" ] || exit 1
  echo "       FORCE_SEED=1 set, continuing anyway." >&2
fi

echo "Seeding $COUNT products from template id=$TEMPLATE_ID (prefix ${PREFIX})..."
date +%T

mysql_run <<SQL
SET SESSION sql_mode='';
SET SESSION cte_max_recursion_depth = 1000000;

SET @base   := (SELECT GREATEST(MAX(id_product), 100000) + 1 FROM ps_product);
SET @pabase := (SELECT GREATEST(MAX(id_product_attribute), 100000) + 1 FROM ps_product_attribute);
SET @vcount := (SELECT COUNT(*) FROM ps_product_attribute WHERE id_product = $TEMPLATE_ID);

CREATE TEMPORARY TABLE perf_seq (n INT PRIMARY KEY);
INSERT INTO perf_seq
WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < $COUNT)
SELECT n FROM s;

-- Stable 1..V rank per template combination, so a clone's combination ids are
-- a contiguous block and every child table can recompute the same id.
CREATE TEMPORARY TABLE perf_tpl_pa (rnk INT PRIMARY KEY, id_product_attribute INT, UNIQUE KEY(id_product_attribute));
INSERT INTO perf_tpl_pa
SELECT ROW_NUMBER() OVER (ORDER BY id_product_attribute), id_product_attribute
FROM ps_product_attribute WHERE id_product = $TEMPLATE_ID;

INSERT INTO ps_product (id_product, reference, ean13, date_add, date_upd, $PROD_COLS)
SELECT @base + q.n,
       CONCAT('$PREFIX', LPAD(q.n, 5, '0')),
       LPAD(5900000000000 + q.n, 13, '0'),
       NOW(), NOW(), $(qualify "$PROD_COLS")
FROM ps_product p CROSS JOIN perf_seq q WHERE p.id_product = $TEMPLATE_ID;

INSERT INTO ps_product_shop (id_product, $SHOP_COLS)
SELECT @base + q.n, $(qualify "$SHOP_COLS")
FROM ps_product_shop p CROSS JOIN perf_seq q WHERE p.id_product = $TEMPLATE_ID;

INSERT INTO ps_product_lang (id_product, name, link_rewrite, $LANG_COLS)
SELECT @base + q.n,
       CONCAT('Perf Baseline ', LPAD(q.n, 5, '0')),
       CONCAT('perf-baseline-', LPAD(q.n, 5, '0')),
       $(qualify "$LANG_COLS")
FROM ps_product_lang p CROSS JOIN perf_seq q WHERE p.id_product = $TEMPLATE_ID;

INSERT INTO ps_category_product (id_product, $CATP_COLS)
SELECT @base + q.n, $(qualify "$CATP_COLS")
FROM ps_category_product p CROSS JOIN perf_seq q WHERE p.id_product = $TEMPLATE_ID;

INSERT INTO ps_product_attribute (id_product_attribute, id_product, reference, ean13, $PA_COLS)
SELECT @pabase + (q.n - 1) * @vcount + t.rnk,
       @base + q.n,
       CONCAT('$PREFIX', LPAD(q.n, 5, '0'), '-V', t.rnk),
       LPAD(5910000000000 + (q.n - 1) * @vcount + t.rnk, 13, '0'),
       $(qualify "$PA_COLS")
FROM ps_product_attribute p
JOIN perf_tpl_pa t ON t.id_product_attribute = p.id_product_attribute
CROSS JOIN perf_seq q
WHERE p.id_product = $TEMPLATE_ID;

INSERT INTO ps_product_attribute_shop (id_product_attribute, id_product, $PAS_COLS)
SELECT @pabase + (q.n - 1) * @vcount + t.rnk, @base + q.n, $(qualify "$PAS_COLS")
FROM ps_product_attribute_shop p
JOIN perf_tpl_pa t ON t.id_product_attribute = p.id_product_attribute
CROSS JOIN perf_seq q
WHERE p.id_product = $TEMPLATE_ID;

INSERT INTO ps_product_attribute_combination (id_product_attribute, $PAC_COLS)
SELECT @pabase + (q.n - 1) * @vcount + t.rnk, $(qualify "$PAC_COLS")
FROM ps_product_attribute_combination p
JOIN perf_tpl_pa t ON t.id_product_attribute = p.id_product_attribute
CROSS JOIN perf_seq q;

-- Product-level stock row (id_product_attribute = 0).
INSERT INTO ps_stock_available (id_product, id_product_attribute, $STOCK_COLS)
SELECT @base + q.n, 0, $(qualify "$STOCK_COLS")
FROM ps_stock_available p CROSS JOIN perf_seq q
WHERE p.id_product = $TEMPLATE_ID AND p.id_product_attribute = 0;

-- One stock row per cloned combination.
INSERT INTO ps_stock_available (id_product, id_product_attribute, $STOCK_COLS)
SELECT @base + q.n, @pabase + (q.n - 1) * @vcount + t.rnk, $(qualify "$STOCK_COLS")
FROM ps_stock_available p
JOIN perf_tpl_pa t ON t.id_product_attribute = p.id_product_attribute
CROSS JOIN perf_seq q
WHERE p.id_product = $TEMPLATE_ID;

SELECT CONCAT('seeded_products=', COUNT(*)) FROM ps_product WHERE reference LIKE '${PREFIX}%';
SELECT CONCAT('seeded_combinations=', COUNT(*)) FROM ps_product_attribute WHERE reference LIKE '${PREFIX}%';
SQL
date +%T
