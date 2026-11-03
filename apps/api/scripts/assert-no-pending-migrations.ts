/**
 * Assert-no-pending-migrations (#3618)
 *
 * `typeorm migration:show` always `process.exit(0)`s — `MigrationShowCommand`
 * discards `DataSource.showMigrations()`'s boolean return value and never
 * inspects it, so the CLI command's exit code cannot be used to gate CI on
 * "0 pending migrations" (it prints a `[ ] SomeMigration` line for a pending
 * one, but always exits 0 regardless). This script calls the same method
 * directly and turns its answer into the exit code the CI restore-verification
 * job (`.github/workflows/backup-restore.yml`, #3618) actually needs.
 *
 * Usage: run against a database via the standard DB_HOST/DB_PORT/DB_USERNAME/
 * DB_PASSWORD/DB_DATABASE env vars, exactly like `migration:run`/`migration:show`.
 */
import dataSource from '../src/database/data-source';

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const hasPendingMigrations = await dataSource.showMigrations();
    if (hasPendingMigrations) {
      console.error('[assert-no-pending-migrations] pending migrations found.');
      process.exitCode = 1;
      return;
    }
    console.log('[assert-no-pending-migrations] 0 pending migrations.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('[assert-no-pending-migrations] failed:', error);
  process.exitCode = 1;
});
