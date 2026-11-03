#!/usr/bin/env node
/**
 * check-toast-assertions.mjs
 *
 * Lint-time invariant for #3295: a test must not assert toast copy through a
 * bare `screen.findByText` / `getByText` / `queryByText`.
 *
 * ## Why
 *
 * `@radix-ui/react-toast` renders every toast TWICE — once visibly in the
 * Viewport, and once in a hidden `[role="status"]` announce portal for screen
 * readers (`ToastAnnounce`, @radix-ui/react-toast/dist/index.mjs). The portal
 * mounts a moment after the toast and un-mounts about a second later, so a
 * bare text query can land while BOTH copies carry the identical text and
 * throw "Found multiple elements" — intermittently, only under load, which is
 * exactly what made #3295 hard to reproduce on an idle machine.
 *
 * `apps/web/src/test/test-utils.tsx` ships four helpers for precisely this —
 * `findToastTitle` / `getToastTitle` / `findToastDescription` /
 * `getToastDescription` — which scope the query to `.toast__title` /
 * `.toast__description` and so never see the announce duplicate. This guard
 * makes forgetting them a build failure instead of a flake discovered on CI.
 *
 * A GLOBAL fix (excluding `[role="status"]` from Testing Library's
 * `defaultIgnore`, so the unsafe call becomes structurally impossible) was
 * tried and reverted: `role="status"` is reused throughout this codebase for
 * ordinary loading/notice/hint regions unrelated to toasts (grep the app —
 * dozens of hits), and excluding it broke a dozen unrelated test files whose
 * assertions target THOSE regions. Radix's announce span carries no
 * distinguishing selector of its own (a plain `VisuallyHidden` `<span
 * role="status">`), so there is nothing narrower to exclude. Hence a static
 * check on the TEST SOURCE rather than a DOM-query-time fix.
 *
 * ## What this checks
 *
 * For every `*.tsx` component that calls `showToast({...})`, this extracts
 * the PLAIN STRING `title:` / `description:` literals passed to it. For its
 * paired `*.test.tsx` file, it then flags a bare `screen.findByText(...)` /
 * `getByText(...)` / `queryByText(...)` call whose argument is a plain string
 * literal EXACTLY equal to one of those toast literals.
 *
 * ## Deliberate scope limits — stated so a false "clean" reading is never assumed
 *
 *   - Only PLAIN STRING literals are compared, on both sides. A toast built
 *     from a template literal (`` `Kept ${n} of ${m}` ``) is not extracted,
 *     and a query using a REGEX literal (`/Kept 1, but 1 failed/`) is not
 *     inspected — matching a regex against a template's static fragments
 *     reliably, without inventing new false positives (a short, unrelated
 *     button label can legitimately be a substring of an unrelated toast
 *     sentence — this was tried and produced exactly that noise), needs more
 *     than a textual scan can safely promise. Every real #3295-shaped
 *     violation found in this repo used a plain string on both sides; this is
 *     the scope that catches them without inventing new failures.
 *   - `{ selector: ... }` on the query is trusted as already-scoped and never
 *     flagged, whatever its value.
 *   - The pairing is BY PATH (`x.tsx` -> `x.test.tsx`, `x.tsx` -> a colocated
 *     `x.test.tsx`, if present). A toast asserted from an unrelated test file
 *     (rendering the component indirectly through a parent) is not checked.
 *   - Comments are NOT stripped before scanning `showToast` blocks — a
 *     commented-out `title: '...'` inside one is (rarely) extracted as a
 *     literal. Accepted: worst case is a false positive on dead code, not a
 *     missed real toast.
 *
 * Usage:
 *   node scripts/check-toast-assertions.mjs --self-check
 *   node scripts/check-toast-assertions.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = 'apps/web/src';

// A whole single- or double-quoted string literal, as ONE unit with no
// internal capturing group — a backreference-based `(['"])...\1` fragment
// cannot be safely re-embedded into a larger regex, because the group
// numbering it depends on shifts with whatever precedes it there.
const QUOTED_STRING_SRC = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;

/** Strip the surrounding quotes and unescape `\'`/`\"`/`\\` inside them. */
function unquote(raw) {
  const quote = raw[0];
  const inner = raw.slice(1, -1);
  return inner.replace(new RegExp(`\\\\(${quote}|\\\\)`, 'g'), '$1');
}

/**
 * Every plain-string `title:` / `description:` literal found strictly inside
 * `showToast({ ... })` call bodies (brace-matched, so a literal elsewhere in
 * the file with the same key name — e.g. a job-type option's own
 * `description` — is never picked up).
 */
export function extractShowToastLiterals(content) {
  const values = new Set();
  const callRe = /showToast\(\s*\{/g;
  let m;
  while ((m = callRe.exec(content)) !== null) {
    const start = m.index + m[0].length - 1; // position of the opening '{'
    let depth = 0;
    let i = start;
    for (; i < content.length; i += 1) {
      if (content[i] === '{') depth += 1;
      else if (content[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const block = content.slice(start, i + 1);
    const litRe = new RegExp(`(?:title|description)\\s*:\\s*(${QUOTED_STRING_SRC})`, 'g');
    let lm;
    while ((lm = litRe.exec(block)) !== null) {
      const value = unquote(lm[1]);
      if (value.trim().length > 0) values.add(value);
    }
  }
  return values;
}

/**
 * Every bare `screen.(findByText|getByText|queryByText)('...')` /
 * `("...")` call with no `{ selector: ... }` second argument — regex-literal
 * and template-literal arguments are skipped (see docblock scope limits).
 */
export function extractBareTextQueries(content) {
  const results = [];
  const re = new RegExp(
    `screen\\.(findByText|getByText|queryByText)\\(\\s*(${QUOTED_STRING_SRC})\\s*(,\\s*\\{[^}]*\\})?\\s*\\)`,
    'g',
  );
  let m;
  while ((m = re.exec(content)) !== null) {
    const trailingArg = m[3];
    if (trailingArg) continue; // already carries an options object — trust it as scoped
    const line = content.slice(0, m.index).split('\n').length;
    results.push({ line, method: m[1], text: unquote(m[2]) });
  }
  return results;
}

/** Pure differ: which bare queries in `testContent` assert `sourceContent`'s toast copy. */
export function findToastAssertionViolations(sourceContent, testContent) {
  const literals = extractShowToastLiterals(sourceContent);
  if (literals.size === 0) return [];
  return extractBareTextQueries(testContent).filter((q) => literals.has(q.text));
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      yield full;
    }
  }
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    const a = JSON.stringify(actual);
    const w = JSON.stringify(wanted);
    if (a !== w) failures.push(`  - ${label}: expected ${w}, got ${a}`);
  };

  // --- extractShowToastLiterals
  expect(
    'collects title + description from a showToast block',
    [...extractShowToastLiterals("showToast({ tone: 'success', title: 'Saved', description: 'All good.' });")].sort(),
    ['All good.', 'Saved'],
  );
  expect(
    'ignores a description key OUTSIDE any showToast(...) call',
    [...extractShowToastLiterals("const opt = { description: 'Enumerate and sync every product.' };")],
    [],
  );
  expect(
    'ignores a template-literal title (out of scope — see docblock)',
    [...extractShowToastLiterals('showToast({ title: `Turned on for ${n} sources` });')],
    [],
  );
  expect(
    'stops at the matching closing brace, not a later one',
    [...extractShowToastLiterals("showToast({ description: 'First' }); showToast({ description: 'Second' });")].sort(),
    ['First', 'Second'],
  );

  // --- extractBareTextQueries
  expect(
    'flags a bare findByText with a plain string',
    extractBareTextQueries("await screen.findByText('Connection created');").map((q) => q.text),
    ['Connection created'],
  );
  expect(
    'does not flag a query carrying a selector option',
    extractBareTextQueries("screen.findByText('Connection created', { selector: '.toast__title' });"),
    [],
  );
  expect(
    'does not flag a regex-literal argument (out of scope — see docblock)',
    extractBareTextQueries('screen.findByText(/Connection created/);'),
    [],
  );
  expect(
    'reports the correct line number',
    extractBareTextQueries("const a = 1;\nscreen.getByText('Connection created');").map((q) => q.line),
    [2],
  );

  // --- findToastAssertionViolations (the real gate)
  expect(
    'flags the known #3295 shape: bare query text === a showToast literal',
    findToastAssertionViolations(
      "showToast({ title: 'Connection created', description: `PrestaShop connection created.` });",
      "expect(await screen.findByText('Connection created')).toBeInTheDocument();",
    ).map((v) => v.text),
    ['Connection created'],
  );
  expect(
    'passes when the same text is asserted through the scoped helper',
    findToastAssertionViolations(
      "showToast({ title: 'Connection created' });",
      "expect(await findToastTitle('Connection created')).toBeInTheDocument();",
    ),
    [],
  );
  expect(
    'does not flag an unrelated bare query in a file that also renders a toast',
    findToastAssertionViolations(
      "showToast({ title: 'Connection created' });",
      "expect(await screen.findByText('Ergonomic Office Chair')).toBeInTheDocument();",
    ),
    [],
  );
  expect(
    'does not flag when the source has no showToast call at all',
    findToastAssertionViolations(
      "return <p>Connection created</p>;",
      "expect(await screen.findByText('Connection created')).toBeInTheDocument();",
    ),
    [],
  );

  if (failures.length > 0) {
    console.error('check-toast-assertions SELF-CHECK FAILED:');
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log('check-toast-assertions self-check OK (12 assertions)');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const scanDir = join(repoRoot, SCAN_ROOT);
  let scanned = 0;
  let sourcesWithToasts = 0;

  for await (const file of walk(scanDir)) {
    scanned += 1;
    const sourceContent = await readFile(file, 'utf8');
    if (!sourceContent.includes('showToast(')) continue;
    sourcesWithToasts += 1;

    const testFile = file.slice(0, -'.tsx'.length) + '.test.tsx';
    let testContent;
    try {
      testContent = await readFile(testFile, 'utf8');
    } catch {
      continue; // no colocated test — nothing to check
    }

    const violations = findToastAssertionViolations(sourceContent, testContent);
    for (const v of violations) {
      const relTest = relative(repoRoot, testFile);
      problems.push(
        `${relTest}:${v.line} — screen.${v.method}('${v.text}') asserts toast copy through a bare ` +
          "query. Use findToastTitle / getToastTitle / findToastDescription / getToastDescription " +
          "from 'apps/web/src/test/test-utils.tsx' instead — the visible copy and Radix's hidden " +
          'screen-reader announce duplicate race, and only the scoped helpers see just the visible one (#3295).',
      );
    }
  }

  // A scan that found no toast-triggering component at all is a moved
  // directory or a broken extractor, not a clean repo — ToastProvider has
  // dozens of `showToast(` call sites today.
  if (sourcesWithToasts === 0) {
    console.error(
      `check-toast-assertions: found 0 files calling showToast(...) under ${SCAN_ROOT} — did the ` +
        'toast provider move, or did the scan break? Refusing to report a pass over an empty scan.',
    );
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error('check-toast-assertions FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `check-toast-assertions OK (${String(scanned)} files scanned, ${String(sourcesWithToasts)} ` +
      'render a toast, no bare-query assertion found)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
