import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `resolvedProductId` / `resolvedVariantId` to `return_lines` (#3450).
 *
 * Denormalizes the catalogue identity of the already-resolved order line
 * (`OrderItem.productId` / `OrderItem.variantId`) onto the return line at the
 * same moment `resolvedOrderLineId` is claimed, so `ReturnCustodyService`'s
 * restock target resolution can use it without a live order-snapshot read —
 * `libs/core/src/returns` must not take the orders-module edge that read
 * would cost.
 *
 * Nullable, no default, no FK — the same reasoning `resolvedOrderLineId`
 * already carries: these are internal ids on `products` / `product_variants`,
 * but the write is a by-value denormalization of an already-resolved fact
 * rather than a relation this table owns, and a line whose order-line
 * resolution never ran (an orphan, a pre-#3171 return) legitimately has
 * neither.
 */
export class AddReturnLineResolvedCatalogIdentity1893000000000 implements MigrationInterface {
  name = 'AddReturnLineResolvedCatalogIdentity1893000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "return_lines" ADD COLUMN IF NOT EXISTS "resolvedProductId" text`
    );
    await queryRunner.query(
      `ALTER TABLE "return_lines" ADD COLUMN IF NOT EXISTS "resolvedVariantId" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "return_lines" DROP COLUMN IF EXISTS "resolvedVariantId"`
    );
    await queryRunner.query(
      `ALTER TABLE "return_lines" DROP COLUMN IF EXISTS "resolvedProductId"`
    );
  }
}
