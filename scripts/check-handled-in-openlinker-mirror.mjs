#!/usr/bin/env node
/**
 * check-handled-in-openlinker-mirror.mjs
 *
 * Lint-time invariant for the two hand-maintained frontend mirrors #3482 adds
 * (an order OpenLinker handles itself, on /orders).
 *
 * Pair 1 - WAITING REASONS. `WaitingFulfillmentBlockReasonValues` in
 *   libs/core/src/fulfillment/domain/types/fulfillment-block-reason.types.ts  (backend, authoritative)
 * and
 *   apps/web/src/features/orders/api/orders.types.ts                          (frontend mirror)
 * must hold the same literals in the same order, AND
 * `orders.handledInOpenLinker.waitingReasons` (apps/web/src/locales/en/orders.json)
 * must carry exactly one entry per reason. The backend counts and filters "waiting in OpenLinker" with this list;
 * the frontend badges a row with the copy. A reason added on one side only would
 * be counted but never badged, or badged but never counted.
 *
 * Pair 2 - PACKING STAGES. `OrderWorkStageValues` in
 *   libs/core/src/fulfillment/domain/types/order-work-summary.types.ts
 * and the same name in orders.types.ts, plus
 * `orders.handledInOpenLinker.workStages` in en/orders.json. A stage
 * added in core only renders nothing on the frontend (safe, but silent).
 *
 * SCOPE: arrays and object keys, compared TEXTUALLY - nothing about wording or
 * whether a surface renders a value. The parsers are COPIED from
 * `check-destination-routing-reason-mirror.mjs` (with its #3002 comment-order
 * fix); importing would run that guard's `main()` as a side effect.
 *
 * Pair 3 - HEALTH FIXTURES. `ORDER_HEALTH_FIXTURES` in
 *   libs/core/src/orders/testing/order-health.fixtures.ts
 * (the table the SQL integration spec seeds) and the FE mirror table in
 *   apps/web/src/features/orders/lib/order-health.test.ts
 * must carry the same rows - same `name`, same `expected` bucket, same order. The
 * health `synced` rule is written twice (TypeScript and SQL) and a textual guard
 * cannot prove they agree about meaning; the shared table does, but only while
 * both copies stay equal, which this check enforces.
 *
 * Run with `--self-check` to exercise the differ against synthetic inputs.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const FRONTEND_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'orders.types.ts');
const COPY_FILE = join('apps', 'web', 'src', 'locales', 'en', 'orders.json');
const HEALTH_FIXTURES_CORE_FILE = join('libs', 'core', 'src', 'orders', 'testing', 'order-health.fixtures.ts');
const HEALTH_FIXTURES_FE_FILE = join('apps', 'web', 'src', 'features', 'orders', 'lib', 'order-health.test.ts');
const DOCS_REF = 'docs/plans/implementation-plan-orders-handled-in-openlinker-2.md';

/**
 * The keys of the copy object at `path` in a locale JSON file, with the 1-based
 * line its first key sits on. `null` when the path is absent or not an object.
 * COPIED from `check-destination-routing-reason-mirror.mjs` (see above).
 */
export function readJsonCopyKeys(src, path) {
  let node = JSON.parse(src);
  for (const segment of path) {
    if (node === null || typeof node !== 'object' || !(segment in node)) return null;
    node = node[segment];
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null;
  const keys = Object.keys(node);
  const first = keys.length > 0 ? src.indexOf(`"${keys[0]}"`) : -1;
  const line = first < 0 ? 1 : src.slice(0, first).split('\n').length;
  return { line, keys };
}

const PAIRS = [
  {
    label: 'waiting reasons',
    backendFile: join('libs', 'core', 'src', 'fulfillment', 'domain', 'types', 'fulfillment-block-reason.types.ts'),
    declaration: 'WaitingFulfillmentBlockReasonValues',
    copyPath: ['handledInOpenLinker', 'waitingReasons'],
  },
  {
    label: 'packing stages',
    backendFile: join('libs', 'core', 'src', 'fulfillment', 'domain', 'types', 'order-work-summary.types.ts'),
    declaration: 'OrderWorkStageValues',
    copyPath: ['handledInOpenLinker', 'workStages'],
  },
];

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 *
 * DIVERGENCE from the `check-sales-document-reason-mirror.mjs` original, found
 * by this guard failing on its own first real run: that version locates the
 * closing `]` in the RAW source and strips comments only afterwards, so a `]`
 * inside a per-entry docblock ends the scan early and the array reads as EMPTY
 * — which surfaces as "every value is missing from core", not as a parse error.
 * The core union here documents `destinationConnectionIds: []` on one of its
 * members, so the original would have under-read it silently the moment that
 * comparison stopped being trivially unequal.
 *
 * Comments are therefore blanked to EQUAL-LENGTH whitespace before the bracket
 * is located, which keeps every offset — and so the reported line number —
 * identical to the raw source. Blanking is safe for a value array (kebab-case
 * literals); copy is read from the locale JSON, so no prose ever reaches this parser.
 *
 * The sibling carries the same latent weakness and is left alone: it passes on
 * its current inputs, and editing a shipped invariant to fix a bug it does not
 * yet have is a change with risk and no payoff.
 */
function parseReasonValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const blank = (match) => ' '.repeat(match.length);
  const scrubbed = content
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = scrubbed.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = scrubbed.slice(openBracket + 1, closeBracket);

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, values };
}

/** Index of the closing quote of the string literal starting at `start`. */
function findStringEnd(content, start) {
  const quote = content[start];
  for (let i = start + 1; i < content.length; i += 1) {
    if (content[i] === '\\') {
      i += 1;
      continue;
    }
    if (content[i] === quote) return i;
  }
  return -1;
}

/**
 * Compare the two arrays. Order-sensitive; see the header for why that is a
 * deliberate strengthening rather than a semantic claim.
 */
export function diffReasonValues(backend, frontend) {
  const issues = [];

  for (const value of backend) {
    if (!frontend.includes(value)) {
      issues.push(`'${value}' is declared in core but MISSING from the frontend mirror`);
    }
  }
  for (const value of frontend) {
    if (!backend.includes(value)) {
      issues.push(`'${value}' is declared in the frontend mirror but MISSING from core`);
    }
  }

  if (issues.length === 0 && backend.join('\u0000') !== frontend.join('\u0000')) {
    issues.push(
      `same members, different ORDER — core [${backend.join(', ')}] vs frontend [${frontend.join(', ')}]`,
    );
  }

  return { ok: issues.length === 0, issues };
}

/** Every reason must have exactly one copy entry, and no entry may be orphaned. */
export function diffCopyCoverage(reasons, copyKeys) {
  const issues = [];
  for (const reason of reasons) {
    if (!copyKeys.includes(reason)) {
      issues.push(`'${reason}' has no entry in the copy table`);
    }
  }
  for (const key of copyKeys) {
    if (!reasons.includes(key)) {
      issues.push(`the copy table carries '${key}', which is not a declared value`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * The `name -> expected` rows of a fixture table, in order, read from the text
 * after `startMarker`. Both keys are plain single-quoted strings in either file;
 * a row carrying a name without an expectation (or the reverse) makes the two
 * lists differ in length and is reported.
 */
export function parseHealthFixtureRows(content, startMarker) {
  const start = content.indexOf(startMarker);
  if (start === -1) return null;
  const body = content.slice(start);
  const names = [...body.matchAll(/\bname:\s*'([^']+)'/g)].map((m) => m[1]);
  const expected = [...body.matchAll(/\bexpected:\s*'([^']+)'/g)].map((m) => m[1]);
  return { names, expected, line: content.slice(0, start).split('\n').length };
}

/** The two tables must carry the same rows. Order-sensitive. */
export function diffHealthFixtures(core, fe) {
  const issues = [];
  if (core.names.length !== core.expected.length) {
    issues.push(`core: ${core.names.length} name(s) but ${core.expected.length} expectation(s)`);
  }
  if (fe.names.length !== fe.expected.length) {
    issues.push(`frontend: ${fe.names.length} name(s) but ${fe.expected.length} expectation(s)`);
  }
  const rows = (t) => t.names.map((name, i) => `${name} => ${t.expected[i]}`);
  const coreRows = rows(core);
  const feRows = rows(fe);
  for (const row of coreRows) {
    if (!feRows.includes(row)) issues.push(`'${row}' is in the core table but missing (or different) in the frontend mirror`);
  }
  for (const row of feRows) {
    if (!coreRows.includes(row)) issues.push(`'${row}' is in the frontend mirror but missing (or different) in core`);
  }
  if (issues.length === 0 && coreRows.join('\u0000') !== feRows.join('\u0000')) {
    issues.push('same rows, different ORDER between the core table and the frontend mirror');
  }
  return { ok: issues.length === 0, issues };
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`${label}: expected ${wanted}, got ${actual}`);
  };

  expect('identical arrays are ok', diffReasonValues(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing in frontend fails', diffReasonValues(['a', 'b'], ['a']).ok, false);
  expect('extra in frontend fails', diffReasonValues(['a'], ['a', 'b']).ok, false);
  expect('reordered fails', diffReasonValues(['a', 'b'], ['b', 'a']).ok, false);
  expect('full copy coverage is ok', diffCopyCoverage(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing copy entry fails', diffCopyCoverage(['a', 'b'], ['a']).ok, false);
  expect('orphan copy entry fails', diffCopyCoverage(['a'], ['a', 'b']).ok, false);
  const row = (n, e) => ({ names: n, expected: e });
  expect('equal fixture tables are ok', diffHealthFixtures(row(['a', 'b'], ['x', 'y']), row(['a', 'b'], ['x', 'y'])).ok, true);
  expect('a row only in core fails', diffHealthFixtures(row(['a', 'b'], ['x', 'y']), row(['a'], ['x'])).ok, false);
  expect('a changed expectation fails', diffHealthFixtures(row(['a'], ['x']), row(['a'], ['z'])).ok, false);
  expect('reordered fixture rows fail', diffHealthFixtures(row(['a', 'b'], ['x', 'y']), row(['b', 'a'], ['y', 'x'])).ok, false);
  expect('a name without an expectation fails', diffHealthFixtures(row(['a', 'b'], ['x']), row(['a', 'b'], ['x', 'y'])).ok, false);
  const fx = parseHealthFixtureRows("// head\nexport const T = [\n  { name: 'one', expected: 'x' },\n  { name: 'two',\n expected: 'y' },\n];", 'export const T');
  expect('fixture parser reads name and expected pairs', `${fx?.names.join(',')}|${fx?.expected.join(',')}`, 'one,two|x,y');
  // Vacuous by design at this layer; `main` refuses an empty parse instead.
  expect('empty vs empty is vacuously ok', diffReasonValues([], []).ok, true);

  const parsed = parseReasonValues(`export const X = [\n  // note\n  'one',\n  'two',\n] as const;`, 'X');
  expect('parser reads literals', parsed?.values.join(','), 'one,two');
  const bracketed = parseReasonValues(
    `export const X = [\n  /** carries [] here */\n  'one',\n  'two',\n] as const;`,
    'X',
  );
  expect('bracket in a comment does not truncate', bracketed?.values.join(','), 'one,two');
  const json = '{\n  "a": {\n    "b": {\n      "one": { "label": "x" }\n    }\n  }\n}';
  expect('json reader reads copy keys', readJsonCopyKeys(json, ['a', 'b'])?.keys.join(','), 'one');
  expect('json reader rejects a missing path', readJsonCopyKeys(json, ['a', 'c']), null);

  if (failures.length > 0) {
    console.error('✗ check-handled-in-openlinker-mirror self-check FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ check-handled-in-openlinker-mirror self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const [frontendSrc, copySrc] = await Promise.all([
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
    readFile(join(repoRoot, COPY_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];
  for (const pair of PAIRS) {
    const backendSrc = await readFile(join(repoRoot, pair.backendFile), 'utf8');
    const backend = parseReasonValues(backendSrc, pair.declaration);
    const frontend = parseReasonValues(frontendSrc, pair.declaration);
    const copyDeclaration = pair.copyPath.join('.');
    const copy = readJsonCopyKeys(copySrc, pair.copyPath);

    // An EMPTY parse is fatal: `diffReasonValues([], [])` is ok, so a parser that
    // read nothing would otherwise pass while asserting nothing (#2673).
    const need = (parsed, file, name, kind) => {
      if (!parsed) fatal.push(`${file}: could not find \`export const ${name} = ${kind}\``);
      else if ((parsed.values ?? parsed.keys).length === 0)
        fatal.push(`${file}:${parsed.line}: \`${name}\` parsed as EMPTY — refusing to compare`);
    };
    need(backend, pair.backendFile, pair.declaration, '[');
    need(frontend, FRONTEND_FILE, pair.declaration, '[');
    if (!copy) fatal.push(`${COPY_FILE}: could not find the \`${copyDeclaration}\` object`);
    else need(copy, COPY_FILE, copyDeclaration, '{');
    if (!backend || !frontend || !copy || backend.values.length === 0) continue;

    const drift = diffReasonValues(backend.values, frontend.values);
    const copyDrift = diffCopyCoverage(backend.values, copy.keys);
    if (!drift.ok) drifts.push({ where: `${pair.backendFile}:${backend.line} vs ${FRONTEND_FILE}:${frontend.line}`, issues: drift.issues });
    if (!copyDrift.ok) drifts.push({ where: `${COPY_FILE}:${copy.line} (${copyDeclaration})`, issues: copyDrift.issues });
  }

  // Pair 3 - the shared health fixtures. An EMPTY parse is fatal for the same
  // reason as above: two empty tables are equal.
  const [coreFixturesSrc, feFixturesSrc] = await Promise.all([
    readFile(join(repoRoot, HEALTH_FIXTURES_CORE_FILE), 'utf8'),
    readFile(join(repoRoot, HEALTH_FIXTURES_FE_FILE), 'utf8'),
  ]);
  const coreFixtures = parseHealthFixtureRows(coreFixturesSrc, 'export const ORDER_HEALTH_FIXTURES');
  const feFixtures = parseHealthFixtureRows(feFixturesSrc, 'shared health fixtures (#3482)');
  if (!coreFixtures || coreFixtures.names.length === 0) {
    fatal.push(`${HEALTH_FIXTURES_CORE_FILE}: could not read any \`ORDER_HEALTH_FIXTURES\` row`);
  }
  if (!feFixtures || feFixtures.names.length === 0) {
    fatal.push(`${HEALTH_FIXTURES_FE_FILE}: could not read any row after the "shared health fixtures (#3482)" marker`);
  }
  if (coreFixtures && feFixtures && coreFixtures.names.length > 0 && feFixtures.names.length > 0) {
    const drift = diffHealthFixtures(coreFixtures, feFixtures);
    if (!drift.ok) {
      drifts.push({
        where: `${HEALTH_FIXTURES_CORE_FILE}:${coreFixtures.line} vs ${HEALTH_FIXTURES_FE_FILE}:${feFixtures.line}`,
        issues: drift.issues,
      });
    }
  }

  if (fatal.length > 0 || drifts.length > 0) {
    console.error('✗ check-handled-in-openlinker-mirror FAILED');
    for (const f of fatal) console.error(`  - ${f}`);
    for (const d of drifts) {
      console.error(`  ${d.where}`);
      for (const issue of d.issues) console.error(`  - ${issue}`);
    }
    console.error(`  See ${DOCS_REF}`);
    process.exit(1);
  }

  console.log(
    `✓ check-handled-in-openlinker-mirror: ${PAIRS.map((p) => p.label).join(' and ')} identical across core and the frontend mirror, each with copy; ${coreFixtures?.names.length ?? 0} health fixture(s) identical in core and the frontend mirror`,
  );
}

Promise.resolve(main()).catch((error) => {
  console.error('✗ check-handled-in-openlinker-mirror crashed');
  console.error(error);
  process.exit(1);
});
