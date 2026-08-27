/**
 * Migration: Widen Allegro Quantity Command Unique Index
 *
 * A batch quantity-change command (#2622) covers several offers under one
 * Allegro commandId — `PUT /sale/offer-quantity-change-commands/{id}` applies
 * one command to every offer named in `offerCriteria`. The original unique
 * index on `commandId` alone assumed one offer per command and would reject
 * every row past the first for a batch command. This widens uniqueness to
 * (commandId, offerId), so one row per offer can be persisted per command.
 *
 * @module libs/integrations/allegro/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenAllegroQuantityCommandUniqueIndex1841000000007 implements MigrationInterface {
  name = 'WidenAllegroQuantityCommandUniqueIndex1841000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_allegro_quantity_commands_commandId"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_allegro_quantity_commands_commandId_offerId"
      ON "allegro_quantity_commands" ("commandId", "offerId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_allegro_quantity_commands_commandId_offerId"`
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_allegro_quantity_commands_commandId"
      ON "allegro_quantity_commands" ("commandId")
    `);
  }
}
