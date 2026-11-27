/**
 * The `custom-price` gift document form carries an amount (#3935, ADR-083
 * amendment): the gross unit price the gift shows at on a document.
 *
 * Two nullable columns, NULL = no amount (every other form, every existing
 * row): `promotion_grants.documentUnitPrice` freezes the amount with the form
 * at grant time, and `sales_document_settings.gift_document_unit_price` holds
 * the OpenLinker-wide default's amount. A promotion's own benefit is jsonb and
 * needs no column. Declared on the ORM entities as well, because the
 * integration harness builds schema by `synchronize`.
 *
 * Generated: 2026-11-10 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGiftCustomPriceAmount1939600000000 implements MigrationInterface {
  name = 'AddGiftCustomPriceAmount1939600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "promotion_grants" ADD COLUMN "documentUnitPrice" character varying(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "sales_document_settings" ADD COLUMN "gift_document_unit_price" character varying(16)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_document_settings" DROP COLUMN "gift_document_unit_price"`);
    await queryRunner.query(`ALTER TABLE "promotion_grants" DROP COLUMN "documentUnitPrice"`);
  }
}
