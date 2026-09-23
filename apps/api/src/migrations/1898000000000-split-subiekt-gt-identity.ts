import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give Subiekt GT its own identity, separate from Subiekt nexo.
 *
 * The Subiekt integration shipped as `platformType: 'subiekt'` /
 * `adapterKey: 'subiekt.invoicing.v1'` while serving exactly one product,
 * Subiekt GT. Subiekt nexo is a DIFFERENT InsERT product reached through a
 * different bridge with a different wire contract, and it has no adapter here
 * at all. The bare name could not tell the two apart, so an operator's
 * connection list showed both under one identifier and the only thing
 * distinguishing them was a free-text name.
 *
 * This renames the persisted identity to match the manifest:
 *
 *   platformType  'subiekt'               -> 'subiekt-gt'
 *   adapterKey    'subiekt.invoicing.v1'  -> 'subiekt.gt.v1'
 *   providerType  'subiekt'               -> 'subiekt-gt'
 *
 * `invoicing` leaves the adapter key because it described a fifth of what the
 * adapter does - it is also the product master, the inventory master, an order
 * source and an order destination.
 *
 * WHY ALL FIVE TABLES MOVE IN ONE TRANSACTION
 *
 * `IdentifierMappingService.getInternalId` reads the connection, takes
 * `platformType` from it, and filters `identifier_mappings` on that value; the
 * unique index is `(entityType, platformType, connectionId, externalId)`. If
 * the connection row said `subiekt-gt` while the mapping rows still said
 * `subiekt`, every lookup would MISS and OpenLinker would mint fresh internal
 * ids for every product, variant, customer and order - silently, with each
 * sync appearing to succeed. Splitting this across two deployments would open
 * exactly that window, which is why there is no expand/contract phase and no
 * backwards-compatible alias: `migrate` gates `api` and `worker` in compose,
 * so code and data cross together.
 *
 * `fiscal_registration_records` carries no Subiekt rows on any reachable
 * install (`Fiscalization` is deliberately absent from the Subiekt manifest
 * until the bridge endpoint is verified), so its UPDATE is expected to match
 * zero rows. It is included because the constant it mirrors
 * (`SUBIEKT_FISCAL_PROVIDER_TYPE`) moved with the others, and a statement that
 * matches nothing costs nothing while closing a class of orphaned label.
 *
 * WHAT DELIBERATELY DOES NOT MOVE
 *
 * Persisted keys that merely contain the word "subiekt" keep it. They name
 * stored state, not the platform:
 *
 *   connection_cursors.cursorKey  'subiekt.orders.dataWystawieniaCursor'
 *                                 'subiekt.orders.watermark'
 *       Renaming restarts the order feed from the beginning of time and
 *       re-ingests the entire history.
 *   sync_jobs.jobType             'subiekt.bridge.reachabilitySweep'
 *       A registered SyncJobType; renaming makes the job type unrecognised.
 *   sync_jobs.idempotencyKey      'subiekt:{connectionId}:...'
 *       Harmless but pointless: it would split history from new keys.
 *   Connection config field names ('subiektBridgeUrl', ...) - form fields,
 *       not identity.
 *
 * Do not "finish the rename" by touching those later.
 *
 * ON THE TIMESTAMP
 *
 * `1898000000000`, chosen after scanning EVERY ref rather than this branch's
 * migrations directory. TypeORM keys applied migrations by timestamp, not by
 * class name or file name, so two migrations sharing one timestamp means the
 * second to run is SILENTLY skipped - no error, and `migration:show` reports
 * nothing pending. That has already happened three times on this repo:
 * `1893000000000` and `1894000000000` are each claimed twice today, and
 * `1897000000000` was taken by a branch that appeared between this file being
 * written and being reviewed. A directory listing on your own branch is not a
 * sufficient check; scan the refs.
 */
export class SplitSubiektGtIdentity1898000000000 implements MigrationInterface {
  name = 'SplitSubiektGtIdentity1898000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Collision guard, FIRST and before any write.
    //
    // Renaming `subiekt` -> `subiekt-gt` inside `identifier_mappings` would
    // violate the unique index if a `subiekt-gt` row already existed for the
    // same (entityType, connectionId, externalId). That is unreachable today
    // because nothing has ever written `subiekt-gt`, but a migration must not
    // rest on that: a raw unique-violation here would abort mid-way with a
    // driver error naming an index rather than the problem. Fail loudly and
    // explain instead.
    await queryRunner.query(`
      DO $$
      DECLARE collisions integer;
      BEGIN
        SELECT COUNT(*) INTO collisions
          FROM "identifier_mappings" legacy
          JOIN "identifier_mappings" already
            ON already."platformType" = 'subiekt-gt'
           AND already."entityType"   = legacy."entityType"
           AND already."connectionId" = legacy."connectionId"
           AND already."externalId"   = legacy."externalId"
          WHERE legacy."platformType" = 'subiekt';
        IF collisions > 0 THEN
          RAISE EXCEPTION
            'Subiekt GT identity split aborted: % identifier_mappings row(s) would collide on (entityType, platformType, connectionId, externalId) after renaming subiekt -> subiekt-gt. Nothing was changed. Inspect with: SELECT "entityType", "connectionId", "externalId", "platformType" FROM identifier_mappings WHERE "platformType" IN (''subiekt'', ''subiekt-gt'') ORDER BY 1,2,3;',
            collisions;
        END IF;
      END$$;
    `);

    // 1. connections. The adapterKey arm is primary; the platformType arm is
    //    the fallback for a row that never carried an explicit key (adapter
    //    resolution would have fallen back to the platform default there).
    await queryRunner.query(
      `UPDATE "connections"
         SET "platformType" = 'subiekt-gt',
             "adapterKey"   = 'subiekt.gt.v1'
         WHERE COALESCE("adapterKey", '') = 'subiekt.invoicing.v1'
            OR ("adapterKey" IS NULL AND "platformType" = 'subiekt')`
    );

    // 2. integration_credentials.
    await queryRunner.query(
      `UPDATE "integration_credentials"
         SET "platformType" = 'subiekt-gt'
         WHERE "platformType" = 'subiekt'`
    );

    // 3. identifier_mappings. The one that matters - see the header.
    await queryRunner.query(
      `UPDATE "identifier_mappings"
         SET "platformType" = 'subiekt-gt'
         WHERE "platformType" = 'subiekt'`
    );

    // 4. invoice_records. These documents really were issued by the GT
    //    adapter (no nexo adapter has ever existed), so the new label is more
    //    truthful than the old one rather than a rewrite of history. The
    //    column is read as a display label, never as a join key.
    await queryRunner.query(
      `UPDATE "invoice_records"
         SET "providerType" = 'subiekt-gt'
         WHERE "providerType" = 'subiekt'`
    );

    // 5. fiscal_registration_records. Expected to match zero rows - see header.
    await queryRunner.query(
      `UPDATE "fiscal_registration_records"
         SET "providerType" = 'subiekt-gt'
         WHERE "providerType" = 'subiekt'`
    );

    // Visibility. Every failure mode this migration guards against is SILENT,
    // so report anything left behind rather than trusting that zero rows
    // remain. A leftover here means a later read will miss.
    await queryRunner.query(`
      DO $$
      DECLARE
        left_connections  integer;
        left_credentials  integer;
        left_mappings     integer;
        left_invoices     integer;
        left_fiscal       integer;
      BEGIN
        SELECT COUNT(*) INTO left_connections FROM "connections"              WHERE "platformType" = 'subiekt';
        SELECT COUNT(*) INTO left_credentials FROM "integration_credentials"  WHERE "platformType" = 'subiekt';
        SELECT COUNT(*) INTO left_mappings    FROM "identifier_mappings"      WHERE "platformType" = 'subiekt';
        SELECT COUNT(*) INTO left_invoices    FROM "invoice_records"          WHERE "providerType" = 'subiekt';
        SELECT COUNT(*) INTO left_fiscal      FROM "fiscal_registration_records" WHERE "providerType" = 'subiekt';

        IF left_connections + left_credentials + left_mappings + left_invoices + left_fiscal > 0 THEN
          RAISE WARNING
            'Subiekt GT identity split left rows behind: connections=%, integration_credentials=%, identifier_mappings=%, invoice_records=%, fiscal_registration_records=%. A leftover identifier_mappings row means lookups will MISS and fresh internal ids will be minted.',
            left_connections, left_credentials, left_mappings, left_invoices, left_fiscal;
        ELSE
          RAISE NOTICE 'Subiekt GT identity split: no rows left on the legacy ''subiekt'' identity.';
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Same guard, mirrored: reverting could collide against a row that legitimately
    // carries the bare 'subiekt' identity (e.g. one created by an older build
    // running alongside).
    await queryRunner.query(`
      DO $$
      DECLARE collisions integer;
      BEGIN
        SELECT COUNT(*) INTO collisions
          FROM "identifier_mappings" gt
          JOIN "identifier_mappings" legacy
            ON legacy."platformType" = 'subiekt'
           AND legacy."entityType"   = gt."entityType"
           AND legacy."connectionId" = gt."connectionId"
           AND legacy."externalId"   = gt."externalId"
          WHERE gt."platformType" = 'subiekt-gt';
        IF collisions > 0 THEN
          RAISE EXCEPTION
            'Subiekt GT identity split rollback aborted: % identifier_mappings row(s) would collide when renaming subiekt-gt -> subiekt. Nothing was changed.',
            collisions;
        END IF;
      END$$;
    `);

    await queryRunner.query(
      `UPDATE "connections"
         SET "platformType" = 'subiekt',
             "adapterKey"   = 'subiekt.invoicing.v1'
         WHERE COALESCE("adapterKey", '') = 'subiekt.gt.v1'
            OR ("adapterKey" IS NULL AND "platformType" = 'subiekt-gt')`
    );

    await queryRunner.query(
      `UPDATE "integration_credentials"
         SET "platformType" = 'subiekt'
         WHERE "platformType" = 'subiekt-gt'`
    );

    await queryRunner.query(
      `UPDATE "identifier_mappings"
         SET "platformType" = 'subiekt'
         WHERE "platformType" = 'subiekt-gt'`
    );

    await queryRunner.query(
      `UPDATE "invoice_records"
         SET "providerType" = 'subiekt'
         WHERE "providerType" = 'subiekt-gt'`
    );

    await queryRunner.query(
      `UPDATE "fiscal_registration_records"
         SET "providerType" = 'subiekt'
         WHERE "providerType" = 'subiekt-gt'`
    );
  }
}
