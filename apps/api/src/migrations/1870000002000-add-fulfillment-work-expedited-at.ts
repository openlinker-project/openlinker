/**
 * Add `fulfillment_works."expeditedAt"` (#2416, `W3b-3`, spec D22)
 *
 * One nullable timestamp. `NULL` means the work sits in ordinary deadline
 * order; an instant means an operator pushed it to the front, and the instant
 * is also the tiebreak between two expedited parcels — first pushed, first out.
 *
 * ## No default, and no index
 *
 * **No default**, because the ORM entity declares none either: the integration
 * harness builds its schema by TypeORM `synchronize` rather than by running
 * migrations, so a default present here and absent there would hold in
 * production and silently not in tests. `fulfillment-work-migration-parity.int-spec.ts`
 * diffs the two schemas column by column and is what catches exactly that; this
 * migration needs no edit to that spec, whose table list already names
 * `fulfillment_works`.
 *
 * **No index**, because nothing orders by this column in SQL. The bench's sort
 * key is the ORDER's `dispatchByAt`, which lives in another bounded context and
 * cannot reach a `fulfillment_works` query at all (ADR-053), so the ordering
 * happens above the query in `apps/api/src/bench`. An index nothing reads is
 * cost on every write to the table; the day a SQL `ORDER BY` arrives is the day
 * to add one.
 *
 * ## The down migration is lossless in the only sense that matters
 *
 * Dropping the column discards which parcels were expedited. That is an
 * operator's ordering preference rather than a record of anything that
 * happened — nothing downstream is refused because of it, and no document, no
 * shipment and no counter derives from it — so a revert costs a re-expedite,
 * not a lost fact. Stated because the sibling columns on this table
 * (`acceptedAt`, `cancelledAt`) are the opposite and a reader may assume the
 * same care applies.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorkExpeditedAt1870000002000 implements MigrationInterface {
  name = 'AddFulfillmentWorkExpeditedAt1870000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "expeditedAt" TIMESTAMP WITH TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "expeditedAt"`
    );
  }
}
