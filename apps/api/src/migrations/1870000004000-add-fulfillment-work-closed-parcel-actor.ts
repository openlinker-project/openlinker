/**
 * A CLOSED parcel must name an actor (#2890 F1, spec § 2.7 G1).
 *
 * `CHK_fulfillment_works_packed_actor` (#2413, migration `1870000001000`) is
 * AT-MOST-ONE: it forbids both actor columns being set and admits both being
 * NULL. That was correct when it was written — a work is created unpacked, so
 * `fulfillment_holds`' XOR would have been unsatisfiable at INSERT — and #2413
 * recorded the residual ambiguity of both-NULL as acceptable *because `status`
 * distinguishes "not yet packed" from "packed, unattributed"*.
 *
 * **#2418 removed that disambiguator's job by adding `parcelClosedAt`.** With a
 * real completion instant on the row, `parcelClosedAt IS NOT NULL` with neither
 * actor set is representable, and it says the one thing G1 exists to prevent:
 * *this parcel was packed and we do not know by whom*. It is reachable rather
 * than theoretical — `claimParcelClose` writes the verifier through verbatim,
 * and until #2890 the bench route sourced it from an OPTIONAL `@CurrentUser()`.
 *
 * So the missing half is added here, as its own rule:
 *
 *     NOT ("parcelClosedAt" IS NOT NULL
 *          AND "packedByUserId" IS NULL
 *          AND "packedByService" IS NULL)
 *
 * The two constraints together are exactly G1's *"either a packer's user id or
 * the service that packed it, exactly one"* — an XOR that applies **once the
 * parcel is closed** and leaves an open work free to carry neither, which is the
 * only form of it this table can satisfy.
 *
 * ## A SECOND constraint, against this repo's own precedent
 *
 * Every `@Check` in `libs/core` is one per table, and both multi-rule cases fold
 * independent clauses into a single named constraint —
 * `CHK_return_lines_quantity_ordering` (six clauses) and
 * `CHK_fulfillment_work_lines_capacity`, which #2392 WIDENED rather than giving
 * it a sibling. The precedent is real and is departed from deliberately: those
 * clauses are facets of one sentence (a line's quantities are ordered), whereas
 * these two rules quantify over different column sets under different
 * conditions — one is unconditional and about mutual exclusion, the other fires
 * only on closure and is about presence. A violation of each calls for a
 * different fix, and a single predicate would report both under one name,
 * leaving the operator to work out which half they broke. Folding them back
 * together would lose that, so please do not tidy it.
 *
 * ## Spelling
 *
 * `NOT (… AND …)` rather than the equivalent
 * `"parcelClosedAt" IS NULL OR <actor set>`, purely so the pair reads as one
 * idiom — both constraints on this table then say "forbid this state" in the
 * same shape. Nothing depends on the absence of an `OR` here; the parity spec's
 * `OR` ban is scoped by name prefix to the sibling constraint, where an `OR`
 * really would forbid the both-NULL state the router needs.
 *
 * ## Validation cost
 *
 * `ADD CONSTRAINT` takes `ACCESS EXCLUSIVE` and validates every existing row.
 * Acceptable HERE and not in general: `parcelClosedAt` itself ships in the same
 * unreleased wave (#2418, migration `1870000003000` immediately preceding), so
 * no released row can be closed at all and the scan is over a table that is
 * empty or nearly so on every install. A dev database that somehow carries a
 * closed, unattributed row fails this migration loudly — which is the correct
 * direction, since silently admitting the row is the defect being fixed. On a
 * large populated table the `NOT VALID` + `VALIDATE CONSTRAINT` two-step would
 * be required instead; do not copy this shape blind.
 *
 * Generated: 2026-09-04 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1870000003000 is #2418's parcel-verification table).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorkClosedParcelActor1870000004000 implements MigrationInterface {
  name = 'AddFulfillmentWorkClosedParcelActor1870000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // DROP-then-ADD, matching `1870000001000`: Postgres has no
    // `ADD CONSTRAINT IF NOT EXISTS`, and a half-re-runnable `up()` is the kind
    // of asymmetry that only bites during a recovery.
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP CONSTRAINT IF EXISTS "CHK_fulfillment_works_closed_parcel_actor"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD CONSTRAINT "CHK_fulfillment_works_closed_parcel_actor" ` +
        `CHECK (NOT ("parcelClosedAt" IS NOT NULL AND "packedByUserId" IS NULL AND "packedByService" IS NULL))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP CONSTRAINT IF EXISTS "CHK_fulfillment_works_closed_parcel_actor"`
    );
  }
}
