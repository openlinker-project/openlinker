/**
 * Sales document settings singleton (#3941): the OpenLinker-wide gift form on
 * documents, the lowest of the three levels (gift, connection, default).
 *
 * Nullable columns, NULL = not set, so an install that never saves anything
 * keeps resolving the code default (`technical-cent`). No row is seeded.
 * Declared on the ORM entity as well, because the integration harness builds
 * schema by `synchronize`.
 *
 * Generated: 2026-11-05 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSalesDocumentSettings1939300000000 implements MigrationInterface {
  name = 'CreateSalesDocumentSettings1939300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "sales_document_settings" (
        "id" text NOT NULL,
        "gift_document_form" character varying(32),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_sales_document_settings" PRIMARY KEY ("id")
      )`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sales_document_settings"`);
  }
}
