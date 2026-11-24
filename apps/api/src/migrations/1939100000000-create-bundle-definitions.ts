/**
 * Create `bundle_definitions` and add `order_records.lineExpansion` (#3607).
 *
 * `bundle_definitions` holds one immutable row per VERSION of a bundle's
 * composition, so an order frozen against version N stays explainable after
 * version N+1. `order_records.lineExpansion` is the per-order frozen copy of
 * the definitions that applied at ingestion (ADR-083 decision 2).
 *
 * Existing `ready` orders are stamped with the EMPTY frozen expansion, so that
 * a NULL `lineExpansion` on a `ready` row afterwards unambiguously means "an
 * ingestion persisted the order and crashed before freezing it" and is frozen
 * on retry. Without the stamp a pre-feature order and that crash residue are
 * indistinguishable, and the crash residue would reserve the bundle SKU forever.
 * The stamp is a constant (`{"v":1,"definitions":[]}`, the application's
 * EMPTY_LINE_EXPANSION), not a derivation, so there is no application logic to
 * copy.
 *
 * Declared on the ORM entities as well, because the integration harness builds
 * schema by `synchronize`.
 *
 * Generated: 2026-11-04 (synthetic sequential prefix per docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBundleDefinitions1939100000000 implements MigrationInterface {
  name = 'CreateBundleDefinitions1939100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bundle_definitions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variantId" text NOT NULL,
        "version" integer NOT NULL,
        "components" jsonb NOT NULL,
        "retiredAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bundle_definitions" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bundle_definitions_variant_version" ON "bundle_definitions" ("variantId", "version")`
    );
    await queryRunner.query(`ALTER TABLE "order_records" ADD COLUMN "lineExpansion" jsonb`);
    await queryRunner.query(
      `UPDATE "order_records" SET "lineExpansion" = '{"v":1,"definitions":[]}'::jsonb WHERE "recordStatus" = 'ready'`
    );
    // Serves the containment predicate of countOpenOrdersByBundleVersion.
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_lineExpansion" ON "order_records" USING GIN ("lineExpansion" jsonb_path_ops)`
    );
    // #3624: an operator's "N x this product" confirmation for a held multipack.
    await queryRunner.query(
      `CREATE TABLE "multipack_confirmations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "variantId" text NOT NULL,
        "packQuantity" integer NOT NULL,
        "confirmedByUserId" text,
        "confirmedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_multipack_confirmations" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_multipack_confirmations_variant_pack" ON "multipack_confirmations" ("variantId", "packQuantity")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_multipack_confirmations_variant_pack"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "multipack_confirmations"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_lineExpansion"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "lineExpansion"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_bundle_definitions_variant_version"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bundle_definitions"`);
  }
}
