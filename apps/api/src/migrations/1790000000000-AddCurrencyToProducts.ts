/**
 * Add Currency To Products
 *
 * Adds a `currency` column to the `products` table so the ISO 4217 currency code
 * resolved by the master adapter at sync time survives persistence. Nullable —
 * existing rows stay null until their next sync populates the field, and
 * adapters that don't know the shop's currency emit `null` rather than a guess.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCurrencyToProducts1790000000000 implements MigrationInterface {
  name = 'AddCurrencyToProducts1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "currency" character varying(3)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "currency"`);
  }
}
