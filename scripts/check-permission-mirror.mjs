#!/usr/bin/env node
/**
 * check-permission-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirror of the backend's
 * permission vocabulary.
 *
 * Rule. `PermissionValues` in
 *   libs/core/src/users/domain/types/role.types.ts   (backend, authoritative)
 * and
 *   apps/web/src/shared/auth/session.types.ts        (frontend mirror)
 * MUST contain exactly the same string literals, in the same order. The FE file
 * cannot import the core type (the browser bundle does not depend on
 * `@openlinker/core`), so the two arrays are copies — and a copy drifts
 * silently: a permission added only to core never reaches `usePermission`, and
 * one added only to the FE type-checks against a `permissions[]` array the API
 * will never populate.
 *
 * Both arrays are parsed TEXTUALLY (no TypeScript import, no transpile) so this
 * script stays a zero-dependency `check:invariants` step like its siblings.
 * Line comments inside either array are stripped before comparison.
 *
 * Run with `--self-check` to exercise the pure parser + differ against
 * synthetic inputs (no filesystem) — mirrors `check-service-interfaces.mjs`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BACKEND_FILE = join('libs', 'core', 'src', 'users', 'domain', 'types', 'role.types.ts');
const FRONTEND_FILE = join('apps', 'web', 'src', 'shared', 'auth', 'session.types.ts');

const DOCS_REF = 'docs/engineering-standards.md#union-types-as-const-pattern-default';

/**
 * Extract the string literals of the `export const PermissionValues = [...] as const;`
 * declaration, with the 1-based line number the declaration starts on.
 * Returns `{ line, values }`, or `null` when the declaration is absent.
 */
export function parsePermissionValues(content) {
  const declRe = /export\s+const\s+PermissionValues\s*=\s*\[/;
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = content
    .slice(openBracket + 1, closeBracket)
    // Strip `//` line comments so annotating an entry can't be read as a value.
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
export function diffPermissionValues(backend, frontend) {
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
    // files are read side-by-side when adding a permission - keep them aligned.
    issues.push(
      `same permissions but different order (backend: ${backend.join(', ')} / frontend: ${frontend.join(', ')})`,
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const backendPath = join(repoRoot, BACKEND_FILE);
  const frontendPath = join(repoRoot, FRONTEND_FILE);

  const [backendContent, frontendContent] = await Promise.all([
    readFile(backendPath, 'utf8'),
    readFile(frontendPath, 'utf8'),
  ]);

  const backend = parsePermissionValues(backendContent);
  const frontend = parsePermissionValues(frontendContent);

  const fatal = [];
  if (!backend) fatal.push(`${BACKEND_FILE}: no 'export const PermissionValues = [...]' found`);
  if (!frontend) fatal.push(`${FRONTEND_FILE}: no 'export const PermissionValues = [...]' found`);
  if (fatal.length > 0) {
    console.error('✗ check-permission-mirror: could not locate both declarations.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  const { ok, issues } = diffPermissionValues(backend.values, frontend.values);

  if (ok) {
    console.log(
      `✓ check-permission-mirror: ${backend.values.length} permission(s) identical in ${BACKEND_FILE} and ${FRONTEND_FILE}.`,
    );
    process.exit(0);
  }

  console.error(`✗ check-permission-mirror: ${issues.length} drift(s).\n`);
  console.error(`  ${BACKEND_FILE}:${backend.line}  (authoritative)`);
  console.error(`  ${FRONTEND_FILE}:${frontend.line}  (hand-maintained mirror)`);
  for (const issue of issues) {
    console.error(`    rule: PermissionValues must be identical in both files - ${issue}`);
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parser + differ against synthetic inputs (no filesystem). */
function selfCheck() {
  const file = (entries) =>
    `/** header */\nexport const PermissionValues = [\n${entries}\n] as const;\n\nexport type Permission = (typeof PermissionValues)[number];\n`;

  const failures = [];
  const expect = (name, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${name}: expected ${wanted}, got ${actual}`);
  };

  const parsed = parsePermissionValues(file("  'a:read',\n  'a:write',"));
  expect('parses two literals', parsed?.values.join(','), 'a:read,a:write');
  expect('reports the declaration line', parsed?.line, 2);

  const commented = parsePermissionValues(
    file("  'a:read',\n  // DISPLAY-ONLY: not 'ghost:write'\n  'a:write',"),
  );
  expect('strips line comments', commented?.values.join(','), 'a:read,a:write');

  const blockCommented = parsePermissionValues(file("  'a:read',\n  /* 'x:y' */\n  'a:write',"));
  expect('strips block comments', blockCommented?.values.join(','), 'a:read,a:write');

  expect('absent declaration → null', parsePermissionValues('export const Other = [];'), null);

  expect('identical arrays → ok', diffPermissionValues(['a', 'b'], ['a', 'b']).ok, true);
  expect('missing in frontend → not ok', diffPermissionValues(['a', 'b'], ['a']).ok, false);
  expect('missing in backend → not ok', diffPermissionValues(['a'], ['a', 'b']).ok, false);
  expect('reordered → not ok', diffPermissionValues(['a', 'b'], ['b', 'a']).ok, false);

  if (failures.length === 0) {
    console.log('✓ check-permission-mirror --self-check: all parser/differ case(s) passed.');
    process.exit(0);
  }

  console.error('✗ check-permission-mirror --self-check failed:\n');
  console.error(failures.join('\n'));
  process.exit(1);
}

const run = process.argv.includes('--self-check') ? selfCheck : main;
Promise.resolve(run()).catch((err) => {
  console.error('check-permission-mirror: fatal error:', err);
  process.exit(1);
});
