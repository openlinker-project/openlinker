#!/usr/bin/env node
/**
 * check-stock-and-pricing-preview-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the two pure
 * publish-policy helpers (#2610).
 *
 * Rule. These four functions
 *   applyStockSafetyBuffer  (libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts)
 *   applyPricingRule / applyRounding / round2dp
 *                           (libs/core/src/identifier-mapping/domain/types/pricing-rule.types.ts)
 * and their mirror in
 *   apps/web/src/features/connections/lib/stock-and-pricing-preview.ts
 * MUST be the same code.
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so the
 * functions exist twice - the same constraint check-shipping-tax-split-mirror.mjs
 * lives under, and this script follows it. The connection form previews the
 * published quantity and price with the mirror, so drift means an operator sets
 * a reserve or a margin against a number the backend will not produce.
 *
 * Comparison is TOKEN-based: comments are blanked and whitespace collapsed, so
 * reformatting or re-wording a comment is free while any change to the code
 * itself fails. `export` is ignored on both sides (core exports two of the four,
 * the mirror exports two).
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * SCOPE, so the wrong guard is not trusted: only the four function bodies are
 * compared. The mirrored `PricingRule` / `PriceRoundingMode` types are NOT -
 * a field added to one side only is caught by that side's own call sites - and
 * nothing here asserts that the form actually calls the mirror.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const CORE_STOCK = join(
  'libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts'
);
const CORE_PRICING = join('libs/core/src/identifier-mapping/domain/types/pricing-rule.types.ts');
const MIRROR = join('apps/web/src/features/connections/lib/stock-and-pricing-preview.ts');

const FUNCTIONS = [
  { name: 'applyStockSafetyBuffer', coreFile: CORE_STOCK },
  { name: 'applyPricingRule', coreFile: CORE_PRICING },
  { name: 'applyRounding', coreFile: CORE_PRICING },
  { name: 'round2dp', coreFile: CORE_PRICING },
];

/**
 * Extract one function declaration (signature + body) by locating its name and
 * brace-matching from the first `{` after the parameter list. Returns null when
 * the declaration is absent, which the caller reports as a failure.
 */
export function extractFunction(source, name) {
  const pattern = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(source);
  if (!match) return null;
  let index = match.index + match[0].length - 1;
  let depth = 0;
  let bodyStart = -1;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      if (bodyStart === -1) bodyStart = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(match.index, index + 1);
      }
    }
  }
  return null;
}

/** Blank comments, drop `export`, collapse whitespace outside string literals. */
export function normalize(code) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const char = code[i];
    if (quote) {
      out += char;
      if (char === '\\') {
        out += code[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out
    .replace(/\bexport\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

if (process.argv.includes('--self-check')) {
  const a = 'export function f(x: number) {\n  // note\n  return x; /* t */\n}';
  const b = 'function f(x: number) { return x; }';
  if (normalize(extractFunction(a, 'f')) !== normalize(extractFunction(b, 'f'))) {
    console.error('self-check failed: equivalent sources did not normalize equal');
    process.exit(1);
  }
  if (extractFunction('function g() {}', 'f') !== null) {
    console.error('self-check failed: absent function did not report null');
    process.exit(1);
  }
  console.log('check-stock-and-pricing-preview-mirror: self-check passed');
  process.exit(0);
}

const failures = [];
const mirrorSource = await readFile(join(repoRoot, MIRROR), 'utf8');
const cache = new Map();

for (const { name, coreFile } of FUNCTIONS) {
  if (!cache.has(coreFile)) {
    cache.set(coreFile, await readFile(join(repoRoot, coreFile), 'utf8'));
  }
  const core = extractFunction(cache.get(coreFile), name);
  const mirror = extractFunction(mirrorSource, name);
  if (!core) {
    failures.push(`${coreFile}: ${name} not found (renamed or removed?)`);
    continue;
  }
  if (!mirror) {
    failures.push(`${MIRROR}: ${name} not found - the frontend mirror is incomplete`);
    continue;
  }
  if (normalize(core) !== normalize(mirror)) {
    failures.push(
      `${name} has drifted between ${coreFile} and ${MIRROR}.\n` +
        `  core:   ${normalize(core)}\n` +
        `  mirror: ${normalize(mirror)}`
    );
  }
}

if (failures.length > 0) {
  console.error('check-stock-and-pricing-preview-mirror FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}
console.log(`check-stock-and-pricing-preview-mirror: ${FUNCTIONS.length} function(s) in sync`);
