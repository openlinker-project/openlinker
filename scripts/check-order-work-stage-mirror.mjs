#!/usr/bin/env node
/**
 * check-order-work-stage-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the packing-stage
 * vocabulary an order list row shows for an order OpenLinker handles itself (#3482).
 *
 * The authoritative declaration is `OrderWorkStageValues` in
 *   libs/core/src/fulfillment/domain/types/order-work-summary.types.ts
 * and the mirror is
 *   apps/web/src/features/orders/api/orders.types.ts
 * which re-declares the same exported name because the browser bundle does not
 * depend on `@openlinker/core` (#591).
 *
 * ONE RULE - value + ORDER equality. The array order IS the time order the core
 * rule folds on ("a split order reports its EARLIEST stage"), so a reordered mirror
 * would silently change which stage an operator reads while both lists still
 * "agree" as sets.
 *
 * WHAT THIS DOES NOT CATCH. Only the two ARRAYS are compared. The per-stage copy
 * table (`ORDER_WORK_STAGE_COPY`) is not read here. Without this guard a stage added
 * in core is rendered as nothing by the browser (an unknown stage is a no-op by
 * design), which is safe but silent - that silence is what this script removes.
 *
 * "MATCHED NOTHING" is a FAILURE: a missing declaration in either file exits
 * non-zero rather than comparing two empty lists forever.
 *
 * Usage:
 *   node scripts/check-order-work-stage-mirror.mjs
 *   node scripts/check-order-work-stage-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join(
  'libs',
  'core',
  'src',
  'fulfillment',
  'domain',
  'types',
  'order-work-summary.types.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'orders',
  'api',
  'orders.types.ts',
);

/** The `as const` array this script treats as authoritative, by name. */
const DECLARATION = 'OrderWorkStageValues';

const DOCS_REF = 'docs/architecture-overview.md (28. The pack bench and the Assign Packing Work board)';

/**
 * Strip line and block comments so an annotated entry cannot be read as a value.
 *
 * Textual and not quote-aware — the same documented limit its sibling carries.
 * Both inputs are repo-owned `as const` arrays of bare kebab-case reason names,
 * none of which can contain a `//` or `/*` sequence, which is what makes the
 * simple pass adequate.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Blank `//` and `/* ... *\/` comments to spaces (newlines preserved), so a `]`
 * written inside a comment can never be mistaken for the array's real closing
 * bracket. Length-preserving: any index found in the blanked string is a valid
 * index into the original.
 */
function blankComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`.
 * Returns `string[]`, or `null` when the declaration is absent.
 *
 * The closing bracket is located on a comment-BLANKED copy of the content, or
 * a `]` written inside a comment between the real brackets is mistaken for
 * the declaration's own close and truncates everything after it (#3002).
 */
export function parseReasonValues(content, name = DECLARATION) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = blankComments(content).indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripComments(content.slice(openBracket + 1, closeBracket));

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }
  return values;
}

/**
 * Compare two ordered vocabularies. Returns a list of human-readable problems;
 * empty means they agree.
 */
export function diffVocabularies(coreValues, mirrorValues) {
  const problems = [];

  const missing = coreValues.filter((v) => !mirrorValues.includes(v));
  const extra = mirrorValues.filter((v) => !coreValues.includes(v));

  for (const value of missing) {
    problems.push(`'${value}' is declared in core but MISSING from the frontend mirror`);
  }
  for (const value of extra) {
    problems.push(`'${value}' is in the frontend mirror but NOT declared in core`);
  }

  if (problems.length === 0 && coreValues.join('|') !== mirrorValues.join('|')) {
    problems.push(
      `order differs — core: [${coreValues.join(', ')}] / mirror: [${mirrorValues.join(', ')}]`,
    );
  }

  return problems;
}

function selfCheck() {
  const failures = [];
  const expect = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}: expected ${e}, got ${a}`);
  };

  expect(
    'parses a simple declaration',
    parseReasonValues(`export const ${DECLARATION} = ['a', 'b'] as const;`),
    ['a', 'b'],
  );
  expect(
    'ignores a commented-out entry',
    parseReasonValues(`export const ${DECLARATION} = ['a', /* 'x' */ 'b'] as const;`),
    ['a', 'b'],
  );
  expect(
    'ignores a line-commented entry',
    parseReasonValues(`export const ${DECLARATION} = [\n 'a',\n // 'x',\n 'b',\n] as const;`),
    ['a', 'b'],
  );
  expect('reports an absent declaration', parseReasonValues('export const Other = [];'), null);

  // #3002: a `]` inside a comment BETWEEN the real brackets must not truncate
  // the array. Red-first against the pre-fix `indexOf(']', openBracket)` on
  // raw content: that stopped at the comment's own `]`.
  expect(
    'a "]" inside a line comment does not truncate the array',
    parseReasonValues(
      `export const ${DECLARATION} = [\n  'a', // e.g. some-list: []\n  'b',\n] as const;`,
    ),
    ['a', 'b'],
  );
  expect(
    'a "]" inside a block comment does not truncate the array',
    parseReasonValues(
      `export const ${DECLARATION} = [\n  'a', /* e.g. some-list: [] */\n  'b',\n] as const;`,
    ),
    ['a', 'b'],
  );
  expect(
    'a declaration whose every entry is commented out parses to zero values',
    parseReasonValues(`export const ${DECLARATION} = [\n  // 'a',\n] as const;`),
    [],
  );
  expect('agrees on identical lists', diffVocabularies(['a', 'b'], ['a', 'b']), []);
  expect('detects a missing value', diffVocabularies(['a', 'b'], ['a']), [
    "'b' is declared in core but MISSING from the frontend mirror",
  ]);
  expect('detects an extra value', diffVocabularies(['a'], ['a', 'b']), [
    "'b' is in the frontend mirror but NOT declared in core",
  ]);
  expect('detects a reorder', diffVocabularies(['a', 'b'], ['b', 'a']), [
    'order differs — core: [a, b] / mirror: [b, a]',
  ]);

  if (failures.length > 0) {
    console.error('check-order-work-stage-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-order-work-stage-mirror --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const parsed = {};

  for (const [label, relPath] of [
    ['core', CORE_FILE],
    ['mirror', FRONTEND_FILE],
  ]) {
    let content;
    try {
      content = await readFile(join(repoRoot, relPath), 'utf8');
    } catch {
      problems.push(`${relPath} could not be read — did the file move?`);
      continue;
    }
    const values = parseReasonValues(content);
    if (values === null) {
      problems.push(`${relPath} declares no \`export const ${DECLARATION} = [...]\``);
      continue;
    }
    if (values.length === 0) {
      problems.push(`${relPath} declares an EMPTY ${DECLARATION} — a gate that matches nothing`);
      continue;
    }
    parsed[label] = values;
  }

  if (problems.length === 0) {
    problems.push(...diffVocabularies(parsed.core, parsed.mirror));
  }

  if (problems.length > 0) {
    console.error(`check-order-work-stage-mirror FAILED (${DOCS_REF}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE}`);
    console.error(`  mirror: ${FRONTEND_FILE}`);
    console.error('\n  Both declarations must list the same reasons in the same order.');
    process.exit(1);
  }

  console.log(`check-order-work-stage-mirror OK (${parsed.core.length} stages)`);
}

await main();
