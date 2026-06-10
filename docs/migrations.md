# Database Migrations Guide

This document describes the database migration workflow for OpenLinker, including how to generate, review, commit, and run migrations.

## Table of Contents

1. [Overview](#overview)
2. [Migration Workflow](#migration-workflow)
3. [Generating Migrations](#generating-migrations)
4. [Running Migrations](#running-migrations)
5. [CI/CD Integration](#cicd-integration)
6. [Troubleshooting](#troubleshooting)

---

## Overview

### Architecture

- **Migrations Location**:
  - Core: `apps/api/src/migrations/`
  - Plugin-owned (#599): `libs/integrations/<platform>/src/migrations/` — each plugin ships its own DDL alongside its ORM entities. Aggregated by `apps/api/src/plugin-migrations.ts` (the TypeORM CLI seam) + mirrored at `scripts/plugin-migration-dirs.json` (the lint manifest). Today the only plugin shipping migrations is Allegro (`allegro_quantity_commands`).
- **DataSource File**: `apps/api/src/database/data-source.ts` — unions core + plugin migration globs at boot.
- **Database Ownership**: `apps/api` owns the *core* schema; **plugins own theirs** (#599). ORM entities can live in `libs/core/` (canonical entities — products, orders, …) or in `libs/integrations/<platform>/` (plugin-private — e.g. `AllegroQuantityCommandOrmEntity`). A plugin's migrations live alongside its entities in the plugin package, NOT in `apps/api/src/migrations/`.
- **Migration Execution**: 
  - **Dev/CI**: Run via TypeScript (ts-node) for fast iteration
  - **Production**: Run via compiled JavaScript for robustness

### Key Principles

1. **Migrations are code**: All migrations are committed to git and reviewed in PRs
2. **`synchronize: false`**: Migrations are the source of truth in all environments
3. **Separate DataSource**: TypeORM CLI requires a standalone `DataSource` file (not NestJS module)
4. **CI/CD runs migrations**: Migrations run explicitly before application startup
5. **Timestamps are unique and strictly match the class**: Every migration in `apps/api/src/migrations/` has a unique 13-digit timestamp prefix, and the class declared in the file repeats that same timestamp suffix. Enforced by `scripts/check-migration-timestamps.mjs`, wired into `pnpm lint`. See [Migration Naming Convention](#migration-naming-convention) and [Recovery: duplicate migration timestamp](#5-duplicate-migration-timestamp).

---

## Migration Workflow

### Standard Workflow

1. **Make schema changes** to ORM entities in `libs/core/src/**/*.orm-entity.ts`
2. **Generate migration** using TypeORM CLI
3. **Review migration file** in `apps/api/src/migrations/`
4. **Test migration** locally (up and down)
5. **Commit migration** to git
6. **CI/CD runs migration** automatically on deployment

### Migration Naming Convention

Migrations are automatically named with timestamp prefix:
- Format: `{timestamp}-{description}.ts`
- Example: `1735000000000-add-connections-and-update-mappings.ts`

#### Timestamp uniqueness invariant

Every migration filename begins with exactly **13 digits** (the `Date.now()` millisecond shape TypeORM generates). Two rules are non-negotiable:

1. **Unique**: no two files across `apps/api/src/migrations/` AND every plugin migration directory listed in `scripts/plugin-migration-dirs.json` (#599) share a 13-digit prefix. TypeORM 0.3.17 sorts migrations by timestamp alone with no deterministic tie-breaker — a collision can leave one `up()` body silently unapplied while both class names still appear in the `migrations` table (see [#374](https://github.com/openlinker-project/openlinker/issues/374)). Uniqueness is enforced across the *union*, so Allegro + a hypothetical Shopify plugin can't both pick the same prefix.
2. **Consistent**: the class declared in the file repeats the same timestamp suffix as the filename prefix. This catches half-renames where one side is updated but not the other.

Both rules are enforced by `scripts/check-migration-timestamps.mjs`, chained into the root `check:invariants` command and therefore into every `pnpm lint` run (including pre-commit). A collision fails `pnpm lint` immediately.

If `migration:generate` produces a timestamp that happens to be already taken (rare, but possible in branch-merge windows), bump the new file's prefix to the next free millisecond and update the class suffix to match before committing.

---

## Plugin-Owned Migrations (#599)

A plugin shipping its own ORM entities (e.g. Allegro's `AllegroQuantityCommandOrmEntity`) owns its migrations too. The migration files live alongside the plugin's source — not in `apps/api/src/migrations/`.

**Recipe — adding migrations to a new plugin:**

1. **Create the migration file** under `libs/integrations/<platform>/src/migrations/`:
   ```
   libs/integrations/foo/src/migrations/1800000000000-add-foo-table.ts
   ```
   Use the same `MigrationInterface` shape as core migrations. Class name + filename timestamp must match the standard 13-digit-prefix invariant (see [Timestamp uniqueness invariant](#timestamp-uniqueness-invariant)).

2. **Declare it on the plugin descriptor** (informational — see `@openlinker/plugin-sdk` `AdapterPlugin.migrations`):
   ```typescript
   // libs/integrations/foo/src/foo-plugin.ts
   import { resolve } from 'node:path';
   export function createFooPlugin(deps): AdapterPlugin {
     return {
       manifest: { /* ... */ },
       migrations: [resolve(__dirname, 'migrations/**/*{.ts,.js}')],
       // ...
     };
   }
   ```

3. **Enable it in the host** — two parallel edits (both required):
   - Add the plugin directory to `apps/api/src/plugin-migrations.ts` (`PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT`):
     ```typescript
     const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [
       'libs/integrations/allegro/src/migrations',
       'libs/integrations/foo/src/migrations',
     ];
     ```
   - Add the same directory to `scripts/plugin-migration-dirs.json`:
     ```json
     { "directories": [
       "libs/integrations/allegro/src/migrations",
       "libs/integrations/foo/src/migrations"
     ] }
     ```

   The two lists are checked for equality by `scripts/check-migration-timestamps.mjs` — drift fails `pnpm lint`.

4. **Generate a fresh timestamp** (manual — `migration:generate` against the aggregated data-source emits into `apps/api/src/migrations/` by default; either run it from there and move the file, or hand-author the migration). Verify with `pnpm --filter @openlinker/api migration:show` that TypeORM lists your new migration alongside core.

**Why two files at the host layer:**
- `apps/api/src/plugin-migrations.ts` is consumed by the TypeORM CLI data-source at boot. TypeScript file; resolves paths against `__dirname`.
- `scripts/plugin-migration-dirs.json` is the lint-time mirror — the invariant script reads JSON because it's a plain `.mjs` script with no ts-node loader.
- Both lists must agree. The invariant script cross-checks them and fails `pnpm lint` if they drift. Mirrors the `apps/api/src/plugins.ts` pattern (single edit point for enabling a plugin's runtime registration; this is the analogous edit point for enabling its schema).

**Pre-existing migration moves:** when relocating an existing plugin-specific migration out of `apps/api/src/migrations/` into a plugin package (as the Allegro `1767900000000-add-allegro-quantity-commands-table.ts` was during #599), **keep the class name + 13-digit timestamp identical**. TypeORM tracks executed migrations by class name; moving the file is a no-op for the `migrations` table. Existing prod DBs see no change.

---

## Generating Migrations

### Prerequisites

1. Ensure database is running and accessible
2. Ensure environment variables are set (`.env` or `.env.local`, or set as system environment variables)
3. Ensure current database schema matches the last committed migration
4. **Optional**: Install `dotenv` package for automatic `.env` file loading:
   ```bash
   pnpm add -D dotenv
   ```
   Note: If `dotenv` is not installed, environment variables must be set as system environment variables.

### Generate Migration Command

**Development (TypeScript):**

```bash
# From project root
pnpm --filter @openlinker/api migration:generate -- src/migrations/YourMigrationName
```

**Alternative - Using TypeORM CLI directly:**

```bash
# From apps/api directory
NODE_OPTIONS='-r ts-node/register -r tsconfig-paths/register' \
  bash node_modules/.bin/typeorm migration:generate \
  -d src/database/data-source.ts \
  src/migrations/YourMigrationName
```

### What Happens

1. TypeORM compares current ORM entities with database schema
2. Generates migration file with `up()` and `down()` methods
3. Saves migration to `apps/api/src/migrations/{timestamp}-YourMigrationName.ts`

### Manual Migration Creation

For complex migrations (data migrations, complex transformations), you can create migrations manually:

```typescript
// apps/api/src/migrations/1735000000000-your-migration.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class YourMigration1735000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Migration logic
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback logic
  }
}
```

**Important**: Always implement both `up()` and `down()` methods for reversibility.

---

## Running Migrations

### Development (TypeScript)

**Run pending migrations:**

```bash
# From project root
pnpm --filter @openlinker/api migration:run
```

**Revert last migration:**

```bash
pnpm --filter @openlinker/api migration:revert
```

**Show migration status:**

```bash
pnpm --filter @openlinker/api migration:show
```

### Production (Compiled JavaScript)

**Prerequisites:**
1. Build the application: `pnpm build`
2. Ensure compiled migrations exist in `apps/api/dist/apps/api/src/migrations/`

**Run migrations:**

```bash
# From project root (after build)
node -r tsconfig-paths/register apps/api/dist/apps/api/src/database/data-source.js migration:run
```

Or using TypeORM CLI with compiled DataSource:

```bash
# From project root (after build)
node node_modules/.bin/typeorm migration:run \
  -d apps/api/dist/apps/api/src/database/data-source.js
```

### Migration Execution Order

Migrations run in chronological order based on timestamp prefix. TypeORM tracks executed migrations in the `migrations` table.

---

## CI/CD Integration

### Recommended Pattern

**"Migrate then start"** - Run migrations before application startup:

```yaml
# Example GitHub Actions / CI workflow
- name: Build application
  run: pnpm build

- name: Run database migrations
  run: |
    node -r tsconfig-paths/register \
      apps/api/dist/apps/api/src/database/data-source.js \
      migration:run
  env:
    DB_HOST: ${{ secrets.DB_HOST }}
    DB_PORT: ${{ secrets.DB_PORT }}
    DB_USERNAME: ${{ secrets.DB_USERNAME }}
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
    DB_DATABASE: ${{ secrets.DB_DATABASE }}

- name: Start application
  run: pnpm start:prod:api
```

### Migration Safety in CI/CD

1. **Always test migrations locally first**
2. **Run migrations in a transaction** (TypeORM does this by default)
3. **Monitor migration execution** in CI/CD logs
4. **Have rollback plan** ready for production

---

## Troubleshooting

### Common Issues

#### 1. "Cannot find module" errors

**Problem**: TypeORM CLI can't resolve path aliases (`@openlinker/core/*`)

**Solution**: Use `tsconfig-paths/register` or ensure paths are resolved correctly:

```bash
node -r tsconfig-paths/register -r ts-node/register \
  node_modules/.bin/typeorm migration:run \
  -d apps/api/src/database/data-source.ts
```

#### 2. "Migration already executed" error

**Problem**: Migration timestamp conflicts or database state mismatch

**Solution**: 
- Check `migrations` table in database
- Verify migration file timestamps are unique
- If needed, manually fix `migrations` table

#### 3. Entity discovery fails

**Problem**: TypeORM can't find ORM entities

**Solution**: 
- Verify entity paths in `data-source.ts`
- Ensure entities are in `libs/core/src/**/*.orm-entity.ts`
- Check file extensions match pattern `{.ts,.js}`

#### 4. Migration fails in production

**Problem**: Compiled paths don't match source paths

**Solution**:
- Verify `data-source.ts` uses `__dirname` (not hardcoded paths)
- Check compiled output structure matches expectations
- Test migration execution in staging environment first

#### 5. Duplicate migration timestamp

**Problem**: Two migrations share the same 13-digit timestamp prefix. TypeORM's execution order between them is undefined, so on some environments both class rows appear in the `migrations` table but one `up()` body never ran. Symptoms typically surface as `QueryFailedError: column "X" does not exist` on reads that depend on the lost DDL.

**Prevention**: `pnpm lint` runs `scripts/check-migration-timestamps.mjs` on every invocation (via `check:invariants`) and fails the build on any collision or on filename-vs-class drift. If this guard is green, a collision cannot reach `main`. See [Timestamp uniqueness invariant](#timestamp-uniqueness-invariant).

**Recovery (for environments already affected by the #374 collision)**:

The `AddCurrencyToProducts1790000000002` migration self-heals — on any environment that applied the pre-rename `AddCurrencyToProducts1790000000000`, running `pnpm --filter @openlinker/api migration:run` is sufficient: it removes the orphaned `migrations` row and creates the `products.currency` column idempotently. The same is true of `RenameMarketplaceCapability1788000000001` for the second collision pair.

If the automated path cannot run (e.g. the API is down and you need a quick unblock), either of these manual recipes restores the affected DB by hand:

```sql
-- Option 1 (minimal): apply the missing DDL directly.
ALTER TABLE "products" ADD "currency" character varying(3);
```

```sql
-- Option 2 (cleaner): delete both orphan migrations rows, then let
-- `migration:run` apply the renamed migrations normally. Delete whichever
-- row(s) the affected DB actually has — both are safe no-ops if absent.
DELETE FROM migrations WHERE name = 'AddCurrencyToProducts1790000000000';
DELETE FROM migrations WHERE name = 'RenameMarketplaceCapability1788000000000';
```

### Debugging Tips

1. **Enable logging**: Set `NODE_ENV=development` to see SQL queries
2. **Check migration table**: Query `SELECT * FROM migrations;` to see executed migrations
3. **Test rollback**: Always test `migration:revert` before committing
4. **Review generated SQL**: Check migration file `up()` method for correctness

---

## Best Practices

1. **Always review generated migrations** before committing
2. **Test migrations locally** (up and down) before pushing
3. **Keep migrations small and focused** - one logical change per migration
4. **Never edit executed migrations** - create new migrations for fixes
5. **Document complex migrations** with inline comments
6. **Use transactions** for data migrations (TypeORM does this by default)
7. **Backup database** before running migrations in production

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md) - System architecture
- [Engineering Standards](./engineering-standards.md) - Coding standards
- [TypeORM Migrations Documentation](https://typeorm.io/migrations)

