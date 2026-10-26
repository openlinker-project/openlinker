#!/usr/bin/env node
/**
 * ADR Number Uniqueness Invariant Guard (#2082)
 *
 * ADR numbers are allocated by hand and nothing enforced uniqueness before
 * this guard. Because two ADRs claiming the same number have *different
 * filenames*, git merges both cleanly with no conflict marker — each PR
 * passes review in isolation and only the *second* one to merge produces a
 * silent duplicate in a record `docs/architecture/adrs/README.md` describes
 * as append-only. This is the same failure mode as the migration-timestamp
 * collision (#374/#1013) that `scripts/check-migration-timestamps.mjs`
 * already guards, and this script mirrors its shape.
 *
 * Enforced invariants (over `docs/architecture/adrs/*.md`, excluding
 * `README.md` and `template.md`):
 *   1. Every ADR filename matches `NNN-kebab-case-title.md` (a 3-digit
 *      zero-padded prefix).
 *   2. No two files share the same 3-digit prefix.
 *   3. The file's first line — `# ADR-NNN: Title` — carries the same
 *      number as the filename prefix (catches a half-rename that updates
 *      one side but not the other).
 *   4. A number not present on `origin/main` under a given filename must
 *      not already be claimed there under a *different* filename — this is
 *      the check that actually catches the cross-PR collision, since it's
 *      only visible when the branch is compared against the trunk. Mirrors
 *      the migration guard's git-availability caveat: skipped with a
 *      notice when `origin/main` is unfetchable locally, a HARD FAILURE in
 *      CI (`CI=true`), and skipped entirely when `git` itself is absent.
 *   5. `docs/architecture/adrs/README.md`'s `## Index` table carries
 *      exactly one row per ADR file, and no row without a matching file —
 *      the index is what an author actually reads to pick the next number,
 *      and it has drifted from the file list twice already.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
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
const ADRS_DIR = resolve(ROOT, 'docs/architecture/adrs');
const README_PATH = resolve(ADRS_DIR, 'README.md');

const IGNORED_FILES = new Set(['README.md', 'template.md']);
const FILENAME_RE = /^(\d+)-(.+)\.md$/;
const CANONICAL_NUMBER_LEN = 3;
const HEADING_RE = /^#\s+ADR-(\d+):/;
// README index row: | [ADR-NNN](./NNN-slug.md) | Title | Status | Date |
const README_ROW_RE = /^\|\s*\[ADR-(\d+)\]\(\.\/(\d+)-[^)]+\.md\)\s*\|/gm;

/**
 * The ADR's title line — matched against the file's first non-blank line
 * only (never scanned across the whole body), so a `# ADR-NNN:`-shaped
 * string quoted deeper in the prose (e.g. discussing a superseded ADR)
 * can never be mistaken for the file's own heading.
 */
function extractHeadingNumber(source) {
  const firstNonBlankLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
  const match = HEADING_RE.exec(firstNonBlankLine.trim());
  return match ? match[1] : null;
}

/**
 * Pure validator for rules 1-3. Takes `{ filename, source }` entries for
 * every ADR file (README/template already excluded by the caller) and
 * returns `{ ok, violations }`. Side-effect-free so the self-check can
 * drive it with inline fixtures.
 */
export function validateEntries(entries) {
  const violations = [];
  const byNumber = new Map();

  for (const { filename, source } of entries) {
    const match = FILENAME_RE.exec(filename);
    if (!match) {
      violations.push(`${filename}: filename does not match {NNN}-{kebab-title}.md`);
      continue;
    }

    const [, number] = match;
    if (number.length !== CANONICAL_NUMBER_LEN) {
      violations.push(
        `${filename}: number has ${number.length} digits, expected ${CANONICAL_NUMBER_LEN}`,
      );
      continue;
    }

    const headingNumber = extractHeadingNumber(source);
    if (headingNumber === null) {
      violations.push(`${filename}: could not find a \`# ADR-{digits}: Title\` heading`);
    } else {
      // Compare numerically so "01" vs "1" (malformed either way) doesn't
      // mask a real mismatch behind a string-length difference already
      // reported above; the filename's own digit-count is checked above.
      if (Number(headingNumber) !== Number(number) || headingNumber.length !== number.length) {
        violations.push(
          `${filename}: filename number ${number} ≠ heading number ADR-${headingNumber}`,
        );
      }
    }

    const existing = byNumber.get(number);
    if (existing) {
      violations.push(`${filename}: shares ADR number ${number} with ${existing}`);
    } else {
      byNumber.set(number, filename);
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Pure validator for rule 4 — the cross-PR collision. A file that is NOT
 * on `origin/main` (new, or renamed) must not claim a number that a
 * *different* filename already holds on `origin/main`. A file whose exact
 * filename is unchanged on `origin/main` is simply an edit, not a claim.
 *
 * `renames` (optional, `Map<newFilename, oldFilename>`, from
 * `git diff --find-renames`) is what tells apart the two situations that
 * otherwise look identical from a bare filename diff: a genuine cross-PR
 * collision (#2066 — a rival file claims a number that a DIFFERENT ADR
 * already holds on origin/main) versus a same-number rename (fixing a typo
 * in an ADR's own kebab-title without renumbering it). Without this, the
 * latter is indistinguishable from the former and fails every such rename —
 * an author's own file, not a rival's. When `filename` is git's detected
 * rename target of exactly the baseline file that already claims `number`,
 * it's the same ADR under a corrected name, not a second claimant, and is
 * exempted. An absent/empty `renames` map (git rename-detection unavailable
 * or below git's similarity threshold) simply falls back to the stricter
 * pre-existing behaviour — a false positive in that degraded case, never a
 * false negative.
 *
 * An empty baseline (no ADRs on main yet) accepts anything. Malformed
 * filenames are ignored here — `validateEntries` already reports them.
 */
export function validateAgainstBaseline({ entries, baselineFilenames, renames = new Map() }) {
  const violations = [];
  const baselineSet = new Set(baselineFilenames);

  const baselineByNumber = new Map();
  for (const filename of baselineFilenames) {
    const match = FILENAME_RE.exec(filename);
    if (!match || match[1].length !== CANONICAL_NUMBER_LEN) continue;
    baselineByNumber.set(match[1], filename);
  }

  for (const { filename } of entries) {
    if (baselineSet.has(filename)) continue;
    const match = FILENAME_RE.exec(filename);
    if (!match || match[1].length !== CANONICAL_NUMBER_LEN) continue;

    const [, number] = match;
    const baselineFile = baselineByNumber.get(number);
    if (!baselineFile || baselineFile === filename) continue;

    if (renames.get(filename) === baselineFile) {
      // git detected `filename` as a rename of `baselineFile` itself — the
      // very file that already legitimately holds `number` — so this is a
      // slug correction, not a rival claim.
      continue;
    }

    violations.push(
      `${filename}: ADR number ${number} is already claimed on origin/main by ` +
        `${baselineFile} — pick the next free number`,
    );
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Pure validator for rule 5 — the README index must be a BIJECTION with
 * the file set (exactly one row per file, exactly one file per row), not
 * merely "every file has at least one row and every row names a real
 * file". Takes the set of ADR numbers derived from files on disk and the
 * full list of README index rows (each with its own filename-in-link, so
 * a stale link is also caught) — every row is inspected, not deduped
 * first, or two rows both (correctly) naming the same real file would
 * silently pass despite the index no longer being 1:1.
 */
export function validateReadmeIndex({ fileNumbers, indexRows }) {
  const violations = [];
  const fileNumberSet = new Set(fileNumbers);

  const rowCountByNumber = new Map();
  for (const row of indexRows) {
    rowCountByNumber.set(row.linkNumber, (rowCountByNumber.get(row.linkNumber) ?? 0) + 1);
  }

  for (const number of fileNumberSet) {
    if (!rowCountByNumber.has(number)) {
      violations.push(`ADR-${number}: file exists but has no README index row`);
    }
  }

  for (const row of indexRows) {
    if (!fileNumberSet.has(row.linkNumber)) {
      violations.push(
        `README index row references ADR-${row.headingNumber} (./${row.linkNumber}-...) ` +
          `but no such file exists`,
      );
    }
    if (row.headingNumber !== row.linkNumber) {
      violations.push(
        `README index row: [ADR-${row.headingNumber}] link points at ` +
          `./${row.linkNumber}-...md — heading and link number disagree`,
      );
    }
  }

  for (const [number, count] of rowCountByNumber) {
    if (count > 1) {
      violations.push(
        `ADR-${number}: README index has ${count} rows referencing it, expected exactly 1`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Same reasoning as check-migration-timestamps.mjs's identically-named helper (#1020). */
export function resolveMissingBaselineAction({ isCi }) {
  return isCi ? 'fail' : 'skip';
}

/** Same reasoning as check-migration-timestamps.mjs's identically-named helper (#1020). */
export function classifyBaselineError(error) {
  if (error && (error.code === 'ENOENT' || error.status === 127)) {
    return 'no-git';
  }
  return 'no-ref';
}

/**
 * Basenames of ADR files present on `origin/main`, via `git ls-tree` (no
 * checkout needed). Returns a tagged result mirroring the migration guard.
 */
function loadBaselineFilenames() {
  try {
    const out = execSync(`git ls-tree -r --name-only origin/main -- docs/architecture/adrs`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const filenames = out
      .split('\n')
      .filter((line) => line.endsWith('.md'))
      .map((line) => line.split('/').pop())
      .filter((name) => !IGNORED_FILES.has(name));
    return { kind: 'ok', filenames };
  } catch (error) {
    return { kind: classifyBaselineError(error) };
  }
}

/**
 * Rename pairs detected between `origin/main` and the working tree, scoped
 * to `docs/architecture/adrs`, as `Map<newFilename, oldFilename>`. Feeds the
 * rename exemption in `validateAgainstBaseline` — see that function's
 * docblock for why it's needed. Best-effort: any failure (git absent, ref
 * missing, or simply nothing to diff) degrades to an empty map, which only
 * ever makes the collision check MORE strict, never less — so a failure
 * here can't hide a real collision, only reintroduce the rename
 * false-positive this exists to prevent.
 */
function loadRenamedFilenames() {
  try {
    const out = execSync(
      `git diff --find-renames=50% --name-status origin/main -- docs/architecture/adrs`,
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();

    const renames = new Map();
    for (const line of out.split('\n')) {
      if (!line.startsWith('R')) continue;
      const [, oldPath, newPath] = line.split('\t');
      if (!oldPath || !newPath || !oldPath.endsWith('.md') || !newPath.endsWith('.md')) continue;
      renames.set(newPath.split('/').pop(), oldPath.split('/').pop());
    }
    return renames;
  } catch {
    return new Map();
  }
}

function loadAdrsFromDisk() {
  const filenames = readdirSync(ADRS_DIR)
    .filter((name) => name.endsWith('.md') && !IGNORED_FILES.has(name))
    .sort();
  return filenames.map((filename) => ({
    filename,
    source: readFileSync(resolve(ADRS_DIR, filename), 'utf8'),
  }));
}

function loadReadmeIndexRows() {
  const source = readFileSync(README_PATH, 'utf8');
  const rows = [];
  let match;
  while ((match = README_ROW_RE.exec(source)) !== null) {
    rows.push({ headingNumber: match[1], linkNumber: match[2] });
  }
  return rows;
}

function runAgainstTree() {
  const entries = loadAdrsFromDisk();
  const { ok, violations } = validateEntries(entries);

  const readmeResult = validateReadmeIndex({
    fileNumbers: entries
      .map((e) => FILENAME_RE.exec(e.filename))
      .filter((m) => m && m[1].length === CANONICAL_NUMBER_LEN)
      .map((m) => m[1]),
    indexRows: loadReadmeIndexRows(),
  });
  violations.push(...readmeResult.violations);

  const baseline = loadBaselineFilenames();
  let baselineSummary;
  if (baseline.kind === 'ok') {
    const baselineResult = validateAgainstBaseline({
      entries,
      baselineFilenames: baseline.filenames,
      renames: loadRenamedFilenames(),
    });
    violations.push(...baselineResult.violations);
    baselineSummary = 'uniqueness vs origin/main: checked';
  } else if (baseline.kind === 'no-git') {
    // git itself is unavailable (e.g. a self-hosted runner where
    // actions/checkout used its tarball/API fallback) — environment
    // limitation, not a per-PR failure. Skip even in CI.
    baselineSummary = 'uniqueness vs origin/main: skipped (git unavailable)';
  } else if (resolveMissingBaselineAction({ isCi: process.env.CI === 'true' }) === 'fail') {
    violations.push(
      'uniqueness vs origin/main: git works but the origin/main ref is unavailable in CI — the ' +
        'lint job must fetch it (git fetch --no-tags --depth=1 origin ' +
        '+refs/heads/main:refs/remotes/origin/main); refusing to skip the ADR-number invariant',
    );
    baselineSummary = 'uniqueness vs origin/main: FAILED (ref unavailable in CI)';
  } else {
    baselineSummary = 'uniqueness vs origin/main: skipped (no origin/main ref)';
  }

  if (!ok || violations.length > 0) {
    for (const line of violations) {
      console.error(`adr-numbers: ${line}`);
    }
    console.error(`adr-numbers: ${violations.length} violation(s)`);
    process.exit(1);
  }

  console.log(`adr-numbers: OK (${entries.length} ADRs; ${baselineSummary})`);
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
    { filename: '040-foo.md', source: '# ADR-040: Foo\n\nStatus: Accepted\n' },
    { filename: '041-bar.md', source: '# ADR-041: Bar\n\nStatus: Proposed\n' },
  ]);

  fail(
    'duplicate number (different filenames — the #2050/#2056 shape)',
    [
      { filename: '040-foo.md', source: '# ADR-040: Foo\n' },
      { filename: '040-baz.md', source: '# ADR-040: Baz\n' },
    ],
    'shares ADR number',
  );

  fail(
    'heading/filename mismatch',
    [{ filename: '042-foo.md', source: '# ADR-040: Foo\n' }],
    'filename number 042 ≠ heading number ADR-040',
  );

  fail(
    'short number',
    [{ filename: '42-foo.md', source: '# ADR-42: Foo\n' }],
    'digits, expected 3',
  );

  fail('missing heading', [{ filename: '040-foo.md', source: 'No heading here.\n' }], 'could not find');

  fail(
    'a heading-shaped string later in the body must never be mistaken for the title line',
    [
      {
        filename: '040-foo.md',
        source: '# ADR-041: Wrong title\n\nSee also # ADR-040: mentioned in prose.\n',
      },
    ],
    'filename number 040 ≠ heading number ADR-041',
  );

  // --- Cross-PR baseline collision (rule 4) ---

  const passBaseline = (label, input) => {
    const { ok, violations } = validateAgainstBaseline(input);
    if (!ok) {
      console.error(
        `self-check FAIL: "${label}" expected no violations, got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };
  const failBaseline = (label, input, expectedSubstring) => {
    const { ok, violations } = validateAgainstBaseline(input);
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

  passBaseline('baseline: unchanged file (edit, not a new claim)', {
    entries: [{ filename: '040-foo.md' }],
    baselineFilenames: ['040-foo.md'],
  });

  passBaseline('baseline: new file, next free number', {
    entries: [{ filename: '040-foo.md' }, { filename: '041-bar.md' }],
    baselineFilenames: ['040-foo.md'],
  });

  passBaseline('baseline: empty baseline accepts anything', {
    entries: [{ filename: '001-first.md' }],
    baselineFilenames: [],
  });

  failBaseline(
    'baseline: new filename reuses a number already on main (the #2066 shape)',
    {
      entries: [{ filename: '039-second-claimant.md' }],
      baselineFilenames: ['039-order-analytics-read-model-persistence-strategy.md'],
    },
    'already claimed on origin/main',
  );

  passBaseline(
    'baseline: git-detected rename of the SAME number is exempted, not flagged as a rival claim',
    {
      entries: [{ filename: '040-order-time-fx-stamping-corrected-title.md' }],
      baselineFilenames: ['040-order-time-fx-stamping-against-a-system-reporting-currency.md'],
      renames: new Map([
        [
          '040-order-time-fx-stamping-corrected-title.md',
          '040-order-time-fx-stamping-against-a-system-reporting-currency.md',
        ],
      ]),
    },
  );

  failBaseline(
    'baseline: a rename map entry pointing at a DIFFERENT baseline file does not exempt a real collision',
    {
      entries: [{ filename: '039-second-claimant.md' }],
      baselineFilenames: ['039-order-analytics-read-model-persistence-strategy.md'],
      renames: new Map([['039-second-claimant.md', '038-some-other-unrelated-file.md']]),
    },
    'already claimed on origin/main',
  );

  // --- README index bijection (rule 5) ---

  const passReadme = (label, input) => {
    const { ok, violations } = validateReadmeIndex(input);
    if (!ok) {
      console.error(
        `self-check FAIL: "${label}" expected no violations, got:\n  ${violations.join('\n  ')}`,
      );
      process.exit(1);
    }
  };
  const failReadme = (label, input, expectedSubstring) => {
    const { ok, violations } = validateReadmeIndex(input);
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

  passReadme('readme: file and row agree', {
    fileNumbers: ['001', '002'],
    indexRows: [
      { headingNumber: '001', linkNumber: '001' },
      { headingNumber: '002', linkNumber: '002' },
    ],
  });

  failReadme(
    'readme: file with no index row',
    {
      fileNumbers: ['001', '002'],
      indexRows: [{ headingNumber: '001', linkNumber: '001' }],
    },
    'has no README index row',
  );

  failReadme(
    'readme: index row with no file',
    {
      fileNumbers: ['001'],
      indexRows: [
        { headingNumber: '001', linkNumber: '001' },
        { headingNumber: '002', linkNumber: '002' },
      ],
    },
    'no such file exists',
  );

  failReadme(
    'readme: row heading/link numbers disagree',
    {
      fileNumbers: ['001'],
      indexRows: [{ headingNumber: '001', linkNumber: '002' }],
    },
    'heading and link number disagree',
  );

  failReadme(
    'readme: two rows both (correctly) reference the same file — breaks the bijection',
    {
      fileNumbers: ['001'],
      indexRows: [
        { headingNumber: '001', linkNumber: '001' },
        { headingNumber: '001', linkNumber: '001' },
      ],
    },
    'has 2 rows referencing it',
  );

  // --- Missing-baseline action / error classification (shared with #1020) ---

  const expectAction = (label, input, expected) => {
    const got = resolveMissingBaselineAction(input);
    if (got !== expected) {
      console.error(`self-check FAIL: "${label}" expected '${expected}', got '${got}'`);
      process.exit(1);
    }
  };
  expectAction('missing baseline in CI → fail', { isCi: true }, 'fail');
  expectAction('missing baseline locally → skip', { isCi: false }, 'skip');

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

  console.log('adr-numbers: self-check OK');
}

if (process.argv.includes('--self-check')) {
  runSelfCheck();
} else {
  runAgainstTree();
}
