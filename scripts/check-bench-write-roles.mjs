/**
 * `bench:write`'s holders must be exactly the bench controllers' `@Roles` list
 * (#3439 review)
 *
 * The grant's own comment in `role.types.ts` states the rule:
 *
 *   > The roles holding it MUST stay identical to the `@Roles` lists on
 *   > `BenchWorkController` and `BenchParcelController` … a UI that offers
 *   > what the route refuses (or hides what it allows, which is what happened
 *   > here) is the defect either way.
 *
 * Until now that rule was enforced by the comment. Its violation is exactly
 * the defect #3424 fixed: `ROLE_PERMISSIONS.packer` was `[]` while both bench
 * claim controls gated on `orders:write`, so the controls rendered ZERO times
 * for the one role the routes admit — and nothing failed, because a control
 * that never renders breaks no assertion. It took a live E2E sweep to notice.
 *
 * The failure is silent in BOTH directions, which is why this compares the
 * sets rather than one inclusion:
 *
 *   - a role on the routes but NOT holding the permission sees no controls
 *     while the API would serve it (the #3424 defect);
 *   - a role holding the permission but NOT on the routes is offered controls
 *     the API will refuse (the same defect wearing the other face).
 *
 * Parsed TEXTUALLY — no TypeScript import, no transpile — so this stays a
 * zero-dependency `check:invariants` step like its siblings
 * (`check-permission-mirror.mjs` is the closest one in shape).
 *
 * Run with `--self-check` to exercise the pure parser + differ against
 * synthetic inputs, with no filesystem access at all.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
// `bench:write` is held by the roles on the bench's MUTATING routes (anything but
// GET); `bench:read` (#3734) by the roles on ANY of its routes. A viewer is on
// the GET routes only, so it holds the second and not the first - which is the
// whole point of the read-only preview.
const CHECKS = [
  { permission: 'bench:write', routes: 'mutating' },
  { permission: 'bench:read', routes: 'any' },
];

const ROLE_TYPES = 'libs/core/src/users/domain/types/role.types.ts';
const CONTROLLERS = [
  'apps/api/src/bench/http/bench-work.controller.ts',
  'apps/api/src/bench/http/bench-parcel.controller.ts',
];

/**
 * Strip comments so a role named in prose is never mistaken for a decorator
 * argument or a `ROLE_PERMISSIONS` entry. Both parsers below run on the
 * stripped text; neither ever sees a comment.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Which roles hold `permission`, read off `ROLE_PERMISSIONS`.
 *
 * `admin: PermissionValues` is the whole set by construction, so admin holds
 * every permission without naming one — recognised explicitly rather than
 * being read as "admin holds nothing".
 */
export function parsePermissionHolders(source, permission) {
  const text = stripComments(source);
  const start = text.indexOf('ROLE_PERMISSIONS');
  if (start === -1) return null;

  const holders = [];
  // One `role: [...]` (or `role: PermissionValues`) entry at a time.
  const entry = /(\w+)\s*:\s*(PermissionValues|\[[^\]]*\])/g;
  entry.lastIndex = start;
  let m;
  while ((m = entry.exec(text)) !== null) {
    const [, role, value] = m;
    if (value === 'PermissionValues') holders.push(role);
    else if (value.includes(`'${permission}'`)) holders.push(role);
  }
  return holders.sort();
}

/**
 * The roles named by `@Roles(...)` decorators, unioned.
 *
 * The union rather than a per-route set: each permission gates controls that
 * reach several routes, so the question it answers is "may this role use that
 * half of the bench at all". `routes: 'mutating'` keeps only the decorators that
 * follow a non-GET verb; `'any'` keeps every one. A `@Roles` is read as the one
 * following its verb decorator, which is the order every bench controller uses.
 */
export function parseControllerRoles(source, routes = 'any') {
  const text = stripComments(source);
  const roles = new Set();
  const route = /@(Get|Post|Put|Patch|Delete)\([^)]*\)\s*@Roles\(([^)]*)\)/g;
  for (const m of text.matchAll(route)) {
    if (routes === 'mutating' && m[1] === 'Get') continue;
    for (const r of m[2].matchAll(/'([^']+)'/g)) roles.add(r[1]);
  }
  return [...roles].sort();
}

export function diffRoleSets(holders, routeRoles) {
  const missingPermission = routeRoles.filter((r) => !holders.includes(r));
  const missingRoute = holders.filter((r) => !routeRoles.includes(r));
  return { ok: missingPermission.length === 0 && missingRoute.length === 0, missingPermission, missingRoute };
}

async function main() {
  const roleSource = await readFile(join(ROOT, ROLE_TYPES), 'utf8');
  const sources = [];
  for (const file of CONTROLLERS) sources.push(await readFile(join(ROOT, file), 'utf8'));

  let failed = false;
  for (const { permission, routes } of CHECKS) {
    const holders = parsePermissionHolders(roleSource, permission);
    if (holders === null) {
      console.error(`check-bench-write-roles: could not find ROLE_PERMISSIONS in ${ROLE_TYPES}`);
      process.exit(1);
    }
    const routeRoles = new Set();
    for (const source of sources) {
      for (const role of parseControllerRoles(source, routes)) routeRoles.add(role);
    }
    const names = [...routeRoles].sort();
    const { ok, missingPermission, missingRoute } = diffRoleSets(holders, names);
    if (ok) {
      console.log(
        `✓ check-bench-write-roles: '${permission}' is held by exactly the roles on the bench's ${routes} routes (${names.join(', ')}).`
      );
      continue;
    }

    failed = true;
    console.error(`✗ check-bench-write-roles: '${permission}' and the bench routes disagree.\n`);
    if (missingPermission.length > 0) {
      console.error(
        `  These roles CAN call the ${routes} bench routes but do NOT hold '${permission}', so the UI hides\n` +
          `  controls the API would serve them (the #3424 defect):\n    ${missingPermission.join(', ')}\n`
      );
    }
    if (missingRoute.length > 0) {
      console.error(
        `  These roles hold '${permission}' but are NOT on the ${routes} bench routes, so the UI offers\n` +
          `  controls the API will refuse:\n    ${missingRoute.join(', ')}\n`
      );
    }
    console.error(`  Fix in ${ROLE_TYPES} or in the controllers' @Roles lists — whichever is wrong.`);
  }
  if (failed) process.exit(1);
}

function selfCheck() {
  const failures = [];
  const expect = (what, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`  ✗ ${what}\n      expected ${e}\n      got      ${a}`);
  };

  const roleFile = (body) => `export const ROLE_PERMISSIONS = {\n${body}\n} as const;`;

  expect(
    'admin holds every permission through PermissionValues, without naming one',
    parsePermissionHolders(roleFile('  admin: PermissionValues,'), 'bench:write'),
    ['admin']
  );
  expect(
    'a role naming the permission is a holder',
    parsePermissionHolders(roleFile("  packer: ['bench:write'],"), 'bench:write'),
    ['packer']
  );
  expect(
    'an empty row is not a holder',
    parsePermissionHolders(roleFile('  viewer: [],'), 'bench:write'),
    []
  );
  expect(
    'a permission named only in a COMMENT is not a holder',
    parsePermissionHolders(roleFile("  viewer: [], // one day 'bench:write'"), 'bench:write'),
    []
  );
  expect(
    'a near-miss name does not count as a holder',
    parsePermissionHolders(roleFile("  viewer: ['bench:write:all'],"), 'bench:write'),
    []
  );
  expect('a file with no ROLE_PERMISSIONS reports null', parsePermissionHolders('export {};', 'x'), null);

  expect(
    'roles are unioned across decorators and de-duplicated',
    parseControllerRoles("@Post('a')\n@Roles('admin', 'operator')\n@Get('b')\n@Roles('admin', 'packer')"),
    ['admin', 'operator', 'packer']
  );
  expect(
    'a role named in a comment is not a route role',
    parseControllerRoles("// @Roles('viewer')\n@Post()\n@Roles('admin')"),
    ['admin']
  );
  expect(
    'a role named in a BLOCK comment is not a route role',
    parseControllerRoles("/* @Roles('viewer') */\n@Post()\n@Roles('admin')"),
    ['admin']
  );

  expect(
    "'mutating' leaves out a GET-only role (#3734: viewer reads, never writes)",
    parseControllerRoles("@Get('a')\n@Roles('admin', 'viewer')\n@Post('b')\n@Roles('admin')", 'mutating'),
    ['admin']
  );
  expect(
    "'any' keeps a GET-only role",
    parseControllerRoles("@Get('a')\n@Roles('admin', 'viewer')\n@Post('b')\n@Roles('admin')", 'any'),
    ['admin', 'viewer']
  );

  expect('identical sets → ok', diffRoleSets(['a', 'b'], ['a', 'b']).ok, true);
  expect(
    'a route role missing the permission is reported, and named',
    diffRoleSets(['a'], ['a', 'b']).missingPermission,
    ['b']
  );
  expect(
    'a holder missing from the routes is reported, and named',
    diffRoleSets(['a', 'b'], ['a']).missingRoute,
    ['b']
  );
  expect(
    'the #3424 defect itself is caught: routes admit packer, permission row is empty',
    diffRoleSets(['admin', 'operator'], ['admin', 'operator', 'packer']).ok,
    false
  );

  if (failures.length === 0) {
    console.log('✓ check-bench-write-roles --self-check: all parser/differ case(s) passed.');
    process.exit(0);
  }
  console.error('✗ check-bench-write-roles --self-check failed:\n');
  console.error(failures.join('\n'));
  process.exit(1);
}

const run = process.argv.includes('--self-check') ? selfCheck : main;
Promise.resolve(run()).catch((err) => {
  console.error('check-bench-write-roles: fatal error:', err);
  process.exit(1);
});
