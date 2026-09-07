#!/usr/bin/env node
/**
 * check-sales-document-market-summary-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained `apps/e2e` mirror of the
 * settings-page market summary (#2809 review).
 *
 * Rule. The body of `summarizeSalesDocumentMarkets` (plus the two helpers it
 * reads, `isConfigured` and `namesSentenceFragment`, and the `needsDecision`
 * predicate) in
 *   apps/web/src/features/sales-documents/lib/summarize-sales-document-markets.ts  (authoritative)
 * and
 *   apps/e2e/src/support/sales-document-market-summary.ts                          (test mirror)
 * MUST be identical after normalisation.
 *
 * WHY THIS PAIR NEEDS A GUARD AT ALL, AND WHY IT NEEDS IT MORE THAN ITS
 * SIBLINGS: the mirror computes the test's EXPECTED value. Every other mirror
 * in this repo (`stock-and-pricing-preview`, `parameter-restrictions`,
 * `return-stage`, `sales-document-reason`) drifts into a wrong number or a
 * missing case — visible. This one drifts into a TAUTOLOGY: the spec keeps
 * passing while asserting the old sentence against the old rule, and the
 * product's real sentence is never checked by anything.
 *
 * NORMALISATION, stated so the wrong guard is not trusted. Comments are
 * stripped, whitespace collapsed, and two deliberate spelling differences are
 * rewritten before comparison:
 *   - `SALES_DOCUMENT_REST_OF_WORLD_COUNTRY` -> `REST_OF_WORLD_COUNTRY`
 *     (the mirror cannot import `apps/web`, so it declares the constant — the
 *     script separately asserts both hold the literal '*')
 *   - `describeSalesDocumentMarketOutcome(row.outcome).needsDecision`
 *     -> `needsDecision(row)` (the mirror inlines that one predicate).
 * Anything else is a genuine difference and fails.
 *
 * SCOPE: this compares FUNCTION TEXT, not behaviour. A change made
 * identically in both files passes here and is correct to pass — that is the
 * point. What it catches is a change made in ONE file.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 *
 * Run with `--self-check` to exercise the pure normaliser against synthetic
 * inputs (no filesystem).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SOURCE_FILE = 'apps/web/src/features/sales-documents/lib/summarize-sales-document-markets.ts';
const MIRROR_FILE = 'apps/e2e/src/support/sales-document-market-summary.ts';

/** The declarations compared, in order. */
const COMPARED = ['isConfigured', 'namesSentenceFragment', 'summarizeSalesDocumentMarkets'];

/** Strip `//` and block comments without touching string contents. */
export function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Extract a top-level `function name(` … matching-brace block. */
export function extractFunction(text, name) {
  const pattern = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(text);
  if (!match) return null;
  let i = text.indexOf('{', match.index + match[0].length - 1);
  if (i === -1) return null;
  let depth = 0;
  const start = match.index;
  for (; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Rewrite the two authorized spelling differences, then collapse whitespace. */
export function normalize(source) {
  return source
    .replaceAll('SALES_DOCUMENT_REST_OF_WORLD_COUNTRY', 'REST_OF_WORLD_COUNTRY')
    .replaceAll('describeSalesDocumentMarketOutcome(row.outcome).needsDecision', 'needsDecision(row)')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function selfCheck() {
  const failures = [];
  const commented = stripComments("const a = 1; // note\n/* block */ const b = '// not a comment';");
  if (!commented.includes("'// not a comment'")) failures.push('stripComments ate a string literal');
  if (commented.includes('note') || commented.includes('block')) failures.push('stripComments left a comment');

  const fn = extractFunction('export function foo(a) {\n  if (a) { return 1; }\n  return 2;\n}\nconst x = 1;', 'foo');
  if (fn === null || !fn.endsWith('}') || fn.includes('const x')) failures.push('extractFunction brace matching is wrong');
  if (extractFunction('const y = 1;', 'foo') !== null) failures.push('extractFunction found a function that is not there');

  const a = normalize('function f() {\n  return SALES_DOCUMENT_REST_OF_WORLD_COUNTRY;\n}');
  const b = normalize('function f() { return REST_OF_WORLD_COUNTRY; }');
  if (a !== b) failures.push('normalize did not rewrite the rest-of-world constant');

  const c = normalize('rows.filter((row) => describeSalesDocumentMarketOutcome(row.outcome).needsDecision)');
  if (c !== normalize('rows.filter((row) => needsDecision(row))')) {
    failures.push('normalize did not rewrite the needsDecision predicate');
  }
  if (normalize('return 1;') === normalize('return 2;')) failures.push('normalize collapsed distinct bodies');

  if (failures.length > 0) {
    console.error('check-sales-document-market-summary-mirror: SELF-CHECK FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-sales-document-market-summary-mirror: self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const [sourceRaw, mirrorRaw] = await Promise.all([
    readFile(join(REPO_ROOT, SOURCE_FILE), 'utf8'),
    readFile(join(REPO_ROOT, MIRROR_FILE), 'utf8'),
  ]);
  const source = stripComments(sourceRaw);
  const mirror = stripComments(mirrorRaw);

  const failures = [];

  // The mirror declares the constant the source imports; assert the value, not the name.
  if (!/REST_OF_WORLD_COUNTRY\s*=\s*'\*'/.test(mirror)) {
    failures.push(`${MIRROR_FILE}: REST_OF_WORLD_COUNTRY is not declared as '*'`);
  }
  const sourceCap = /MAX_NAMED_MARKETS\s*=\s*(\d+)/.exec(source)?.[1];
  const mirrorCap = /MAX_NAMED_MARKETS\s*=\s*(\d+)/.exec(mirror)?.[1];
  if (sourceCap === undefined || mirrorCap === undefined || sourceCap !== mirrorCap) {
    failures.push(`MAX_NAMED_MARKETS differs: source=${sourceCap ?? 'missing'} mirror=${mirrorCap ?? 'missing'}`);
  }

  for (const name of COMPARED) {
    const a = extractFunction(source, name);
    const b = extractFunction(mirror, name);
    if (a === null) {
      failures.push(`${SOURCE_FILE}: could not find function ${name}`);
      continue;
    }
    if (b === null) {
      failures.push(`${MIRROR_FILE}: could not find function ${name}`);
      continue;
    }
    if (normalize(a) !== normalize(b)) {
      failures.push(
        `${name} has drifted between ${SOURCE_FILE} and ${MIRROR_FILE}.\n` +
          `    source: ${normalize(a).slice(0, 200)}…\n` +
          `    mirror: ${normalize(b).slice(0, 200)}…`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('check-sales-document-market-summary-mirror: FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      '\n  The apps/e2e mirror computes the EXPECTED value for the settings-page summary spec.\n' +
        '  Drift here does not fail a test — it makes the assertion a tautology. Update both files.',
    );
    process.exit(1);
  }
  console.log('check-sales-document-market-summary-mirror: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
