/**
 * Add the bundle-component columns to `return_line_events` (#3933).
 *
 * A returned bundle line restocks its COMPONENTS, one act per component, so each
 * act must say which component it is about, which dispose call it belongs to
 * (the line counters move once per group, not once per act) and, for a partial
 * return of the set, the gross share of the set price that component carries
 * (the figure the correction proposal credits). All nullable, no backfill: NULL
 * means "an ordinary act on the line itself", which is every row that exists.
 *
 * Generated: 2026-11-04 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReturnLineEventComponentColumns1939150000000 implements MigrationInterface {
  name = 'AddReturnLineEventComponentColumns1939150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "return_line_events" ADD "componentVariantId" text`);
    await queryRunner.query(`ALTER TABLE "return_line_events" ADD "componentGroup" text`);
    await queryRunner.query(
      `ALTER TABLE "return_line_events" ADD "componentShareGross" numeric(14,2)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "return_line_events" DROP COLUMN "componentShareGross"`);
    await queryRunner.query(`ALTER TABLE "return_line_events" DROP COLUMN "componentGroup"`);
    await queryRunner.query(`ALTER TABLE "return_line_events" DROP COLUMN "componentVariantId"`);
  }
}
