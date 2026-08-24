#!/usr/bin/env node
/**
 * check-parameter-restriction-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the
 * category-parameter restriction vocabulary (#2243).
 *
 * Rule. `ParameterRestrictionIssueCodeValues` in
 *   libs/core/src/listings/domain/types/parameter-restriction.types.ts   (backend, authoritative)
 * and
 *   apps/web/src/features/listings/lib/parameter-restrictions.ts          (frontend mirror)
 * MUST contain exactly the same string literals, in the same order.
 *
 * The FE file cannot import the core type (the browser bundle does not depend on
 * `@openlinker/core`), so the arrays are copies - and a copy drifts silently in
 * BOTH directions. The consequence here is specific: the two halves check the
 * same declared bound on different values (the operator's in Review, the
 * mapping rule's in core), so a code present on one side only means an operator
 * is told one thing in the wizard and something else in a failed record.
 *
 * SCOPE, so the wrong guard is not trusted: this script compares two ARRAYS. It
 * says nothing about whether the two checkers produce the same MESSAGE for the
 * same input, nor whether every code is actually raised - the unit tests on each
 * side cover that. Adding a code to both arrays and implementing it in neither
 * passes here.
 *
 * Both files are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 * Line and block comments inside either array are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parser + differ against synthetic
 * inputs (no filesystem) - mirrors `check-sales-document-reason-mirror.mjs`.
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
  'listings',
  'domain',
  'types',
  'parameter-restriction.types.ts',
);
const FRONTEND_FILE = join(
  'apps',
  'web',
  'src',
  'features',
  'listings',
  'lib',
  'parameter-restrictions.ts',
);

const MIRRORED_DECLARATION = 'ParameterRestrictionIssueCodeValues';
const DOCS_REF = 'docs/architecture-overview.md § Listings';

/**
 * Extract the string literals of `export const <name> = [...] as const;`, with
 * the 1-based line number the declaration starts on. Returns `{ line, values }`,
 * or `null` when the declaration is absent.
 */
export function parseCodeValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = content
    .slice(openBracket + 1, closeBracket)
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

/** Pure differ. Returns `{ ok, issues }` with one human-readable reason each. */
export function diffCodeValues(backend, frontend) {
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

  const backend = parseCodeValues(backendContent, MIRRORED_DECLARATION);
  const frontend = parseCodeValues(frontendContent, MIRRORED_DECLARATION);

  const fatal = [];
  if (!backend) fatal.push(`${BACKEND_FILE}: no 'export const ${MIRRORED_DECLARATION} = [...]' found`);
  if (!frontend) fatal.push(`${FRONTEND_FILE}: no 'export const ${MIRRORED_DECLARATION} = [...]' found`);
  if (fatal.length > 0) {
    console.error('✗ check-parameter-restriction-mirror: could not locate the declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  const { ok, issues } = diffCodeValues(backend.values, frontend.values);
  if (ok) {
    console.log(
      `✓ check-parameter-restriction-mirror: ${backend.values.length} issue code(s) identical in ` +
        `${BACKEND_FILE} and ${FRONTEND_FILE}.`,
    );
    process.exit(0);
  }

  console.error('✗ check-parameter-restriction-mirror: the mirror drifted.\n');
  console.error(`  ${MIRRORED_DECLARATION}`);
  console.error(`    ${BACKEND_FILE}:${backend.line}  (authoritative)`);
  console.error(`    ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`);
  for (const issue of issues) {
    console.error(`      rule: ${MIRRORED_DECLARATION} must be identical in both files - ${issue}`);
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

  const name = MIRRORED_DECLARATION;

  const parsed = parseCodeValues(file(name, "  'VALUE_TOO_SHORT',\n  'VALUE_TOO_LONG',"), name);
  expect('parses two literals', parsed?.values.join(','), 'VALUE_TOO_SHORT,VALUE_TOO_LONG');
  expect('reports the declaration line', parsed?.line, 2);

  const commented = parseCodeValues(
    file(name, "  'VALUE_TOO_SHORT',\n  // never shipped: 'GHOST_CODE'\n  'VALUE_TOO_LONG',"),
    name,
  );
  expect('strips line comments', commented?.values.join(','), 'VALUE_TOO_SHORT,VALUE_TOO_LONG');

  const blockCommented = parseCodeValues(
    file(name, "  'VALUE_TOO_SHORT',\n  /* 'GHOST_CODE' */\n  'VALUE_TOO_LONG',"),
    name,
  );
  expect('strips block comments', blockCommented?.values.join(','), 'VALUE_TOO_SHORT,VALUE_TOO_LONG');

  // The FE file declares a second `as const` array too, so the parser must key
  // on the NAME rather than grabbing the first array it finds.
  const twoArrays =
    file('SomeOtherValues', "  'unrelated',") + file(name, "  'VALUE_BELOW_MIN',");
  expect(
    'selects the requested declaration, not the first one',
    parseCodeValues(twoArrays, name)?.values.join(','),
    'VALUE_BELOW_MIN',
  );

  expect('absent declaration → null', parseCodeValues('export const Other = [];', name), null);

  expect('identical arrays → ok', diffCodeValues(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing in frontend → not ok', diffCodeValues(['a', 'b'], ['a']).ok, false);
  expect('missing in backend → not ok', diffCodeValues(['a'], ['a', 'b']).ok, false);
  expect('reordered → not ok', diffCodeValues(['a', 'b'], ['b', 'a']).ok, false);

  if (failures.length > 0) {
    console.error('✗ check-parameter-restriction-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-parameter-restriction-mirror --self-check: parser + differ behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-parameter-restriction-mirror: fatal error:', err);
    process.exit(1);
  });
}
