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
 *      to the next free synthetic timestamp before committing). Baseline
 *      resolution depends on `git` (#1020): when `git` works but the
 *      `origin/main` ref is missing it's skipped locally / a HARD FAILURE in
 *      CI (`CI=true`) — the lint workflow fetches the ref so git-capable PR
 *      builds enforce it; when `git` is absent entirely (self-hosted runners
 *      where `actions/checkout` used its tarball fallback) the check skips
 *      even in CI, since the runner can't support it (gated on #662/#557).
 *      `push: [main]` builds pass vacuously (the migration is already in the
 *      baseline) — the guard is a pre-merge gate.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain, so a
 * collision fails pre-commit and CI runs before the broken migration can
 * ever reach a shared environment.
 *
 * Exits non-zero on violation, with one human-readable line per problem.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
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
 * Decide what to do when the `origin/main` baseline ref is unavailable but
 * `git` itself works (#1020). Locally (no CI) the ordering check degrades to a
 * skip — exotic setups without the remote shouldn't block a commit. In CI a
 * missing ref means the workflow failed to fetch it, so the guard would
 * silently stop enforcing the #1013 invariant on exactly the pre-merge path
 * that matters; we refuse to skip and fail loudly instead. Pure (env-free) so
 * the self-check can drive it with fixtures; the single call site passes
 * `isCi: process.env.CI === 'true'`.
 *
 * NOTE: this governs only the *ref-missing* case. When `git` is absent
 * entirely (see `classifyBaselineError`) the check skips even in CI — a runner
 * with no git binary cannot support the guard, and that's an environment
 * limitation, not a per-PR failure.
 */
export function resolveMissingBaselineAction({ isCi }) {
  return isCi ? 'fail' : 'skip';
}

/**
 * Classify a failed `git ls-tree origin/main` into the reason it failed, so
 * the caller can treat the two cases differently (#1020):
 *   - `'no-git'`: the `git` binary is unavailable. The shell returns 127
 *     ("command not found") — on self-hosted runners where `actions/checkout`
 *     used its tarball/API fallback there is no git at all. Node throws
 *     `ENOENT` if git is exec'd directly. This is an environment limitation;
 *     the guard skips (even in CI).
 *   - `'no-ref'`: git works but `origin/main` isn't present (git exits 128).
 *     Fixable by fetching the ref — hard-fail in CI via
 *     `resolveMissingBaselineAction`.
 * Pure (no I/O) so the self-check can drive it with fixtures.
 */
export function classifyBaselineError(error) {
  if (error && (error.code === 'ENOENT' || error.status === 127)) {
    return 'no-git';
  }
  return 'no-ref';
}

/**
 * Basenames of migration files present on `origin/main` across the given
 * repo-root-relative directories, via `git ls-tree` (no checkout needed).
 * Returns a tagged result:
 *   - `{ kind: 'ok', filenames }` on success;
 *   - `{ kind: 'no-git' }` when the `git` binary is unavailable;
 *   - `{ kind: 'no-ref' }` when git works but the `origin/main` ref is missing.
 * The lint workflow fetches `origin/main` after checkout (when git is present)
 * so git-capable PR builds resolve to `'ok'` (#1020).
 */
function loadBaselineFilenames(relativeDirs) {
  try {
    const out = execSync(`git ls-tree -r --name-only origin/main -- ${relativeDirs.join(' ')}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const filenames = out
      .split('\n')
      .filter((line) => line.endsWith('.ts'))
      .map((line) => line.split('/').pop());
    return { kind: 'ok', filenames };
  } catch (error) {
    return { kind: classifyBaselineError(error) };
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

/**
 * Migration timestamp prefixes claimed by OTHER branches, and by whom.
 *
 * WHY THIS EXISTS. Review assigned migration prefixes across PRs three times in
 * one week and all three broke - not three people ignoring advice, one
 * structural problem showing up three times. `loadBaselineFilenames` compares
 * this tree against `origin/main` and is therefore blind to every other open
 * branch BY CONSTRUCTION, so nothing between "an author picks a number" and
 * "the second branch to merge fails lint" can see a clash. With ~19 open PRs
 * and dense sequential prefixes, collisions are the expected outcome rather
 * than bad luck, and a review comment is not an allocator.
 *
 * WHAT IT IS, PRECISELY: a PRE-MERGE CONVENIENCE, not a hard gate, and the
 * difference is deliberate rather than a shortcut. It reports what is already
 * FETCHED under `refs/remotes/origin/*` - it performs no network I/O, so on a
 * shallow CI clone carrying only `origin/main` it has nothing to compare and
 * says so instead of pretending. It cannot be a gate for the same reason the
 * ordering check is not one everywhere: `docs/migrations.md` records that some
 * self-hosted runners have no `git` binary at all.
 *
 * IT OVER-REPORTS, and that is a property of git rather than a rough edge to
 * file off. `--no-merged origin/main` cannot see a branch that was SQUASH-merged
 * - the squash commit shares no ancestry with it - so a long-dead branch keeps
 * appearing as open work and its prefixes keep being listed. `git remote prune
 * origin` cuts the stale refs, but that is the operator's call, not this
 * script's. Over-reporting is the survivable direction here: every entry names
 * its branch and its filename, so a reader dismisses a stale one in a glance,
 * whereas a missed live collision is the whole failure this exists to catch.
 *
 * It therefore WARNS and never fails. A collision between two unmerged branches
 * is not a defect in either one - whichever merges second has to move, and that
 * is a conversation, not a build break. Failing here would block a branch for
 * something another branch did, which is precisely the allocation problem one
 * level down.
 *
 * Returns `{ kind: 'ok', collisions, scanned }`, or `{ kind }` naming why it
 * could not look (`'no-git'`, reusing `classifyBaselineError`).
 */
export function findCrossBranchCollisions(
  ownFilenames,
  listRefs,
  listFiles,
  selfRef = null,
  baselineFilenames = null
) {
  const branches = listRefs().filter(
    (b) => b !== 'origin/main' && b !== 'origin/HEAD' && b !== selfRef
  );

  // A COLLISION IS SAME PREFIX, DIFFERENT FILE. Same prefix AND same filename is
  // this branch's own migration seen on its own remote ref, or on a branch that
  // took it along in a merge - the one thing that is certainly not a clash, and
  // reporting it buries the real ones. Keyed by prefix -> the filename WE claim.
  //
  // AND A MERGED PREFIX CANNOT BE CONTENDED. `baselineFilenames` is what is
  // already on `origin/main`; anything of ours in that set has landed, so
  // whoever else claims its prefix is either a dead branch or is alive and
  // already failing the ordering check above. Without this the scanner printed
  // 11 contended prefixes on a clean tree - every one of them ours, already
  // merged - and the true-positive set was empty. #2615's rule: an alert that
  // fires on a healthy install is worse than no alert, because the twelfth line
  // is the real one and nobody reads past the eleventh.
  const merged = baselineFilenames === null ? null : new Set(baselineFilenames);
  const owned = new Map();
  for (const name of ownFilenames) {
    if (merged !== null && merged.has(name)) continue;
    owned.set(name.split('-')[0], name);
  }

  const collisions = new Map();
  for (const branch of branches) {
    for (const name of listFiles(branch)) {
      const prefix = name.split('-')[0];
      const ours = owned.get(prefix);
      if (ours === undefined || ours === name) continue;
      if (!collisions.has(prefix)) collisions.set(prefix, []);
      collisions.get(prefix).push({ branch, filename: name });
    }
  }
  return { kind: 'ok', collisions, scanned: branches.length };
}

/** Remote-tracking branches already present locally. No fetch: see the docblock
 * above for why this is a convenience rather than a gate. */
function listLocalRemoteBranches() {
  // `--no-merged origin/main` is what makes this about OPEN work. A repository
  // accumulates every branch it ever fetched - 539 on the machine this was
  // written on - and a merged one shares prefixes with main by definition, so
  // scanning them all costs one `ls-tree` each and reports nothing true.
  const out = execSync(
    "git for-each-ref --no-merged origin/main --format='%(refname:short)' refs/remotes/origin",
    {
    cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  ).toString();
  return out
    .split('\n')
    .map((l) => l.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

/** This branch's own remote-tracking ref, so it is not reported against itself. */
function currentRemoteRef() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return branch && branch !== 'HEAD' ? `origin/${branch}` : null;
  } catch {
    return null;
  }
}

/** Migration basenames on one ref. A ref whose objects are missing yields
 * nothing rather than throwing - a branch we cannot read is a branch we simply
 * did not compare, which is the honest answer for a convenience. */
function listMigrationFilenamesOnRef(ref, relativeDirs) {
  try {
    return execSync(`git ls-tree -r --name-only ${ref} -- ${relativeDirs.join(' ')}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .filter((line) => line.endsWith('.ts'))
      .map((line) => line.split('/').pop());
  } catch {
    return [];
  }
}

/** Report cross-branch prefix collisions. Warns, never fails - see the
 * `findCrossBranchCollisions` docblock. */
function reportCrossBranchCollisions(ownFilenames, relativeDirs, baseline) {
  // NO BASELINE, NO SCAN. Falling back to the unfiltered behaviour would print
  // the 11-entry noise floor precisely where the guard is least able to say
  // anything true, which is the opposite of the fail-honest posture the rest of
  // this function takes.
  if (baseline.kind !== 'ok') {
    return `cross-branch: skipped (no baseline: ${baseline.kind})`;
  }

  let result;
  try {
    result = findCrossBranchCollisions(
      ownFilenames,
      listLocalRemoteBranches,
      (ref) => listMigrationFilenamesOnRef(ref, relativeDirs),
      currentRemoteRef(),
      baseline.filenames
    );
  } catch (error) {
    return classifyBaselineError(error) === 'no-git'
      ? 'cross-branch: skipped (no git)'
      : 'cross-branch: skipped (refs unreadable)';
  }

  if (result.scanned === 0) {
    return 'cross-branch: no other unmerged branches fetched';
  }
  // "unmerged" is said plainly rather than dressed up as open PRs. Measured on
  // this repository: 509 fetched branches, 503 of them unmerged, against about
  // nineteen open PRs - because `--no-merged` cannot see a SQUASH merge, which
  // is how everything lands here. The number is branches we could read, not
  // work in flight, and reporting it as the latter would be a false statement
  // in the one line an operator actually reads.
  if (result.collisions.size === 0) {
    return `cross-branch: clean (${result.scanned} fetched branches compared)`;
  }

  console.warn(
    `\nmigration-timestamps: WARNING - ${result.collisions.size} migration prefix(es) also claimed elsewhere:\n`
  );
  for (const [prefix, claims] of [...result.collisions].sort()) {
    console.warn(`  ${prefix}`);
    for (const c of claims) console.warn(`    ${c.branch}: ${c.filename}`);
  }
  console.warn(
    '\nNot a failure: whichever branch merges second has to move, which is a\n' +
      'conversation rather than a build break. Renumber before merge to avoid it.\n'
  );
  return `cross-branch: ${result.collisions.size} prefix(es) contended (${result.scanned} fetched branches compared)`;
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
  const baseline = loadBaselineFilenames(['apps/api/src/migrations', ...pluginDirs]);
  let orderingSummary;
  if (baseline.kind === 'ok') {
    const ordering = validateOrdering({ entries, baselineFilenames: baseline.filenames });
    violations.push(...ordering.violations);
    orderingSummary = 'ordering vs origin/main: checked';
  } else if (baseline.kind === 'no-git') {
    // `git` is unavailable on this runner (e.g. a self-hosted runner where
    // actions/checkout used its tarball/API fallback). The guard cannot run
    // without git — skip even in CI; this is an environment limitation, not a
    // per-PR failure. Full CI enforcement is gated on a git-capable runner
    // (see #662 / #557 — move CI off self-hosted runners).
    orderingSummary = 'ordering vs origin/main: skipped (git unavailable)';
  } else if (resolveMissingBaselineAction({ isCi: process.env.CI === 'true' }) === 'fail') {
    violations.push(
      'ordering vs origin/main: git works but the origin/main ref is unavailable in CI — the ' +
        'lint job must fetch it (git fetch --no-tags --depth=1 origin ' +
        '+refs/heads/main:refs/remotes/origin/main); refusing to skip the #1013 invariant (#1020)',
    );
    orderingSummary = 'ordering vs origin/main: FAILED (ref unavailable in CI)';
  } else {
    orderingSummary = 'ordering vs origin/main: skipped (no origin/main ref)';
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
    `migration-timestamps: OK (${entries.length} migrations${pluginSummary}; ${orderingSummary}; ` +
      `${reportCrossBranchCollisions(
        entries.map((e) => e.filename),
        ['apps/api/src/migrations', ...pluginDirs],
        baseline
      )})`,
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

  // --- Baseline-error classification (#1020): git-absent vs ref-missing ---

  const expectClass = (label, error, expected) => {
    const got = classifyBaselineError(error);
    if (got !== expected) {
      console.error(`self-check FAIL: "${label}" expected '${expected}', got '${got}'`);
      process.exit(1);
    }
  };

  expectClass('git binary absent (shell 127) → no-git', { status: 127 }, 'no-git');
  expectClass('git binary absent (ENOENT) → no-git', { code: 'ENOENT' }, 'no-git');
  expectClass('git present, ref missing (128) → no-ref', { status: 128 }, 'no-ref');

  // --- Cross-branch prefix collisions (the guard review asked for) ---

  const expectCollisions = (label, own, branches, files, selfRef, expected) => {
    const { collisions } = findCrossBranchCollisions(
      own,
      () => branches,
      (ref) => files[ref] ?? [],
      selfRef
    );
    const got = [...collisions.keys()].sort().join(',');
    if (got !== expected) {
      console.error(`self-check FAIL: "${label}" expected '${expected}', got '${got}'`);
      process.exit(1);
    }
  };

  // THE CASE THE SCANNER EXISTS FOR: two branches, one prefix, two files.
  expectCollisions(
    'same prefix, different file on another branch → collision',
    ['1902000000000-split-subiekt-product-lines.ts'],
    ['origin/other'],
    { 'origin/other': ['1902000000000-create-inventory-sale-decrements.ts'] },
    null,
    '1902000000000'
  );

  // The noise that made the first run useless: our OWN migration, seen on our
  // own remote ref or carried along by a merge, is not a clash with anything.
  expectCollisions(
    'same prefix AND same file → not a collision',
    ['1902000000000-split-subiekt-product-lines.ts'],
    ['origin/other'],
    { 'origin/other': ['1902000000000-split-subiekt-product-lines.ts'] },
    null,
    ''
  );

  expectCollisions(
    'our own remote ref is excluded outright',
    ['1902000000000-a.ts'],
    ['origin/mine'],
    { 'origin/mine': ['1902000000000-b.ts'] },
    'origin/mine',
    ''
  );

  expectCollisions(
    'origin/main is never a collision - that is the ordering check above',
    ['1902000000000-a.ts'],
    ['origin/main'],
    { 'origin/main': ['1902000000000-b.ts'] },
    null,
    ''
  );

  // THE 11-FALSE-POSITIVE CASE: our migration is already on origin/main, so its
  // prefix cannot be contended - whoever else claims it is a dead branch, or is
  // alive and already failing the ordering check.
  {
    const { collisions } = findCrossBranchCollisions(
      ['1799000000000-add-shipments-table.ts'],
      () => ['origin/792-persist-variant-price'],
      () => ['1799000000000-add-price-to-product-variants.ts'],
      null,
      ['1799000000000-add-shipments-table.ts']
    );
    if (collisions.size !== 0) {
      console.error(
        "self-check FAIL: 'a merged prefix cannot be contended' expected none, got " +
          [...collisions.keys()].join(',')
      );
      process.exit(1);
    }
  }

  // And the filter must not swallow a LIVE one: same shape, ours not on main.
  {
    const { collisions } = findCrossBranchCollisions(
      ['1902000000000-split-subiekt-product-lines.ts'],
      () => ['origin/other'],
      () => ['1902000000000-create-inventory-sale-decrements.ts'],
      null,
      ['1899000000000-something-else.ts']
    );
    if (collisions.size !== 1 || !collisions.has('1902000000000')) {
      console.error(
        "self-check FAIL: 'an unmerged prefix is still reported' expected 1902000000000, got " +
          [...collisions.keys()].join(',')
      );
      process.exit(1);
    }
  }

  expectCollisions(
    'a prefix we do not claim is somebody else business',
    ['1902000000000-a.ts'],
    ['origin/other'],
    { 'origin/other': ['1999000000000-z.ts'] },
    null,
    ''
  );

  console.log('migration-timestamps: self-check OK');
}

// RUN-IF-MAIN. Without this, `import`ing the module to drive its exported
// functions executes `runAgainstTree()` - which reads
// `scripts/plugin-migration-dirs.json` relative to its own ROOT and dies
// outside a checkout. `findCrossBranchCollisions` is exported with injectable
// `listRefs` / `listFiles` precisely so it can be driven from a spec, and a
// module that runs on import cannot be. Costs nothing today, since the
// self-check lives in the same module; costs the next person who wants a real
// one (PR #3365 review).
// `realpathSync` THROWS `ENOENT` when `argv[1]` is defined but absent from
// disk. Unreachable through `node scripts/…` or a `.bin` symlink, both of which
// resolve - but this module is now written to be IMPORTED, and an uncaught
// throw at module load breaks the importer rather than the runner it was meant
// to serve. Not a live defect; one line, and the failure it prevents is the one
// this guard exists to avoid being the cause of (PR #3365 review).
function isInvokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const invokedDirectly = isInvokedDirectly();

if (invokedDirectly) {
  if (process.argv.includes('--self-check')) {
    runSelfCheck();
  } else {
    runAgainstTree();
  }
}
