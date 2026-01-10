import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConnectionCursorsTable1767713171000 implements MigrationInterface {
  name = 'AddConnectionCursorsTable1767713171000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "connection_cursors" (
        "connectionId" uuid NOT NULL,
        "cursorKey" character varying NOT NULL,
        "value" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_cursors" PRIMARY KEY ("connectionId", "cursorKey")
      )
    `);
    // Note: No explicit unique index needed - composite primary key already enforces uniqueness
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "connection_cursors"`);
  }
}

