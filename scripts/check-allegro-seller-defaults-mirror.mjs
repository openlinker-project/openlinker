#!/usr/bin/env node
/**
 * check-allegro-seller-defaults-mirror.mjs
 *
 * Lint-time invariant for the frontend mirror of Allegro's create-time
 * seller-defaults gate (#2240).
 *
 * Rule. Every `sellerDefaults.*` path that
 *   libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts
 *   → collectMissingSellerDefaultsFields()                       (authoritative)
 * can report as missing MUST appear in
 *   apps/web/src/features/listings/components/allegro/allegro-offer-validation.ts
 *   → ALLEGRO_SELLER_DEFAULT_PATHS                               (hand-maintained mirror)
 * and vice versa.
 *
 * Why a guard rather than a comment. The adapter's gate is the FIRST statement
 * of `createOffer` and is unconditional, so a connection missing any of these
 * fields cannot create a single offer. The frontend re-implements the same rule
 * to refuse the batch before submit - it cannot import the adapter (the browser
 * bundle has no `@openlinker/*` dependency), so it is a copy, and a copy of a
 * gate drifts silently in the direction that hurts: when the adapter grows a
 * fourth required group, the wizard keeps reading green and the operator gets
 * the rejection one child job at a time. That is the exact failure the
 * pre-submit check exists to close, one layer up.
 *
 * SCOPE, so the wrong guard is not trusted. This script compares two SETS of
 * path literals. It says nothing about whether the two halves apply the same
 * PREDICATE to a path (the adapter's truthiness checks versus the frontend's
 * `isFilled`), nor about the operator-facing wording, nor about the type-arm
 * logic on `safetyInformation`. The unit tests on each side cover behaviour;
 * this covers vocabulary. Order is deliberately NOT compared: the adapter's
 * order is control flow, the mirror's is a reading order for humans.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * stays a zero-dependency `check:invariants` step like its siblings.
 *
 * Run with `--self-check` to exercise the pure parser + differ against
 * synthetic inputs (no filesystem) - mirrors
 * `check-parameter-restriction-mirror.mjs`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const ADAPTER_FILE = join(
  'libs',
  'integrations',
  'allegro',
  'src',
  'infrastructure',
  'adapters',
  'allegro-offer-manager.adapter.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'listings',
  'components',
  'allegro',
  'allegro-offer-validation.ts',
);

const ADAPTER_FUNCTION = 'collectMissingSellerDefaultsFields';
const MIRRORED_DECLARATION = 'ALLEGRO_SELLER_DEFAULT_PATHS';
const PATH_PREFIX = 'sellerDefaults.';
const DOCS_REF = 'docs/architecture-overview.md § Listings';

const stripComments = (text) =>
  text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Collect every `'sellerDefaults.*'` literal inside the adapter's gate
 * function. Returns `{ line, values }` (deduped, source order), or `null` when
 * the function is absent - a rename must fail loudly rather than pass with an
 * empty set.
 */
export function parseAdapterPaths(content, functionName) {
  const declRe = new RegExp(`function\\s+${functionName}\\s*\\(`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  // The function body ends at the first brace that closes at column 0, which is
  // how every top-level declaration in this file is formatted.
  const bodyStart = content.indexOf('{', declMatch.index);
  if (bodyStart === -1) return null;
  const bodyEnd = content.indexOf('\n}', bodyStart);
  if (bodyEnd === -1) return null;

  const body = stripComments(content.slice(bodyStart, bodyEnd));
  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    const value = m[1] ?? m[2];
    if (value.startsWith(PATH_PREFIX) && !values.includes(value)) values.push(value);
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, values };
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line the declaration starts on.
 */
export function parseDeclaredPaths(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = stripComments(content.slice(openBracket + 1, closeBracket));
  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }

  const line = content.slice(0, declMatch.index).split('\n').length;
  return { line, values };
}

/** Pure differ over sets. Returns `{ ok, issues }` with one reason each. */
export function diffPaths(adapter, frontend) {
  const issues = [];
  const adapterSet = new Set(adapter);
  const frontendSet = new Set(frontend);

  const missingInFrontend = adapter.filter((v) => !frontendSet.has(v));
  const missingInAdapter = frontend.filter((v) => !adapterSet.has(v));

  if (missingInFrontend.length > 0) {
    issues.push(
      `the adapter gate can report these, and the frontend mirror does not know them (the wizard would read GREEN and every offer would be rejected): ${missingInFrontend
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (missingInAdapter.length > 0) {
    issues.push(
      `the frontend mirror lists these and the adapter gate never reports them (the wizard would refuse a batch the adapter accepts): ${missingInAdapter
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const [adapterContent, frontendContent] = await Promise.all([
    readFile(join(repoRoot, ADAPTER_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
  ]);

  const adapter = parseAdapterPaths(adapterContent, ADAPTER_FUNCTION);
  const frontend = parseDeclaredPaths(frontendContent, MIRRORED_DECLARATION);

  const fatal = [];
  if (!adapter) fatal.push(`${ADAPTER_FILE}: no 'function ${ADAPTER_FUNCTION}(' found`);
  if (!frontend) {
    fatal.push(`${FRONTEND_FILE}: no 'export const ${MIRRORED_DECLARATION} = [...]' found`);
  }
  if (fatal.length > 0) {
    console.error('✗ check-allegro-seller-defaults-mirror: could not locate a side of the mirror.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  const { ok, issues } = diffPaths(adapter.values, frontend.values);
  if (ok) {
    console.log(
      `✓ check-allegro-seller-defaults-mirror: ${adapter.values.length} sellerDefaults path(s) ` +
        `identical in ${ADAPTER_FUNCTION} and ${MIRRORED_DECLARATION}.`,
    );
    process.exit(0);
  }

  console.error('✗ check-allegro-seller-defaults-mirror: the mirror drifted.\n');
  console.error(`    ${ADAPTER_FILE}:${adapter.line}  ${ADAPTER_FUNCTION} (authoritative)`);
  console.error(`    ${FRONTEND_FILE}:${frontend.line}  ${MIRRORED_DECLARATION} (mirror)`);
  for (const issue of issues) {
    console.error(`      rule: both sides must name the same paths - ${issue}`);
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parser + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const adapterFile = (body) =>
    `/** header */\nfunction ${ADAPTER_FUNCTION}(\n  defaults: X | undefined\n): string[] {\n${body}\n}\n` +
    `\nfunction unrelated(): void {\n  push('sellerDefaults.ghost');\n}\n`;

  const parsed = parseAdapterPaths(
    adapterFile("  missing.push('sellerDefaults.location.city');\n  missing.push('sellerDefaults.responsibleProducerId');"),
    ADAPTER_FUNCTION,
  );
  expect(
    'collects paths from the gate body',
    parsed?.values.join(','),
    'sellerDefaults.location.city,sellerDefaults.responsibleProducerId',
  );
  expect('reports the declaration line', parsed?.line, 2);

  expect(
    'stops at the end of the gate body, ignoring later functions',
    parseAdapterPaths(adapterFile("  missing.push('sellerDefaults.location');"), ADAPTER_FUNCTION)
      ?.values.join(','),
    'sellerDefaults.location',
  );

  expect(
    'strips line comments',
    parseAdapterPaths(
      adapterFile("  // was: missing.push('sellerDefaults.retired')\n  missing.push('sellerDefaults.location');"),
      ADAPTER_FUNCTION,
    )?.values.join(','),
    'sellerDefaults.location',
  );

  expect(
    'strips block comments',
    parseAdapterPaths(
      adapterFile("  /* 'sellerDefaults.retired' */\n  missing.push('sellerDefaults.location');"),
      ADAPTER_FUNCTION,
    )?.values.join(','),
    'sellerDefaults.location',
  );

  expect(
    'ignores literals that are not sellerDefaults paths',
    parseAdapterPaths(
      adapterFile("  log('some message');\n  missing.push('sellerDefaults.location');"),
      ADAPTER_FUNCTION,
    )?.values.join(','),
    'sellerDefaults.location',
  );

  expect(
    'dedupes a path pushed on two branches',
    parseAdapterPaths(
      adapterFile("  missing.push('sellerDefaults.location');\n  missing.push('sellerDefaults.location');"),
      ADAPTER_FUNCTION,
    )?.values.length,
    1,
  );

  expect('renamed gate → null', parseAdapterPaths('function other() {\n}\n', ADAPTER_FUNCTION), null);

  const feFile = (entries) =>
    `/** header */\nconst UNRELATED = ['sellerDefaults.ghost'] as const;\n\n` +
    `export const ${MIRRORED_DECLARATION} = [\n${entries}\n] as const;\n`;
  expect(
    'selects the requested declaration, not the first array',
    parseDeclaredPaths(feFile("  'sellerDefaults.location',"), MIRRORED_DECLARATION)?.values.join(','),
    'sellerDefaults.location',
  );
  expect(
    'absent declaration → null',
    parseDeclaredPaths('const Other = [];', MIRRORED_DECLARATION),
    null,
  );

  expect('identical sets → ok', diffPaths(['a', 'b'], ['a', 'b']).ok, true);
  expect('different order, same set → ok', diffPaths(['a', 'b'], ['b', 'a']).ok, true);
  expect('missing in frontend → not ok', diffPaths(['a', 'b'], ['a']).ok, false);
  expect('missing in adapter → not ok', diffPaths(['a'], ['a', 'b']).ok, false);

  if (failures.length > 0) {
    console.error('✗ check-allegro-seller-defaults-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-allegro-seller-defaults-mirror --self-check: parser + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  await main();
}
