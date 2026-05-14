/**
 * Promote ProductVariant to First-Class EntityType Migration
 *
 * Re-homes existing variant rows under the new `'ProductVariant'` EntityType so
 * they adopt the documented `ol_variant_*` internal-ID prefix. Before this
 * migration every variant mapping was written under `entityType='Product'` with
 * a `metadata.isVariant='true'` shim, which produced `ol_product_*` IDs and broke
 * the frontend CreateOfferWizard (whose Zod schema validates picked variants
 * against `^ol_variant_[a-f0-9]+$`).
 *
 * Scope of data touched (all inside one transactional run):
 *  - `identifier_mappings`    — entityType + internalId updated for variant rows
 *  - `product_variants.id`    — PK re-prefixed
 *  - `inventory_items.productVariantId`        — FK re-prefixed
 *  - `offer_creation_records.internalVariantId` — loose reference re-prefixed
 *
 * The `inventory_items → product_variants` FK is temporarily dropped so the PK
 * update succeeds, then re-added with its original ON DELETE/UPDATE semantics.
 *
 * The `context.metadata.isVariant` value is deliberately left in place on
 * historical rows — no code reads or writes it anymore, and scrubbing it from
 * the JSON would bloat this migration for zero functional benefit.
 *
 * Issue: https://github.com/SilkSoftwareHouse/openlinker/issues/322
 * Generated: 2026-04-22
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PromoteProductVariantEntityType1788000000000 implements MigrationInterface {
  name = 'PromoteProductVariantEntityType1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the inventory_items → product_variants FK so the PK update succeeds.
    //    The FK is ON UPDATE NO ACTION so it does not cascade PK changes.
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "FK_8fa4cdd8e98fde93d4f14025417"`
    );

    // 2. Build a temp projection of (mapping_id, old_id, new_id) covering every
    //    identifier_mappings row currently flagged as a variant. The projection
    //    drives all four subsequent UPDATEs so they stay consistent.
    await queryRunner.query(`
      CREATE TEMP TABLE variant_id_migration AS
      SELECT
        im.id           AS mapping_id,
        im."internalId" AS old_id,
        'ol_variant_' || substring(im."internalId" from 12) AS new_id
      FROM identifier_mappings im
      WHERE im."entityType" = 'Product'
        AND (im.context -> 'metadata' ->> 'isVariant') = 'true'
        AND im."internalId" LIKE 'ol_product_%'
    `);

    // 3. Update the canonical variant rows. RETURNING count drives orphan detection.
    const productVariantsUpdateResult = (await queryRunner.query(`
      WITH updated AS (
        UPDATE product_variants pv
        SET id = m.new_id
        FROM variant_id_migration m
        WHERE pv.id = m.old_id
        RETURNING 1
      )
      SELECT count(*)::int AS "updatedCount" FROM updated
    `)) as Array<{ updatedCount: number }>;

    // 4. Update the inventory-items FK column in lockstep.
    await queryRunner.query(`
      UPDATE inventory_items ii
      SET "productVariantId" = m.new_id
      FROM variant_id_migration m
      WHERE ii."productVariantId" = m.old_id
    `);

    // 5. Update the offer-creation-records loose reference.
    await queryRunner.query(`
      UPDATE offer_creation_records ocr
      SET "internalVariantId" = m.new_id
      FROM variant_id_migration m
      WHERE ocr."internalVariantId" = m.old_id
    `);

    // 6. Update the identifier_mappings rows last (entityType + internalId atomically).
    //    The unique index (entityType, platformType, connectionId, externalId)
    //    will not conflict — no rows currently use entityType='ProductVariant'.
    await queryRunner.query(`
      UPDATE identifier_mappings im
      SET "internalId" = m.new_id,
          "entityType" = 'ProductVariant'
      FROM variant_id_migration m
      WHERE im.id = m.mapping_id
    `);

    // 7. Orphan detection: if the variant-mapping count is greater than the
    //    product_variants updated count, there are orphaned mappings (mappings
    //    flagged as variant with no backing row). Not a regression — a pre-
    //    existing orphan stays an orphan, just re-prefixed — but worth logging
    //    so the drift is visible in migration output.
    //    Note: the reverse case (a `product_variants` row with no flagged
    //    mapping) is NOT detected here — that row stays as `ol_product_*`
    //    and is effectively a dangling variant. A follow-up cleanup script
    //    can scan for those if the drift ever matters; out of scope here.
    const mappingCountRows = (await queryRunner.query(`
      SELECT count(*)::int AS "mappingCount" FROM variant_id_migration
    `)) as Array<{ mappingCount: number }>;

    const mappingCount = mappingCountRows[0]?.mappingCount ?? 0;
    const variantUpdateCount = productVariantsUpdateResult[0]?.updatedCount ?? 0;
    if (mappingCount > variantUpdateCount) {
      const orphanCount = mappingCount - variantUpdateCount;
      queryRunner.connection.logger.log(
        'warn',
        `[PromoteProductVariantEntityType1788000000000] ${orphanCount} identifier_mappings row(s) flagged as variant had no backing product_variants row. Mappings were still re-prefixed to ol_variant_* so the system remains consistent; pre-existing orphans remain orphans.`
      );
    }

    // 8. Drop the temp table before re-adding the FK (temp tables auto-drop at
    //    transaction end, but being explicit avoids surprises if this migration
    //    is ever split across calls).
    await queryRunner.query(`DROP TABLE variant_id_migration`);

    // 9. Re-add the inventory_items → product_variants FK with its original semantics.
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_8fa4cdd8e98fde93d4f14025417" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Inverse: every `entityType='ProductVariant'` row with `ol_variant_*` id
    // reverts to `entityType='Product' + ol_product_*`, with `metadata.isVariant`
    // re-added so the pre-migration repository query (which filters on the
    // isVariant shim) still finds these rows after rollback.
    //
    // Gate is entityType (authoritative post-up), NOT `metadata.isVariant`:
    // variants minted after up() no longer carry the shim, so gating on it
    // would silently leave post-migration variants behind as orphans.

    // Pre-flight collision check: PrestaShop combination IDs share the
    // numeric externalId namespace with product IDs. If a 'Product' mapping
    // exists with the same (platformType, connectionId, externalId) as a
    // 'ProductVariant' mapping, reverting the variant to 'Product' would
    // violate the unique index. This indicates a pre-existing data
    // inconsistency that we refuse to silently corrupt further — abort with
    // a clear error so operators can remediate manually.
    const collisions = (await queryRunner.query(`
      SELECT v."externalId", v."connectionId", v."platformType"
      FROM identifier_mappings v
      JOIN identifier_mappings p
        USING ("externalId", "connectionId", "platformType")
      WHERE v."entityType" = 'ProductVariant'
        AND p."entityType" = 'Product'
      LIMIT 5
    `)) as Array<{ externalId: string; connectionId: string; platformType: string }>;

    if (collisions.length > 0) {
      const sample = collisions
        .map((c) => `(${c.platformType}/${c.connectionId}/externalId=${c.externalId})`)
        .join(', ');
      throw new Error(
        `[PromoteProductVariantEntityType1788000000000] Cannot revert: ${collisions.length}+ ProductVariant mapping(s) collide with existing Product mappings on (platformType, connectionId, externalId). Reverting would violate the identifier_mappings unique index. Sample: ${sample}. Remediate manually (drop the colliding Product rows or re-run up) before retrying.`
      );
    }

    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "FK_8fa4cdd8e98fde93d4f14025417"`
    );

    await queryRunner.query(`
      CREATE TEMP TABLE variant_id_rollback AS
      SELECT
        im.id           AS mapping_id,
        im."internalId" AS new_id,
        'ol_product_' || substring(im."internalId" from 12) AS old_id
      FROM identifier_mappings im
      WHERE im."entityType" = 'ProductVariant'
        AND im."internalId" LIKE 'ol_variant_%'
    `);

    await queryRunner.query(`
      UPDATE product_variants pv
      SET id = r.old_id
      FROM variant_id_rollback r
      WHERE pv.id = r.new_id
    `);

    await queryRunner.query(`
      UPDATE inventory_items ii
      SET "productVariantId" = r.old_id
      FROM variant_id_rollback r
      WHERE ii."productVariantId" = r.new_id
    `);

    await queryRunner.query(`
      UPDATE offer_creation_records ocr
      SET "internalVariantId" = r.old_id
      FROM variant_id_rollback r
      WHERE ocr."internalVariantId" = r.new_id
    `);

    // entityType + internalId + metadata.isVariant all updated atomically.
    // jsonb_set with create_missing=true handles rows that never had the shim.
    await queryRunner.query(`
      UPDATE identifier_mappings im
      SET "internalId" = r.old_id,
          "entityType" = 'Product',
          context = jsonb_set(
            coalesce(im.context, '{}'::jsonb),
            '{metadata,isVariant}',
            'true'::jsonb,
            true
          )
      FROM variant_id_rollback r
      WHERE im.id = r.mapping_id
    `);

    await queryRunner.query(`DROP TABLE variant_id_rollback`);

    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD CONSTRAINT "FK_8fa4cdd8e98fde93d4f14025417" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }
}
