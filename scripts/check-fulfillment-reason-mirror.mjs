#!/usr/bin/env node
/**
 * check-fulfillment-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirrors of the two order
 * routing vocabularies the /orders list reads for an order OpenLinker handles
 * itself (#3482).
 *
 * Pair 1 - `FulfillmentBlockReasonValues`
 *   libs/core/src/fulfillment/domain/types/fulfillment-block-reason.types.ts   (authoritative)
 * Pair 2 - `FulfillmentRoutingSkipReasonValues`
 *   libs/core/src/orders/domain/types/fulfillment-routing-eligibility.types.ts (authoritative)
 * each mirrored under the same name in
 *   apps/web/src/features/orders/api/orders.types.ts
 * Pair 3 - `REROUTABLE_FULFILLMENT_BLOCK_REASONS` (#3557)
 *   libs/core/src/fulfillment/domain/types/fulfillment-block-reason.types.ts   (authoritative)
 *   apps/web/src/features/fulfillment/lib/routing-decision-state.ts           (mirror)
 *   The set the retry endpoint accepts. Drift is silent: a widened backend set
 *   hides the "Retry routing" button, a narrowed one offers a retry that 409s.
 * MUST contain the same literals in the same order. The browser bundle does not
 * depend on `@openlinker/core` (#591), so these are copies, and a copy drifts
 * silently: a reason renamed in core makes the "Waiting: ..." badge fall back to
 * nothing with no error anywhere.
 *
 * Rule C - `orders.handledInOpenLinker.waitingReasons` (apps/web/src/locales/en/orders.json)
 *   may carry only keys that are block reasons. SUBSET, not coverage: the
 *   transient held states deliberately have no badge. The `satisfies` on
 *   `WAITING_REASON_TONE` in handled-in-openlinker.ts checks the keys against the
 *   FRONTEND union; this check is what ties the copy to the BACKEND one.
 *
 * SCOPE: arrays and object keys, compared TEXTUALLY. The parsers are COPIED from
 * `check-destination-routing-reason-mirror.mjs` (with its #3002 comment-order
 * fix); importing would run that guard's `main()` as a side effect.
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
const COPY_PATH = ['handledInOpenLinker', 'waitingReasons'];
const COPY_DECLARATION = COPY_PATH.join('.');

/**
 * The keys of the copy object at `path` in a locale JSON file, with the 1-based
 * line its first key sits on. `null` when the path is absent or not an object.
 * COPIED from `check-destination-routing-reason-mirror.mjs` (see below).
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
const BLOCK_DECLARATION = 'FulfillmentBlockReasonValues';
const DOCS_REF = 'docs/architecture-overview.md § 28 The pack bench (#3482)';

const PAIRS = [
  {
    backendFile: join('libs', 'core', 'src', 'fulfillment', 'domain', 'types', 'fulfillment-block-reason.types.ts'),
    declaration: BLOCK_DECLARATION,
  },
  {
    backendFile: join('libs', 'core', 'src', 'orders', 'domain', 'types', 'fulfillment-routing-eligibility.types.ts'),
    declaration: 'FulfillmentRoutingSkipReasonValues',
  },
  {
    backendFile: join('libs', 'core', 'src', 'fulfillment', 'domain', 'types', 'fulfillment-block-reason.types.ts'),
    declaration: 'REROUTABLE_FULFILLMENT_BLOCK_REASONS',
    frontendFile: join('apps', 'web', 'src', 'features', 'fulfillment', 'lib', 'routing-decision-state.ts'),
  },
];

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 *
 * Comments are blanked to EQUAL-LENGTH whitespace before the closing bracket is
 * located, so a `]` inside a per-entry docblock cannot end the scan early
 * (#3002) and the reported line number still matches the raw source.
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

/** Every copy key must be a declared reason; reasons without copy are allowed. */
export function diffCopySubset(reasons, copyKeys) {
  const issues = [];
  for (const key of copyKeys) {
    if (!reasons.includes(key)) {
      issues.push(`${COPY_DECLARATION} carries '${key}', which is not a ${BLOCK_DECLARATION} member`);
    }
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
  expect('copy subset is ok', diffCopySubset(['a', 'b'], ['a']).ok, true);
  expect('orphan copy key fails', diffCopySubset(['a'], ['a', 'b']).ok, false);

  const bracketed = parseReasonValues(
    `export const X = [\n  /** carries [] here */\n  'one',\n  'two',\n] as const;`,
    'X',
  );
  expect('bracket in a comment does not truncate', bracketed?.values.join(','), 'one,two');
  const json = '{\n  "a": {\n    "b": {\n      "one": { "label": "x" }\n    }\n  }\n}';
  expect('json reader reads copy keys', readJsonCopyKeys(json, ['a', 'b'])?.keys.join(','), 'one');
  expect('json reader rejects a missing path', readJsonCopyKeys(json, ['a', 'c']), null);

  if (failures.length > 0) {
    console.error('✗ check-fulfillment-reason-mirror self-check FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ check-fulfillment-reason-mirror self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const frontendSrc = await readFile(join(repoRoot, FRONTEND_FILE), 'utf8');
  const copySrc = await readFile(join(repoRoot, COPY_FILE), 'utf8');

  const fatal = [];
  const drift = [];
  let blockValues = null;

  for (const pair of PAIRS) {
    const backendSrc = await readFile(join(repoRoot, pair.backendFile), 'utf8');
    const pairFrontendFile = pair.frontendFile ?? FRONTEND_FILE;
    const pairFrontendSrc =
      pair.frontendFile === undefined
        ? frontendSrc
        : await readFile(join(repoRoot, pair.frontendFile), 'utf8');
    const backend = parseReasonValues(backendSrc, pair.declaration);
    const frontend = parseReasonValues(pairFrontendSrc, pair.declaration);
    // An EMPTY parse is fatal: `diffReasonValues([], [])` is vacuously ok (#2673).
    for (const [parsed, file] of [[backend, pair.backendFile], [frontend, pairFrontendFile]]) {
      if (!parsed) fatal.push(`${file}: could not find \`export const ${pair.declaration} = [\``);
      else if (parsed.values.length === 0) {
        fatal.push(`${file}:${parsed.line}: \`${pair.declaration}\` parsed as EMPTY - refusing to compare`);
      }
    }
    if (!backend || !frontend || backend.values.length === 0 || frontend.values.length === 0) continue;
    const result = diffReasonValues(backend.values, frontend.values);
    if (!result.ok) {
      drift.push(`${pair.backendFile}:${backend.line} vs ${pairFrontendFile}:${frontend.line}`);
      drift.push(...result.issues.map((issue) => `  ${issue}`));
    }
    if (pair.declaration === BLOCK_DECLARATION) blockValues = backend.values;
  }

  const copy = readJsonCopyKeys(copySrc, COPY_PATH);
  if (!copy) fatal.push(`${COPY_FILE}: could not find the \`${COPY_DECLARATION}\` object`);
  else if (copy.keys.length === 0) {
    fatal.push(`${COPY_FILE}:${copy.line}: \`${COPY_DECLARATION}\` parsed as EMPTY - refusing to compare`);
  } else if (blockValues) {
    const subset = diffCopySubset(blockValues, copy.keys);
    if (!subset.ok) {
      drift.push(`${COPY_FILE}:${copy.line}`);
      drift.push(...subset.issues.map((issue) => `  ${issue}`));
    }
  }

  if (fatal.length > 0 || drift.length > 0) {
    console.error('✗ check-fulfillment-reason-mirror FAILED');
    for (const f of [...fatal, ...drift]) console.error(`  - ${f}`);
    console.error(`  See ${DOCS_REF}`);
    process.exit(1);
  }

  console.log(
    '✓ check-fulfillment-reason-mirror: block, skip and reroutable reasons identical across core and the frontend mirrors; waiting copy keys are block reasons',
  );
}

Promise.resolve(main()).catch((error) => {
  console.error('✗ check-fulfillment-reason-mirror crashed');
  console.error(error);
  process.exit(1);
});
