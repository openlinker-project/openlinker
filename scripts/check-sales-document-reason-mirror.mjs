#!/usr/bin/env node
/**
 * check-sales-document-reason-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * sales-document reason vocabularies (#2100, ADR-041 decision 11).
 *
 * Rule. `SalesDocumentGateBlockReasonValues` and
 * `SalesDocumentUnresolvedReasonValues` in
 *   libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts  (backend, authoritative)
 * and
 *   apps/web/src/features/orders/api/orders.types.ts                            (frontend mirror)
 * MUST contain exactly the same string literals, in the same order.
 *
 * The FE file cannot import the core type (the browser bundle does not depend on
 * `@openlinker/core`), so the arrays are copies — and a copy drifts silently in
 * BOTH directions: a reason added only to core reaches the browser as a value the
 * badge mapper has no label for, and one added only to the FE type-checks against
 * a value the API will never send. A prose "keep in sync" comment is not
 * enforcement; this is.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 * Line and block comments inside either array are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parser + differ against synthetic
 * inputs (no filesystem) — mirrors `check-permission-mirror.mjs`.
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
  'sales-document-reason.types.ts',
);
const FRONTEND_FILE = join('apps', 'web', 'src', 'features', 'orders', 'api', 'orders.types.ts');

/** The two `as const` arrays this script keeps aligned. */
const MIRRORED_DECLARATIONS = [
  'SalesDocumentGateBlockReasonValues',
  'SalesDocumentUnresolvedReasonValues',
];

const DOCS_REF = 'docs/architecture/adrs/041-sales-document-routing-policy.md';

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 */
export function parseReasonValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = content
    .slice(openBracket + 1, closeBracket)
    // Strip comments so annotating an entry can't be read as a value.
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

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
 * Pure differ. Returns `{ ok, issues }` where each issue is a human-readable
 * reason string describing one asymmetric difference.
 */
export function diffReasonValues(backend, frontend) {
  const issues = [];

  const backendSet = new Set(backend);
  const frontendSet = new Set(frontend);

  const missingInFrontend = backend.filter((v) => !frontendSet.has(v));
  const missingInBackend = frontend.filter((v) => !backendSet.has(v));

  if (missingInFrontend.length > 0) {
    issues.push(
      `present in the backend but MISSING from the frontend mirror: ${missingInFrontend
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (missingInBackend.length > 0) {
    issues.push(
      `present in the frontend mirror but MISSING from the backend: ${missingInBackend
        .map((v) => `'${v}'`)
        .join(', ')}`,
    );
  }
  if (issues.length === 0 && backend.join('|') !== frontend.join('|')) {
    // Same membership, different order. Not a functional break today, but the
    // files are read side-by-side when adding a reason - keep them aligned.
    issues.push(
      `same values but different order (backend: ${backend.join(', ')} / frontend: ${frontend.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const [backendContent, frontendContent] = await Promise.all([
    readFile(join(repoRoot, BACKEND_FILE), 'utf8'),
    readFile(join(repoRoot, FRONTEND_FILE), 'utf8'),
  ]);

  const fatal = [];
  const drifts = [];
  let compared = 0;

  for (const name of MIRRORED_DECLARATIONS) {
    const backend = parseReasonValues(backendContent, name);
    const frontend = parseReasonValues(frontendContent, name);

    if (!backend) {
      fatal.push(`${BACKEND_FILE}: no 'export const ${name} = [...]' found`);
      continue;
    }
    if (!frontend) {
      fatal.push(`${FRONTEND_FILE}: no 'export const ${name} = [...]' found`);
      continue;
    }

    const { ok, issues } = diffReasonValues(backend.values, frontend.values);
    compared += backend.values.length;
    if (!ok) {
      drifts.push({ name, backend, frontend, issues });
    }
  }

  if (fatal.length > 0) {
    console.error('✗ check-sales-document-reason-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-sales-document-reason-mirror: ${compared} reason value(s) across ` +
        `${MIRRORED_DECLARATIONS.length} union(s) identical in ${BACKEND_FILE} and ${FRONTEND_FILE}.`,
    );
    process.exit(0);
  }

  console.error(`✗ check-sales-document-reason-mirror: ${drifts.length} drifted union(s).\n`);
  for (const { name, backend, frontend, issues } of drifts) {
    console.error(`  ${name}`);
    console.error(`    ${BACKEND_FILE}:${backend.line}  (authoritative)`);
    console.error(`    ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`);
    for (const issue of issues) {
      console.error(`      rule: ${name} must be identical in both files - ${issue}`);
    }
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parser + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const file = (name, entries) =>
    `/** header */\nexport const ${name} = [\n${entries}\n] as const;\n` +
    `\nexport type X = (typeof ${name})[number];\n`;

  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  const name = 'SalesDocumentGateBlockReasonValues';

  const parsed = parseReasonValues(file(name, "  'a-x',\n  'b-y',"), name);
  expect('parses two literals', parsed?.values.join(','), 'a-x,b-y');
  expect('reports the declaration line', parsed?.line, 2);

  const commented = parseReasonValues(
    file(name, "  'a-x',\n  // never written: 'ghost-value'\n  'b-y',"),
    name,
  );
  expect('strips line comments', commented?.values.join(','), 'a-x,b-y');

  const blockCommented = parseReasonValues(file(name, "  'a-x',\n  /* 'ghost' */\n  'b-y',"), name);
  expect('strips block comments', blockCommented?.values.join(','), 'a-x,b-y');

  // The two unions live in the same file, so the parser must key on the NAME and
  // not simply grab the first `as const` array it finds.
  const twoUnions =
    file('SalesDocumentGateBlockReasonValues', "  'gate-1',") +
    file('SalesDocumentUnresolvedReasonValues', "  'unresolved-1',");
  expect(
    'selects the requested declaration, not the first one',
    parseReasonValues(twoUnions, 'SalesDocumentUnresolvedReasonValues')?.values.join(','),
    'unresolved-1',
  );

  expect('absent declaration → null', parseReasonValues('export const Other = [];', name), null);

  expect('identical arrays → ok', diffReasonValues(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing in frontend → not ok', diffReasonValues(['a', 'b'], ['a']).ok, false);
  expect('missing in backend → not ok', diffReasonValues(['a'], ['a', 'b']).ok, false);
  expect('reordered → not ok', diffReasonValues(['a', 'b'], ['b', 'a']).ok, false);

  if (failures.length > 0) {
    console.error('✗ check-sales-document-reason-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-sales-document-reason-mirror --self-check: parser + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  await main();
}
