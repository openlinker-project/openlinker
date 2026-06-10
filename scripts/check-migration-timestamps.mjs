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
 * Pure validator for the JSON-vs-TS drift check. Takes the manifest
 * directories (parsed JSON) and the TS source text, returns
 * `{ ok, error, dirs }`. Kept side-effect-free so the self-check at the
 * bottom of this file can drive it with inline fixtures.
 *
 * The TS extraction is intentionally strict: any re-shaping of the
 * `PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT` constant that would break the
 * regex MUST also update this validator. The failure message says
 * exactly what to change.
 */
export function validatePluginMigrationDirsDrift({ manifestDirs, tsSource }) {
  const arrayMatch = /PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT\s*=\s*\[([\s\S]*?)\]/.exec(tsSource);
  if (!arrayMatch) {
    return {
      ok: false,
      error:
        'plugin-migrations: could not extract PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT from ' +
        'apps/api/src/plugin-migrations.ts. If the constant was renamed or its shape changed, ' +
        'update scripts/check-migration-timestamps.mjs to match.',
    };
  }

  // Strip TS line + block comments before parsing — protects against future
  // additions like `// shopify plugin` interleaved with the entries.
  const stripped = arrayMatch[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tsDirs = [...stripped.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  const a = [...manifestDirs].sort();
  const b = [...tsDirs].sort();
  if (a.length !== b.length || a.some((d, i) => d !== b[i])) {
    return {
      ok: false,
      error:
        `plugin-migrations: drift between scripts/plugin-migration-dirs.json and ` +
        `apps/api/src/plugin-migrations.ts.\n` +
        `  manifest: ${JSON.stringify(a)}\n` +
        `  ts seam: ${JSON.stringify(b)}\n` +
        `Keep both lists in sync — see file headers.`,
    };
  }

  return { ok: true, dirs: manifestDirs };
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
  const tsSource = readFileSync(PLUGIN_MIGRATIONS_TS, 'utf8');
  const result = validatePluginMigrationDirsDrift({
    manifestDirs: manifest.directories,
    tsSource,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.dirs;
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

  // --- Plugin-migration drift check (#599) ---

  const passDrift = (label, manifestDirs, tsSource) => {
    const result = validatePluginMigrationDirsDrift({ manifestDirs, tsSource });
    if (!result.ok) {
      console.error(`self-check FAIL: "${label}" expected ok, got error:\n  ${result.error}`);
      process.exit(1);
    }
  };
  const failDrift = (label, manifestDirs, tsSource, expectedSubstring) => {
    const result = validatePluginMigrationDirsDrift({ manifestDirs, tsSource });
    if (result.ok) {
      console.error(`self-check FAIL: "${label}" expected error, got ok`);
      process.exit(1);
    }
    if (!result.error.includes(expectedSubstring)) {
      console.error(
        `self-check FAIL: "${label}" expected error containing "${expectedSubstring}", got:\n  ${result.error}`,
      );
      process.exit(1);
    }
  };

  const canonicalTs = `const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [\n  'libs/integrations/allegro/src/migrations',\n];`;

  passDrift(
    'drift: aligned manifest + ts (single entry)',
    ['libs/integrations/allegro/src/migrations'],
    canonicalTs,
  );

  passDrift(
    'drift: aligned manifest + ts (multiple entries, order-insensitive)',
    [
      'libs/integrations/shopify/src/migrations',
      'libs/integrations/allegro/src/migrations',
    ],
    `const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [
  'libs/integrations/allegro/src/migrations',
  'libs/integrations/shopify/src/migrations',
];`,
  );

  passDrift(
    'drift: tolerates inline line comments between entries',
    [
      'libs/integrations/allegro/src/migrations',
      'libs/integrations/shopify/src/migrations',
    ],
    `const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [
  // Allegro plugin (#599)
  'libs/integrations/allegro/src/migrations',
  // Shopify plugin (hypothetical)
  'libs/integrations/shopify/src/migrations',
];`,
  );

  failDrift(
    'drift: manifest has extra entry',
    [
      'libs/integrations/allegro/src/migrations',
      'libs/integrations/shopify/src/migrations',
    ],
    canonicalTs,
    'drift between',
  );

  failDrift(
    'drift: ts has extra entry',
    ['libs/integrations/allegro/src/migrations'],
    `const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [
  'libs/integrations/allegro/src/migrations',
  'libs/integrations/shopify/src/migrations',
];`,
    'drift between',
  );

  failDrift(
    'drift: constant renamed → extraction fails loudly',
    ['libs/integrations/allegro/src/migrations'],
    `const RENAMED_CONST = ['libs/integrations/allegro/src/migrations'];`,
    'could not extract PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT',
  );

  failDrift(
    'drift: empty ts array vs populated manifest',
    ['libs/integrations/allegro/src/migrations'],
    `const PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT = [];`,
    'drift between',
  );

  console.log('migration-timestamps: self-check OK');
}

if (process.argv.includes('--self-check')) {
  runSelfCheck();
} else {
  runAgainstTree();
}
