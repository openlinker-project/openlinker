/**
 * Migration: Add Allegro Quantity Commands Table
 *
 * Creates the allegro_quantity_commands table for storing Allegro offer quantity
 * change command status. Tracks command execution status, errors, and timestamps
 * for observability and debugging.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllegroQuantityCommandsTable1767900000000 implements MigrationInterface {
  name = 'AddAllegroQuantityCommandsTable1767900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if table already exists (might have been created manually or by a later migration)
    const table = await queryRunner.getTable('allegro_quantity_commands');

    if (!table) {
      await queryRunner.query(`
        CREATE TABLE "allegro_quantity_commands" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "commandId" character varying NOT NULL,
          "connectionId" uuid NOT NULL,
          "offerId" character varying NOT NULL,
          "quantity" integer NOT NULL,
          "status" character varying NOT NULL,
          "error" text,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_allegro_quantity_commands" PRIMARY KEY ("id")
        )
      `);

      // Unique constraint: one record per commandId (commandId is unique per Allegro)
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_allegro_quantity_commands_commandId" 
        ON "allegro_quantity_commands" ("commandId")
      `);

      // Index for querying by connection
      await queryRunner.query(`
        CREATE INDEX "IDX_allegro_quantity_commands_connection" 
        ON "allegro_quantity_commands" ("connectionId", "createdAt")
      `);

      // Index for querying failed commands
      await queryRunner.query(`
        CREATE INDEX "IDX_allegro_quantity_commands_status" 
        ON "allegro_quantity_commands" ("status", "createdAt")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_allegro_quantity_commands_status"`);
    await queryRunner.query(`DROP INDEX "IDX_allegro_quantity_commands_connection"`);
    await queryRunner.query(`DROP INDEX "IDX_allegro_quantity_commands_commandId"`);
    await queryRunner.query(`DROP TABLE "allegro_quantity_commands"`);
  }
}
