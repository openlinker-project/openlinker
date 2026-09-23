-- Enough fulfilment work to exercise the board and the bench for real.
--
-- The demo database carries hundreds of orders and four `fulfillment_works`,
-- which is too few to reach several states that only appear at volume: a second
-- page, a packer lane beside another packer's, a "lightest load" tag, a location
-- axis with more than one lane. Every row here is built from a REAL order that
-- is already `ready` and already has an order snapshot, so the bench renders the
-- buyer, the reference and the actual products rather than placeholders.
--
-- Idempotent: ids are deterministic (`ol_fwork_e2e_NN`), so re-running replaces
-- nothing and inserts nothing twice. Remove with the DELETE at the bottom of
-- this file's comment block.
--
--   docker exec -i ol-apw-verify-postgres psql -U postgres -d openlinker \
--     < apps/e2e/seed-fulfillment-board.sql
--
-- To undo:
--   DELETE FROM fulfillment_holds WHERE "fulfillmentWorkId" LIKE 'ol_fwork_e2e_%';
--   DELETE FROM fulfillment_work_lines WHERE "fulfillmentWorkId" LIKE 'ol_fwork_e2e_%';
--   DELETE FROM fulfillment_works WHERE id LIKE 'ol_fwork_e2e_%';

BEGIN;

-- Candidate orders: ready, snapshot present, not already carrying work.
CREATE TEMP TABLE _cand ON COMMIT DROP AS
SELECT r."internalOrderId" AS order_id,
       row_number() OVER (ORDER BY r."createdAt" DESC) AS n
FROM order_records r
WHERE r."recordStatus" = 'ready'
  AND jsonb_array_length(r."orderSnapshot" -> 'items') BETWEEN 1 AND 4
  AND NOT EXISTS (SELECT 1 FROM fulfillment_works w WHERE w."orderId" = r."internalOrderId")
ORDER BY r."createdAt" DESC
LIMIT 30;

-- One work per candidate. The spread is what makes the board worth looking at:
-- most work unassigned (the landing lane), two packers carrying different
-- counts (so "lightest load" has something to say), two locations and two
-- delivery methods (so the location axis has more than one lane), plus one
-- held, one cancelled and one already packed.
INSERT INTO fulfillment_works (
  id, "orderId", "locationId", "deliveryMethod", "assignedConnectionId",
  status, "requestStatus", "assignmentAttempt", version,
  "createdAt", "updatedAt", "acceptedAt",
  "assignedToUserId", "selfServeEligible", "unassignedSince",
  "cancellationReason", "cancelledAt", "parcelClosedAt", "packedByUserId"
)
SELECT
  'ol_fwork_e2e_' || lpad(c.n::text, 2, '0'),
  c.order_id,
  CASE WHEN c.n % 3 = 0
       THEN 'ol_location_e2ebenchseed0001'
       ELSE 'ol_location_bab164c3b9b94a9eab0df5ab2130c184' END,
  CASE WHEN c.n % 4 = 0 THEN 'locker' ELSE 'courier' END,
  '1bba5b4f-d217-46d7-85ed-b289dec0b8b4',
  CASE WHEN c.n = 29 THEN 'on_hold'
       WHEN c.n = 30 THEN 'cancelled'
       ELSE 'open' END,
  'accepted',
  1, 1,
  now() - (c.n || ' hours')::interval,
  now() - (c.n || ' hours')::interval,
  now() - (c.n || ' hours')::interval,
  CASE WHEN c.n BETWEEN 1 AND 5  THEN 'ca560b27-bcd2-4d62-bb7f-b6952f7207f1'::uuid  -- anna.pakowska
       WHEN c.n BETWEEN 6 AND 8  THEN 'e4a80767-0cd9-4831-98a9-ec47fc507a1e'::uuid  -- e2e-packer-manual
       ELSE NULL END,
  -- A couple of unassigned rows are deliberately NOT self-serve, which is what
  -- renders the muted "pulled out of self-serve" card the board has styling for.
  CASE WHEN c.n IN (11, 12) THEN false ELSE true END,
  CASE WHEN c.n BETWEEN 1 AND 8 THEN NULL ELSE now() - (c.n || ' hours')::interval END,
  CASE WHEN c.n = 30 THEN 'operator-cancelled' ELSE NULL END,
  CASE WHEN c.n = 30 THEN now() - interval '2 hours' ELSE NULL END,
  CASE WHEN c.n = 28 THEN now() - interval '1 hour' ELSE NULL END,
  CASE WHEN c.n = 28 THEN 'ca560b27-bcd2-4d62-bb7f-b6952f7207f1'::uuid ELSE NULL END
FROM _cand c
ON CONFLICT (id) DO NOTHING;

-- Lines, straight off each order's own snapshot, so the quantities a packer is
-- asked to verify match what the buyer actually bought.
INSERT INTO fulfillment_work_lines (
  id, "fulfillmentWorkId", "orderLineId", "productVariantId",
  "totalQuantity", "fulfilledQuantity", "cancelledQuantity", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  w.id,
  COALESCE(item ->> 'id', 'e2e-line-' || ord),
  item ->> 'variantId',
  GREATEST(1, COALESCE((item ->> 'quantity')::int, 1)),
  0, 0, now(), now()
FROM fulfillment_works w
JOIN order_records r ON r."internalOrderId" = w."orderId"
CROSS JOIN LATERAL jsonb_array_elements(r."orderSnapshot" -> 'items')
  WITH ORDINALITY AS t(item, ord)
WHERE w.id LIKE 'ol_fwork_e2e_%'
  AND item ->> 'variantId' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM fulfillment_work_lines l WHERE l."fulfillmentWorkId" = w.id
  );

-- The held one needs a hold to be held by.
INSERT INTO fulfillment_holds (
  id, "fulfillmentWorkId", reason, note, "placedByUserId", "placedAt", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), 'ol_fwork_e2e_29', 'stock_shortfall',
       'Seeded for end-to-end verification.',
       (SELECT id FROM users WHERE username = 'admin' LIMIT 1),
       now() - interval '3 hours', now(), now()
WHERE EXISTS (SELECT 1 FROM fulfillment_works WHERE id = 'ol_fwork_e2e_29')
  AND NOT EXISTS (
    SELECT 1 FROM fulfillment_holds WHERE "fulfillmentWorkId" = 'ol_fwork_e2e_29'
  );

COMMIT;

SELECT status,
       CASE WHEN "assignedToUserId" IS NULL THEN 'unassigned' ELSE 'assigned' END AS assignment,
       count(*)
FROM fulfillment_works
WHERE id LIKE 'ol_fwork_e2e_%'
GROUP BY 1, 2 ORDER BY 1, 2;
