#!/usr/bin/env node
/**
 * Stylesheet Structure Guard (#2674)
 *
 * Fails `pnpm lint` if any stylesheet in the working tree is structurally
 * damaged: an unclosed block, a stray `}`, an unclosed `(`, a stray `)`, an
 * unclosed comment, or an unterminated string.
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
 * ## Parenthesis balance (#2677)
 *
 * A dropped `)` in `@media (min-width: 700px {` survives a merge resolution,
 * leaves braces perfectly balanced, and silently kills the block - structurally
 * the same defect class as the dropped `}`. Parentheses are tracked on their own
 * stack, through the same comment/string precedence, and every unclosed `(` is
 * reported at its opener, outermost first, like an unclosed block.
 *
 * Two kinds of `(` are not syntax and must not count, or the check would fire
 * on correct files: a paren inside a string (handled by the string state), and
 * a paren inside an UNQUOTED `url(...)`, which CSS reads as one token up to the
 * first `)` - so that state also stops `/*` and `//` inside a data URI being
 * read as comments. Code-level escapes (`.w-\(10\)`, `.a\{`) are skipped for
 * the same reason; before #2677 an escaped brace was miscounted as a block.
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
 * The mirror hazard on the SCSS side - an *unquoted*
 * `url(data:image/png;base64,...)` containing `//`, since `/` is in the base64
 * alphabet - is closed by the url-token state (#2677): the contents of an
 * unquoted `url(...)` are consumed as one token before any comment rule runs,
 * exactly as CSS tokenises them.
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
  'unclosed-paren':
    '`(` opened here is never closed. Braces can still balance, so the stylesheet parses and the ' +
    'enclosing rule (e.g. a whole `@media` block) silently stops applying.',
  'unexpected-paren-close': 'stray `)` with no matching `(`.',
});

/**
 * Whether `char` can be part of a CSS identifier, i.e. whether a `url` ending
 * just before it is really the tail of a longer name (`my-url(`) rather than
 * the `url(` token. Escapes and non-ASCII are identifier characters in CSS.
 */
function isIdentChar(char) {
  return char !== undefined && (/[A-Za-z0-9_\-\\]/.test(char) || char >= '\u0080');
}

/**
 * Whether the `(` at `index` opens an UNQUOTED url token.
 *
 * Only the unquoted form needs special treatment. In `url('a(1).png')` the
 * argument is an ordinary string, so the string state already hides its parens
 * and the `(`/`)` pair around it balances like any function call. In
 * `url(a(1.png)` there is no string: CSS tokenises everything up to the first
 * `)` as one url token, in which `(`, quotes and `/*` are all plain content.
 * Reading that `(` as syntax would report a phantom unclosed paren, and reading
 * the `/*` as a comment would swallow the rest of the file.
 */
function opensUnquotedUrl(source, index) {
  if (source.slice(index - 3, index).toLowerCase() !== 'url') return false;
  if (isIdentChar(source[index - 4])) return false;
  let j = index + 1;
  while (j < source.length && /[ \t\n\r\f]/.test(source[j])) j += 1;
  return source[j] !== '"' && source[j] !== "'";
}

/**
 * Every structural defect in a stylesheet source, plus the number of blocks and
 * parenthesised groups seen - all from ONE pass.
 *
 * Pure - the whole detection lives here so `--self-check` can exercise it
 * without touching the filesystem. One single pass, holding exactly one state:
 * code / comment / line comment / single- or double-quoted string / unquoted
 * url token.
 *
 * Braces and parentheses are tracked on two independent stacks. They are not
 * cross-checked against each other (`@media (x { }` is reported as the
 * unclosed `(`, not as a brace inside a paren), because the opener of the
 * unclosed one is the location that names the defect either way.
 *
 * The counts ride along deliberately. A separate counter would have to
 * re-implement this same comment/string/escape precedence to know which `{`
 * and `(` are real, i.e. a second copy of the one rule this file exists to get
 * right, kept in step by nothing. Since the counts are already in hand here,
 * returning them costs nothing and removes the possibility of drift rather than
 * warning against it.
 *
 * @param {string} source
 * @param {{ allowLineComments?: boolean }} [options]
 * @returns {{
 *   defects: { kind: string, line: number, column: number }[],
 *   blockCount: number,
 *   parenCount: number,
 * }}
 */
export function scan(source, options = {}) {
  const allowLineComments = options.allowLineComments === true;
  const defects = [];
  /** Open braces awaiting a match, outermost first. */
  const openBlocks = [];
  /** Open parentheses awaiting a match, outermost first. */
  const openParens = [];
  let blockCount = 0;
  let parenCount = 0;

  let state = 'code'; // 'code' | 'comment' | 'lineComment' | 'string' | 'url'
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
        defects.push({ kind: 'unterminated-string', ...(openedAt ?? { line, column }) });
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

    if (state === 'url') {
      if (char === '\\' && i + 1 < source.length) {
        advance(char);
        advance(next);
        i += 2;
        continue;
      }
      if (char === ')') {
        state = 'code';
        openedAt = null;
        advance(char);
        i += 1;
        continue;
      }
      if (char === '\n') {
        // An unquoted url token cannot span lines in practice. Report at the
        // `url(` and recover at the line break, the unterminated-string rule,
        // rather than consuming up to some unrelated `)` many lines below.
        defects.push({ kind: 'unclosed-paren', ...(openedAt ?? { line, column }) });
        state = 'code';
        openedAt = null;
      }
      advance(char);
      i += 1;
      continue;
    }

    // state === 'code'
    // An escape makes the next character part of an identifier, so `.w-\(10\)`
    // and `.a\{` contain no syntax at all.
    if (char === '\\' && i + 1 < source.length) {
      advance(char);
      advance(next);
      i += 2;
      continue;
    }
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
    if (char === '(') {
      parenCount += 1;
      if (opensUnquotedUrl(source, i)) {
        state = 'url';
        openedAt = { line, column };
      } else {
        openParens.push({ line, column });
      }
      advance(char);
      i += 1;
      continue;
    }
    if (char === ')') {
      if (openParens.length === 0) {
        defects.push({ kind: 'unexpected-paren-close', line, column });
      } else {
        openParens.pop();
      }
      advance(char);
      i += 1;
      continue;
    }
    advance(char);
    i += 1;
  }

  // `openedAt` is set on every transition into `comment`/`string`/`url` and cleared on
  // every exit, so it is non-null here by construction. The fallback is not
  // defensive noise: without it, a future path into either state that forgot the
  // assignment would report `path:undefined:undefined` - a location worse than
  // none, in the one field this guard is judged on.
  if (state === 'comment') {
    defects.push({ kind: 'unclosed-comment', ...(openedAt ?? { line, column }) });
  }
  if (state === 'string') {
    defects.push({ kind: 'unterminated-string', ...(openedAt ?? { line, column }) });
  }
  // Outermost first: the earliest divergence is where the file went wrong, and
  // every location after it is a consequence. `openBlocks` is already in that
  // order.
  for (const open of openBlocks) {
    defects.push({ kind: 'unclosed-block', ...open });
  }
  for (const open of openParens) {
    defects.push({ kind: 'unclosed-paren', ...open });
  }
  // A url token is entered only from code, so every paren still on the stack
  // opened before it: it is the innermost and goes last.
  if (state === 'url') {
    defects.push({ kind: 'unclosed-paren', ...(openedAt ?? { line, column }) });
  }

  return { defects, blockCount, parenCount };
}

/**
 * Defects only. This exists for `--self-check`, whose assertion table compares
 * defect arrays and would otherwise repeat `.defects` on every row; `main()`
 * calls `scan` directly because it needs the block count too. No production
 * caller - do not go looking for one.
 *
 * @param {string} source
 * @param {{ allowLineComments?: boolean }} [options]
 * @returns {{ kind: string, line: number, column: number }[]}
 */
export function scanCssStructure(source, options = {}) {
  return scan(source, options).defects;
}

/**
 * The defects to PRINT, in file order, with every defect KIND guaranteed a slot.
 *
 * Two separate requirements, and file order alone satisfies only one of them.
 *
 * `scan` appends unclosed blocks after the encounter-ordered defects (its
 * contract is outermost-first, which the self-check pins). That is right for the
 * scanner and wrong for a capped report: a file with more than
 * `MAX_DEFECTS_PER_FILE` stray `}` truncates away every `unclosed-block` - the
 * defect this guard exists for - on exactly the duplicated-chunk merge shape
 * that motivated #2674. So the guard would have been least useful on its own
 * motivating input.
 *
 * Sorting into file order does NOT fix that by itself: in that same shape the
 * stray closes occupy the early lines and the unclosed block is last, so it
 * falls off the end again. The cap must therefore reserve a slot for the first
 * occurrence of each kind, then spend what is left on file order. A cap that can
 * silently drop a whole defect class is worse than no cap - it reports
 * confidently and omits the line that mattered.
 *
 * Lives in the reporter, not in `scan`, so the pure function's contract is
 * untouched.
 */
export function selectForReport(defects, max = MAX_DEFECTS_PER_FILE) {
  const inFileOrder = [...defects].sort((a, b) => a.line - b.line || a.column - b.column);
  if (inFileOrder.length <= max) return inFileOrder;

  const chosen = new Set();
  const kindsSeen = new Set();
  for (const defect of inFileOrder) {
    if (!kindsSeen.has(defect.kind)) {
      kindsSeen.add(defect.kind);
      chosen.add(defect);
    }
  }
  for (const defect of inFileOrder) {
    if (chosen.size >= max) break;
    chosen.add(defect);
  }
  return inFileOrder.filter((defect) => chosen.has(defect));
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
  let parens = 0;

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
        const { defects, blockCount, parenCount } = scan(source, options);
        parsed += 1;
        blocks += blockCount;
        parens += parenCount;
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

  // Backstop only, and unreachable today: every selected file either parses or
  // lands in `unreadable`, and the check above already exited. The property
  // "the success line never overstates coverage" is enforced THERE, by treating
  // an unreadable file as fatal. Kept because it costs nothing and would catch a
  // future third outcome, but it is not the mechanism - saying otherwise would
  // be the reported-versus-enforced gap this guard exists to close.
  if (parsed !== files.length) {
    fail([
      `parsed ${parsed} of ${files.length} stylesheets - refusing to report success over a gap.`,
    ]);
  }

  // The counters are floored for the same reason `files.length` is: REQUIRED_STYLESHEETS
  // guarantees index.css is in the corpus, and it carries thousands of blocks and
  // var(...) groups, so a zero here means a detector matched nothing (e.g. an
  // over-eager url() token swallowing every `(`), not a healthy tree.
  if (blocks === 0 || parens === 0) {
    fail([
      `scanned ${blocks} blocks and ${parens} parenthesised groups - a detector matched nothing.`,
      '  A healthy tree has both in the thousands. Fix the scanner, do not lower this floor.',
    ]);
  }

  if (violations.length > 0) {
    console.error('✗ check-css-structure: structurally damaged stylesheet(s).\n');
    for (const { file, defects } of violations.sort((a, b) => a.file.localeCompare(b.file))) {
      const shown = selectForReport(defects);
      for (const defect of shown) {
        console.error(
          `  ${file}:${defect.line}:${defect.column} — ${DEFECT_DETAIL[defect.kind] ?? defect.kind}`
        );
      }
      if (defects.length > shown.length) {
        console.error(`  ${file}: … and ${defects.length - shown.length} more.`);
      }
    }
    console.error('');
    process.exit(1);
  }

  console.log(
    `✓ check-css-structure: ${parsed} stylesheet(s) parse cleanly ` +
      `(${blocks} blocks, ${parens} parenthesised groups balanced).`
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

  // `//` is NOT a comment in CSS. Both directions asserted on a `//` outside any
  // url token, so the gate itself is what is being tested.
  expect('bare // in .css → no defects', '.a { x: a//b; }', [], { allowLineComments: false });
  expect(
    'same source read as SCSS → the // swallows the closing brace',
    '.a { x: a//b; }',
    ['unclosed-block@1:4'],
    { allowLineComments: true }
  );
  expect(
    'protocol URL in .css → no defects',
    '.a { background: url(https://x/y.png); }',
    [],
    { allowLineComments: false }
  );
  // Before #2677 this read the `//` as a comment and reported a phantom
  // unclosed block; the unquoted url token now wins, as in real CSS tokenising.
  expect(
    'protocol URL read as SCSS → the url token wins over //',
    '.a { background: url(https://x/y.png); }',
    [],
    { allowLineComments: true }
  );
  expect('scss line comment → no defects', '// note {\n.a { }\n', [], { allowLineComments: true });

  // Multi-line location accuracy.
  expect('defect on line 3 → line 3', '.a { }\n.b { }\n.c {\n', ['unclosed-block@3:4']);

  // Parenthesis balance (#2677). The motivating shape: braces balance, the file
  // parses, and the whole @media block is silently dead.
  expect(
    'dropped ) in @media → unclosed-paren at the opener, braces still balanced',
    '@media (min-width: 700px {\n  .thing { color: red; }\n}\n',
    ['unclosed-paren@1:8']
  );
  expect('balanced nested parens → no defects', '.a { width: calc((1px + 2px) * 3); }', []);
  expect('stray ) → unexpected-paren-close', '.a { width: calc(1px + 2px)); }', [
    'unexpected-paren-close@1:28',
  ]);
  expect('two unclosed parens → both, outermost first', '.a:is(.b:not(.c { }', [
    'unclosed-paren@1:6',
    'unclosed-paren@1:13',
  ]);
  expect('dropped ) on line 2 → line 2', '.a { }\n@media (x {\n.b { }\n}\n', [
    'unclosed-paren@2:8',
  ]);

  // Parentheses that are not syntax must not count.
  expect('paren inside a string → no defects', '.a { content: "("; }', []);
  expect('close paren inside a string → no defects', ".a { content: ')'; }", []);
  expect('paren inside a comment → no defects', '/* ( */ .a { }', []);
  expect('quoted url with parens → no defects', ".a { background: url('a(1).png'); }", []);
  expect('unquoted url with a paren → no defects', '.a { background: url(a(1.png); }', []);
  expect(
    'unquoted url containing /* → not a comment',
    '.a { background: url(data:x/*y); }',
    []
  );
  expect('URL() is case-insensitive', '.a { background: URL(a(b.png); }', []);
  expect(
    'unquoted url never closed on its line → unclosed-paren at url(, then recovery',
    '.a { background: url(a.png;\n}\n',
    ['unclosed-paren@1:21']
  );
  // `url(` inside an identifier is not the url token.
  expect('my-url( is an ordinary function', '.a { x: my-url((1)); }', []);
  expect('escaped paren in a selector → no defects', '.w-\\(10\\) { }', []);
  expect('escaped brace in a selector → no defects', '.a\\{ { }', []);

  // Report ordering: the cap must never truncate away a whole defect class.
  // 25 stray closes then one unclosed block is the duplicated-chunk merge shape.
  {
    let src = '';
    for (let n = 0; n < 25; n += 1) src += '}\n';
    src += '.dropped-brace {\n  color: red;\n';
    const all = scan(src, {}).defects;
    const shown = selectForReport(all);
    if (!shown.some((d) => d.kind === 'unclosed-block')) {
      failures.push(
        '  selectForReport: the unclosed-block must survive the report cap (it is the point of the guard)'
      );
    }
    for (const kind of new Set(all.map((d) => d.kind))) {
      if (!shown.some((d) => d.kind === kind)) {
        failures.push(`  selectForReport: kind '${kind}' was truncated away entirely`);
      }
    }
    const lines = shown.map((d) => d.line);
    if (lines.some((l, idx) => idx > 0 && l < lines[idx - 1])) {
      failures.push('  selectForReport: defects must be reported in file order');
    }
    if (shown.length > MAX_DEFECTS_PER_FILE) {
      failures.push('  selectForReport: must respect the cap');
    }
  }

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
  if (scan('@media (x) { .a:not(.b) { width: calc((1px)); } }', {}).parenCount !== 4) {
    failures.push('  parenCount: expected 4 parenthesised groups');
  }
  // The url token counts as ONE group; the `(` inside it does not count at all.
  if (scan('.a { content: "(("; background: url(a(b.png); }', {}).parenCount !== 1) {
    failures.push('  parenCount: parens in strings and unquoted url() must not be counted');
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
  console.log(
    '✓ check-css-structure --self-check: scanner, locator, paren balance + comment/string/url precedence behave.'
  );
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
