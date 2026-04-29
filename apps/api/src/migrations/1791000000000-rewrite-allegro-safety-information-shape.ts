/**
 * Rewrite Allegro Safety Information Shape (#445)
 *
 * Pre-#445 versions of the Allegro adapter persisted
 * `Connection.config.sellerDefaults.safetyInformation` as:
 *   { type: 'SAFETY_INFORMATION', content: string }
 *
 * Allegro's actual API (per developer.allegro.pl, GPSR) uses a different
 * discriminator and field name:
 *   { type: 'TEXT', description: string }
 *
 * The `SAFETY_INFORMATION` discriminator is unrecognized — Allegro silently
 * drops the malformed object on POST /sale/product-offers and reports the
 * field as missing via a misleading `SAFETY_INFO_NOT_DEFINED` error.
 *
 * This migration rewrites every legacy-shape row in-place. It is idempotent
 * — only matches rows where `type === 'SAFETY_INFORMATION'` survives, so
 * re-running has no effect. `NO_SAFETY_INFORMATION`, `TEXT`, and
 * `ATTACHMENTS` rows are left untouched.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class RewriteAllegroSafetyInformationShape1791000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE connections
      SET config = jsonb_set(
        config,
        '{sellerDefaults,safetyInformation}',
        jsonb_build_object(
          'type', 'TEXT',
          'description', config->'sellerDefaults'->'safetyInformation'->>'content'
        )
      )
      WHERE "platformType" = 'allegro'
        AND config->'sellerDefaults'->'safetyInformation'->>'type' = 'SAFETY_INFORMATION'
        AND (config->'sellerDefaults'->'safetyInformation'->>'content') IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort reversal: rewrite any TEXT-shape rows we just promoted back
    // to the legacy SAFETY_INFORMATION shape. Cannot distinguish rows that
    // were originally TEXT from rows promoted by `up()` — but rolling back
    // through this migration also rolls back the code that recognized TEXT,
    // so the legacy shape is what the older adapter expected.
    await queryRunner.query(`
      UPDATE connections
      SET config = jsonb_set(
        config,
        '{sellerDefaults,safetyInformation}',
        jsonb_build_object(
          'type', 'SAFETY_INFORMATION',
          'content', config->'sellerDefaults'->'safetyInformation'->>'description'
        )
      )
      WHERE "platformType" = 'allegro'
        AND config->'sellerDefaults'->'safetyInformation'->>'type' = 'TEXT'
        AND (config->'sellerDefaults'->'safetyInformation'->>'description') IS NOT NULL
    `);
  }
}
