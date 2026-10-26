#!/usr/bin/env node
/**
 * check-permission-mirror.mjs
 *
 * Lint-time invariant for the hand-maintained frontend mirrors of the backend's
 * permission and role vocabularies.
 *
 * Two pairs are checked, with one parser and one differ:
 *   - `PermissionValues` (core) vs `PermissionValues` (apps/web session.types.ts)
 *   - `UserRoleValues`   (core) vs `RoleValues`       (apps/web nav-registry.types.ts)
 *     The role copy is the one a nav gate reads; a role missing from it fails
 *     CLOSED (the item is hidden), so the drift is silent rather than loud,
 *     which is exactly why it needs a build-time comparison.
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

const FRONTEND_ROLE_FILE = join('apps', 'web', 'src', 'app', 'nav-registry.types.ts');

const DOCS_REF = 'docs/engineering-standards.md#union-types-as-const-pattern-default';

/**
 * Blank `//` and `/* ... *\/` comments to spaces (newlines preserved), so a `]`
 * written inside a comment can never be mistaken for the declaration's real
 * closing bracket. Length-preserving: any index found in the blanked string is
 * a valid index into the original.
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
 * Extract the string literals of the `export const PermissionValues = [...] as const;`
 * declaration, with the 1-based line number the declaration starts on.
 * Returns `{ line, values }`, or `null` when the declaration is absent.
 *
 * The closing bracket is located on a COMMENT-BLANKED copy of the content, or
 * a `]` written inside a comment between the real brackets is mistaken for the
 * declaration's own close and truncates everything after it (#3002).
 */
export function parsePermissionValues(content) {
  return parseConstArray(content, 'PermissionValues');
}

/** Same parse for any `export const <name> = [...] as const;` declaration. */
export function parseConstArray(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = blankComments(content).indexOf(']', openBracket);
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
export function diffPermissionValues(backend, frontend, noun = 'permission') {
  const issues = [];

  const backendSet = new Set(backend);
  const frontendSet = new Set(frontend);

  const missingInFrontend = backend.filter((v) => !frontendSet.has(v));
  const missingInBackend = frontend.filter((v) => !backendSet.has(v));

  if (missingInFrontend.length > 0) {
    issues.push(
      `present in the backend but MISSING from the frontend mirror: ${missingInFrontend
        .map((v) => `'${v}'`)
        .join(', ')}`
    );
  }
  if (missingInBackend.length > 0) {
    issues.push(
      `present in the frontend mirror but MISSING from the backend: ${missingInBackend
        .map((v) => `'${v}'`)
        .join(', ')}`
    );
  }
  if (issues.length === 0 && backend.join('|') !== frontend.join('|')) {
    // Same membership, different order. Not a functional break today, but the
    // files are read side-by-side when adding a permission - keep them aligned.
    issues.push(
      `same ${noun}s but different order (backend: ${backend.join(', ')} / frontend: ${frontend.join(', ')})`
    );
  }

  return { ok: issues.length === 0, issues };
}

const PAIRS = [
  {
    noun: 'permission',
    backendName: 'PermissionValues',
    frontendName: 'PermissionValues',
    backendFile: BACKEND_FILE,
    frontendFile: FRONTEND_FILE,
  },
  {
    noun: 'role',
    backendName: 'UserRoleValues',
    frontendName: 'RoleValues',
    backendFile: BACKEND_FILE,
    frontendFile: FRONTEND_ROLE_FILE,
  },
];

async function main() {
  const failures = [];
  const summaries = [];

  for (const pair of PAIRS) {
    const [backendContent, frontendContent] = await Promise.all([
      readFile(join(repoRoot, pair.backendFile), 'utf8'),
      readFile(join(repoRoot, pair.frontendFile), 'utf8'),
    ]);
    const backend = parseConstArray(backendContent, pair.backendName);
    const frontend = parseConstArray(frontendContent, pair.frontendName);

    const fatal = [];
    for (const [side, parsed, file, name] of [
      ['backend', backend, pair.backendFile, pair.backendName],
      ['frontend', frontend, pair.frontendFile, pair.frontendName],
    ]) {
      if (!parsed) {
        fatal.push(`${file}: no 'export const ${name} = [...]' found`);
      } else if (parsed.values.length === 0) {
        fatal.push(
          `${file}: ${name} parsed to ZERO values - the PARSER is broken (a ` +
            `bracket inside a comment likely truncated the array), not the ${side} union legitimately empty`
        );
      }
    }
    if (fatal.length > 0) {
      failures.push(
        `could not locate both ${pair.noun} declarations.\n` + fatal.map((f) => `  ${f}`).join('\n')
      );
      continue;
    }

    const { ok, issues } = diffPermissionValues(backend.values, frontend.values, pair.noun);
    if (ok) {
      summaries.push(
        `${backend.values.length} ${pair.noun}(s) identical in ${pair.backendFile} and ${pair.frontendFile}`
      );
      continue;
    }
    failures.push(
      [
        `${issues.length} ${pair.noun} drift(s).`,
        `  ${pair.backendFile}:${backend.line}  (authoritative, ${pair.backendName})`,
        `  ${pair.frontendFile}:${frontend.line}  (hand-maintained mirror, ${pair.frontendName})`,
        ...issues.map(
          (issue) =>
            `    rule: ${pair.backendName} and ${pair.frontendName} must be identical - ${issue}`
        ),
        `    docs: ${DOCS_REF}`,
      ].join('\n')
    );
  }

  if (failures.length === 0) {
    console.log(`✓ check-permission-mirror: ${summaries.join('; ')}.`);
    process.exit(0);
  }
  console.error('✗ check-permission-mirror:\n');
  for (const f of failures) console.error(`${f}\n`);
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
    file("  'a:read',\n  // DISPLAY-ONLY: not 'ghost:write'\n  'a:write',")
  );
  expect('strips line comments', commented?.values.join(','), 'a:read,a:write');

  const blockCommented = parsePermissionValues(file("  'a:read',\n  /* 'x:y' */\n  'a:write',"));
  expect('strips block comments', blockCommented?.values.join(','), 'a:read,a:write');

  expect('absent declaration → null', parsePermissionValues('export const Other = [];'), null);

  // #3002: a `]` inside a comment BETWEEN the real brackets must not truncate
  // the array. Red-first against the pre-fix `indexOf(']', openBracket)` on
  // raw content: that stopped at the comment's own `]`.
  const lineCommentWithBracket = parsePermissionValues(
    file("  'a:read', // e.g. permissions: []\n  'a:write',")
  );
  expect(
    'a "]" inside a line comment does not truncate the array',
    lineCommentWithBracket?.values.join(','),
    'a:read,a:write'
  );

  const blockCommentWithBracket = parsePermissionValues(
    file("  'a:read', /* e.g. permissions: [] */\n  'a:write',")
  );
  expect(
    'a "]" inside a block comment does not truncate the array',
    blockCommentWithBracket?.values.join(','),
    'a:read,a:write'
  );

  const commentedBeforeDecl = `// mentions a bracket like foo(): []\n${file("  'a:read',")}`;
  expect(
    'a "]" inside a comment BEFORE the declaration does not shift the reported line',
    parsePermissionValues(commentedBeforeDecl)?.line,
    3 // leading comment (1) + the helper's own `/** header */` (2) + the decl (3)
  );

  expect(
    'a declaration whose every entry is commented out parses to zero values',
    parsePermissionValues(file("  // 'a:read',\n"))?.values.length,
    0
  );

  const roleFile = `export const RoleValues = ['admin', 'packer'] as const;\n`;
  expect(
    'parseConstArray reads a differently-named declaration',
    parseConstArray(roleFile, 'RoleValues')?.values.join(','),
    'admin,packer'
  );
  expect(
    'parseConstArray does not match a name that merely CONTAINS the target',
    parseConstArray(roleFile, 'Values'),
    null
  );
  expect(
    'a role diff names the noun in the reorder issue',
    diffPermissionValues(['a', 'b'], ['b', 'a'], 'role').issues[0].startsWith('same roles'),
    true
  );

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
