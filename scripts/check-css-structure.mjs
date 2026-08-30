#!/usr/bin/env node
/**
 * Stylesheet Structure Guard (#2674)
 *
 * Fails `pnpm lint` if any stylesheet in the working tree is structurally
 * damaged: an unclosed block, a stray `}`, an unclosed comment, or an
 * unterminated string.
 *
 * Why this exists: nothing in the pipeline parses `apps/web/src/index.css`.
 * ESLint does not look at CSS, Vitest does not evaluate it, and `tsc` has no
 * view of it. A merge conflict resolution dropped the closing brace of
 * `.stock-at-risk-callout__items` and the result passed `pnpm lint`,
 * `pnpm type-check`, 4142 `apps/web` tests and 130 integration suites. A
 * defect of the same shape had already shipped in the preceding merge commit.
 *
 * A missing closing brace is worse than a syntax error, because it is not an
 * error at all: under CSS nesting it silently re-scopes every following rule
 * as a descendant of the unclosed selector. The stylesheet still loads, the
 * build still succeeds, and an arbitrary number of later rules simply stop
 * applying. Class-presence assertions (the `who-decides-styles.test.ts` shape)
 * cannot catch it either - they assert a class *appears* in the file, and after
 * a dropped brace it still does.
 *
 * ## Two rules that are not obvious, and that the self-check pins
 *
 * **1. Comments take precedence over strings, not the other way round.** Inside
 * a comment nothing else is special; inside a string, `/*` opens nothing. Get
 * this backwards and the apostrophe in a comment like `the badge's own tone
 * dot` opens a single-quoted string that never closes, every subsequent brace
 * is read as string content, and the guard reports the whole 21k-line file as
 * unbalanced - a false positive on the exact file it exists to protect, which
 * would be diagnosed as "the new check is broken" and disabled. There are 7+
 * such apostrophes in `index.css` today.
 *
 * **2. An empty corpus is fatal, and so is a file that could not be read.** A
 * guard that finds no subject must fail loudly rather than report green over
 * nothing (#2673: a mirror keyed on a declaration name that was renamed, where
 * "not found" and "pending" were indistinguishable, so it passed over a live
 * divergence). `check-nul-bytes.mjs` may skip an unreadable file because a
 * missed file there means one missed NUL byte; here a skipped file means the
 * subject went unchecked while the success line still claimed it. So a read
 * failure exits non-zero naming the file, and the success line reports files
 * *actually parsed*, asserted equal to the corpus size before it is printed.
 *
 * ## Deliberately NOT checked: parenthesis balance
 *
 * A dropped `)` in `@media (min-width: 700px {` survives a merge resolution,
 * leaves braces perfectly balanced, and silently kills the block - structurally
 * the same defect class this guard exists to catch. It is omitted because it is
 * outside #2674's three stated criteria and because a guard that grows a second
 * detector during implementation is harder to review than the one that was
 * scoped. Considered and deferred, not overlooked - tracked as #2677; both
 * stylesheets are paren-balanced today, so it can be added there red-first with
 * no live false positive.
 *
 * Run with `--self-check` to exercise the pure scanner against synthetic
 * sources, so a refactor of the detection itself cannot silently pass.
 *
 * Wired into `pnpm lint` via the root `check:invariants` chain.
 *
 * @module scripts
 * @see scripts/check-nul-bytes.mjs - the walk + self-check shape this follows
 * @see scripts/check-design-tokens.mjs - the other `index.css` reader (regex, non-structural)
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Extensions treated as stylesheets.
 *
 * `.sass` is matched for completeness but note that the indentation-based
 * syntax has no braces at all, so a brace-balance scan over one is trivially
 * green. Matching it is harmless; it must not be read as coverage.
 */
const STYLESHEET_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);

/**
 * `//` is a line comment in SCSS/Sass/Less and is NOT one in CSS.
 *
 * Applying it to `.css` is a false-positive generator: `url(https://x/y.woff2)`
 * would be read as commented from `//` to end of line, swallowing any `}` later
 * on that line. There are no `//` sequences in either stylesheet today, which is
 * precisely why the hazard would land silently - the day someone adds a Google
 * Font URL to `.design-sync/fonts.css`.
 *
 * The mirror hazard exists on the SCSS side and is left standing: an *unquoted*
 * `url(data:image/png;base64,...)` can contain `//`, since `/` is in the base64
 * alphabet, so in a `.scss`/`.less` file it would comment out the rest of that
 * line and can swallow a `}`. Quoting the URL avoids it (string state wins), and
 * no data URI exists in the corpus today. If a phantom `unclosed-block` ever
 * appears in a preprocessor file, look here first.
 */
function allowsLineComments(ext) {
  return ext !== '.css' && STYLESHEET_EXTENSIONS.has(ext);
}

/**
 * Stylesheets that MUST be present in the corpus.
 *
 * The empty-corpus check alone is not enough: if `index.css` moved or its
 * extension changed, the walk would still find `.design-sync/fonts.css` and
 * report a cheerful green over the file this guard was written for.
 */
const REQUIRED_STYLESHEETS = ['apps/web/src/index.css'];

/**
 * Directories skipped during the walk.
 *
 * The walk is filesystem-based rather than git-based for the reason
 * `check-nul-bytes.mjs` and `check-repo-urls.mjs` document at the same spot:
 * the CI runner that invokes `pnpm lint` has no `git` on its PATH, so a
 * `git ls-files` version of this guard passes locally and dies with
 * `spawn git ENOENT` in CI. A pure-fs walk behaves identically in both.
 */
const SKIP_DIRS = new Set([
  '.git',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.vite',
  '.turbo',
  '.cache',
  '.pnpm-store',
  '.husky',
]);

/** Read at most this many files concurrently, to bound open descriptors. */
const READ_CONCURRENCY = 32;

/** At most this many defects reported per file, so the actionable first one is not buried. */
const MAX_DEFECTS_PER_FILE = 20;

/** The closed vocabulary of structural defects. */
const DEFECT_DETAIL = Object.freeze({
  'unclosed-block':
    'block opened here is never closed. Under CSS nesting this does not error - it silently ' +
    're-scopes every following rule as a descendant of this selector.',
  'unexpected-close': 'stray `}` with no matching open block.',
  'unclosed-comment': 'comment opened here is never closed, swallowing the rest of the file.',
  'unterminated-string': 'string opened here is never closed on its line.',
});

/**
 * Every structural defect in a stylesheet source, plus the number of blocks
 * seen - both from ONE pass.
 *
 * Pure - the whole detection lives here so `--self-check` can exercise it
 * without touching the filesystem. One single pass, holding exactly one state:
 * code / comment / line comment / single- or double-quoted string.
 *
 * The block count rides along deliberately. A separate counter would have to
 * re-implement this same comment/string/escape precedence to know which `{`
 * are real, i.e. a second copy of the one rule this file exists to get right,
 * kept in step by nothing. Since the count is already in hand here, returning
 * it costs nothing and removes the possibility of drift rather than warning
 * against it.
 *
 * @param {string} source
 * @param {{ allowLineComments?: boolean }} [options]
 * @returns {{ defects: { kind: string, line: number, column: number }[], blockCount: number }}
 */
export function scan(source, options = {}) {
  const allowLineComments = options.allowLineComments === true;
  const defects = [];
  /** Open braces awaiting a match, outermost first. */
  const openBlocks = [];
  let blockCount = 0;

  let state = 'code'; // 'code' | 'comment' | 'lineComment' | 'string'
  let quote = '';
  let openedAt = null; // where the current comment/string began
  let line = 1;
  let column = 1;
  let i = 0;

  const advance = (char) => {
    if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        openedAt = null;
        advance(char);
        advance(next);
        i += 2;
        continue;
      }
      advance(char);
      i += 1;
      continue;
    }

    if (state === 'lineComment') {
      if (char === '\n') {
        state = 'code';
        openedAt = null;
      }
      advance(char);
      i += 1;
      continue;
    }

    if (state === 'string') {
      // A backslash before a newline is a legal line continuation and keeps the
      // string open; before anything else it escapes that character.
      if (char === '\\' && i + 1 < source.length) {
        advance(char);
        advance(next);
        i += 2;
        continue;
      }
      if (char === '\n') {
        // CSS strings do not span raw newlines. Report and recover at the line
        // break rather than swallowing the rest of the file.
        defects.push({ kind: 'unterminated-string', ...openedAt });
        state = 'code';
        openedAt = null;
        advance(char);
        i += 1;
        continue;
      }
      if (char === quote) {
        state = 'code';
        openedAt = null;
      }
      advance(char);
      i += 1;
      continue;
    }

    // state === 'code'
    if (char === '/' && next === '*') {
      state = 'comment';
      openedAt = { line, column };
      advance(char);
      advance(next);
      i += 2;
      continue;
    }
    if (allowLineComments && char === '/' && next === '/') {
      state = 'lineComment';
      openedAt = { line, column };
      advance(char);
      advance(next);
      i += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      state = 'string';
      quote = char;
      openedAt = { line, column };
      advance(char);
      i += 1;
      continue;
    }
    if (char === '{') {
      openBlocks.push({ line, column });
      blockCount += 1;
      advance(char);
      i += 1;
      continue;
    }
    if (char === '}') {
      if (openBlocks.length === 0) {
        defects.push({ kind: 'unexpected-close', line, column });
      } else {
        openBlocks.pop();
      }
      advance(char);
      i += 1;
      continue;
    }
    advance(char);
    i += 1;
  }

  if (state === 'comment') {
    defects.push({ kind: 'unclosed-comment', ...openedAt });
  }
  if (state === 'string') {
    defects.push({ kind: 'unterminated-string', ...openedAt });
  }
  // Outermost first: the earliest divergence is where the file went wrong, and
  // every location after it is a consequence. `openBlocks` is already in that
  // order.
  for (const open of openBlocks) {
    defects.push({ kind: 'unclosed-block', ...open });
  }

  return { defects, blockCount };
}

/**
 * Defects only - the shape `--self-check` asserts against.
 *
 * @param {string} source
 * @param {{ allowLineComments?: boolean }} [options]
 * @returns {{ kind: string, line: number, column: number }[]}
 */
export function scanCssStructure(source, options = {}) {
  return scan(source, options).defects;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(abs);
    } else if (entry.isFile() && STYLESHEET_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      yield abs;
    }
  }
}

async function stylesheetFiles() {
  const files = [];
  for await (const abs of walk(ROOT)) {
    files.push(relative(ROOT, abs).split(sep).join('/'));
  }
  return files.sort();
}

function fail(lines) {
  console.error(`✗ check-css-structure: ${lines[0]}\n`);
  for (const line of lines.slice(1)) console.error(line);
  console.error('');
  process.exit(1);
}

async function main() {
  const files = await stylesheetFiles();

  // A guard with no subject is not a passing guard.
  if (files.length === 0) {
    fail([
      'no stylesheets found - the guard is not guarding anything.',
      `  Walked ${ROOT} for ${[...STYLESHEET_EXTENSIONS].join(', ')} and matched nothing.`,
      '  Either the extension set or SKIP_DIRS stopped matching. Fix the walk, do not silence this.',
    ]);
  }

  const missing = REQUIRED_STYLESHEETS.filter((required) => !files.includes(required));
  if (missing.length > 0) {
    fail([
      'a stylesheet this guard is required to cover is not in the corpus.',
      ...missing.map((m) => `  ${m} - not found by the walk.`),
      '  If it moved, update REQUIRED_STYLESHEETS. Do not delete the assertion:',
      '  without it a moved file reads as green because the other stylesheets still parse.',
    ]);
  }

  const violations = [];
  const unreadable = [];
  let parsed = 0;
  let blocks = 0;

  for (let start = 0; start < files.length; start += READ_CONCURRENCY) {
    const batch = files.slice(start, start + READ_CONCURRENCY);
    await Promise.all(
      batch.map(async (file) => {
        let source;
        try {
          source = await readFile(resolve(ROOT, file), 'utf8');
        } catch (err) {
          // Deliberately NOT the silent skip `check-nul-bytes.mjs` uses: a file
          // the walk selected but never parsed would leave the success line
          // claiming coverage the guard does not have.
          unreadable.push({ file, message: err instanceof Error ? err.message : String(err) });
          return;
        }
        const options = { allowLineComments: allowsLineComments(extname(file).toLowerCase()) };
        const { defects, blockCount } = scan(source, options);
        parsed += 1;
        blocks += blockCount;
        if (defects.length > 0) violations.push({ file, defects });
      })
    );
  }

  if (unreadable.length > 0) {
    fail([
      'a stylesheet in the corpus could not be read, so it went unchecked.',
      ...unreadable.map((u) => `  ${u.file} - ${u.message}`),
    ]);
  }

  // The success line is a verified claim, not an assumption.
  if (parsed !== files.length) {
    fail([
      `parsed ${parsed} of ${files.length} stylesheets - refusing to report success over a gap.`,
    ]);
  }

  if (violations.length > 0) {
    console.error('✗ check-css-structure: structurally damaged stylesheet(s).\n');
    for (const { file, defects } of violations.sort((a, b) => a.file.localeCompare(b.file))) {
      for (const defect of defects.slice(0, MAX_DEFECTS_PER_FILE)) {
        console.error(
          `  ${file}:${defect.line}:${defect.column} — ${DEFECT_DETAIL[defect.kind] ?? defect.kind}`
        );
      }
      if (defects.length > MAX_DEFECTS_PER_FILE) {
        console.error(`  ${file}: … and ${defects.length - MAX_DEFECTS_PER_FILE} more.`);
      }
    }
    console.error('');
    process.exit(1);
  }

  console.log(
    `✓ check-css-structure: ${parsed} stylesheet(s) parse cleanly (${blocks} blocks balanced).`
  );
}

function selfCheck() {
  const failures = [];
  const project = (defects) => defects.map((d) => `${d.kind}@${d.line}:${d.column}`);
  const expect = (label, source, expected, options) => {
    const actual = project(scanCssStructure(source, options));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };

  // Well-formed input.
  expect('balanced rule → no defects', '.a { color: red; }', []);
  expect('nested at-rule → no defects', '@media (x) { .a { } }', []);
  expect('empty source → no defects', '', []);

  // Each defect kind.
  expect('dropped closing brace → unclosed-block at the opener', '.a { color: red;', [
    'unclosed-block@1:4',
  ]);
  expect('stray close → unexpected-close', '.a { } }', ['unexpected-close@1:8']);
  expect('unclosed comment → reported at the opener', '/* unclosed', ['unclosed-comment@1:1']);
  // Recovery matters: the string is closed at the line break, so the `}` on the
  // next line still closes the block. Swallowing the rest of the file instead
  // would turn one unterminated string into a cascade of phantom defects.
  expect('newline inside string → unterminated-string, then recovery', '.a { content: "oops\n}', [
    'unterminated-string@1:15',
  ]);
  expect('unterminated string at EOF → still reported', '.a { content: "oops', [
    'unterminated-string@1:15',
    'unclosed-block@1:4',
  ]);

  // Every unclosed block is reported, outermost first - the earliest divergence
  // is the useful one; the innermost is a consequence of it.
  expect('two unclosed blocks → both, outermost first', '.a { .b { ', [
    'unclosed-block@1:4',
    'unclosed-block@1:9',
  ]);
  expect('unclosed at-rule → the at-rule brace', '@media (x) { .a { }', ['unclosed-block@1:12']);

  // Comment precedence over strings - the false positive that would have
  // condemned the whole of index.css.
  expect("apostrophe in comment → no defects", "/* it doesn't { */ .a { }", []);
  expect('brace inside a comment → no defects', '/* } } } */ .a { }', []);

  // String precedence over comments and braces.
  expect('brace inside a string → no defects', '.a { content: "}"; }', []);
  expect('comment opener inside a string → no defects', '.a { content: "/*"; }', []);
  expect('escaped quote inside a string → no defects', '.a { content: "\\""; }', []);
  expect('single-quoted string → no defects', ".a { content: '}'; }", []);
  expect('backslash line continuation keeps the string open', '.a { content: "a\\\nb"; }', []);

  // `//` is NOT a comment in CSS. Both directions asserted, because the gating
  // is what stops `url(https://…)` swallowing a following `}`.
  expect(
    'protocol URL in .css → no defects',
    '.a { background: url(https://x/y.png); }',
    [],
    { allowLineComments: false }
  );
  expect(
    'same source read as SCSS → the // swallows the closing braces',
    '.a { background: url(https://x/y.png); }',
    ['unclosed-block@1:4'],
    { allowLineComments: true }
  );
  expect('scss line comment → no defects', '// note {\n.a { }\n', [], { allowLineComments: true });

  // Multi-line location accuracy.
  expect('defect on line 3 → line 3', '.a { }\n.b { }\n.c {\n', ['unclosed-block@3:4']);

  // The measured figure in the success line, from the same single pass.
  if (scan('.a { } .b { }', {}).blockCount !== 2) {
    failures.push('  blockCount: expected 2 blocks');
  }
  if (scan('/* { { */ .a { }', {}).blockCount !== 1) {
    failures.push('  blockCount: braces in comments must not be counted');
  }
  if (scan('.a { content: "{ {"; }', {}).blockCount !== 1) {
    failures.push('  blockCount: braces in strings must not be counted');
  }

  // The extension gate itself.
  if (allowsLineComments('.css') !== false) failures.push('  .css must not allow // comments');
  if (allowsLineComments('.scss') !== true) failures.push('  .scss must allow // comments');
  if (allowsLineComments('.less') !== true) failures.push('  .less must allow // comments');

  if (failures.length > 0) {
    console.error('✗ check-css-structure --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-css-structure --self-check: scanner, locator + comment/string precedence behave.');
  process.exit(0);
}

// Only act when run as a script. `scan` / `scanCssStructure` are exported, so
// the module invites `import` - and without this guard an import would silently
// run the whole filesystem walk and could `process.exit(1)` out of the
// importing process with no diagnosable cause. (`import.meta.main` would say
// this more directly but is Node 24+; the repo floor is Node 22.)
const isEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    Promise.resolve(main()).catch((err) => {
      console.error('✗ check-css-structure: fatal error:', err);
      process.exit(1);
    });
  }
}
