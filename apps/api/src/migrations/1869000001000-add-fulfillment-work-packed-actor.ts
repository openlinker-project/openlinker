/**
 * Add `fulfillment_works.packedByUserId` / `packedByService` (#2413, W3b-1, ADR-071 decision 2).
 *
 * Who closed this work object's packing phase. Two columns rather than one, so
 * that *"a 3PL packed this"* and *"a human packed it"* are never the same
 * value — a single nullable column cannot express both, and ADR-071 makes the
 * distinction the point of recording an actor at all.
 *
 * ## The CHECK is AT-MOST-ONE, not `fulfillment_holds`' XOR — deliberately
 *
 * `CHK_fulfillment_holds_actor` is `(a IS NOT NULL) <> (b IS NOT NULL)`:
 * EXACTLY one. That is right there, because a hold always has an actor — a row
 * with neither is meaningless.
 *
 * A *work* is created unpacked and spends most of its life that way, so both
 * columns NULL is the normal state, not an anomaly. Copying `<>` literally
 * would fail this migration on every existing row and refuse every future
 * INSERT — the constraint would be unsatisfiable by the router that creates
 * these rows. So the predicate admits both-NULL and forbids only both-SET:
 *
 *     NOT ("packedByUserId" IS NOT NULL AND "packedByService" IS NOT NULL)
 *
 * What the issue asks for survives exactly: the two facts can never collapse
 * into one value. Only the third state — nobody has packed it yet — is
 * admitted, because here it genuinely exists.
 *
 * **Both-NULL was therefore ambiguous** between "not packed" and "packed with
 * no attribution recorded", and this migration recorded that as an accepted
 * limitation on the grounds that `status` distinguishes them. No `packedAt` was
 * added to disambiguate it: that would create a second completion instant
 * competing with the phase model #2418 owns.
 *
 * **Superseded (#2890).** #2418 landed that model as `parcelClosedAt`, and
 * migration `1869000004000` uses it to close the gap with a sibling constraint,
 * `CHK_fulfillment_works_closed_parcel_actor`: both-NULL stays legal while the
 * parcel is open and is refused once it is closed. The limitation above no
 * longer holds — read the two constraints together.
 *
 * ## `uuid` + `text`, and no foreign key
 *
 * The pair mirrors `fulfillment_holds`' `placedByUserId` / `placedByService` in
 * shape and name discipline, but NOT in type: those are both `text`, and this
 * user id is `uuid`. Spec D4 derives the order-grain fact from this column, and
 * its target `order_records.packedByUserId` (#2287) is `uuid` — a `text` source
 * could hold a value the derivation cannot store, surfacing in #2418's writer
 * far from the column that admitted it. Nothing derives from
 * `placedByUserId`, so the holds precedent is not load-bearing the same way.
 * `packedByService` stays `text`, because a service NAME is free-form: the two
 * columns hold two different kinds of value and the split types say so.
 *
 * No FK to `users`, matching both precedents: a dangling id from a deleted user
 * is the honest outcome for an audit fact, and this table carries
 * cross-aggregate references by value throughout.
 *
 * ## No writer ships with this
 *
 * #2418 writes it, at the moment it owns the verification that triggers the
 * close. Nothing is added to `FulfillmentProgressEvent` (spec D6) — a field
 * only our own bench can populate would be permanently `null` on every 3PL
 * adapter and would later read as "unattributed" rather than "not applicable".
 *
 * Generated: 2026-09-04 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1869000000900 is the automation retry-attempt column).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorkPackedActor1869000001000 implements MigrationInterface {
  name = 'AddFulfillmentWorkPackedActor1869000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "packedByUserId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "packedByService" text`
    );
    // DROP-then-ADD so the constraint half is as idempotent as the columns'
    // `IF NOT EXISTS`. Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, and two
    // halves of one `up()` disagreeing about re-runnability is the kind of
    // asymmetry that only bites during a recovery.
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP CONSTRAINT IF EXISTS "CHK_fulfillment_works_packed_actor"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD CONSTRAINT "CHK_fulfillment_works_packed_actor" ` +
        `CHECK (NOT ("packedByUserId" IS NOT NULL AND "packedByService" IS NOT NULL))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP CONSTRAINT IF EXISTS "CHK_fulfillment_works_packed_actor"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "packedByService"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "packedByUserId"`
    );
  }
}
