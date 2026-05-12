/**
 * API Plugin Migrations (#599)
 *
 * The single edit point an OSS contributor touches to enable a plugin's
 * tables. Read by the TypeORM CLI data-source at
 * `apps/api/src/database/data-source.ts` AND mirrored at
 * `scripts/plugin-migration-dirs.json` (the lint-time invariant manifest).
 *
 * **If a plugin in `apps/api/src/plugins.ts` ships migrations:**
 *   1. Add its directory glob entry below.
 *   2. Add the same directory (without glob suffix) to
 *      `scripts/plugin-migration-dirs.json`.
 *
 * The two lists are checked for equality by the invariant script — drift
 * fails `pnpm lint`. Mirrors the `apps/api/src/plugins.ts` pattern from
 * #604/#605.
 *
 * Glob shape: `<absolute-dir>/**\/*{.ts,.js}` so the same declaration
 * serves dev (`.ts` from source) and prod (`.js` from compiled output) —
 * same convention as the core entity glob in
 * `apps/api/src/database/data-source.ts`.
 *
 * @module apps/api/src
 */
import { join, resolve } from 'node:path';

/**
 * Repo-root-relative directories, matched against
 * `scripts/plugin-migration-dirs.json` at lint time.
 *
 * Keep alphabetical for diff stability.
 */
const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [
  'libs/integrations/allegro/src/migrations',
];

/**
 * Resolve relative dirs against repo root. Anchored on `__dirname` —
 * this file lives at `apps/api/src/plugin-migrations.ts`, so
 * `../../..` = repo root in dev (ts-node CLI context). Matches the
 * existing core entity glob convention in
 * `apps/api/src/database/data-source.ts` which uses the same anchor.
 *
 * In compiled output (`apps/api/dist/apps/api/src/plugin-migrations.js`)
 * the same expression resolves to a different absolute path; production
 * deployments must ship source-tree-alongside-dist for either glob to
 * work — pre-existing characteristic, not introduced by #599.
 */
const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Plugin migration globs the TypeORM CLI expands.
 */
export const apiPluginMigrations: string[] = PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT.map(
  (relDir) => join(resolve(REPO_ROOT, relDir), '**', '*{.ts,.js}'),
);

/**
 * Exported so the lint-time invariant script can cross-check that
 * `scripts/plugin-migration-dirs.json` carries the same set.
 * Not part of the public API; consumers should use `apiPluginMigrations`.
 */
export const _pluginMigrationDirsForLintCheck: readonly string[] =
  PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT;
