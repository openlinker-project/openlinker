/**
 * Re-key category mappings the Category Mappings page saved under the master (#3993).
 *
 * Until #3993 the page wrote every mapping with `destination_connection_id` =
 * the MASTER connection (the route id), while offer creation resolves by the
 * MARKETPLACE id. Those rows were never read when listing offers.
 *
 * A legacy row is one whose destination connection is not of the platform its
 * own `destination_taxonomy_provenance` names (a Shopify or PrestaShop
 * connection holding an `allegro` row). It is moved only when exactly one
 * non-archived connection of that platform exists, because then the target is
 * not a guess:
 *   - `destination_connection_id` becomes that connection;
 *   - `source_connection_id` becomes the old destination when it was NULL, since
 *     the old destination WAS the master;
 *   - a category already mapped on the target for that source keeps the
 *     target's row, and the legacy row is deleted.
 *
 * With two or more candidates (Allegro sandbox and production side by side)
 * the rows stay where they are, and the Category Mappings page offers the
 * operator a one-click move to the marketplace they pick
 * (`POST .../mappings/categories/reassign`).
 *
 * `down()` reverses nothing and only logs a notice saying so: the moved rows
 * are indistinguishable from rows written correctly afterwards, and restoring
 * the old key would only make them unused again.
 *
 * Generated: 2026-11-05 (synthetic prefix carrying the issue number, per
 * docs/migrations.md rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_ROWS_CTE = `
  WITH legacy AS (
    SELECT
      cm.id,
      cm.source_category_id,
      COALESCE(cm.source_connection_id, cm.destination_connection_id) AS source_id,
      owners.ids[1] AS owner_id
    FROM category_mappings cm
    JOIN connections d ON d.id = cm.destination_connection_id
    CROSS JOIN LATERAL (
      SELECT array_agg(c.id) AS ids
      FROM connections c
      WHERE c."platformType" = split_part(cm.destination_taxonomy_provenance, ':', 1)
        AND c.status <> 'archived'
    ) owners
    WHERE d."platformType" <> split_part(cm.destination_taxonomy_provenance, ':', 1)
      AND cardinality(owners.ids) = 1
  )`;

export class RekeyMasterKeyedCategoryMappings1938443993000 implements MigrationInterface {
  name = 'RekeyMasterKeyedCategoryMappings1938443993000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `${LEGACY_ROWS_CTE}
      DELETE FROM category_mappings t
      USING legacy l
      WHERE t.id = l.id
        AND EXISTS (
          SELECT 1 FROM category_mappings e
          WHERE e.destination_connection_id = l.owner_id
            AND e.source_category_id = l.source_category_id
            AND (e.source_connection_id = l.source_id OR e.source_connection_id IS NULL)
        )`
    );
    await queryRunner.query(
      `${LEGACY_ROWS_CTE}
      UPDATE category_mappings t
      SET destination_connection_id = l.owner_id,
          source_connection_id = l.source_id,
          updated_at = now()
      FROM legacy l
      WHERE t.id = l.id`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Nothing is reversed, see the header. An operator rolling back would
    // otherwise read a clean revert as "the mappings are keyed as before", so
    // the migration log says plainly that they stay re-keyed (the RAISE NOTICE
    // breadcrumb shape of 1881000000001).
    await queryRunner.query(`
      DO $$
      BEGIN
        RAISE NOTICE
          '[#3993] Category mappings stay re-keyed to their marketplace connection. The original master-keyed rows and any deduplicated duplicates are not restored.';
      END$$;
    `);
  }
}
