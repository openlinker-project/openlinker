/**
 * Add request snapshot column to listing_creation_records (#1845)
 *
 * Persists the neutral per-item shop-publish request on each
 * `ListingCreationRecord` at enqueue time so the bulk shop-publish retry can
 * rebuild the original `shop.product.publish` payload for a failed child without
 * re-deriving it - the shop-side counterpart to `offer_creation_records.request`.
 *
 * Nullable jsonb: existing rows (and single publishes that opt out) carry null.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListingCreationRecordRequestSnapshot1831000000000
  implements MigrationInterface
{
  name = 'AddListingCreationRecordRequestSnapshot1831000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "listing_creation_records" ADD COLUMN IF NOT EXISTS "request" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "listing_creation_records" DROP COLUMN IF EXISTS "request"`,
    );
  }
}
