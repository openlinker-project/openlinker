#!/usr/bin/env bash
# A4 support — synthesise one ready-to-dispatch order with EIGHT lines.
#
# Every order on the demo stack has a single line, so the per-line cost of
# price pinning (POST + DELETE /specific_prices per line) is visible only in
# its weakest possible form. This builds an order whose lines are eight real,
# already-mapped PERFBASE variants, reusing the customer of an order that
# already synced so the fixed part of the request cost is identical and the
# difference between the two orders is purely per-line.
#
# The source of the order is irrelevant to what is being measured: A4 counts
# what OpenLinker sends to PrestaShop, not how the order arrived.
set -euo pipefail

PG="${PG_CONTAINER:-ol-demo-fresh-postgres}"
SRC_ORDER="${SRC_ORDER:-ol_order_a147a1f2af16402f86115640a11f4c73}"
NEW_ID="ol_order_$(openssl rand -hex 16)"

docker exec -i "$PG" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<SQL
WITH picked AS (
  SELECT v.id AS variant_id, v."productId" AS product_id, v.sku,
         ROW_NUMBER() OVER (ORDER BY v.id) AS n
  FROM product_variants v
  JOIN identifier_mappings m ON m."internalId" = v.id
    AND m."entityType" = 'ProductVariant'
    AND m."connectionId" = '44bb1f3f-17ae-4038-ab48-413ce54a71c7'
  JOIN products p ON p.id = v."productId"
  WHERE p.sku LIKE 'PERFBASE-%' AND v."isStale" = false
  ORDER BY v.id LIMIT 8
),
lines AS (
  SELECT jsonb_agg(jsonb_build_object(
           'id', 'a4line-' || n::text,
           'sku', sku,
           'name', 'Perf Baseline line ' || n::text,
           'price', 149,
           'taxRate', '23',
           'quantity', 1,
           'productId', product_id,
           'taxSource', 'shop',
           'variantId', variant_id
         ) ORDER BY n) AS items
  FROM picked
),
base AS (
  SELECT "orderSnapshot" AS s, "customerId", "sourceConnectionId"
  FROM order_records WHERE "internalOrderId" = '$SRC_ORDER'
)
INSERT INTO order_records (
  "internalOrderId", "customerId", "sourceConnectionId", "sourceEventId",
  "orderSnapshot", "syncStatus", "recordStatus", "syncAttempts",
  "placedAt", "currency", "taxTreatment", "totalAmount", "taxRateEra",
  "createdAt", "updatedAt"
)
SELECT
  '$NEW_ID', base."customerId", base."sourceConnectionId", 'a4-8line-$NEW_ID',
  jsonb_set(
    jsonb_set(
      jsonb_set(base.s, '{items}', lines.items),
      '{id}', to_jsonb('$NEW_ID'::text)
    ),
    '{totals}',
    jsonb_build_object(
      'tax', 0, 'total', 1202.95, 'currency', 'PLN',
      'shipping', 10.95, 'subtotal', 1192, 'taxTreatment', 'inclusive'
    )
  ) || jsonb_build_object('orderNumber', 'A4-8LINE-' || substr('$NEW_ID', 10, 8)),
  '[]'::jsonb, 'ready', '[]'::jsonb,
  now(), 'PLN', 'inclusive', 1202.95, 'current',
  now(), now()
FROM base, lines;

SELECT 'created=$NEW_ID lines=' || jsonb_array_length("orderSnapshot"->'items')
FROM order_records WHERE "internalOrderId" = '$NEW_ID';
SQL
