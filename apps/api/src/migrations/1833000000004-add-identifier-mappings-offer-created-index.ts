/**
 * Add a partial `(connectionId, createdAt DESC, id DESC)` index on
 * `identifier_mappings` for `entityType = 'Offer'` (#2032 review thread 4).
 *
 * `identifier_mappings` carries only `UNIQUE(entityType, platformType,
 * connectionId, externalId)` and `(entityType, connectionId, internalId)` -
 * neither leads with nor includes `createdAt`, so `OfferMappingRepository`'s
 * `createdAt DESC, id DESC` ordering (both `findMany`'s listings-page query
 * and `findMappingPage`'s write/sync-path query) forces a full scan + sort on
 * every page of a large catalog.
 *
 * The same drift is a correctness bug, not just latency: `OfferStatusSyncService`
 * pages this exact ordering by a persisted OFFSET cursor
 * (`allegro.offerStatus.scanOffset`). A newly-inserted mapping sorts to the
 * top under `createdAt DESC` and pushes every older row one offset higher, so
 * on a busy seller the cursor can permanently skip rows past wherever it last
 * stopped - a third, undocumented mechanism producing permanently-`Unsynced`
 * rows, on top of the two `offer-lifecycle.types.ts` already documents. This
 * index does not remove the OFFSET-paging hazard itself (that's a keyset-paging
 * follow-up), but it makes the scan the cursor walks an index-order scan
 * instead of a sort-after-seqscan, which is the load-bearing half of the fix
 * today.
 *
 * Partial (`WHERE "entityType" = 'Offer'`) rather than a plain composite index:
 * `identifier_mappings` is shared by every `CoreEntityType`, and only the
 * Offer rows are paged by this ordering.
 *
 * Renumbered from 1833000000002 to 1833000000004: #2036 landed
 * `CreateRefundRecords1833000000002` in parallel, so the two shared a
 * timestamp and TypeORM's ordering between them was undefined. `CREATE INDEX`
 * is `IF NOT EXISTS` so an environment that already applied the old
 * `...1833000000002` name re-runs the renamed migration without failing.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdentifierMappingsOfferCreatedIndex1833000000004 implements MigrationInterface {
  name = 'AddIdentifierMappingsOfferCreatedIndex1833000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_identifier_mappings_offer_created"
        ON "identifier_mappings" ("connectionId", "createdAt" DESC, "id" DESC)
        WHERE "entityType" = 'Offer'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_identifier_mappings_offer_created"`
    );
  }
}
