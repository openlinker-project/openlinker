/**
 * Migration prerequisites bootstrap (#2684)
 *
 * The oldest migration in the tree (`1766246163229-add-connections-and-mappings..ts`)
 * uses `uuid_generate_v4()` without ever issuing `CREATE EXTENSION "uuid-ossp"`, so the
 * chain cannot run against a genuinely empty Postgres — nothing noticed for years
 * because every real deployment's database already carried the extension from some
 * earlier, out-of-band bootstrap, and the integration harness builds schema via
 * `synchronize`, never by running the chain.
 *
 * Two of the usual fixes are unavailable. Editing `1766246163229` in place is out:
 * TypeORM tracks applied migrations by class name, so an edited body never re-runs on
 * a database that already applied it — the fix would reach nobody who has deployed.
 * Inserting a new migration with an earlier timestamp is also out:
 * `scripts/check-migration-timestamps.mjs` refuses any new file that sorts at or below
 * `origin/main`'s current maximum, and the first migration IS that maximum's floor.
 * A migration appended at the normal tail cannot help either — the chain runs in
 * timestamp order, so `1766246163229` fails and aborts the run long before a
 * tail-appended migration is ever reached.
 *
 * So the fix lives outside the migration chain entirely: it runs once, before
 * `runMigrations()` is invoked, every time. It is idempotent (`IF NOT EXISTS`) and
 * therefore has NO limitation on an already-provisioned database — unlike a
 * migration-based fix, this runs on every future `migration:run` invocation
 * regardless of how far along the chain that database already is.
 *
 * @module apps/api/src/database
 * @see {@link file://./data-source.ts} for the CLI entry point that wires this in
 */

import type { DataSource } from 'typeorm';

export async function ensureMigrationPrerequisites(dataSource: DataSource): Promise<void> {
  await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
}
