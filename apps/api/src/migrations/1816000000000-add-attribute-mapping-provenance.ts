/**
 * Add owner-taxonomy provenance to attribute_mappings (#1045, ADR-023 §40/§83).
 *
 * Mirrors the `destination_taxonomy_provenance` column already on
 * `category_mappings` (migration 1804000000000). Lets a `borrows` destination
 * (ERLI) reuse an owner-authored attribute mapping by provenance with zero
 * re-authoring. `NOT NULL DEFAULT 'allegro'` keeps every existing row resolvable
 * post-migration without a backfill (Allegro is the only owner taxonomy today).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttributeMappingProvenance1816000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attribute_mappings" ADD COLUMN IF NOT EXISTS "destination_taxonomy_provenance" varchar(50) NOT NULL DEFAULT 'allegro'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attribute_mappings" DROP COLUMN IF EXISTS "destination_taxonomy_provenance"`
    );
  }
}
