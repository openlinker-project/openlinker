/**
 * Add Currency To Products
 *
 * Adds a `currency` column to the `products` table so the ISO 4217 currency code
 * resolved by the master adapter at sync time survives persistence. Nullable —
 * existing rows stay null until their next sync populates the field, and
 * adapters that don't know the shop's currency emit `null` rather than a guess.
 *
 * Retimestamped from `1790000000000` → `1790000000002` (#374): the original
 * timestamp collided with `AddPromptTemplatesTable1790000000000`, leaving the
 * `currency` column unapplied on some dev DBs even though TypeORM recorded both
 * migrations as executed. The `up()` body self-heals across all affected states:
 *
 *   1. DELETE the orphaned `migrations` row written under the old class name
 *      (no-op on fresh DBs / DBs that never saw the colliding version).
 *   2. `ADD COLUMN IF NOT EXISTS` so re-applying after a correct original run
 *      is a no-op rather than a `column "currency" already exists` failure.
 *
 * Both statements commit atomically with TypeORM's insert into `migrations`
 * (migrations run under `transaction: 'all'` by default, and Postgres
 * supports DDL inside transactions), so a mid-migration failure rolls the
 * orphan-row cleanup back with the rest.
 *
 * After this migration runs, every previously-affected environment converges
 * to a consistent end state.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCurrencyToProducts1790000000002 implements MigrationInterface {
  name = 'AddCurrencyToProducts1790000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "migrations" WHERE "name" = 'AddCurrencyToProducts1790000000000'`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "currency" character varying(3)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "currency"`);
  }
}
