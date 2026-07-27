/**
 * Add Product Variant isStale Migration
 *
 * Adds `isStale` (boolean) + `staleAt` (timestamptz) to `product_variants`
 * (#1599). The master product sync soft-marks a variant stale when it stops
 * appearing in the master's `getProductVariants` response, or when the product
 * itself 404s at the master — the products-context counterpart of
 * `inventory_items.isStale` (#1478). Order-item resolution consults `isStale`
 * to fail early instead of passing a deleted ("zombie") variant downstream.
 * Soft-mark, never a delete, so mappings and historical orders keep resolving.
 * `isStale` defaults `false` so all existing rows backfill to "live".
 *
 * `staleAt` is `timestamptz` (not bare `timestamp`) so the `NOW()` write — which
 * yields `timestamptz` — is stored without a silent tz coercion, matching the
 * #1296 correction applied to `invoice_records`.
 *
 * Column names are camelCase to match TypeORM's default naming (the repo sets no
 * naming strategy) — cf. `inventory_items.isStale` and the sibling columns here
 * (`productId`, `createdAt`).
 *
 * Generated: 2026-07-16 (synthetic sequential prefix per docs/migrations.md
 * #1013 — sorts strictly after the current `main` tail `1819000000000`).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductVariantIsStale1819000000001 implements MigrationInterface {
  name = 'AddProductVariantIsStale1819000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "isStale" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "staleAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "staleAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "isStale"`,
    );
  }
}
