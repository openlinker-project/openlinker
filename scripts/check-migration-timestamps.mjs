#!/usr/bin/env node
/**
 * Migration Timestamp Invariant Guard (#374)
 *
 * Scans `apps/api/src/migrations/` and fails on any violation of the
 * four rules that together prevent the ordering bugs where two migrations
 * share a timestamp (#374) or a new migration sorts into the middle of
 * already-merged history (#1013) — TypeORM 0.3.17 sorts by timestamp alone
 * with no deterministic tie-breaker, so a collision can leave one `up()`
 * body silently unapplied, and a too-low timestamp runs DDL before the
 * tables it depends on exist on fresh databases.
 *
 * Enforced invariants:
 *   1. Every migration filename begins with exactly 13 digits followed by
 *      `-` (e.g. `1790000000002-add-currency-to-products.ts`). This is the
 *      `.now()` millisecond shape TypeORM generates.
 *   2. The class exported from the file declares the same 13-digit suffix
 *      as the filename prefix (catches half-renames that update one side
 *      but not the other).
 *   3. No two migration files share the same 13-digit prefix.
 *   4. A migration file that is NOT yet on `origin/main` must have a
 *      timestamp strictly greater than every migration that IS (#1013 —
 *      `migration:generate` emits a real `Date.now()` prefix; re-prefix it
 *      to the next free synthetic timestamp before committing). When the
 *      `origin/main` ref is unavailable this is skipped locally with a
 *      one-line notice, but is a HARD FAILURE in CI (`CI=true`) — the lint
 *      workflow fetches `origin/main` explicitly so the check runs on every
 *      PR build (#1020). `push: [main]` builds pass vacuously (the migration
 *      is already in the baseline) — the guard is a pre-merge gate.
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
import { execSync } from 'node:child_process';

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

/**
 * Pure validator for the ordering invariant (#1013). Takes the working-tree
 * entries (`{ filename }` — basenames) and the basenames of migrations
 * already present on `origin/main`, and returns `{ ok, violations }`.
 *
 * Every entry NOT in the baseline ("new on this branch") must have a
 * 13-digit prefix strictly greater than the highest prefix in the baseline —
 * otherwise TypeORM would execute it in the middle of already-applied
 * history, which breaks fresh-database `migration:run` whenever the new DDL
 * depends on tables created later in the sequence.
 *
 * An empty baseline (repo with no migrations on main yet) accepts anything.
 * Malformed filenames are ignored here — rule 1 already reports them.
 * Kept free of I/O so the self-check can drive it with inline fixtures.
 */
export function validateOrdering({ entries, baselineFilenames }) {
  const violations = [];
  const baseline = new Set(baselineFilenames);

  let baselineMax = null;
  let baselineMaxFile = null;
  for (const filename of baselineFilenames) {
    const match = FILENAME_RE.exec(filename);
    if (!match || match[1].length !== CANONICAL_TIMESTAMP_LEN) continue;
    if (baselineMax === null || match[1] > baselineMax) {
      baselineMax = match[1];
      baselineMaxFile = filename;
    }
  }
  if (baselineMax === null) {
    return { ok: true, violations };
  }

  for (const { filename } of entries) {
    if (baseline.has(filename)) continue;
    const match = FILENAME_RE.exec(filename);
    if (!match || match[1].length !== CANONICAL_TIMESTAMP_LEN) continue;
    if (match[1] <= baselineMax) {
      violations.push(
        `${filename}: timestamp ${match[1]} sorts before (or ties with) the newest migration ` +
          `already on origin/main (${baselineMax} — ${baselineMaxFile}); bump the prefix to the ` +
          `next free synthetic timestamp and update the class suffix to match (#1013)`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Decide what to do when the `origin/main` baseline ref is unavailable
 * (#1020). Locally (no CI) the ordering check degrades to a skip — exotic
 * setups without the remote shouldn't block a commit. In CI a missing ref
 * means the workflow failed to provide it, so the guard would silently stop
 * enforcing the #1013 invariant on exactly the pre-merge path that matters;
 * we refuse to skip and fail loudly instead. Pure (env-free) so the
 * self-check can drive it with fixtures; the single call site passes
 * `isCi: process.env.CI === 'true'`.
 */
export function resolveMissingBaselineAction({ isCi }) {
  return isCi ? 'fail' : 'skip';
}

/**
 * Basenames of migration files present on `origin/main` across the given
 * repo-root-relative directories, via `git ls-tree` (no checkout needed).
 * Returns `null` when the ref is unavailable (no remote, shallow clone
 * without the ref). The caller then consults `resolveMissingBaselineAction`:
 * a skip with a notice locally, a hard failure in CI (`CI=true`). The lint
 * workflow fetches `origin/main` after checkout so PR builds always have it
 * (#1020).
 */
function loadBaselineFilenames(relativeDirs) {
  try {
    const out = execSync(`git ls-tree -r --name-only origin/main -- ${relativeDirs.join(' ')}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return out
      .split('\n')
      .filter((line) => line.endsWith('.ts'))
      .map((line) => line.split('/').pop());
  } catch {
    return null;
  }
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

  // Ordering invariant (#1013): files new on this branch must sort after
  // everything already on origin/main (core + plugin dirs, same union).
  const baselineFilenames = loadBaselineFilenames(['apps/api/src/migrations', ...pluginDirs]);
  let orderingSummary;
  if (baselineFilenames === null) {
    if (resolveMissingBaselineAction({ isCi: process.env.CI === 'true' }) === 'fail') {
      violations.push(
        'ordering vs origin/main: ref unavailable in CI — the lint job must fetch origin/main ' +
          '(see .github/workflows/ci.yml); refusing to skip the #1013 ordering invariant (#1020)',
      );
      orderingSummary = 'ordering vs origin/main: FAILED (ref unavailable in CI)';
    } else {
      orderingSummary = 'ordering vs origin/main: skipped (no origin/main ref)';
    }
  } else {
    const ordering = validateOrdering({ entries, baselineFilenames });
    violations.push(...ordering.violations);
    orderingSummary = 'ordering vs origin/main: checked';
  }

  if (!ok || violations.length > 0) {
    for (const line of violations) {
      console.error(`migration-timestamps: ${line}`);
    }
    console.error(`migration-timestamps: ${violations.length} violation(s)`);
    process.exit(1);
  }

  const pluginSummary = pluginDirs.length > 0 ? ` (incl. ${pluginDirs.length} plugin dir)` : '';
  console.log(
    `migration-timestamps: OK (${entries.length} migrations${pluginSummary}; ${orderingSummary})`,
  );
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

  // --- Ordering invariant (#1013) ---

  const passOrdering = (label, input) => {
    const { ok, violations } = validateOrdering(input);
    if (!ok) {
      console.error(
        `self-check FAIL: "${label}" expected no violations, got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };
  const failOrdering = (label, input, expectedSubstring) => {
    const { ok, violations } = validateOrdering(input);
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

  passOrdering('ordering: new file above baseline max', {
    entries: [{ filename: '1801000000000-a.ts' }, { filename: '1802000000000-b.ts' }],
    baselineFilenames: ['1801000000000-a.ts'],
  });

  passOrdering('ordering: no new files (running on main itself)', {
    entries: [{ filename: '1801000000000-a.ts' }],
    baselineFilenames: ['1801000000000-a.ts'],
  });

  passOrdering('ordering: empty baseline accepts anything', {
    entries: [{ filename: '1700000000000-first.ts' }],
    baselineFilenames: [],
  });

  passOrdering('ordering: file deleted from tree but still on main is ignored', {
    entries: [{ filename: '1802000000000-b.ts' }],
    baselineFilenames: ['1779985594755-AddShipmentCarrier.ts', '1801000000000-a.ts'],
  });

  failOrdering(
    'ordering: new file sorts into the middle of merged history (#1013 shape)',
    {
      entries: [{ filename: '1801000000000-a.ts' }, { filename: '1779985594755-carrier.ts' }],
      baselineFilenames: ['1801000000000-a.ts'],
    },
    'sorts before',
  );

  failOrdering(
    'ordering: new file ties with baseline max',
    {
      entries: [{ filename: '1801000000000-a.ts' }, { filename: '1801000000000-b.ts' }],
      baselineFilenames: ['1801000000000-a.ts'],
    },
    'sorts before',
  );

  // --- Missing-baseline action (#1020): hard-fail in CI, skip locally ---

  const expectAction = (label, input, expected) => {
    const got = resolveMissingBaselineAction(input);
    if (got !== expected) {
      console.error(`self-check FAIL: "${label}" expected '${expected}', got '${got}'`);
      process.exit(1);
    }
  };

  expectAction('missing baseline in CI → fail', { isCi: true }, 'fail');
  expectAction('missing baseline locally → skip', { isCi: false }, 'skip');

  console.log('migration-timestamps: self-check OK');
}

if (process.argv.includes('--self-check')) {
  runSelfCheck();
} else {
  runAgainstTree();
}
