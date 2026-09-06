/**
 * Backfill `shipment_lines` from existing shipments — AS LEDGER EVENTS (#2727).
 *
 * ## Why this cannot be a snapshot
 *
 * Existing shipments carry no line detail. Order O, line L, quantity 2. `S1`
 * dispatched then cancelled; `S2` the re-issue, dispatched.
 *
 * - A SNAPSHOT backfill writes `S1.shipped = 2` and `S2.shipped = 2`, so the
 *   order-level shipped quantity is **4** — permanently, and unfixably, because
 *   both rows claim to be shipments of the same units and nothing distinguishes
 *   a correction from a second shipment. A third cancelled attempt makes it 6.
 * - This EVENT backfill writes `S1: ship(2), cancel(2)` (net 0) and
 *   `S2: ship(2)` (net 2). Order-level net is **2**, and stays 2 however many
 *   cancelled attempts precede the successful one.
 *
 * The `cancel` act IS the thing that distinguishes a correction from a second
 * shipment, and it exists only because this pass walks each shipment's history
 * instead of restating its end state. `shipment-lines-backfill.int-spec.ts`
 * asserts the net is 2 AND computes the snapshot-shaped sum alongside it, so
 * the test genuinely fails against a snapshot backfill rather than merely
 * passing against this one.
 *
 * ## Lossy, and named as such
 *
 * Attributing each shipment the line's FULL ordered quantity is a guess for a
 * genuinely multi-package order — OL never recorded the split, and no data in
 * the tree can recover it. What the event shape guarantees is not that history
 * is exact, but that a later cancel-and-reissue does not COMPOUND the error.
 * `FulfillmentQuantityCoverage`'s docblock records why the rollup's coverage arm
 * is still sound against an over-estimating numerator.
 *
 * ## Batched, because `shipments` has no retention
 *
 * Nothing in the tree prunes `shipments`, so one unbounded statement joining it
 * to `order_records` through `jsonb_array_elements` is a long write inside a
 * single migration transaction on a mature install. This pages by shipment id.
 *
 * ## Outbound only
 *
 * `direction = 'outbound'` on every statement (#2373 / ADR-060). A return label
 * is a different cohort and must never contribute to a statement about
 * fulfilling the buyer's order — the #2645 cross-body defect.
 *
 * Idempotent: every insert is `ON CONFLICT DO NOTHING` and the counter fold is
 * a total recompute, so re-running changes nothing.
 *
 * @module migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Shipments per batch. Small enough to keep each statement short-lived. */
const BATCH_SIZE = 500;

export class BackfillShipmentLines1874000001000 implements MigrationInterface {
  name = 'BackfillShipmentLines1874000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    let after = '';

    for (;;) {
      const page = (await queryRunner.query(
        `SELECT "id" FROM "shipments"
           WHERE "direction" = 'outbound' AND "id" > $1
           ORDER BY "id" ASC
           LIMIT ${BATCH_SIZE}`,
        [after]
      )) as { id: string }[];

      if (page.length === 0) break;
      const ids = page.map((row) => row.id);

      // 1. One line per (shipment, orderId, lineId) from the order's snapshot.
      //
      // A blank `lineId` is SKIPPED, never written: two blank-id lines in one
      // order would collide on the unique index and the second would vanish
      // under ON CONFLICT DO NOTHING — a silently lost line. Every shipped
      // adapter supplies a stable id (PrestaShop's `resolveOrderRowId` throws on
      // a missing one), so this is a floor rather than the expected path.
      await queryRunner.query(
        `INSERT INTO "shipment_lines"
           ("shipmentId", "orderId", "lineId", "productVariantId", "quantity")
         SELECT s."id", s."orderId", item->>'id',
                NULLIF(item->>'variantId', ''),
                GREATEST(COALESCE(NULLIF(item->>'quantity', '')::numeric, 0)::int, 0)
           FROM "shipments" s
           JOIN "order_records" o ON o."internalOrderId" = s."orderId"
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(o."orderSnapshot"->'items') = 'array'
                  THEN o."orderSnapshot"->'items' ELSE '[]'::jsonb END
           ) AS item
          WHERE s."id" = ANY($1) AND s."direction" = 'outbound'
            AND COALESCE(item->>'id', '') <> ''
         ON CONFLICT DO NOTHING`,
        [ids]
      );

      // 2. The acts. `occurredAt` is the SHIPMENT's own instant, falling back to
      //    its immutable `createdAt` — never `updatedAt`, which is a key column
      //    here and would mint a duplicate act on every re-run.
      //
      //    A `ship` act is emitted when the shipment actually left: an explicit
      //    `dispatchedAt`, or a status that implies one (a branch-1 projection
      //    row is born at its terminal status and may carry no timestamp).
      await queryRunner.query(
        `INSERT INTO "shipment_line_events"
           ("shipmentLineId", "kind", "quantity", "occurredAt")
         SELECT sl."id", 'ship', sl."quantity",
                COALESCE(s."dispatchedAt", s."createdAt")
           FROM "shipment_lines" sl
           JOIN "shipments" s ON s."id" = sl."shipmentId"
          WHERE s."id" = ANY($1) AND s."direction" = 'outbound' AND sl."quantity" > 0
            AND (s."dispatchedAt" IS NOT NULL
                 OR s."status" IN ('dispatched', 'in-transit', 'delivered'))
         ON CONFLICT DO NOTHING`,
        [ids]
      );

      await queryRunner.query(
        `INSERT INTO "shipment_line_events"
           ("shipmentLineId", "kind", "quantity", "occurredAt")
         SELECT sl."id", 'deliver', sl."quantity",
                COALESCE(s."deliveredAt", s."createdAt")
           FROM "shipment_lines" sl
           JOIN "shipments" s ON s."id" = sl."shipmentId"
          WHERE s."id" = ANY($1) AND s."direction" = 'outbound' AND sl."quantity" > 0
            AND (s."deliveredAt" IS NOT NULL OR s."status" = 'delivered')
         ON CONFLICT DO NOTHING`,
        [ids]
      );

      // A `cancel` REVERSES a ship, so it requires that a ship happened. A
      // shipment cancelled at `draft` never shipped — there is nothing to
      // reverse, and emitting one anyway would break
      // `"cancelledQuantity" <= "shippedQuantity"`.
      //
      // The predicate is `dispatchedAt IS NOT NULL` alone, and that is EXACTLY
      // the ship statement's condition for these rows rather than a narrowing of
      // it: the ship statement's status disjunct (`dispatched | in-transit |
      // delivered`) cannot hold for a row whose status is `cancelled` or
      // `failed`, so for this cohort the two conditions are provably identical.
      // Spelling the dead disjunct out here again would only invite a reader to
      // "fix" one side and silently emit a cancel with no ship to reverse.
      await queryRunner.query(
        `INSERT INTO "shipment_line_events"
           ("shipmentLineId", "kind", "quantity", "occurredAt")
         SELECT sl."id", 'cancel', sl."quantity",
                COALESCE(s."cancelledAt", s."failedAt", s."createdAt")
           FROM "shipment_lines" sl
           JOIN "shipments" s ON s."id" = sl."shipmentId"
          WHERE s."id" = ANY($1) AND s."direction" = 'outbound' AND sl."quantity" > 0
            AND s."status" IN ('cancelled', 'failed')
            AND s."dispatchedAt" IS NOT NULL
         ON CONFLICT DO NOTHING`,
        [ids]
      );

      // 3. Fold the acts into the counters — a TOTAL recompute, never an
      //    increment, so the ledger stays authoritative and a re-run converges.
      await queryRunner.query(
        `UPDATE "shipment_lines" sl
            SET "shippedQuantity"   = COALESCE(f.ship, 0),
                "deliveredQuantity" = COALESCE(f.deliver, 0),
                "cancelledQuantity" = COALESCE(f.cancel, 0)
           FROM (
             SELECT e."shipmentLineId" AS line_id,
                    SUM(e."quantity") FILTER (WHERE e."kind" = 'ship')    AS ship,
                    SUM(e."quantity") FILTER (WHERE e."kind" = 'deliver') AS deliver,
                    SUM(e."quantity") FILTER (WHERE e."kind" = 'cancel')  AS cancel
               FROM "shipment_line_events" e
               JOIN "shipment_lines" l ON l."id" = e."shipmentLineId"
              WHERE l."shipmentId" = ANY($1)
              GROUP BY e."shipmentLineId"
           ) f
          WHERE f.line_id = sl."id"`,
        [ids]
      );

      after = ids[ids.length - 1];
      if (page.length < BATCH_SIZE) break;
    }
  }

  /**
   * Empties both tables. The tables themselves belong to `1874000000000`, whose
   * own `down()` drops them — reverting just this migration should leave an
   * empty schema, not a missing one.
   *
   * **Honest about its blast radius**: this is a bare `DELETE`, not a targeted
   * un-backfill. It cannot distinguish a row this pass wrote from one the
   * runtime reconcile wrote afterwards, because nothing stamps provenance onto a
   * line — so on an install that has been live since the backfill, reverting
   * discards runtime rows too. That is acceptable only because the whole model
   * is a DERIVED read model: the next `OrderFulfillmentProjectionService.recompute`
   * for an order rebuilds its lines and re-folds its counters from the shipments,
   * which remain untouched. Nothing here is a source of truth.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "shipment_line_events"`);
    await queryRunner.query(`DELETE FROM "shipment_lines"`);
  }
}
