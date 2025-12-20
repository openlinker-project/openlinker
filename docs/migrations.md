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

- **Migrations Location**: `apps/api/src/migrations/`
- **DataSource File**: `apps/api/src/database/data-source.ts`
- **Database Ownership**: `apps/api` owns the database schema, even though ORM entities live in `libs/core`
- **Migration Execution**: 
  - **Dev/CI**: Run via TypeScript (ts-node) for fast iteration
  - **Production**: Run via compiled JavaScript for robustness

### Key Principles

1. **Migrations are code**: All migrations are committed to git and reviewed in PRs
2. **`synchronize: false`**: Migrations are the source of truth in all environments
3. **Separate DataSource**: TypeORM CLI requires a standalone `DataSource` file (not NestJS module)
4. **CI/CD runs migrations**: Migrations run explicitly before application startup

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

