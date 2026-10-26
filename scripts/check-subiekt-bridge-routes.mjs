#!/usr/bin/env node
/**
 * check-subiekt-bridge-routes.mjs
 *
 * Lint-time invariant for the LARGEST hand-copied contract in this repository:
 * the HTTP surface between the TypeScript Subiekt GT clients and the C# Sfera
 * bridge they talk to.
 *
 * WHY THIS EXISTS
 *
 * `libs/integrations/subiekt/docs/*.cs.ready` is 16 files and ~7 000 lines of a
 * SECOND RUNTIME, in a second language. Nothing in this repository compiles it,
 * type-checks it or tests it - the only other script that opens those files is
 * `check-nul-bytes.mjs`, which treats them as opaque bytes. The bridge is built
 * and deployed by hand onto an operator's Windows host.
 *
 * So the route vocabulary is mirrored by hand on both sides, and a rename on
 * either one is invisible here: it type-checks, it lints, every unit test
 * passes, and it fails at runtime on somebody's machine as a failed invoice.
 * This repository already guards a dozen far smaller hand-copies the same way -
 * four role strings, one integer against a DTO's `@Max` - so the one surface
 * with two orders of magnitude more of it should not be the unguarded one.
 *
 * WHAT IT COMPARES, AND WHAT IT DOES NOT
 *
 * PATHS, not verbs, and not payloads. A client path that the bridge does not
 * declare fails the build; a client that sends the right path with the wrong
 * method or the wrong body shape does not. The reason is honesty about what is
 * cheaply extractable: the clients build paths from template literals a regex
 * can normalise, while the method often lives several lines away in a shared
 * helper, so inferring it would be guesswork dressed as a check. Path drift is
 * the failure named in review ("a renamed route ... discovered by a failed
 * invoice"), and it is the one this closes.
 *
 * Compiling the bridge in CI is the fuller answer and a different decision - a
 * `dotnet` job for a COM-dependent Windows service. This needs no toolchain.
 *
 * BOTH SIDES ARE FLOORED, EACH ON A SINGLE SOURCE. Zero mirrors, zero declared
 * routes, and any `CLIENT_DIRS` root that yields nothing, each exit 1 with a
 * named reason - because a comparison that read nothing on either half would
 * otherwise report OK over an unasked question. The client floor is applied per
 * root rather than over a total, since a total is exactly what a non-empty
 * constant can hold off zero; see `collectClientFiles`.
 *
 * DIRECTION IS DELIBERATE. It fails on a path the CLIENTS call that the bridge
 * does not declare. A route the bridge declares and nobody calls is NOT a
 * failure: the bridge serves more than this repository (the WooCommerce-dialect
 * shim exists precisely so a `woocommerce` connection can consume it), so an
 * unused declaration is normal and flagging it would train the reader to ignore
 * this script.
 *
 * Run with `--self-check` to exercise the parsers and the matcher, per the
 * convention every sibling follows.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIRROR_DIR = join(ROOT, 'libs/integrations/subiekt/docs');

/**
 * Where a path literal is a real call rather than prose.
 *
 * `apps/e2e/src/api/subiekt-bridge.ts` is included deliberately although it is
 * test infrastructure: it is a real client of the same bridge, and drift there
 * breaks the only end-to-end coverage this integration has - silently, since a
 * 404 reads as "Subiekt does not have it".
 */
const CLIENT_DIRS = ['libs/integrations/subiekt/src'];

/** Individually named, not a directory: `apps/e2e/src/api` also holds the
 * PrestaShop webservice client, whose own routes are `/api/customers`,
 * `/api/carts`, `/api/stock_availables` - a different product that happens to
 * share the prefix. Scanning that folder wholesale reported thirteen of them as
 * undeclared bridge routes on this guard's first run. */
const CLIENT_FILES = ['apps/e2e/src/api/subiekt-bridge.ts'];

/** Only the bridge's own `/api/*` family. The WooCommerce-dialect shim is
 * consumed by the WooCommerce adapters against a WC base url, not by these
 * clients, so holding them to it would compare two unrelated things. */
const GUARDED_PREFIX = '/api/';

/** A route parameter, on either side, reduced to one placeholder:
 *   C#  `/api/invoices/{origId:int}/corrections`
 *   TS  `/api/invoices/${origId}/corrections`
 * both become `/api/invoices/{}/corrections`. */
export function normalizeRoute(path) {
  return path
    .replace(/\$\{[^}]*\}/g, '{}')   // TS template hole
    .replace(/\{[^}]*\}/g, '{}')     // C# route parameter, constraint and all
    .replace(/\?.*$/, '')            // query string is not part of the route
    .replace(/\/+$/, '')             // trailing slash
    .trim();
}

/** Comments carry prose paths (`/api/orders*`, `/api/models/{id}`) that nothing
 * calls. Stripping them is what keeps a docblock from inventing a finding.
 *
 * LINE comments go first, and the order is load-bearing rather than arbitrary.
 * A line comment ending in a glob - `// ... gates every /api/*`, which is real
 * and sits eleven lines above a route in `FiscalizationEndpoints` - contains
 * `/*`. Strip blocks first and that opens a comment the parser then closes at
 * the next `*​/` a hundred lines below, swallowing every declaration in between.
 * The guard does not go quiet on that: fewer declared routes means MORE client
 * paths look undeclared, so it fails loudly and for the wrong reason. It cost
 * one debugging pass to find, and the self-check now pins it. */
export function stripComments(source) {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, '$1 ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Routes the bridge DECLARES: `app.MapGet("/api/x", ...)` and friends. */
export function declaredRoutes(source) {
  const out = new Set();
  for (const m of stripComments(source).matchAll(
    /\.Map(?:Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/g
  )) {
    out.add(normalizeRoute(m[1]));
  }
  return out;
}

/** Routes the clients CALL: any guarded path literal outside a comment. */
export function calledRoutes(source) {
  const out = new Set();
  for (const m of stripComments(source).matchAll(/['"`](\/api\/[^'"`\s]*)['"`]/g)) {
    const normalized = normalizeRoute(m[1]);
    // A bare glob (`/api/*`) is a docblock shorthand that survived comment
    // stripping inside a string; it names no route.
    if (normalized.includes('*')) continue;
    if (normalized === GUARDED_PREFIX.replace(/\/$/, '')) continue;
    out.add(normalized);
  }
  return out;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Test files carry fixture paths (`/api/models/NaN`) that name no route.
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
      walk(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Raised when a `CLIENT_DIRS` root yields no client files. Thrown rather than
 * exited so the self-check can exercise the floor - the previous version put
 * the check inside `run()`, where the only way to reach it was to run the whole
 * guard against the real tree. */
export class EmptyClientRootError extends Error {}

/**
 * Every client file to scan, with the floor applied PER ROOT.
 *
 * PER ROOT, not over the combined total, and that distinction is the entire
 * finding this replaces. The previous floor tested `scanned === 0` over
 * `CLIENT_DIRS` walked AND `CLIENT_FILES` concatenated - and `CLIENT_FILES` is
 * a non-empty constant, so it contributed 1 unconditionally and the check was
 * UNREACHABLE. Emptying the real client root left the guard reporting
 * `OK (... 1 client files scanned)`: zero of the 31 client files compared,
 * exit 0. A floor on an aggregate that a constant holds off zero cannot observe
 * the half it was added to watch.
 *
 * It stays per root rather than becoming one `walked.length === 0` for the same
 * reason at the next size up: `CLIENT_DIRS` is written to grow, and the moment
 * it holds two entries an aggregate floor lets an emptied root hide behind a
 * populated sibling - the identical defect one level out.
 *
 * `CLIENT_FILES` needs no floor: every entry is read with `readFileSync`, which
 * throws on a moved file. A root that no longer EXISTS likewise throws ENOENT
 * out of `readdirSync`. This floor is only for the root that still exists and
 * yields nothing - sources moved into a skipped subdirectory, renamed off
 * `.ts`, or a package left holding only tests - which is the one shape that is
 * otherwise silent.
 */
export function collectClientFiles(dirs = CLIENT_DIRS, files = CLIENT_FILES, root = ROOT) {
  const out = [];
  for (const dir of dirs) {
    const found = walk(join(root, dir));
    if (found.length === 0) {
      throw new EmptyClientRootError(
        `no client files under ${dir} - has it moved or been restructured?`
      );
    }
    out.push(...found);
  }
  return out.concat(files.map((f) => join(root, f)));
}

function run() {
  const mirrors = readdirSync(MIRROR_DIR).filter((f) => f.endsWith('.cs.ready'));
  if (mirrors.length === 0) {
    console.error('check-subiekt-bridge-routes: no .cs.ready mirrors found - has the path moved?');
    process.exit(1);
  }

  const declared = new Set();
  for (const file of mirrors) {
    for (const route of declaredRoutes(readFileSync(join(MIRROR_DIR, file), 'utf8'))) {
      declared.add(route);
    }
  }
  if (declared.size === 0) {
    // A parser that reads nothing would report every client route as drifted,
    // or - worse, if the direction were inverted - report success over an
    // unasked question. Named, like the capability guard's zero-floor.
    console.error('check-subiekt-bridge-routes: mirrors found, no routes read - the parser is broken.');
    process.exit(1);
  }

  let files;
  try {
    files = collectClientFiles();
  } catch (e) {
    if (!(e instanceof EmptyClientRootError)) throw e;
    console.error(`check-subiekt-bridge-routes: ${e.message}`);
    process.exit(1);
  }

  const problems = [];
  const scanned = files.length;
  for (const file of files) {
    for (const route of calledRoutes(readFileSync(file, 'utf8'))) {
      if (!declared.has(route)) {
        problems.push({ file: relative(ROOT, file), route });
      }
    }
  }

  if (problems.length > 0) {
    console.error('check-subiekt-bridge-routes FAILED\n');
    console.error('These paths are called by a TypeScript client and declared by no bridge route:\n');
    for (const p of problems) console.error(`  ${p.route}\n    called from ${p.file}`);
    console.error('\nThe bridge is built and deployed by hand, so this does not fail until an');
    console.error('operator\'s Subiekt returns 404. Either the client path is wrong, or the');
    console.error('bridge route was renamed and its mirror in libs/integrations/subiekt/docs/');
    console.error('was re-synced without the client following.');
    console.error('\nDeclared routes:\n');
    for (const r of [...declared].filter((r) => r.startsWith(GUARDED_PREFIX)).sort()) {
      console.error(`  ${r}`);
    }
    process.exit(1);
  }

  console.log(
    `check-subiekt-bridge-routes OK (${declared.size} routes declared across ${mirrors.length} mirrors, ${scanned} client files scanned)`
  );
}

function selfCheck() {
  const assertions = [];
  const assert = (ok, label) => {
    assertions.push(label);
    if (!ok) {
      console.error(`check-subiekt-bridge-routes --self-check FAILED: ${label}`);
      process.exit(1);
    }
  };

  assert(
    normalizeRoute('/api/invoices/{origId:int}/corrections') ===
      normalizeRoute('/api/invoices/${origId}/corrections'),
    'a C# route parameter and a TS template hole reduce to the same route'
  );
  assert(
    normalizeRoute('/api/orders/feed?${params.toString()}') === '/api/orders/feed',
    'a query string is not part of the route'
  );
  assert(
    normalizeRoute('/api/inventory/${encodeURIComponent(s)}/stock') === '/api/inventory/{}/stock',
    'an encoded segment still reduces to one placeholder'
  );

  assert(
    declaredRoutes('app.MapGet("/api/warehouses", () => 1);').has('/api/warehouses'),
    'a declared GET route is read'
  );
  assert(
    declaredRoutes('app.MapPost("/api/invoices", X);').has('/api/invoices'),
    'a declared POST route is read'
  );
  assert(
    declaredRoutes('// app.MapGet("/api/ghost", X);').size === 0,
    'a route inside a comment is not a declaration'
  );

  assert(
    calledRoutes("await this.getJson('/api/warehouses');").has('/api/warehouses'),
    'a called path is read'
  );
  assert(
    calledRoutes('/** talks to `/api/orders*` */').size === 0,
    'a docblock path is not a call'
  );
  assert(calledRoutes("const g = '/api/*';").size === 0, 'a bare glob names no route');

  // THE CLIENT-SIDE FLOOR, exercised rather than approximated.
  //
  // Its predecessor asserted only `calledRoutes('').size === 0` - the PROPERTY
  // the floor rests on - and was honest about that. It was also why the floor
  // could be entirely unreachable and still leave this passing: the parser
  // property held, the floor was never run. `collectClientFiles` is factored
  // out of `run()` and throws instead of exiting precisely so this can call it.
  const emptyRootRefused = (() => {
    try {
      // A real directory that exists and holds no `.ts`: the exact shape the
      // floor exists for, and the one the previous version reported OK on.
      collectClientFiles(['libs/integrations/subiekt/docs'], []);
      return false;
    } catch (e) {
      return e instanceof EmptyClientRootError;
    }
  })();
  assert(emptyRootRefused, 'a client root that exists and yields no .ts is REFUSED, not counted as clean');

  // And the bug that made the old floor unreachable: a non-empty `CLIENT_FILES`
  // must not be able to hold an emptied root off the floor.
  const constantCannotMaskIt = (() => {
    try {
      collectClientFiles(['libs/integrations/subiekt/docs'], ['apps/e2e/src/api/subiekt-bridge.ts']);
      return false;
    } catch (e) {
      return e instanceof EmptyClientRootError;
    }
  })();
  assert(
    constantCannotMaskIt,
    'CLIENT_FILES entries cannot hold an emptied CLIENT_DIRS root off the floor'
  );

  // Per root, not in aggregate: a populated sibling must not cover an empty one.
  const siblingCannotMaskIt = (() => {
    try {
      collectClientFiles(['libs/integrations/subiekt/src', 'libs/integrations/subiekt/docs'], []);
      return false;
    } catch (e) {
      return e instanceof EmptyClientRootError;
    }
  })();
  assert(siblingCannotMaskIt, 'a populated root does not cover an emptied sibling root');

  assert(
    collectClientFiles(['libs/integrations/subiekt/src'], []).length > 0,
    'the real client root still collects files - the floor does not fire on a healthy tree'
  );

  // THE BUG THAT MADE THIS GUARD UNDER-READ ON ITS FIRST RUN: a line comment
  // ending in a glob opens a block comment if blocks are stripped first.
  assert(
    declaredRoutes('// gates every /api/*\napp.MapPost("/api/fiscalize", X);\n/* later */').has(
      '/api/fiscalize'
    ),
    'a line comment ending in `/api/*` does not swallow the routes below it'
  );

  // THE CASE THE GUARD EXISTS FOR: a renamed bridge route, client unchanged.
  const declaredAfterRename = declaredRoutes('app.MapGet("/api/bank-accounts-v2", X);');
  const stillCalled = calledRoutes("this.getJson('/api/bank-accounts');");
  assert(
    [...stillCalled].some((r) => !declaredAfterRename.has(r)),
    'a renamed bridge route leaves the client calling an undeclared path'
  );

  // And the inverse must NOT fail: an unused bridge route is normal.
  const declaredExtra = declaredRoutes(
    'app.MapGet("/api/warehouses", X); app.MapGet("/wp-json/wc/v3/products", Y);'
  );
  const calledSubset = calledRoutes("this.getJson('/api/warehouses');");
  assert(
    [...calledSubset].every((r) => declaredExtra.has(r)),
    'a route the bridge declares and nobody calls is not a failure'
  );

  console.log(`check-subiekt-bridge-routes --self-check passed (${assertions.length} assertions)`);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  run();
}
