/**
 * Add `fulfillment_works."assignedToUserId"` + `"selfServeEligible"` (#3336,
 * ADR-074, `docs/architecture/adrs/074-fulfillment-work-pre-assignment.md`)
 *
 * A supervisor's PRE-assignment of a parcel to a specific packer — a distinct
 * axis from `assignedConnectionId` (ADR-054's HOLDER connection, the
 * executor). `assignedToUserId` names a PERSON inside an already-accepted
 * holder; it never touches the executor handshake (#2399/#2712).
 *
 * ## `assignedToUserId` is `uuid`, matching this table's own `packedByUserId`
 *
 * ADR-074's own text named `text`; the sibling `packedByUserId` column on
 * THIS table is `uuid` (users are `@PrimaryGeneratedColumn('uuid')` rows), so
 * `uuid` is what this migration ships — two user-id columns on one table
 * spelling the same reference two different ways would be the defect, not a
 * faithful reading of the ADR's prose.
 *
 * ## Advisory by default, and that is a column DEFAULT, not merely a reading
 *
 * `selfServeEligible` defaults `true` — an assigned-and-locked parcel is the
 * explicit exception an operator opts into (ADR-074 "Alternatives
 * considered"), never the default a migration silently produces for every
 * existing row. Enforcement of `false` lives in
 * `FulfillmentHandshakeService`'s claim path (#3337); this migration only
 * adds the column the enforcement will read.
 *
 * ## No default and no index on `assignedToUserId`, no index on `selfServeEligible`
 *
 * No default: `null` (unassigned) is the correct state for every row that
 * exists before this migration runs, and the ORM entity declares no default
 * either — the integration harness builds schema by `synchronize` rather than
 * by running migrations, so a default present here and absent there would
 * hold in production and silently not in tests
 * (`fulfillment-work-migration-parity.int-spec.ts` is what catches exactly
 * that, and needs no edit for this migration — its table list already names
 * `fulfillment_works`). No index on either column: nothing orders or filters
 * by them in SQL yet — the worklist read (#3337) is the first consumer, and
 * an index nothing reads is cost on every write to an already five-writer
 * table (REVIEW C10).
 *
 * ## The down migration is lossless in the only sense that matters
 *
 * Dropping both columns discards a supervisor's staffing decision, not a
 * record of anything that happened — no document, no shipment and no counter
 * derives from either column — so a revert costs re-assigning, not a lost
 * fact. The `expeditedAt` migration (#2416) states the identical reasoning for
 * the identical reason: a sibling advisory-ordering column on this table.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorkAssignment1893000000000 implements MigrationInterface {
  name = 'AddFulfillmentWorkAssignment1893000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "assignedToUserId" UUID`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "selfServeEligible" BOOLEAN NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "selfServeEligible"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "assignedToUserId"`
    );
  }
}
