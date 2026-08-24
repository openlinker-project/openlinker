/**
 * Create Sales-Document Country Acknowledgments Table Migration (#2186)
 *
 * Persists "this market intentionally has no sales document configured" as
 * a distinct fact from "nobody has configured it yet" — before this table
 * both read identically (an empty `sales_document_rules` /
 * `sales_document_country_defaults` set for the country). `country` is the
 * primary key — mirrors `sales_document_thresholds`' `ref`-as-primary-key
 * shape, since "the acknowledgment for this country" is structurally
 * singular (an upsert replaces the row, it never accumulates a history).
 *
 * No FK to `connections` — an acknowledgment names a country, not a
 * connection.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSalesDocumentCountryAcknowledgments1839000000000 implements MigrationInterface {
  name = 'CreateSalesDocumentCountryAcknowledgments1839000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sales_document_country_acknowledgments" (
        "country" varchar(8) NOT NULL,
        "acknowledged_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_document_country_acknowledgments" PRIMARY KEY ("country")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_document_country_acknowledgments"`);
  }
}
