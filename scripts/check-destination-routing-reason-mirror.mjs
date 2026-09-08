#!/usr/bin/env node
/**
 * check-destination-routing-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * destination-routing reason vocabulary (#2703 / #2704).
 *
 * Rule A — MIRROR. `DestinationRoutingBlockReasonValues` in
 *   libs/core/src/orders/domain/types/destination-routing-block.types.ts  (backend, authoritative)
 * and
 *   apps/web/src/features/orders/api/orders.types.ts                      (frontend mirror)
 * MUST contain exactly the same string literals, in the same order.
 *
 * The FE file cannot import the core type (the browser bundle does not depend on
 * `@openlinker/core`, #591), so the arrays are copies — and a copy drifts
 * silently in BOTH directions: a reason added only to core renders as an
 * unlabelled badge, and one added only to the FE type-checks against a value the
 * API will never send. A prose "keep in sync" comment is not enforcement.
 *
 * Rule B — COPY COVERAGE. `DESTINATION_ROUTING_REASON_COPY` must carry exactly
 *   one entry per reason. Membership only: the `satisfies Record<…>` in the copy
 *   file enforces it against the FRONTEND type, and this check is what enforces
 *   it against the BACKEND union, which the type system cannot see.
 *
 * ORDER is compared even though nothing here derives meaning from it — unlike
 * `check-return-stage-mirror.mjs`, where the array order IS the stage ordinal.
 * It is compared because an order-insensitive diff is strictly weaker for no
 * benefit, NOT because a reorder would change behaviour. Do not cite this file
 * as evidence that the order is load-bearing.
 *
 * SCOPE, so the wrong guard is not trusted: this script compares an ARRAY and a
 * set of object keys, TEXTUALLY. It says nothing about whether the copy reads
 * correctly, whether a reason is counted, or whether any surface renders it.
 * The counted subset is derived at runtime on BOTH sides (core `.filter`s its
 * own array; the FE derives from the copy table's `tone`), so no third list
 * exists here to drift.
 *
 * The two parsers are COPIED from `check-sales-document-reason-mirror.mjs`
 * rather than imported, and that is deliberate rather than lazy. That module
 * exports them, but it also calls `main()` at top level with no
 * import-vs-executed guard — so importing it would RUN the sales-document check
 * as a side effect of running this one, and a failure there would exit this
 * process before it did its own work, reporting the wrong guard as broken.
 * Adding a main-guard to a shipped invariant was rejected as the riskier change:
 * a subtly wrong guard there makes that check silently never run, which is worse
 * than a duplicated parser. Every sibling guard is self-contained for the same
 * reason.
 *
 * Run with `--self-check` to exercise the differ against synthetic inputs (no
 * filesystem) — mirrors every sibling guard.
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
  'orders',
  'domain',
  'types',
  'destination-routing-block.types.ts',
);
const FRONTEND_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'orders.types.ts');
const COPY_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'orders',
  'lib',
  'destination-routing-copy.ts',
);

const DECLARATION = 'DestinationRoutingBlockReasonValues';
const COPY_DECLARATION = 'DESTINATION_ROUTING_REASON_COPY';
const DOCS_REF = 'docs/architecture-overview.md § Orders';


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
 * literals); it is deliberately NOT applied to `parseCopyKeys`, whose input is
 * operator prose that may legitimately contain `//` or `*` inside a string.
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

/**
 * Extract the TOP-LEVEL keys of `export const <name> = { ... } satisfies ...;`.
 *
 * Brace-matched rather than regex-scanned, because a copy entry is itself an
 * object and a nested key must not be read as a reason id. String bodies are
 * skipped so a brace or a quote inside operator copy cannot end the scan early.
 * Returns `{ line, keys }`, or `null` when the declaration is absent.
 */
function parseCopyKeys(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const open = declMatch.index + declMatch[0].length - 1;
  const keys = [];
  let depth = 0;
  let quote = null;
  let pendingKey = null;

  for (let i = open; i < content.length; i += 1) {
    const ch = content[i];

    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && content[i + 1] === '/') {
      i = content.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = findStringEnd(content, i);
      if (end === -1) break;
      if (depth === 1) pendingKey = content.slice(i + 1, end);
      i = end;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) break;
      continue;
    }

    if (ch === ':' && depth === 1 && pendingKey !== null) {
      keys.push(pendingKey);
      pendingKey = null;
      continue;
    }
    if (ch === ',' && depth === 1) {
      pendingKey = null;
    }
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, keys };
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
      issues.push(`'${reason}' has no entry in ${COPY_DECLARATION}`);
    }
  }
  for (const key of copyKeys) {
    if (!reasons.includes(key)) {
      issues.push(`${COPY_DECLARATION} carries '${key}', which is not a reason value`);
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
  expect('full copy coverage is ok', diffCopyCoverage(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing copy entry fails', diffCopyCoverage(['a', 'b'], ['a']).ok, false);
  expect('orphan copy entry fails', diffCopyCoverage(['a'], ['a', 'b']).ok, false);
  // Both sides empty compares EQUAL — the pure diff is vacuous by design,
  // which is exactly why `main` refuses an empty parse before calling it.
  // Pinned so nobody "fixes" the vacuity here and drops the guard there.
  expect('empty vs empty is vacuously ok', diffReasonValues([], []).ok, true);

  // The local parsers are exercised too — a copied parser that silently stopped
  // reading literals would make every comparison vacuously pass.
  const parsed = parseReasonValues(`export const X = [\n  // note\n  'one',\n  'two',\n] as const;`, 'X');
  expect('parser reads literals', parsed?.values.join(','), 'one,two');
  // A `]` inside a per-entry docblock must not end the array scan. This is the
  // exact input the sibling's parser reads as EMPTY; see parseReasonValues.
  const bracketed = parseReasonValues(
    `export const X = [\n  /** carries [] here */\n  'one',\n  'two',\n] as const;`,
    'X',
  );
  expect('bracket in a comment does not truncate', bracketed?.values.join(','), 'one,two');
  expect('line number survives comment blanking', parseReasonValues(`\n\nexport const X = ['a'] as const;`, 'X')?.line, 3);
  const keys = parseCopyKeys(`export const C = {\n  'one': { label: 'x' },\n} as const satisfies R;`, 'C');
  expect('parser reads copy keys', keys?.keys.join(','), 'one');

  if (failures.length > 0) {
    console.error('✗ check-destination-routing-reason-mirror self-check FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ check-destination-routing-reason-mirror self-check passed');
}

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const [backendSrc, frontendSrc, copySrc] = await Promise.all([
    readFile(join(repoRoot, BACKEND_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
    readFile(join(repoRoot, COPY_FILE), 'utf8'),
  ]);

  const backend = parseReasonValues(backendSrc, DECLARATION);
  const frontend = parseReasonValues(frontendSrc, DECLARATION);
  const copy = parseCopyKeys(copySrc, COPY_DECLARATION);

  // An EMPTY parse is fatal, not merely a parse that found no declaration.
  //
  // `diffReasonValues([], [])` is `ok`, so a parser that silently read zero
  // literals from both sides would print `0 reason value(s) identical` and pass
  // while asserting nothing — the same green reading for "not covered" and
  // "covered and passing" that #2673 rejects. That is also the OTHER half of
  // the sibling's defect this file's `parseReasonValues` fixes (#3002): the
  // comment-order bug made both sides parse as empty, and only an emptiness
  // guard turns that into a failure rather than a vacuous pass. The shape is
  // `check-attention-reason-mirror.mjs`'s `need` / `needEntries`.
  const fatal = [];
  const needValues = (parsed, file) => {
    if (!parsed) {
      fatal.push(`${file}: could not find \`export const ${DECLARATION} = [\``);
    } else if (parsed.values.length === 0) {
      fatal.push(`${file}:${parsed.line}: \`${DECLARATION}\` parsed as EMPTY — refusing to compare`);
    }
  };
  needValues(backend, BACKEND_FILE);
  needValues(frontend, FRONTEND_FILE);
  if (!copy) {
    fatal.push(`${COPY_FILE}: could not find \`export const ${COPY_DECLARATION} = {\``);
  } else if (copy.keys.length === 0) {
    fatal.push(`${COPY_FILE}:${copy.line}: \`${COPY_DECLARATION}\` parsed as EMPTY — refusing to compare`);
  }

  if (fatal.length > 0) {
    console.error('✗ check-destination-routing-reason-mirror FAILED');
    for (const f of fatal) console.error(`  - ${f}`);
    console.error(`  See ${DOCS_REF}`);
    process.exit(1);
  }

  const drift = diffReasonValues(backend.values, frontend.values);
  const copyDrift = diffCopyCoverage(backend.values, copy.keys);

  if (!drift.ok || !copyDrift.ok) {
    console.error('✗ check-destination-routing-reason-mirror FAILED');
    if (!drift.ok) {
      console.error(`  ${BACKEND_FILE}:${backend.line} vs ${FRONTEND_FILE}:${frontend.line}`);
      for (const issue of drift.issues) console.error(`  - ${issue}`);
    }
    if (!copyDrift.ok) {
      console.error(`  ${COPY_FILE}:${copy.line}`);
      for (const issue of copyDrift.issues) console.error(`  - ${issue}`);
    }
    console.error(`  See ${DOCS_REF}`);
    process.exit(1);
  }

  console.log(
    `✓ check-destination-routing-reason-mirror: ${backend.values.length} reason value(s) identical ` +
      `across core and the frontend mirror, each with copy`,
  );
}

Promise.resolve(main()).catch((error) => {
  console.error('✗ check-destination-routing-reason-mirror crashed');
  console.error(error);
  process.exit(1);
});
