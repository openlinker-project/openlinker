#!/usr/bin/env node
/**
 * check-shipping-tax-split-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the shipping
 * tax split (#2248 / #2252 / #2254, ADR-063 § 5).
 *
 * Rule. `splitShippingAcrossRates` and its `roundToMinorUnits` /
 * `minorUnitExponentFor` helpers in
 *   libs/core/src/sales-documents/domain/types/shipping-tax-split.types.ts   (backend, authoritative)
 * and
 *   apps/web/src/features/invoicing/lib/shipping-tax-split.ts                (frontend mirror)
 * MUST be the same code.
 *
 * The browser bundle does not depend on `@openlinker/core` (#591), so the
 * function exists twice - the same constraint the sales-document reason
 * vocabularies live under, and `check-sales-document-reason-mirror.mjs` is the
 * precedent this script follows. Here the copy is a FUNCTION rather than an
 * array, and it drifted once already: the frontend re-derived the split with
 * plain per-part rounding, no remainder pass and no zero-part filter, so the
 * invoice panel previewed shipping parts that did not add up to the shipping
 * the buyer paid. A preview computed by different arithmetic than the document
 * is worse than no preview, and a "keep in sync" comment is not enforcement.
 *
 * Comparison is TOKEN-based, not a raw text diff: comments are blanked and
 * whitespace outside string literals is collapsed, so reformatting or
 * re-wording a comment is free while any change to the code itself fails.
 * `export` on the mirror side is ignored (core keeps `roundToMinorUnits` private;
 * the mirror keeps it module-private too, but either is accepted).
 *
 * SCOPE, so the wrong guard is not trusted: this script compares the two
 * function implementations only. The `ShippingSplitLine` / `ShippingSplitPart`
 * interfaces are NOT compared - a field added to one side only is caught by the
 * call sites, which type-check against their own declarations - and nothing
 * here asserts that the panel actually calls the mirror.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * Run with `--self-check` to exercise the pure extractor + normalizer against
 * synthetic inputs (no filesystem).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BACKEND_FILE = join(
  'libs',
  'core',
  'src',
  'sales-documents',
  'domain',
  'types',
  'shipping-tax-split.types.ts'
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'invoicing',
  'lib',
  'shipping-tax-split.ts'
);

/** The functions this script keeps identical. */
const MIRRORED_FUNCTIONS = ['splitShippingAcrossRates', 'roundToMinorUnits', 'minorUnitExponentFor'];

const DOCS_REF = 'docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md';

// --------------------------------------------------------------------------
// Pure helpers. Exported so `--self-check` can exercise them directly.
// --------------------------------------------------------------------------

/**
 * Replace every comment with a single space, stepping over string and template
 * literals so a `//` inside one is never mistaken for a comment.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Collapse insignificant whitespace outside string literals, so two prettier
 * runs at different print widths compare equal.
 */
export function normalizeCode(source) {
  const stripped = stripComments(source);
  let out = '';
  let i = 0;
  while (i < stripped.length) {
    const ch = stripped[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < stripped.length) {
        if (stripped[i] === '\\') {
          out += stripped.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += stripped[i];
        if (stripped[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (/\s/.test(ch)) {
      // One space stands in for any run, and is dropped entirely next to a
      // punctuator so `(\n  a,\n  b\n)` equals `(a, b)`.
      const prev = out[out.length - 1];
      let j = i;
      while (j < stripped.length && /\s/.test(stripped[j])) j += 1;
      const following = stripped[j];
      const punct = /[(){}[\],;:?=<>+\-*/%!&|.]/;
      if (prev !== undefined && following !== undefined && !punct.test(prev) && !punct.test(following)) {
        out += ' ';
      }
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.trim();
}

/**
 * Extract one function declaration's full source (signature + body), with the
 * 1-based line it starts on. Brace matching runs over comment-blanked text so a
 * brace inside a doc comment cannot unbalance it. Returns `null` when absent.
 */
export function extractFunction(content, name) {
  const declRe = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*[(<]`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const blanked = stripCommentsPreservingLength(content);
  const open = blanked.indexOf('{', declMatch.index);
  if (open === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = open; i < blanked.length; i += 1) {
    const ch = blanked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  // `export` is dropped: the two files may legitimately differ on visibility.
  const source = content.slice(declMatch.index, end + 1).replace(/^export\s+/, '');
  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, source };
}

/** Blank comments while preserving total length, so offsets stay valid. */
function stripCommentsPreservingLength(source) {
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
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

async function main() {
  const [backendContent, frontendContent] = await Promise.all([
    readFile(join(repoRoot, BACKEND_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];

  for (const name of MIRRORED_FUNCTIONS) {
    const backend = extractFunction(backendContent, name);
    const frontend = extractFunction(frontendContent, name);

    if (!backend) {
      fatal.push(`${BACKEND_FILE}: no 'function ${name}(...)' found`);
      continue;
    }
    if (!frontend) {
      fatal.push(`${FRONTEND_FILE}: no 'function ${name}(...)' found`);
      continue;
    }

    if (normalizeCode(backend.source) !== normalizeCode(frontend.source)) {
      drifts.push({ name, backend, frontend });
    }
  }

  if (fatal.length > 0) {
    console.error('✗ check-shipping-tax-split-mirror: could not locate every function.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-shipping-tax-split-mirror: ${MIRRORED_FUNCTIONS.length} function(s) identical in ` +
        `${BACKEND_FILE} and ${FRONTEND_FILE}.`
    );
    process.exit(0);
  }

  console.error(`✗ check-shipping-tax-split-mirror: ${drifts.length} drifted function(s).\n`);
  for (const { name, backend, frontend } of drifts) {
    console.error(`  ${name}`);
    console.error(`    ${BACKEND_FILE}:${backend.line}  (authoritative)`);
    console.error(`    ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`);
    console.error(
      `      rule: the two implementations must be the same code - edit core first, then paste ` +
        `into the mirror. Comments and formatting are free; the code is not.`
    );
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure extractor + normalizer against synthetic inputs. */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const core = [
    '/** doc with a stray { brace */',
    'export function f(a: number): number {',
    '  // a comment',
    '  if (a > 0) return round(a);',
    '  return 0;',
    '}',
    '',
    'function round(v: number): number {',
    '  return Math.round(v);',
    '}',
  ].join('\n');

  const extracted = extractFunction(core, 'f');
  expect('extracts the whole declaration', extracted?.source.endsWith('}'), true);
  expect('drops the export keyword', extracted?.source.startsWith('function f'), true);
  expect('reports the declaration line', extracted?.line, 2);
  expect('stops at the matching brace', extracted?.source.includes('Math.round'), false);
  expect('absent function -> null', extractFunction(core, 'nope'), null);

  // Reformatted + re-commented copy of the same code compares equal.
  const mirror = [
    '/** different doc entirely */',
    'function f(',
    '  a: number',
    '): number {',
    '  /* reworded */',
    '  if (a > 0)',
    '    return round(a);',
    '  return 0;',
    '}',
  ].join('\n');
  expect(
    'formatting + comments are free',
    normalizeCode(extractFunction(core, 'f').source) ===
      normalizeCode(extractFunction(mirror, 'f').source),
    true
  );

  // A real behaviour change fails.
  const changed = mirror.replace('return 0;', 'return 1;');
  expect(
    'a code change drifts',
    normalizeCode(extractFunction(core, 'f').source) ===
      normalizeCode(extractFunction(changed, 'f').source),
    false
  );

  // Whitespace inside a string literal is significant.
  expect(
    'string literals keep their spaces',
    normalizeCode("const a = 'x  y';"),
    "const a='x  y';"
  );
  expect('a // inside a string is not a comment', stripComments("const a = 'http://x';").trim(), "const a = 'http://x';");

  if (failures.length > 0) {
    console.error('✗ check-shipping-tax-split-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-shipping-tax-split-mirror --self-check: extractor + normalizer behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-shipping-tax-split-mirror: fatal error:', err);
    process.exit(1);
  });
}
