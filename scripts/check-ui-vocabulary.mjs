#!/usr/bin/env node
/**
 * check-ui-vocabulary
 *
 * Enforcement of design rule P9 — "no model-internal vocabulary in user-facing
 * copy" — which is aspirational until something fails the build on it (#2384).
 * The rule and its closed nine-term list are stated in
 *   docs/specs/product-spec-oms-wave2-operator-experience.md § 2.1
 * which names this script as its enforcement.
 *
 * TWO INDEPENDENT RULES, because neither alone is the invariant:
 *
 *   RULE A — MIRROR. `BANNED_TERMS` below must equal the fenced § 2.1 table,
 *     term for term AND match-mode for match-mode. Mirroring the term alone
 *     would let the spec say "case-insensitive word match" while the script
 *     quietly did `exact`: the lists would agree and the RULE would have
 *     drifted, which is the failure this gate exists to make impossible.
 *     The mirror is order-INDEPENDENT, deliberately unlike
 *     `check-authority-kind-mirror` — an `as const` array's order is
 *     load-bearing for a runtime vocabulary, whereas the numbering of a prose
 *     table is presentational, and failing a build because a doc table was
 *     alphabetised trains people to distrust the gate.
 *
 *   RULE B — SCAN. No banned term appears in operator-facing copy under the
 *     three Wave-2 feature folders: JSX text and user-facing JSX attribute
 *     values in `.tsx`, and every string literal in a `*.copy.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE DOES **NOT** CATCH. Read this before trusting it — an
 * overstated gate is worse than none, because reviewers stop reading copy when
 * they believe a script already did.
 *
 *   1. Only three folders. Copy in `pages/`, `shared/ui/`, or any other
 *      feature is unscanned. A Wave-2 surface that puts operator copy in a
 *      shared primitive escapes entirely.
 *   2. Only literal strings. A term assembled at runtime (`${noun} authority`,
 *      a concatenation, a value from a lookup keyed elsewhere) is invisible.
 *   3. Backend-sourced copy is out of reach. A message the API returns and the
 *      UI renders verbatim can carry any of the nine terms.
 *   4. Identifiers, comments, imports and non-user-facing props are
 *      deliberately unscanned. P9 bans the vocabulary from RENDERING, not from
 *      existing — § 2.1's own words are "the domain vocabulary stays in the
 *      code", so `authorityKind` as a variable is correct.
 *   5. It cannot judge permitted words. Whether "decided by" beats "owner" is a
 *      copy-review question. This proves only that nine words are absent.
 *   6. A multi-word alternate ("fulfillment work") is matched within one
 *      extracted string; JSX text is whitespace-normalised first so ordinary
 *      wrapping is handled, but a term split across two sibling JSX
 *      expressions is not.
 *
 * So § 2.1's acceptance line — "no banned vocabulary word appears in any
 * shipped string; the lint gate proves it" — is true for literal strings in the
 * three folders, and no wider.
 *
 * ---------------------------------------------------------------------------
 * "MATCHED NOTHING" — three zero-cases, only one of which is a pass. The repo
 * has been bitten by checks that pass because they matched nothing.
 *
 *   Z1  the fenced spec table parses to zero terms   -> FATAL
 *       (the parser or the fence broke; a gate with an empty deny-list cannot
 *        fire, and would then pass forever)
 *   Z2  a declared scan root does not exist          -> note, exit 0
 *       (all three today; the folders ship in later Wave-2 issues. This is the
 *        `check-authority-kind-mirror` PENDING_MIRRORS idiom, reused. Because
 *        an absent path is a PASS, a typo'd path would pass forever — so the
 *        PARENT directory is asserted, exactly as that script's #2441 S-6
 *        comment prescribes.)
 *   Z3  a scan root exists but yields zero files     -> FAIL
 *       (the extension logic or the walk broke; passing here is the trap)
 *
 * A stale or typo'd EXEMPTIONS path is the same hazard as Z2 and is guarded the
 * same way: an exemption whose scan root exists must name a file that exists.
 *
 * Note the script's own `BANNED_TERMS` and the fenced spec table both contain
 * all nine terms verbatim. Any future widening of SCAN_ROOTS must exclude this
 * file and that spec, or the gate self-matches.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import, no transpile, no
 * dependency) so this stays a zero-dependency `check:invariants` step like its
 * siblings.
 *
 * Usage:
 *   node scripts/check-ui-vocabulary.mjs
 *   node scripts/check-ui-vocabulary.mjs --self-check
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const SPEC_FILE = join('docs', 'specs', 'product-spec-oms-wave2-operator-experience.md');

/** The HTML-comment fence delimiting the § 2.1 table this script owns. */
const SPEC_FENCE_START = '<!-- ui-vocabulary:start -->';
const SPEC_FENCE_END = '<!-- ui-vocabulary:end -->';

const DOCS_REF = `${SPEC_FILE} § 2.1 (design rule P9)`;

/**
 * The closed banned list. CLOSED — nine terms, no "and other internal terms"
 * clause: a lint script cannot implement an open list, and an open list is how
 * a gate becomes advisory (§ 2.1).
 *
 * `mode`:
 *   'word'  — case-insensitive, whole-word.
 *   'exact' — case-sensitive substring. These are PascalCase / camelCase
 *             identifiers; a case-insensitive word match on
 *             `AvailabilityAuthority` would be redundant with `authority`.
 * `alternates` — additional spaced forms, matched case-sensitively as whole
 *             words so `ATP` does not fire on "adaptive".
 *
 * Adding a tenth term is an edit HERE and to the fenced § 2.1 table in the
 * same commit; Rule A fails until both sides agree.
 */
const BANNED_TERMS = [
  { term: 'authority', mode: 'word', alternates: [] },
  { term: 'posture', mode: 'word', alternates: [] },
  { term: 'FulfillmentWork', mode: 'exact', alternates: ['fulfillment work'] },
  { term: 'AvailabilityAuthority', mode: 'exact', alternates: [] },
  { term: 'atpEffect', mode: 'exact', alternates: ['ATP'] },
  { term: 'phase', mode: 'word', alternates: [] },
  { term: 'Orchestrator', mode: 'word', alternates: [] },
  { term: 'Gateway', mode: 'word', alternates: [] },
  { term: 'holder', mode: 'word', alternates: [] },
];

/**
 * The three Wave-2 feature folders § 2.1 scopes the ban to. `automation` is
 * SINGULAR even though its route is `/automations` (settled in #2364); the
 * other two slugs come from #2335 and #2364's sibling #2354 / #2364.
 *
 * Each names the issue that creates it, so the pending note is a declared gap
 * with a retirement plan rather than noise. Remove an entry's `pending` field
 * when its folder lands — Z3 then guarantees it is really being scanned.
 */
const SCAN_ROOTS = [
  {
    dir: join('apps', 'web', 'src', 'features', 'fulfillment-authority'),
    pending: 'W1c-8 (#2335)',
  },
  { dir: join('apps', 'web', 'src', 'features', 'automation'), pending: 'W2-17 (#2354)' },
  { dir: join('apps', 'web', 'src', 'features', 'returns'), pending: 'W2-27 (#2364)' },
];

/**
 * The directory every scan root must live under. Asserted so a typo in a slug
 * above is caught immediately instead of reading as a legitimately-pending
 * folder forever (the `check-authority-kind-mirror` #2441 S-6 guard).
 */
const SCAN_ROOT_PARENT = join('apps', 'web', 'src', 'features');

/**
 * Files permitted to contain a banned term, BY FILE with a reason — never by
 * pattern, and never by weakening a term's match mode (§ 2.1 / #2384 AC).
 *
 * Empty at ship time: none of the scan roots exists yet. Keep it that way where
 * possible — the fix for a hit is almost always the copy, which is the point.
 * An entry whose scan root exists must name a file that exists, or it is
 * reported: a typo'd exemption suppresses nothing while its author believes it
 * does, which is the same failure mode as a typo'd pending scan root.
 */
const EXEMPTIONS = new Map();

/**
 * JSX attributes whose string value is rendered to an operator. Scoped rather
 * than "every literal in a .tsx", because a .tsx also legitimately contains
 * `useQuery(['authority'])`, `className="authority-row"` and imports.
 */
const USER_FACING_ATTRIBUTES = new Set([
  'title',
  'label',
  'aria-label',
  'placeholder',
  'alt',
  'description',
  'heading',
  'caption',
  'hint',
  'emptyMessage',
  'errorMessage',
  'confirmLabel',
  'cancelLabel',
  'tooltip',
  'summary',
  'helperText',
]);

// ---------------------------------------------------------------------------
// Pure parsers + matchers (exported for --self-check)
// ---------------------------------------------------------------------------

/**
 * Parse the fenced § 2.1 table into `{ term, mode, alternates }` rows.
 *
 * The `Matched as` cell is prose, so it is read for STRUCTURAL SIGNALS only:
 * the mode word, and every quoted alternate. An editorial reword
 * ("case-insensitive word match" -> "case-insensitive whole-word match")
 * therefore still passes, while flipping the mode or dropping an alternate
 * fails. Parsing the cell verbatim would fail the build on doc copy-editing;
 * not parsing it at all would let the rule drift silently.
 *
 * Returns `{ line, rows }`, or `null` when the fence is absent or unclosed.
 */
export function parseSpecTable(content, fenceStart, fenceEnd) {
  const startIndex = content.indexOf(fenceStart);
  if (startIndex === -1) return null;
  const endIndex = content.indexOf(fenceEnd, startIndex);
  if (endIndex === -1) return null;

  const line = content.slice(0, startIndex).split('\n').length;
  const body = content.slice(startIndex + fenceStart.length, endIndex);

  const rows = [];
  for (const raw of body.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('|')) continue;
    // Leading and trailing pipes produce empty first/last cells; drop them.
    const cells = trimmed.split('|').slice(1, -1);
    if (cells.length < 3) continue;

    // A row counts only when its TERM cell is backticked — that skips the
    // header and the `|---|` separator without counting either.
    const termCell = cells[1].trim();
    const termMatch = /^`([^`]+)`$/.exec(termCell);
    if (!termMatch) continue;

    const modeCell = cells[2].trim();
    const mode = readMatchMode(modeCell);
    rows.push({ term: termMatch[1], mode, alternates: readAlternates(modeCell) });
  }

  return { line, rows };
}

/**
 * The mode word out of a `Matched as` cell. `null` when the cell names neither
 * — a FATAL, never a silent default: guessing here would make the mirror
 * meaningless in exactly the direction it exists to guard.
 */
export function readMatchMode(cell) {
  if (/case-insensitive/i.test(cell)) return 'word';
  if (/\bexact\b/i.test(cell)) return 'exact';
  return null;
}

/**
 * Every `"…"`-quoted alternate in a `Matched as` cell, tolerating typographic
 * quotes and the markdown emphasis the table wraps them in.
 */
export function readAlternates(cell) {
  const out = [];
  const re = /["“”]([^"“”]+)["“”]/g;
  let m;
  while ((m = re.exec(cell)) !== null) out.push(m[1]);
  return out;
}

/**
 * Pure differ over the script's list and the spec's, keyed by term and
 * order-independent. Returns `{ ok, issues }`.
 */
export function diffBannedTerms(script, spec) {
  const issues = [];

  const scriptByTerm = new Map(script.map((r) => [r.term, r]));
  const specByTerm = new Map(spec.map((r) => [r.term, r]));

  const missingInSpec = script.filter((r) => !specByTerm.has(r.term)).map((r) => r.term);
  const missingInScript = spec.filter((r) => !scriptByTerm.has(r.term)).map((r) => r.term);

  if (missingInSpec.length > 0) {
    issues.push(
      `in the script but MISSING from the spec table: ${missingInSpec.map((t) => `'${t}'`).join(', ')}`,
    );
  }
  if (missingInScript.length > 0) {
    issues.push(
      `in the spec table but MISSING from the script: ${missingInScript
        .map((t) => `'${t}'`)
        .join(', ')}`,
    );
  }

  for (const row of script) {
    const specRow = specByTerm.get(row.term);
    if (!specRow) continue;
    if (specRow.mode === null) {
      issues.push(
        `'${row.term}': the spec's "Matched as" cell names neither 'case-insensitive' nor ` +
          `'exact', so its match mode cannot be read`,
      );
      continue;
    }
    if (specRow.mode !== row.mode) {
      issues.push(
        `'${row.term}'.mode: the script says '${row.mode}', the spec table says '${specRow.mode}'`,
      );
    }
    const a = [...row.alternates].sort().join('|');
    const b = [...specRow.alternates].sort().join('|');
    if (a !== b) {
      issues.push(
        `'${row.term}'.alternates: the script says [${row.alternates.join(', ')}], ` +
          `the spec table says [${specRow.alternates.join(', ')}]`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Blank out line and block comments so a comment can never be read as copy.
 *
 * Two properties are load-bearing, and a naive regex pair gets both wrong:
 *
 *   1. LINE COUNT IS PRESERVED. Comment bodies are replaced with spaces and
 *      their newlines kept, so every reported `file:line` still points at the
 *      real line. A regex that deletes a block comment collapses the line count,
 *      and since every file here carries a header docblock, the reported line
 *      would be wrong essentially always.
 *   2. IT IS STRING-AWARE. `'https://x.com/authority'` contains `//`. A regex
 *      stripper truncates it into an unterminated literal, the string extractor
 *      then fails to match it, and the string vanishes from the scan — a SILENT
 *      LOSS OF COVERAGE, which is the exact failure this gate exists to prevent.
 *
 * So this walks the character stream tracking string/template/comment state
 * rather than pattern-matching. Escapes are honoured; `${…}` inside a template
 * is left as-is (the extractor splits on it separately).
 */
export function stripComments(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      // Skip the whole literal so its contents can never be read as a comment.
      for (let j = i + 1; j < source.length; j += 1) {
        if (source[j] === '\\') {
          j += 1;
          continue;
        }
        // An unterminated single/double-quoted literal ends at the newline.
        if (ch !== '`' && source[j] === '\n') {
          i = j - 1;
          break;
        }
        if (source[j] === ch) {
          i = j;
          break;
        }
        if (j === source.length - 1) i = j;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end - 1;
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end - 1;
    }
  }

  return out.join('');
}

/**
 * Every string literal in a `*.copy.ts`, with its 1-based line. The file's
 * whole purpose is operator copy, so the rule is "all of it" — simpler and
 * stricter than any partial parse. Template literals contribute their static
 * chunks; an interpolated value is out of reach either way (coverage note 2).
 */
export function extractCopyStrings(source) {
  const content = stripComments(source);
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    const line = content.slice(0, m.index).split('\n').length;
    if (m[3] !== undefined) {
      // Template: keep only the static chunks between ${…} holes.
      for (const chunk of raw.split(/\$\{[^}]*\}/)) {
        if (chunk.trim()) out.push({ text: chunk, line });
      }
      continue;
    }
    if (raw.trim()) out.push({ text: raw, line });
  }
  return out;
}

/**
 * Operator-facing strings in a `.tsx`: JSX text nodes, plus string values of
 * the `USER_FACING_ATTRIBUTES` allow-list.
 *
 * JSX text is whitespace-normalised so a multi-word alternate survives the line
 * wrapping JSX text routinely carries. Anything else in the file — identifiers,
 * query keys, class names, imports — is deliberately NOT extracted (coverage
 * note 4).
 */
export function extractTsxStrings(source, attributes = USER_FACING_ATTRIBUTES) {
  const content = stripComments(source);
  const out = [];

  // JSX text: between a tag close `>` and the next tag open `<`, with no
  // brace (which would make it an expression container, not literal text).
  const textRe = />([^<>{}]+)</g;
  let m;
  while ((m = textRe.exec(content)) !== null) {
    const text = m[1].replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // Require at least one letter, so `>{' '}<`-ish punctuation is skipped.
    if (!/[A-Za-z]/.test(text)) continue;
    const line = content.slice(0, m.index).split('\n').length;
    out.push({ text, line });
  }

  // Allow-listed attribute values. The attribute NAME is not scanned — only
  // its value — so `placeholder="Search"` contributes "Search" and nothing else.
  const attrRe = /([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((m = attrRe.exec(content)) !== null) {
    if (!attributes.has(m[1])) continue;
    const text = (m[2] ?? m[3] ?? '').trim();
    if (!text) continue;
    const line = content.slice(0, m.index).split('\n').length;
    out.push({ text, line });
  }

  return out;
}

/** Does one banned-term row match this text? Returns the matched form, or null. */
export function matchBannedTerm(text, row) {
  if (row.mode === 'word') {
    if (new RegExp(`\\b${escapeRegExp(row.term)}\\b`, 'i').test(text)) return row.term;
  } else if (text.includes(row.term)) {
    return row.term;
  }
  for (const alt of row.alternates) {
    // Alternates are case-SENSITIVE whole-word: `ATP` must not fire on
    // "adaptive" or on the lowercase English "atp".
    if (new RegExp(`\\b${escapeRegExp(alt)}\\b`).test(text)) return alt;
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * All findings for a set of extracted strings. Each is
 * `{ line, term, matched, mode, text }`.
 */
export function findBannedTerms(strings, terms = BANNED_TERMS) {
  const out = [];
  for (const { text, line } of strings) {
    for (const row of terms) {
      const matched = matchBannedTerm(text, row);
      if (matched) out.push({ line, term: row.term, matched, mode: row.mode, text });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await walk(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

function isScannable(path) {
  return path.endsWith('.tsx') || path.endsWith('.copy.ts');
}

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function isDirectory(path) {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

async function main() {
  const failures = [];
  const pendingNotes = [];

  // --- RULE A: mirror -------------------------------------------------------
  const specContent = await readFile(join(repoRoot, SPEC_FILE), 'utf8');
  const spec = parseSpecTable(specContent, SPEC_FENCE_START, SPEC_FENCE_END);

  // Z1 — an unparseable or empty table is FATAL: a gate with an empty
  // deny-list cannot fire, and would pass forever.
  if (!spec || spec.rows.length === 0) {
    console.error('✗ check-ui-vocabulary: could not read the banned-term table.\n');
    console.error(
      `    ${SPEC_FILE}: no table rows found between ${SPEC_FENCE_START} and ${SPEC_FENCE_END}`,
    );
    console.error(`\n    docs: ${DOCS_REF}\n`);
    process.exit(1);
  }

  const mirror = diffBannedTerms(BANNED_TERMS, spec.rows);
  if (!mirror.ok) {
    failures.push({
      rule: 'the script’s BANNED_TERMS must equal the fenced § 2.1 table, term and match mode',
      locations: [
        'scripts/check-ui-vocabulary.mjs  (BANNED_TERMS)',
        `${SPEC_FILE}:${spec.line}  (fenced table, authoritative)`,
      ],
      issues: mirror.issues,
    });
  }

  // --- RULE B: scan ---------------------------------------------------------
  const parentExists = await isDirectory(join(repoRoot, SCAN_ROOT_PARENT));
  let scannedFiles = 0;
  const liveRoots = [];

  for (const root of SCAN_ROOTS) {
    const abs = join(repoRoot, root.dir);
    if (!(await isDirectory(abs))) {
      // Z2 — absent root is a PASS, so a typo would pass forever. Assert the
      // parent to catch a misspelt slug while still allowing the folder itself
      // to be legitimately absent.
      if (!parentExists) {
        failures.push({
          rule: "a pending scan root's parent directory must exist (a typo here would pass forever)",
          locations: [`${root.dir}  (declared scan root, pending ${root.pending})`],
          issues: [
            `the parent directory '${SCAN_ROOT_PARENT}' does not exist, so this path can never ` +
              'resolve — fix the declared path, or remove the entry',
          ],
        });
      }
      pendingNotes.push(`${root.dir} (pending ${root.pending})`);
      continue;
    }

    liveRoots.push(root);
    const files = (await walk(abs)).filter(isScannable);

    // Z3 — the root exists but nothing matched. The walk or the extension
    // logic broke; passing here is the silent-nothing trap this gate is
    // supposed to be immune to.
    if (files.length === 0) {
      failures.push({
        rule: 'a scan root that exists must contain at least one .tsx or *.copy.ts file',
        locations: [`${root.dir}  (scan root)`],
        issues: [
          'the directory exists but no scannable file was found, so this root is being checked ' +
            'vacuously — verify the folder layout, or remove the root if the feature moved',
        ],
      });
      continue;
    }

    for (const file of files) {
      const rel = relative(repoRoot, file);
      if (EXEMPTIONS.has(rel)) continue;
      scannedFiles += 1;
      const source = await readFile(file, 'utf8');
      const strings = rel.endsWith('.copy.ts')
        ? extractCopyStrings(source)
        : extractTsxStrings(source);
      const findings = findBannedTerms(strings, BANNED_TERMS);
      if (findings.length === 0) continue;
      failures.push({
        rule: 'no banned § 2.1 term may appear in operator-facing copy',
        locations: [`${rel}  (${findings.length} finding(s))`],
        issues: findings.map(
          ({ line, term, matched, mode }) =>
            `${rel}:${line} — '${matched}' (banned term '${term}', ${mode} match)`,
        ),
      });
    }
  }

  // A stale or typo'd exemption suppresses nothing while its author believes
  // it does — the Z2 hazard one level down. Only checkable once the root exists.
  for (const [rel, reason] of EXEMPTIONS) {
    // Path-segment match, never a bare prefix: `features/returns` must not
    // claim an exemption under `features/returns-archive`.
    const root = liveRoots.find((r) => rel.startsWith(`${r.dir}${sep}`));
    if (!root) continue;
    if (await exists(join(repoRoot, rel))) continue;
    failures.push({
      rule: 'every exemption must name a file that exists (a typo silently exempts nothing)',
      locations: [`${rel}  (exemption: ${reason})`],
      issues: ['the exempted file does not exist — fix the path, or drop the exemption'],
    });
  }

  if (failures.length === 0) {
    console.log(
      `✓ check-ui-vocabulary: ${BANNED_TERMS.length} banned term(s) identical in the script and ` +
        `the fenced table in ${SPEC_FILE}; ${scannedFiles} file(s) scanned across ` +
        `${liveRoots.length} of ${SCAN_ROOTS.length} feature folder(s).`,
    );
    if (pendingNotes.length > 0) {
      console.log(`  pending scan roots (declared, not yet present): ${pendingNotes.join(', ')}`);
    }
    process.exit(0);
  }

  console.error(`✗ check-ui-vocabulary: ${failures.length} violation(s).\n`);
  for (const { rule, locations, issues } of failures) {
    for (const location of locations) console.error(`    ${location}`);
    console.error(`      rule: ${rule}`);
    for (const issue of issues) console.error(`        - ${issue}`);
    console.error('');
  }
  if (pendingNotes.length > 0) {
    console.error(`    pending scan roots (declared, not yet present): ${pendingNotes.join(', ')}`);
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Self-check — the pure parsers, matchers and differ against synthetic inputs
// (no filesystem), INCLUDING deliberately drifted fixtures that must fail.
// This is the standing guarantee for AC-1, not the one-off manual test.
// ---------------------------------------------------------------------------

function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const table = (rows) =>
    `intro\n\n${SPEC_FENCE_START}\n\n| # | Banned term | Matched as |\n|---|---|---|\n${rows}\n\n${SPEC_FENCE_END}\n| 9 | \`outside\` | exact |\n`;

  const nineRows = BANNED_TERMS.map((r, i) => {
    const alts = r.alternates.map((a) => `, and the spaced form *"${a}"*`).join('');
    const mode = r.mode === 'word' ? 'case-insensitive word match' : 'exact';
    return `| ${i + 1} | \`${r.term}\` | ${mode}${alts} |`;
  }).join('\n');

  // --- parser: the fenced table ---------------------------------------------
  const parsed = parseSpecTable(table(nineRows), SPEC_FENCE_START, SPEC_FENCE_END);
  expect('parses every fenced row, skipping header + separator', parsed?.rows.length, 9);
  expect(
    'ignores a table row outside the fence',
    parsed?.rows.some((r) => r.term === 'outside'),
    false,
  );
  expect(
    'reads the mode word',
    parsed?.rows.map((r) => r.mode).join(','),
    BANNED_TERMS.map((r) => r.mode).join(','),
  );
  expect(
    'reads quoted alternates out of the prose cell',
    parsed?.rows.flatMap((r) => r.alternates).join(','),
    'fulfillment work,ATP',
  );
  expect('reports the fence line', parsed?.line, 3);
  expect('absent fence → null', parseSpecTable('no fence', SPEC_FENCE_START, SPEC_FENCE_END), null);
  expect(
    'unclosed fence → null',
    parseSpecTable(`${SPEC_FENCE_START}\n| 1 | \`x\` | exact |\n`, SPEC_FENCE_START, SPEC_FENCE_END),
    null,
  );
  // Z1 — an empty fenced table parses to zero rows (main() treats this as FATAL).
  expect('empty fenced table → zero rows, never a pass', parseSpecTable(table(''), SPEC_FENCE_START, SPEC_FENCE_END)?.rows.length, 0);

  // --- differ: agreement, then every drift shape ----------------------------
  expect('script and spec agree → ok', diffBannedTerms(BANNED_TERMS, parsed.rows).ok, true);
  expect(
    'reordered spec table → still ok (order is presentational here)',
    diffBannedTerms(BANNED_TERMS, [...parsed.rows].reverse()).ok,
    true,
  );
  // An editorial reword of the mode cell must NOT fail the build.
  const reworded = parseSpecTable(
    table(nineRows).replace(/case-insensitive word match/g, 'case-insensitive whole-word match'),
    SPEC_FENCE_START,
    SPEC_FENCE_END,
  );
  expect('editorial reword of the mode cell → still ok', diffBannedTerms(BANNED_TERMS, reworded.rows).ok, true);

  // Deliberately drifted fixtures: each MUST fail.
  expect(
    'term dropped from the spec → not ok',
    diffBannedTerms(BANNED_TERMS, parsed.rows.filter((r) => r.term !== 'posture')).ok,
    false,
  );
  expect(
    'term added to the spec → not ok',
    diffBannedTerms(BANNED_TERMS, [...parsed.rows, { term: 'tenth', mode: 'word', alternates: [] }])
      .ok,
    false,
  );
  const modeFlipped = parseSpecTable(
    table(nineRows).replace('| 4 | `AvailabilityAuthority` | exact |', '| 4 | `AvailabilityAuthority` | case-insensitive word match |'),
    SPEC_FENCE_START,
    SPEC_FENCE_END,
  );
  expect('mode flipped in the spec → not ok', diffBannedTerms(BANNED_TERMS, modeFlipped.rows).ok, false);
  const altDropped = parseSpecTable(
    table(nineRows).replace(', and the spaced form *"ATP"*', ''),
    SPEC_FENCE_START,
    SPEC_FENCE_END,
  );
  expect('alternate dropped from the spec → not ok', diffBannedTerms(BANNED_TERMS, altDropped.rows).ok, false);
  expect(
    'unreadable mode cell → not ok, never a silent default',
    diffBannedTerms(
      [{ term: 'authority', mode: 'word', alternates: [] }],
      [{ term: 'authority', mode: readMatchMode('matched somehow'), alternates: [] }],
    ).ok,
    false,
  );

  // --- extraction: .tsx ------------------------------------------------------
  const tsx =
    "import { authorityKind } from '../lib/authority-kind';\n" +
    '// a comment mentioning authority\n' +
    'export function Panel() {\n' +
    "  const q = useQuery(['authority', id]);\n" +
    '  return (\n' +
    '    <div className="authority-row">\n' +
    '      <input placeholder="Search orders" />\n' +
    '      <p>Who decides what happens next</p>\n' +
    '    </div>\n' +
    '  );\n' +
    '}\n';
  expect(
    'ignores imports, comments, query keys and className',
    findBannedTerms(extractTsxStrings(tsx)).length,
    0,
  );
  expect(
    "'holder' must NOT match the placeholder attribute name",
    findBannedTerms([{ text: 'placeholder', line: 1 }]).length,
    0,
  );
  expect(
    'flags a banned term in JSX text (AC-1, standing)',
    findBannedTerms(extractTsxStrings('<p>who has authority here</p>'))[0]?.matched,
    'authority',
  );
  expect(
    'flags a banned term in an allow-listed attribute value',
    findBannedTerms(extractTsxStrings('<Card title="Availability authority" />'))[0]?.matched,
    'authority',
  );
  expect(
    'normalises wrapped JSX text so a spaced alternate survives',
    findBannedTerms(extractTsxStrings('<p>the fulfillment\n      work queue</p>'))[0]?.matched,
    'fulfillment work',
  );

  // --- extraction: *.copy.ts -------------------------------------------------
  const copy =
    '// header comment about phase\n' +
    'export const RETURNS_COPY = {\n' +
    "  title: 'What happens to returned goods',\n" +
    "  hint: 'Nothing happens until you fix this',\n" +
    '};\n';
  expect('a clean copy module yields no findings', findBannedTerms(extractCopyStrings(copy)).length, 0);

  // --- comment stripping: the two defects it must not reintroduce -----------
  // A block comment must PRESERVE line count, or every reported file:line is
  // wrong — and every file in this repo carries a header docblock.
  const withHeader =
    '/**\n * Header\n * spanning lines\n */\n' + 'export const C = {\n' + "  a: 'the current phase',\n" + '};\n';
  expect(
    'a multi-line block comment does not shift reported line numbers',
    findBannedTerms(extractCopyStrings(withHeader))[0]?.line,
    6,
  );
  expect(
    'stripComments preserves the total line count',
    stripComments(withHeader).split('\n').length,
    withHeader.split('\n').length,
  );
  // A `//` INSIDE a string must not be treated as a comment, or the literal is
  // truncated, fails to re-match, and vanishes from the scan — a silent loss of
  // coverage, which is worse than a false positive.
  expect(
    'a URL inside a copy string is still scanned (not eaten as a comment)',
    findBannedTerms(extractCopyStrings("export const C = { a: 'See https://x.com/authority here' };"))[0]
      ?.matched,
    'authority',
  );
  expect(
    'a banned term inside a real comment is still ignored',
    findBannedTerms(extractCopyStrings("// the authority decides\nexport const C = { a: 'ok' };")).length,
    0,
  );
  expect(
    'flags a banned term in any copy-module literal',
    findBannedTerms(extractCopyStrings("export const C = { a: 'the current phase' };"))[0]?.matched,
    'phase',
  );
  expect(
    'reads the static chunks of a template literal',
    findBannedTerms(extractCopyStrings('export const C = `the ${x} gateway is down`;'))[0]?.matched,
    'Gateway',
  );

  // --- match modes -----------------------------------------------------------
  expect(
    "'ATP' is case-sensitive whole-word — 'adaptive' must not fire",
    findBannedTerms([{ text: 'an adaptive layout', line: 1 }]).length,
    0,
  );
  expect(
    "'ATP' is case-sensitive — lowercase 'atp' must not fire",
    findBannedTerms([{ text: 'the atp value', line: 1 }]).length,
    0,
  );
  expect(
    "'ATP' fires as a whole word",
    findBannedTerms([{ text: 'ATP is 4', line: 1 }])[0]?.matched,
    'ATP',
  );
  expect(
    "'authority' is case-insensitive",
    findBannedTerms([{ text: 'AUTHORITY', line: 1 }])[0]?.matched,
    'authority',
  );
  expect(
    "'authority' is whole-word — 'authoritative' must not fire",
    findBannedTerms([{ text: 'an authoritative answer', line: 1 }]).length,
    0,
  );

  // --- declared structure ----------------------------------------------------
  expect('the banned list is closed at nine terms', BANNED_TERMS.length, 9);
  expect(
    'every scan root names its owning issue',
    SCAN_ROOTS.every((r) => typeof r.pending === 'string' && r.pending.length > 0),
    true,
  );
  expect(
    'every exemption is a file→reason pair with a non-empty reason',
    [...EXEMPTIONS.values()].every((reason) => typeof reason === 'string' && reason.trim().length > 0),
    true,
  );
  expect(
    'every scan root lives under the asserted parent',
    SCAN_ROOTS.every((r) => r.dir.startsWith(SCAN_ROOT_PARENT)),
    true,
  );

  if (failures.length > 0) {
    console.error('✗ check-ui-vocabulary --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-ui-vocabulary --self-check: parsers, matchers + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  // Explicit fatal handler, matching the sibling checks. A bare top-level
  // `await main()` surfaces a rename of the spec file as a raw
  // unhandled-rejection stack instead of one actionable line.
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-ui-vocabulary: fatal error:', err);
    process.exit(1);
  });
}
