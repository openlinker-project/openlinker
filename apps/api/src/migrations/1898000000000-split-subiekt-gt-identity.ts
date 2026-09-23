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
 *   platformType  'subiekt'               -> 'subiekt-gt'
 *   adapterKey    'subiekt.invoicing.v1'  -> 'subiekt.gt.v1'
 *   providerType  'subiekt'               -> 'subiekt-gt'
 *
 * WHY EVERYTHING MOVES IN ONE TRANSACTION
 *
 * `IdentifierMappingService.getInternalId` reads the connection, takes
 * `platformType` from it, and filters `identifier_mappings` on that value; the
 * unique index is `(entityType, platformType, connectionId, externalId)`. If a
 * connection row said `subiekt-gt` while its mapping rows still said
 * `subiekt`, every lookup would MISS and OpenLinker would mint fresh internal
 * ids for every product, variant, customer and order - silently, with each
 * sync appearing to succeed and no unique violation to stop it (the index
 * contains the very column that differs). Splitting this across two
 * deployments would open exactly that window, which is why there is no
 * expand/contract phase and no backwards-compatible alias: `migrate` gates
 * `api` and `worker` in compose, so code and data cross together.
 *
 * WHY THE CHILD TABLES ARE ANCHORED ON `connectionId`, NOT ON THE STRING
 *
 * This is the whole correctness argument, and the first draft got it wrong.
 *
 * A mapping row copies its connection's `platformType` VERBATIM at write time
 * (`IdentifierMappingService`), and `platformType` is free text on the way in:
 * `CreateConnectionDto` validates it with `@IsString() @IsNotEmpty()` and
 * nothing else - no registry check, no normalisation. So the connection and
 * its mappings are bound by the FOREIGN KEY, not by the spelling, and any
 * migration that selects the two halves with two different string predicates
 * can move one without the other.
 *
 * That is not hypothetical here. `libs/integrations/subiekt/docs/setup-guide.md`
 * instructs advanced-mode setup with `Platform type = Subiekt` - capital S -
 * alongside `Adapter key = subiekt.invoicing.v1`, while `docs/tutorial.md`
 * says lowercase. A connection created by following our own guide therefore
 * matches on `adapterKey` but not on `platformType = 'subiekt'`, and a
 * string-matched migration would rename the connection and leave every one of
 * its mappings behind - producing precisely the silent id-minting failure the
 * paragraph above exists to prevent.
 *
 * So: the connection set is resolved ONCE, case-insensitively and by either
 * axis, and every child table is scoped by that set's ids (plus a string
 * catch-all for rows whose connection has since been deleted). `connections`
 * is updated LAST, so the subqueries still see the pre-migration identity.
 *
 * TABLES
 *
 * `connections`, `identifier_mappings`, `integration_credentials`,
 * `invoice_records`, `fiscal_registration_records` - every table in the tree
 * carrying a `platformType` / `providerType` / `adapterKey` column.
 * `integration_credentials` has no `connectionId`; it is reached through
 * `connections.credentialsRef -> integration_credentials.ref`.
 *
 * `fiscal_registration_records` carries no Subiekt rows on any reachable
 * install (`Fiscalization` is deliberately absent from the Subiekt manifest
 * until the bridge endpoint is verified), so its UPDATE is expected to match
 * zero rows. It is included because the constant it mirrors
 * (`SUBIEKT_FISCAL_PROVIDER_TYPE`) moved with the others.
 *
 * WHAT DELIBERATELY DOES NOT MOVE
 *
 * Persisted keys that merely contain the word "subiekt" keep it. They name
 * stored state, not the platform:
 *
 *   connection_cursors.cursorKey  'subiekt.orders.dataWystawieniaCursor'
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
 * migrations directory. `scripts/check-migration-timestamps.mjs` catches two
 * migrations sharing a prefix WITHIN one tree, and catches a prefix that is
 * not ahead of `origin/main` - but two sibling branches each holding the same
 * free-looking number pass both checks until one of them merges. The first
 * attempt here used `1897000000000`, which a branch claimed between this file
 * being written and being reviewed.
 */
export class SplitSubiektGtIdentity1898000000000 implements MigrationInterface {
  name = 'SplitSubiektGtIdentity1898000000000';

  /**
   * The connections this migration is about, resolved by EITHER identity axis
   * and case-insensitively on the free-text one. Used as a subquery rather
   * than a temp table so each statement stands alone and re-running the
   * migration is a clean no-op (after `up()` nothing matches).
   */
  private static readonly SUBIEKT_CONNECTIONS = `
    SELECT "id" FROM "connections"
     WHERE "adapterKey" = 'subiekt.invoicing.v1'
        OR lower("platformType") = 'subiekt'`;

  private static readonly SUBIEKT_CONNECTIONS_REVERSE = `
    SELECT "id" FROM "connections"
     WHERE "adapterKey" = 'subiekt.gt.v1'
        OR lower("platformType") = 'subiekt-gt'`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const set = SplitSubiektGtIdentity1898000000000.SUBIEKT_CONNECTIONS;

    // Collision guard, FIRST and before any write.
    //
    // Projects the rows that WILL carry `subiekt-gt` after this migration -
    // the ones about to change, plus any that already carry it - and refuses
    // if two of them would share the unique index's key. That covers both
    // directions at once: a clash against a pre-existing `subiekt-gt` row, and
    // a clash between two rows in the changing set itself (a connection whose
    // mappings carry both `subiekt` and `Subiekt` for one external id).
    //
    // A raw unique violation here would abort mid-way with a driver error
    // naming an index rather than the problem. Fail loudly and explain.
    await queryRunner.query(`
      DO $$
      DECLARE collisions integer;
      BEGIN
        SELECT COUNT(*) INTO collisions FROM (
          SELECT "entityType", "connectionId", "externalId"
            FROM "identifier_mappings"
           WHERE "connectionId" IN (${set})
              OR lower("platformType") IN ('subiekt', 'subiekt-gt')
           GROUP BY 1, 2, 3
          HAVING COUNT(*) > 1
        ) dup;
        IF collisions > 0 THEN
          RAISE EXCEPTION
            'Subiekt GT identity split aborted: % identifier_mappings key(s) would collide on (entityType, platformType, connectionId, externalId) once every Subiekt row carries ''subiekt-gt''. Nothing was changed. Inspect with: SELECT "entityType", "connectionId", "externalId", "platformType", COUNT(*) FROM identifier_mappings WHERE lower("platformType") IN (''subiekt'', ''subiekt-gt'') GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;',
            collisions;
        END IF;
      END$$;
    `);

    // 1. identifier_mappings. The one that matters - anchored on the FK, with
    //    a string catch-all for rows whose connection has been deleted.
    await queryRunner.query(
      `UPDATE "identifier_mappings"
         SET "platformType" = 'subiekt-gt'
         WHERE "connectionId" IN (${set})
            OR lower("platformType") = 'subiekt'`
    );

    // 2. integration_credentials. No `connectionId` column; reached through
    //    `connections.credentialsRef`. The string arm additionally catches a
    //    credential row left behind by a deleted connection.
    await queryRunner.query(
      `UPDATE "integration_credentials"
         SET "platformType" = 'subiekt-gt'
         WHERE lower("platformType") = 'subiekt'
            OR "ref" IN (
                 SELECT "credentialsRef" FROM "connections"
                  WHERE ("adapterKey" = 'subiekt.invoicing.v1'
                         OR lower("platformType") = 'subiekt')
                    AND "credentialsRef" IS NOT NULL
                    AND "credentialsRef" <> ''
               )`
    );

    // 3. invoice_records. These documents really were issued by the GT adapter
    //    (no nexo adapter has ever existed), so the new label is more truthful
    //    than the old one rather than a rewrite of history. The column is read
    //    as a display label, never as a join key.
    await queryRunner.query(
      `UPDATE "invoice_records"
         SET "providerType" = 'subiekt-gt'
         WHERE lower("providerType") = 'subiekt'`
    );

    // 4. fiscal_registration_records. Expected to match zero rows - see header.
    await queryRunner.query(
      `UPDATE "fiscal_registration_records"
         SET "providerType" = 'subiekt-gt'
         WHERE lower("providerType") = 'subiekt'`
    );

    // 5. connections LAST, so every subquery above saw the pre-migration
    //    identity. `adapterKey` is set only where it is the one being retired,
    //    so a connection carrying some other explicit key keeps it.
    await queryRunner.query(
      `UPDATE "connections"
         SET "platformType" = 'subiekt-gt',
             "adapterKey" = CASE
                              WHEN "adapterKey" = 'subiekt.invoicing.v1' THEN 'subiekt.gt.v1'
                              WHEN "adapterKey" IS NULL THEN 'subiekt.gt.v1'
                              ELSE "adapterKey"
                            END
         WHERE "adapterKey" = 'subiekt.invoicing.v1'
            OR lower("platformType") = 'subiekt'`
    );

    // Verification. This RAISES rather than warns, deliberately.
    //
    // The first draft used RAISE WARNING here and called it "visibility". It
    // was decoration: `data-source.ts` sets `logging` from NODE_ENV and never
    // sets `logNotifications`, and TypeORM attaches a `notice` listener only
    // when that option is on - so in the environment this ships to (compose
    // runs `migrate` with NODE_ENV=production) the message went nowhere at
    // all. A leftover mapping row is not a cosmetic blemish, it is the
    // id-minting failure this whole migration exists to prevent, so the
    // honest response is to fail the deploy and roll back.
    await queryRunner.query(`
      DO $$
      DECLARE
        left_connections  integer;
        left_credentials  integer;
        left_mappings     integer;
        left_invoices     integer;
        left_fiscal       integer;
      BEGIN
        SELECT COUNT(*) INTO left_connections FROM "connections"                 WHERE lower("platformType") = 'subiekt' OR "adapterKey" = 'subiekt.invoicing.v1';
        SELECT COUNT(*) INTO left_credentials FROM "integration_credentials"     WHERE lower("platformType") = 'subiekt';
        SELECT COUNT(*) INTO left_mappings    FROM "identifier_mappings"         WHERE lower("platformType") = 'subiekt';
        SELECT COUNT(*) INTO left_invoices    FROM "invoice_records"             WHERE lower("providerType") = 'subiekt';
        SELECT COUNT(*) INTO left_fiscal      FROM "fiscal_registration_records" WHERE lower("providerType") = 'subiekt';

        IF left_connections + left_credentials + left_mappings + left_invoices + left_fiscal > 0 THEN
          RAISE EXCEPTION
            'Subiekt GT identity split left rows on the legacy identity and has been rolled back: connections=%, integration_credentials=%, identifier_mappings=%, invoice_records=%, fiscal_registration_records=%. A leftover identifier_mappings row means every lookup for that connection would MISS and fresh internal ids would be minted on every sync.',
            left_connections, left_credentials, left_mappings, left_invoices, left_fiscal;
        END IF;
      END$$;
    `);

    // A mapping must never disagree with its own connection - that disagreement
    // IS the failure mode, so it is asserted rather than assumed.
    await queryRunner.query(`
      DO $$
      DECLARE mismatched integer;
      BEGIN
        SELECT COUNT(*) INTO mismatched
          FROM "identifier_mappings" m
          JOIN "connections" c ON c."id" = m."connectionId"
         WHERE c."platformType" = 'subiekt-gt'
           AND m."platformType" <> 'subiekt-gt';
        IF mismatched > 0 THEN
          RAISE EXCEPTION
            'Subiekt GT identity split rolled back: % identifier_mappings row(s) disagree with their own connection''s platformType. Lookups would miss and fresh internal ids would be minted.',
            mismatched;
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const set = SplitSubiektGtIdentity1898000000000.SUBIEKT_CONNECTIONS_REVERSE;

    await queryRunner.query(`
      DO $$
      DECLARE collisions integer;
      BEGIN
        SELECT COUNT(*) INTO collisions FROM (
          SELECT "entityType", "connectionId", "externalId"
            FROM "identifier_mappings"
           WHERE lower("platformType") IN ('subiekt', 'subiekt-gt')
           GROUP BY 1, 2, 3
          HAVING COUNT(*) > 1
        ) dup;
        IF collisions > 0 THEN
          RAISE EXCEPTION
            'Subiekt GT identity split rollback aborted: % identifier_mappings key(s) would collide when renaming subiekt-gt -> subiekt. Nothing was changed.',
            collisions;
        END IF;
      END$$;
    `);

    await queryRunner.query(
      `UPDATE "identifier_mappings"
         SET "platformType" = 'subiekt'
         WHERE "connectionId" IN (${set})
            OR "platformType" = 'subiekt-gt'`
    );

    await queryRunner.query(
      `UPDATE "integration_credentials"
         SET "platformType" = 'subiekt'
         WHERE "platformType" = 'subiekt-gt'
            OR "ref" IN (
                 SELECT "credentialsRef" FROM "connections"
                  WHERE ("adapterKey" = 'subiekt.gt.v1'
                         OR lower("platformType") = 'subiekt-gt')
                    AND "credentialsRef" IS NOT NULL
                    AND "credentialsRef" <> ''
               )`
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

    // `adapterKey` is reverted only where it is the one `up()` wrote, so a
    // connection carrying a different explicit key keeps it.
    //
    // KNOWN LOSS, stated rather than hidden: `up()` also stamped
    // `subiekt.gt.v1` onto a connection that originally had NO explicit
    // adapterKey, and nothing records which those were - so the round trip
    // returns them carrying `subiekt.invoicing.v1` instead of NULL.
    // `ConnectionService.update` treats `adapterKey` as immutable after
    // creation, so that is not repairable in-product. Both values resolve the
    // same adapter, so behaviour is unaffected; the row is simply more
    // explicit than it started.
    await queryRunner.query(
      `UPDATE "connections"
         SET "platformType" = 'subiekt',
             "adapterKey" = CASE
                              WHEN "adapterKey" = 'subiekt.gt.v1' THEN 'subiekt.invoicing.v1'
                              ELSE "adapterKey"
                            END
         WHERE "adapterKey" = 'subiekt.gt.v1'
            OR lower("platformType") = 'subiekt-gt'`
    );
  }
}
