import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Split the two Subiekt product lines apart, and give the EXISTING one its
 * true name.
 *
 * Subiekt GT and Subiekt nexo are two different InsERT products, reached
 * through two different bridges with different wire contracts. They shipped
 * under one identity - `platformType: 'subiekt'`, `adapterKey:
 * 'subiekt.invoicing.v1'` - so an operator's connection list could not tell
 * them apart, and the only thing distinguishing them was a free-text name.
 *
 * WHICH ONE IS THE LEGACY IDENTITY, AND WHY IT MATTERS
 *
 * On `main`, `subiekt` is **Subiekt nexo**: `supportedCapabilities:
 * ['Invoicing']`, `displayName: 'Subiekt nexo (Sfera bridge)'`. The Subiekt GT
 * work extended that same adapter in place - five capabilities, a different
 * bridge - without renaming it, so on the GT branch `subiekt` came to mean GT
 * while on `main` it still meant nexo.
 *
 * The GT work is NOT released (`origin/main` carries none of it), so every
 * `subiekt` connection in every real installation is a **nexo** connection.
 * This migration therefore renames it to `subiekt-nexo`:
 *
 *   platformType  'subiekt'               -> 'subiekt-nexo'
 *   adapterKey    'subiekt.invoicing.v1'  -> 'subiekt.nexo.v1'
 *   providerType  'subiekt'               -> 'subiekt-nexo'
 *
 * An earlier draft renamed it to `subiekt-gt` instead. That was correct for the
 * GT development branch, where `subiekt` did mean GT, and WRONG for everywhere
 * else: it would have relabelled real nexo installations as GT, leaving them
 * pointed at an adapter that speaks a different bridge's contract. Subiekt GT
 * connections are created fresh against `subiekt-gt` and need no migration,
 * because outside this branch none exist.
 *
 * WHY THE CHILD TABLES ARE ANCHORED ON `connectionId`, NOT ON THE STRING
 *
 * A mapping row copies its connection's `platformType` VERBATIM at write time
 * (`IdentifierMappingService`), and `platformType` is free text on the way in:
 * `CreateConnectionDto` validates it with `@IsString() @IsNotEmpty()` and
 * nothing else. So the connection and its mappings are bound by the FOREIGN
 * KEY, not by the spelling, and a migration that selects the two halves with
 * two different string predicates can move one without the other.
 *
 * That is not hypothetical. `libs/integrations/subiekt/docs/setup-guide.md`
 * instructs advanced-mode setup with `Platform type = Subiekt` - capital S -
 * alongside the adapter key, while `docs/tutorial.md` says lowercase. Such a
 * connection matches on `adapterKey` and not on `platformType = 'subiekt'`, and
 * a string-matched migration would rename the connection and leave every one of
 * its mappings behind.
 *
 * That matters because `IdentifierMappingService.getInternalId` reads the
 * connection, takes `platformType` from it, and filters `identifier_mappings`
 * on that value, with a unique index over
 * `(entityType, platformType, connectionId, externalId)`. A connection saying
 * `subiekt-nexo` while its mappings still said `subiekt` would make every
 * lookup MISS and mint fresh internal ids for every product, order and
 * customer - silently, with each sync appearing to succeed and no unique
 * violation to stop it, because the index contains the very column that
 * differs.
 *
 * So the connection set is resolved ONCE, case-insensitively and by either
 * axis; every child table is scoped by that set's ids plus a string catch-all
 * for rows whose connection has since been deleted; and `connections` is
 * updated LAST so the subqueries still see the pre-migration identity.
 *
 * TABLES
 *
 * `connections`, `identifier_mappings`, `integration_credentials`,
 * `invoice_records`, `fiscal_registration_records` - every table in the tree
 * carrying a `platformType` / `providerType` / `adapterKey` column.
 * `integration_credentials` has no `connectionId`; it is reached through
 * `connections.credentialsRef`, which stores `db:{uuid}` while
 * `integration_credentials.ref` holds the bare uuid - hence the `'db:' ||`.
 * Joining the two columns directly never matches.
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
 *   Connection config field names ('subiektBridgeUrl', ...) - form fields.
 *
 * Do not "finish the rename" by touching those later.
 *
 * WHAT THE GUARD ACTUALLY CHECKS, since a header like this is the most likely
 * thing a future author reads before picking a number.
 * `check-migration-timestamps.mjs` enforces a 13-digit prefix, a class suffix
 * matching it, prefix uniqueness WITHIN ONE TREE, and ordering against
 * `origin/main`. It knows nothing about an unmerged sibling branch, so two
 * branches can each hold the same free-looking number and both pass their own
 * lint. The hazard of that is UNDEFINED ORDERING between the two plus a hard
 * lint failure when the second one merges - NOT a silent skip. TypeORM decides
 * what is pending by CLASS NAME, so a duplicate timestamp runs both; it is a
 * RENAME that re-runs a migration.
 *
 * RENUMBERED `1898000000000` -> `1902000000000`, and the reason is the hazard
 * that paragraph above names rather than a collision. `1898` was picked while
 * it sat in a genuine gap between two UNMERGED siblings (`1897` and `1899` of
 * the pack-bench stack); that stack has since landed, so `main`'s tail moved to
 * `1899` and this file fell BELOW it, breaking rule 3 of
 * `docs/migrations.md` section Timestamp uniqueness invariant. Slotting into a
 * gap is safe only until the branches around it merge, which is a different and
 * quieter hazard than a sibling claiming the same number.
 *
 * The rename costs nothing here, and NOT because the migration never ran - it
 * has, on the demo stand. It is because every statement in `up()` converges: the
 * collision guard is a read, and each UPDATE is scoped by a WHERE that selects
 * nothing once the rows already carry `subiekt-nexo`. So TypeORM treating
 * `SplitSubiektProductLines1902000000000` as a new migration re-runs a clean
 * no-op rather than the `42701 column already exists` that forced
 * `add-invoice-unlinked-catalogue-lines` to write a self-healing DELETE. A stand that applied the
 * `1898` name keeps that row in `migrations` as a harmless orphan; nothing
 * reads it, and deleting it would be a write with no defect to fix.
 *
 * `add-invoice-unlinked-catalogue-lines` is unaffected - it has since moved to
 * `1903000000000`, above this one, and the two are order-independent anyway:
 * this one rewrites
 * `identifier_mappings` / `connections` / `integration_credentials`, that one
 * adds a column to `invoice_records`.
 */
export class SplitSubiektProductLines1902000000000 implements MigrationInterface {
  name = 'SplitSubiektProductLines1902000000000';

  /**
   * The connections this migration is about, resolved by EITHER identity axis
   * and case-insensitively on the free-text one. A subquery rather than a temp
   * table so each statement stands alone and a re-run is a clean no-op.
   */
  private static readonly LEGACY_CONNECTIONS = `
    SELECT "id" FROM "connections"
     WHERE "adapterKey" = 'subiekt.invoicing.v1'
        OR lower("platformType") = 'subiekt'`;

  private static readonly NEXO_CONNECTIONS = `
    SELECT "id" FROM "connections"
     WHERE "adapterKey" = 'subiekt.nexo.v1'
        OR lower("platformType") = 'subiekt-nexo'`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const set = SplitSubiektProductLines1902000000000.LEGACY_CONNECTIONS;

    // Collision guard, FIRST and before any write. Projects the rows that WILL
    // carry `subiekt-nexo` and refuses if two of them would share the unique
    // index's key - covering both a clash against a pre-existing `subiekt-nexo`
    // row and a clash between two rows in the changing set (a connection whose
    // mappings carry both `subiekt` and `Subiekt`).
    await queryRunner.query(`
      DO $$
      DECLARE collisions integer;
      BEGIN
        SELECT COUNT(*) INTO collisions FROM (
          SELECT "entityType", "connectionId", "externalId"
            FROM "identifier_mappings"
           WHERE "connectionId" IN (${set})
              OR lower("platformType") IN ('subiekt', 'subiekt-nexo')
           GROUP BY 1, 2, 3
          HAVING COUNT(*) > 1
        ) dup;
        IF collisions > 0 THEN
          RAISE EXCEPTION
            'Subiekt product-line split aborted: % identifier_mappings key(s) would collide on (entityType, platformType, connectionId, externalId) once every legacy row carries ''subiekt-nexo''. Nothing was changed.',
            collisions;
        END IF;
      END$$;
    `);

    // 1. identifier_mappings - anchored on the FK, with a string catch-all for
    //    rows whose connection has been deleted.
    await queryRunner.query(
      `UPDATE "identifier_mappings"
         SET "platformType" = 'subiekt-nexo'
         WHERE "connectionId" IN (${set})
            OR lower("platformType") = 'subiekt'`
    );

    // 2. integration_credentials - no `connectionId`; reached through
    //    `connections.credentialsRef`, which carries a `db:` prefix the bare
    //    `ref` does not.
    await queryRunner.query(
      `UPDATE "integration_credentials"
         SET "platformType" = 'subiekt-nexo'
         WHERE lower("platformType") = 'subiekt'
            OR ('db:' || "ref") IN (
                 SELECT "credentialsRef" FROM "connections"
                  WHERE ("adapterKey" = 'subiekt.invoicing.v1'
                         OR lower("platformType") = 'subiekt')
                    AND "credentialsRef" <> ''
               )`
    );

    // 3. invoice_records. These documents were issued by the nexo adapter, so
    //    the new label is more truthful than the old one rather than a rewrite
    //    of history. Read as a display label, never as a join key.
    await queryRunner.query(
      `UPDATE "invoice_records"
         SET "providerType" = 'subiekt-nexo'
         WHERE lower("providerType") = 'subiekt'`
    );

    // 4. fiscal_registration_records. Expected to match zero rows -
    //    `Fiscalization` is absent from the manifest.
    await queryRunner.query(
      `UPDATE "fiscal_registration_records"
         SET "providerType" = 'subiekt-nexo'
         WHERE lower("providerType") = 'subiekt'`
    );

    // 5. connections LAST, so every subquery above saw the pre-migration
    //    identity. `adapterKey` moves only where it is the one being retired.
    await queryRunner.query(
      `UPDATE "connections"
         SET "platformType" = 'subiekt-nexo',
             "adapterKey" = CASE
                              WHEN "adapterKey" = 'subiekt.invoicing.v1' THEN 'subiekt.nexo.v1'
                              WHEN "adapterKey" IS NULL THEN 'subiekt.nexo.v1'
                              ELSE "adapterKey"
                            END
         WHERE "adapterKey" = 'subiekt.invoicing.v1'
            OR lower("platformType") = 'subiekt'`
    );

    // Verification. RAISES rather than warns, and anchors on the RELATION.
    //
    // It raises because `data-source.ts` sets `logging` from NODE_ENV and never
    // sets `logNotifications`, so TypeORM attaches no notice listener and a
    // RAISE WARNING here would go nowhere in the environment this ships to
    // (compose runs `migrate` with NODE_ENV=production).
    //
    // It anchors on the relation because a check that counts rows still
    // matching the predicate its own UPDATE just used is unsatisfiable by
    // construction and can fire on no input at all. What is worth asserting is
    // that no child row disagrees with its own connection - that disagreement
    // IS the failure mode.
    await queryRunner.query(`
      DO $$
      DECLARE
        stranded_mappings    integer;
        stranded_credentials integer;
      BEGIN
        SELECT COUNT(*) INTO stranded_mappings
          FROM "identifier_mappings" m
          JOIN "connections" c ON c."id" = m."connectionId"
         WHERE c."platformType" = 'subiekt-nexo'
           AND m."platformType" <> 'subiekt-nexo';

        SELECT COUNT(*) INTO stranded_credentials
          FROM "integration_credentials" ic
          JOIN "connections" c ON c."credentialsRef" = 'db:' || ic."ref"
         WHERE c."platformType" = 'subiekt-nexo'
           AND ic."platformType" <> 'subiekt-nexo';

        IF stranded_mappings + stranded_credentials > 0 THEN
          RAISE EXCEPTION
            'Subiekt product-line split rolled back: % identifier_mappings and % integration_credentials row(s) disagree with their own connection. A disagreeing mapping means every lookup for that connection MISSES and a fresh internal id is minted on every sync.',
            stranded_mappings, stranded_credentials;
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const set = SplitSubiektProductLines1902000000000.NEXO_CONNECTIONS;

    await queryRunner.query(`
      DO $$
      DECLARE collisions integer;
      BEGIN
        SELECT COUNT(*) INTO collisions FROM (
          SELECT "entityType", "connectionId", "externalId"
            FROM "identifier_mappings"
           WHERE lower("platformType") IN ('subiekt', 'subiekt-nexo')
           GROUP BY 1, 2, 3
          HAVING COUNT(*) > 1
        ) dup;
        IF collisions > 0 THEN
          RAISE EXCEPTION
            'Subiekt product-line split rollback aborted: % identifier_mappings key(s) would collide. Nothing was changed.',
            collisions;
        END IF;
      END$$;
    `);

    await queryRunner.query(
      `UPDATE "identifier_mappings"
         SET "platformType" = 'subiekt'
         WHERE "connectionId" IN (${set})
            OR "platformType" = 'subiekt-nexo'`
    );

    await queryRunner.query(
      `UPDATE "integration_credentials"
         SET "platformType" = 'subiekt'
         WHERE "platformType" = 'subiekt-nexo'
            OR ('db:' || "ref") IN (
                 SELECT "credentialsRef" FROM "connections"
                  WHERE ("adapterKey" = 'subiekt.nexo.v1'
                         OR lower("platformType") = 'subiekt-nexo')
                    AND "credentialsRef" <> ''
               )`
    );

    await queryRunner.query(
      `UPDATE "invoice_records"
         SET "providerType" = 'subiekt'
         WHERE "providerType" = 'subiekt-nexo'`
    );

    await queryRunner.query(
      `UPDATE "fiscal_registration_records"
         SET "providerType" = 'subiekt'
         WHERE "providerType" = 'subiekt-nexo'`
    );

    // KNOWN LOSSES, stated rather than hidden. There are two.
    //
    // (1) Case. A connection created as `Subiekt` (capital S - which
    // `setup-guide.md` instructs) comes back lowercase, because `up()`
    // normalised on the way out and nothing records the original spelling. Its
    // mappings and credential row normalise with it. Harmless: the round trip
    // lands MORE self-consistent than it started.
    //
    // (2) `adapterKey`: `up()` also stamped `subiekt.nexo.v1` onto a connection
    // that originally had NO explicit adapterKey, and nothing records which
    // those were - so they return carrying `subiekt.invoicing.v1` instead of
    // NULL. `ConnectionService.update` treats `adapterKey` as immutable after
    // creation, so that is not repairable in-product. Both values resolve the
    // same adapter, so behaviour is unaffected; the row is simply more explicit
    // than it started.
    await queryRunner.query(
      `UPDATE "connections"
         SET "platformType" = 'subiekt',
             "adapterKey" = CASE
                              WHEN "adapterKey" = 'subiekt.nexo.v1' THEN 'subiekt.invoicing.v1'
                              ELSE "adapterKey"
                            END
         WHERE "adapterKey" = 'subiekt.nexo.v1'
            OR lower("platformType") = 'subiekt-nexo'`
    );
  }
}
