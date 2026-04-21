/**
 * Add Seller Policies Cache Table Migration
 *
 * Creates the `seller_policies_cache` table used by `SellerPoliciesService`
 * to memoise marketplace seller-policy lookups (delivery / return / warranty /
 * implied-warranty) for the 10-minute TTL window. One row per connection;
 * the full `SellerPolicies` document is stored as JSONB and the `fetchedAt`
 * timestamp drives staleness checks.
 *
 * Hand-written: 2026-04-21
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSellerPoliciesCache1785000000000 implements MigrationInterface {
  name = 'AddSellerPoliciesCache1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('seller_policies_cache');

    if (!table) {
      await queryRunner.query(`
        CREATE TABLE "seller_policies_cache" (
          "connectionId" uuid NOT NULL,
          "policies" jsonb NOT NULL,
          "fetchedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_seller_policies_cache" PRIMARY KEY ("connectionId")
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "seller_policies_cache"`);
  }
}
