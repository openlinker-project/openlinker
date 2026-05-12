#!/usr/bin/env node
/**
 * Migration Timestamp Invariant Guard (#374)
 *
 * Scans `apps/api/src/migrations/` and fails on any violation of the
 * three rules that together prevent the ordering bug where two migrations
 * share a timestamp — TypeORM 0.3.17 sorts by timestamp alone with no
 * deterministic tie-breaker, so a collision can leave one `up()` body
 * silently unapplied while both class names appear in the `migrations`
 * table.
 *
 * Enforced invariants:
 *   1. Every migration filename begins with exactly 13 digits followed by
 *      `-` (e.g. `1790000000002-add-currency-to-products.ts`). This is the
 *      `.now()` millisecond shape TypeORM generates.
 *   2. The class exported from the file declares the same 13-digit suffix
 *      as the filename prefix (catches half-renames that update one side
 *      but not the other).
 *   3. No two migration files share the same 13-digit prefix.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain, so a
 * collision fails pre-commit and CI runs before the broken migration can
 * ever reach a shared environment.
 *
 * Exits non-zero on violation, with one human-readable line per problem.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'apps/api/src/migrations');

// Plugin migration dirs (#599) — shared manifest also read by
// apps/api/src/plugin-migrations.ts. Drift fails `pnpm lint`.
const PLUGIN_MIGRATION_DIRS_MANIFEST = resolve(ROOT, 'scripts/plugin-migration-dirs.json');
const PLUGIN_MIGRATIONS_TS = resolve(ROOT, 'apps/api/src/plugin-migrations.ts');

const FILENAME_RE = /^(\d+)-(.+)\.ts$/;
const CANONICAL_TIMESTAMP_LEN = 13;
const CLASS_RE = /export\s+class\s+\w+?(\d+)\s+implements\s+MigrationInterface/;

/**
 * Pure validator. Takes an array of `{ filename, source }` entries and
 * returns `{ ok, violations }`. Kept free of I/O so the self-check at the
 * bottom of this file can drive it with inline fixtures.
 */
export function validateEntries(entries) {
  const violations = [];
  const byTimestamp = new Map();

  for (const { filename, source } of entries) {
    const match = FILENAME_RE.exec(filename);
    if (!match) {
      violations.push(`${filename}: filename does not match {timestamp}-{name}.ts`);
      continue;
    }

    const [, timestamp] = match;
    if (timestamp.length !== CANONICAL_TIMESTAMP_LEN) {
      violations.push(
        `${filename}: timestamp has ${timestamp.length} digits, expected ${CANONICAL_TIMESTAMP_LEN}`,
      );
      continue;
    }

    const classMatch = CLASS_RE.exec(source);
    if (!classMatch) {
      violations.push(
        `${filename}: could not find \`export class …${'${digits}'} implements MigrationInterface\``,
      );
    } else {
      const classTimestamp = classMatch[1];
      if (classTimestamp !== timestamp) {
        violations.push(
          `${filename}: filename timestamp ${timestamp} ≠ class timestamp ${classTimestamp}`,
        );
      }
    }

    const existing = byTimestamp.get(timestamp);
    if (existing) {
      violations.push(
        `${filename}: shares timestamp ${timestamp} with ${existing} (TypeORM ordering is undefined)`,
      );
    } else {
      byTimestamp.set(timestamp, filename);
    }
  }

  return { ok: violations.length === 0, violations };
}

function loadMigrationsFromDisk(dir) {
  const filenames = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
  return filenames.map((filename) => ({
    filename,
    source: readFileSync(resolve(dir, filename), 'utf8'),
  }));
}

/**
 * Load the plugin migration directory list from
 * `scripts/plugin-migration-dirs.json` (the lint-side manifest) and
 * cross-check it against the same list inlined inside
 * `apps/api/src/plugin-migrations.ts` (the TypeORM CLI seam). Drift
 * between the two fails lint immediately — this is the single
 * source-of-truth guard for #599.
 *
 * Returns the list of repo-root-relative directories on success.
 */
function loadPluginMigrationDirsWithDriftCheck() {
  const manifest = JSON.parse(readFileSync(PLUGIN_MIGRATION_DIRS_MANIFEST, 'utf8'));
  const manifestDirs = manifest.directories;

  // Cross-check: the TS seam at apps/api/src/plugin-migrations.ts must
  // carry the same directory list. We don't execute the TS — we just
  // pattern-match the inlined `PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT`
  // string-array literal. The check is intentionally strict: any
  // re-shaping that would break this regex MUST also update the
  // invariant script.
  const tsSource = readFileSync(PLUGIN_MIGRATIONS_TS, 'utf8');
  const arrayMatch = /PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT\s*=\s*\[([^\]]*)\]/.exec(tsSource);
  if (!arrayMatch) {
    throw new Error(
      'plugin-migrations: could not extract PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT from ' +
        `${PLUGIN_MIGRATIONS_TS}. If the constant was renamed or its shape changed, update ` +
        `scripts/check-migration-timestamps.mjs to match.`,
    );
  }
  const tsDirs = [...arrayMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const a = [...manifestDirs].sort();
  const b = [...tsDirs].sort();
  if (a.length !== b.length || a.some((d, i) => d !== b[i])) {
    throw new Error(
      `plugin-migrations: drift between ${PLUGIN_MIGRATION_DIRS_MANIFEST} and ` +
        `${PLUGIN_MIGRATIONS_TS}.\n` +
        `  manifest: ${JSON.stringify(a)}\n` +
        `  ts seam: ${JSON.stringify(b)}\n` +
        `Keep both lists in sync — see file headers.`,
    );
  }

  return manifestDirs;
}

function runAgainstTree() {
  // Core migrations (apps/api/src/migrations) + plugin-owned migrations
  // from every directory listed in the shared #599 manifest. The single
  // pass over the union catches cross-set timestamp collisions (Allegro
  // + a hypothetical Shopify picking the same prefix would fail here).
  const pluginDirs = loadPluginMigrationDirsWithDriftCheck();
  const allDirs = [MIGRATIONS_DIR, ...pluginDirs.map((d) => resolve(ROOT, d))];

  const entries = allDirs.flatMap((dir) => loadMigrationsFromDisk(dir));
  const { ok, violations } = validateEntries(entries);

  if (!ok) {
    for (const line of violations) {
      console.error(`migration-timestamps: ${line}`);
    }
    console.error(`migration-timestamps: ${violations.length} violation(s)`);
    process.exit(1);
  }

  const pluginSummary = pluginDirs.length > 0 ? ` (incl. ${pluginDirs.length} plugin dir)` : '';
  console.log(`migration-timestamps: OK (${entries.length} migrations${pluginSummary})`);
}

function runSelfCheck() {
  const fail = (label, entries, expectedSubstring) => {
    const { ok, violations } = validateEntries(entries);
    if (ok) {
      console.error(`self-check FAIL: "${label}" expected a violation, got none`);
      process.exit(1);
    }
    if (!violations.some((v) => v.includes(expectedSubstring))) {
      console.error(
        `self-check FAIL: "${label}" expected violation containing "${expectedSubstring}", got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };

  const pass = (label, entries) => {
    const { ok, violations } = validateEntries(entries);
    if (!ok) {
      console.error(
        `self-check FAIL: "${label}" expected no violations, got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };

  pass('happy path', [
    {
      filename: '1790000000000-a.ts',
      source: 'export class A1790000000000 implements MigrationInterface {}',
    },
    {
      filename: '1790000000001-b.ts',
      source: 'export class B1790000000001 implements MigrationInterface {}',
    },
  ]);

  fail(
    'duplicate timestamp',
    [
      {
        filename: '1790000000000-a.ts',
        source: 'export class A1790000000000 implements MigrationInterface {}',
      },
      {
        filename: '1790000000000-b.ts',
        source: 'export class B1790000000000 implements MigrationInterface {}',
      },
    ],
    'shares timestamp',
  );

  fail(
    'class/filename mismatch',
    [
      {
        filename: '1790000000002-a.ts',
        source: 'export class A1790000000000 implements MigrationInterface {}',
      },
    ],
    'class timestamp 1790000000000',
  );

  fail(
    'short timestamp',
    [
      {
        filename: '17900000-a.ts',
        source: 'export class A17900000 implements MigrationInterface {}',
      },
    ],
    'digits, expected 13',
  );

  console.log('migration-timestamps: self-check OK');
}

if (process.argv.includes('--self-check')) {
  runSelfCheck();
} else {
  runAgainstTree();
}
