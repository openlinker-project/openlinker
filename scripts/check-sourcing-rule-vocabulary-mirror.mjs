#!/usr/bin/env node
/**
 * check-sourcing-rule-vocabulary-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the OMS
 * sourcing-rule vocabulary (#3057).
 *
 * The authoritative declarations live in
 *   libs/oms/src/routing/routing-vocabulary.types.ts
 * and the mirror is
 *   apps/web/src/features/oms/lib/sourcing-rule-vocabulary.ts
 * which re-declares them because the browser bundle does not depend on
 * `@openlinker/*` (#591).
 *
 * TWO RULES, OF DIFFERENT STRENGTH, AND THE SECOND IS THE LOAD-BEARING ONE.
 *
 * RULE A — MEMBERSHIP for the four vocabularies, deliberately NOT order.
 * These arrays are what a dialog OFFERS and what a copy map is keyed by; both
 * are order-independent, and `sourcing-rules.types.ts` types the wire values
 * `string` precisely so an arriving value this build does not know still
 * parses. Failing a build because someone alphabetised an option list would be
 * an unjustified gate, and `check-ui-vocabulary` records why that is worse than
 * none - it trains people to distrust the check.
 *
 * RULE B — the after-action RANKING, compared BY VALUE.
 * `mostRestrictiveAfterAction` exists on both sides, and its correctness rests
 * entirely on which rung counts as more restrictive - NOT on array order, which
 * is different again on each side. Swap two ranks in core and the frontend
 * keeps compiling, keeps rendering, and names the WRONG rule as the one
 * restricting how far an order may be split. An operator then retires that rule
 * expecting more splitting and nothing changes. Nothing else catches it: the
 * `Readonly<Record<…, number>>` annotation is total against each side's own
 * type, so both sides stay green.
 *
 * WHAT THIS DOES NOT CATCH. An overstated gate is worse than none:
 *
 *   1. It compares declarations only. Neither copy map is read here -
 *      `sourcing-rule.copy.ts` looks values up LOOSELY and falls back to the
 *      raw string by design, so a missing sentence is a degradation, not a
 *      defect, and asserting totality would forbid that design.
 *   2. It says nothing about whether a value is REACHABLE, or about whether the
 *      two `mostRestrictiveAfterAction` bodies agree beyond their ranking. The
 *      unit specs own that.
 *   3. It is textual - no TypeScript parse, no transpile - so it stays a
 *      zero-dependency `check:invariants` step like its siblings.
 *
 * "MATCHED NOTHING" is a FAILURE here, not a pass: a rename or a moved file
 * exits non-zero rather than silently comparing two empty lists forever.
 *
 * Usage:
 *   node scripts/check-sourcing-rule-vocabulary-mirror.mjs
 *   node scripts/check-sourcing-rule-vocabulary-mirror.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const CORE_FILE = join('libs', 'oms', 'src', 'routing', 'routing-vocabulary.types.ts');
const FRONTEND_FILE = join(
  'apps', 'web', 'src', 'features', 'oms', 'lib', 'sourcing-rule-vocabulary.ts',
);

/** The four vocabularies, which deliberately do NOT share a name across sides. */
const VOCABULARIES = [
  ['filter names', 'RoutingFilterNameValues', 'SOURCING_FILTER_NAME_VALUES'],
  ['sort names', 'RoutingSortNameValues', 'SOURCING_SORT_NAME_VALUES'],
  ['rule kinds', 'RoutingRuleKindValues', 'SOURCING_RULE_KIND_VALUES'],
  ['after-actions', 'RoutingAfterActionValues', 'SOURCING_AFTER_ACTION_VALUES'],
];

/** The ranking. Same identifier on both sides; core's is not exported. */
const RANKING_DECLARATION = 'AFTER_ACTION_PERMISSIVENESS';

const DOCS_REF = 'docs/architecture-overview.md § 26 Fulfillment';

/**
 * Strip line and block comments so an annotated entry cannot be read as a value.
 *
 * Textual and not quote-aware - the documented limit every sibling carries.
 * Both inputs are repo-owned literals of bare kebab-case names, none of which
 * can contain a `//` or a block-comment opener, which is what makes the simple
 * pass adequate.
 */
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract the string literals of `export const <name> = [...] as const;`. */
export function parseValues(content, name) {
  // Strip BEFORE locating the brackets, not after: a `]` inside a per-value
  // docblock (an `[ADR-xxx]` reference is the likely one) would otherwise close
  // the array early and silently shorten the parsed list.
  const stripped = stripComments(content);

  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(stripped);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = stripped.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripped.slice(openBracket + 1, closeBracket);

  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) values.push(m[1] ?? m[2]);
  return values;
}

/**
 * Extract `const <name>… = { 'a': 0, b: 1 }` as a plain object of numbers.
 *
 * `export` is optional because core's ranking is module-private - requiring it
 * would make this rule silently unenforceable the day it stays private, which
 * is the state it is in today.
 */
export function parseRanking(content, name) {
  const stripped = stripComments(content);

  const declRe = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*\\{`);
  const declMatch = declRe.exec(stripped);
  if (!declMatch) return null;

  const openBrace = declMatch.index + declMatch[0].length - 1;
  const closeBrace = stripped.indexOf('}', openBrace);
  if (closeBrace === -1) return null;

  const body = stripped.slice(openBrace + 1, closeBrace);

  const ranking = {};
  const entryRe = /(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w-]*))\s*:\s*(-?\d+)/g;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    ranking[m[1] ?? m[2] ?? m[3]] = Number(m[4]);
  }
  return ranking;
}

/** Compare two vocabularies by MEMBERSHIP. Empty result means they agree. */
export function diffVocabularies(label, coreValues, mirrorValues) {
  const problems = [];
  for (const value of coreValues.filter((v) => !mirrorValues.includes(v))) {
    problems.push(`${label}: '${value}' is declared in @openlinker/oms but MISSING from the frontend mirror`);
  }
  for (const value of mirrorValues.filter((v) => !coreValues.includes(v))) {
    problems.push(`${label}: '${value}' is in the frontend mirror but NOT declared in @openlinker/oms`);
  }
  return problems;
}

/** Compare the ranking BY VALUE. Empty result means they agree. */
export function diffRanking(coreRanking, mirrorRanking) {
  const problems = [];
  const keys = [...new Set([...Object.keys(coreRanking), ...Object.keys(mirrorRanking)])].sort();

  for (const key of keys) {
    const core = coreRanking[key];
    const mirror = mirrorRanking[key];
    if (core === undefined) {
      problems.push(`ranking: '${key}' is ranked in the frontend mirror but NOT in @openlinker/oms`);
    } else if (mirror === undefined) {
      problems.push(`ranking: '${key}' is ranked in @openlinker/oms but NOT in the frontend mirror`);
    } else if (core !== mirror) {
      problems.push(
        `ranking: '${key}' is ${core} in @openlinker/oms and ${mirror} in the frontend mirror — ` +
          'the table would name the wrong rule as the one restricting splits',
      );
    }
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

  expect('parses a simple array', parseValues("export const X = ['a', 'b'] as const;", 'X'), ['a', 'b']);
  expect('ignores a block-commented entry',
    parseValues("export const X = ['a', /* 'x' */ 'b'] as const;", 'X'), ['a', 'b']);
  expect('survives a bracket inside a docblock',
    parseValues("export const X = ['a', /* see [ADR-041] */ 'b'] as const;", 'X'), ['a', 'b']);
  expect('reports an absent array', parseValues('export const Other = [];', 'X'), null);

  expect('parses a quoted-key ranking',
    parseRanking("const R: Readonly<Record<A, number>> = { 'no-split': 0, 'line-split': 1 };", 'R'),
    { 'no-split': 0, 'line-split': 1 });
  expect('parses a bare-key ranking', parseRanking('const R = { alpha: 2 };', 'R'), { alpha: 2 });
  // Core's ranking is module-private; requiring `export` would make the rule
  // silently unenforceable, which is worse than not having it.
  expect('parses an EXPORTED ranking too', parseRanking('export const R = { a: 1 };', 'R'), { a: 1 });
  expect('ignores a commented ranking entry',
    parseRanking("const R = { a: 1, /* b: 9, */ c: 2 };", 'R'), { a: 1, c: 2 });
  expect('reports an absent ranking', parseRanking('const Other = {};', 'R'), null);

  expect('agrees on identical lists', diffVocabularies('kinds', ['a', 'b'], ['a', 'b']), []);
  expect('detects a missing value', diffVocabularies('kinds', ['a', 'b'], ['a']), [
    "kinds: 'b' is declared in @openlinker/oms but MISSING from the frontend mirror",
  ]);
  expect('detects an extra value', diffVocabularies('kinds', ['a'], ['a', 'b']), [
    "kinds: 'b' is in the frontend mirror but NOT declared in @openlinker/oms",
  ]);
  // The deliberate non-rule. Asserted so a future author cannot tighten Rule A
  // without deleting this line and reading why.
  expect('tolerates a reorder by design', diffVocabularies('kinds', ['a', 'b'], ['b', 'a']), []);

  expect('agrees on an identical ranking', diffRanking({ a: 0, b: 1 }, { a: 0, b: 1 }), []);
  // Rule B is the whole point: a SWAP is invisible to both compilers.
  expect('detects a swapped ranking', diffRanking({ a: 0, b: 1 }, { a: 1, b: 0 }), [
    "ranking: 'a' is 0 in @openlinker/oms and 1 in the frontend mirror — the table would name the wrong rule as the one restricting splits",
    "ranking: 'b' is 1 in @openlinker/oms and 0 in the frontend mirror — the table would name the wrong rule as the one restricting splits",
  ]);
  expect('detects a rank present on one side only', diffRanking({ a: 0 }, { a: 0, b: 1 }), [
    "ranking: 'b' is ranked in the frontend mirror but NOT in @openlinker/oms",
  ]);

  if (failures.length > 0) {
    console.error('check-sourcing-rule-vocabulary-mirror --self-check FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-sourcing-rule-vocabulary-mirror --self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const problems = [];
  const sources = {};

  for (const [label, relPath] of [['core', CORE_FILE], ['mirror', FRONTEND_FILE]]) {
    try {
      sources[label] = await readFile(join(repoRoot, relPath), 'utf8');
    } catch {
      problems.push(`${relPath} could not be read — did the file move?`);
    }
  }

  if (problems.length === 0) {
    let compared = 0;

    for (const [label, coreName, mirrorName] of VOCABULARIES) {
      const coreValues = parseValues(sources.core, coreName);
      const mirrorValues = parseValues(sources.mirror, mirrorName);

      if (coreValues === null) {
        problems.push(`${CORE_FILE} declares no \`export const ${coreName} = [...]\``);
        continue;
      }
      if (mirrorValues === null) {
        problems.push(`${FRONTEND_FILE} declares no \`export const ${mirrorName} = [...]\``);
        continue;
      }
      if (coreValues.length === 0 || mirrorValues.length === 0) {
        problems.push(`${label}: one side declares an EMPTY list — a gate that matches nothing`);
        continue;
      }

      problems.push(...diffVocabularies(label, coreValues, mirrorValues));
      compared += 1;
    }

    const coreRanking = parseRanking(sources.core, RANKING_DECLARATION);
    const mirrorRanking = parseRanking(sources.mirror, RANKING_DECLARATION);

    if (coreRanking === null || mirrorRanking === null) {
      problems.push(
        `one side declares no \`const ${RANKING_DECLARATION} = { … }\` — the load-bearing rule ` +
          'cannot be checked',
      );
    } else if (Object.keys(coreRanking).length === 0) {
      problems.push(`${RANKING_DECLARATION} parsed EMPTY in ${CORE_FILE} — a gate that matches nothing`);
    } else {
      problems.push(...diffRanking(coreRanking, mirrorRanking));
    }

    if (compared !== VOCABULARIES.length && problems.length === 0) {
      problems.push('not every vocabulary was compared — refusing to report a partial pass');
    }
  }

  if (problems.length > 0) {
    console.error(`check-sourcing-rule-vocabulary-mirror FAILED (${DOCS_REF}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(`\n  core:   ${CORE_FILE}`);
    console.error(`  mirror: ${FRONTEND_FILE}`);
    console.error('\n  Vocabularies are compared by membership (order is not checked);');
    console.error(`  ${RANKING_DECLARATION} is compared by VALUE.`);
    process.exit(1);
  }

  console.log(
    `check-sourcing-rule-vocabulary-mirror OK (${VOCABULARIES.length} vocabularies + the ` +
      'after-action ranking)',
  );
}

await main();
