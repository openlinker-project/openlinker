/**
 * Route-Authorization Coverage Invariant (#2079)
 *
 * Asserts that **every** HTTP route handler in `apps/api` declares its audience
 * with exactly one of `@Public()`, `@Roles(...)` or `@AnyRole()`, so that
 * `RolesGuard`'s deny-by-default can never refuse a route somebody forgot to
 * decorate — the build refuses it first.
 *
 * ## What this replaces, and why both halves mattered
 *
 * It supersedes `write-guard-coverage.spec.ts`, which had **two independent
 * defects**: it covered non-GET handlers only, AND it ran against a hand-listed
 * 23-controller set. Fixing either alone leaves the check ineffective — the one
 * route this issue found outside GET (`PATCH /auth/me/analytics-consent`) was
 * hidden by BOTH, since `AuthController` was not in the list either. Every PII
 * read was outside that spec by construction.
 *
 * ## Non-vacuity — five guards
 *
 * `docs/testing-guide.md § Port-contract suites`: the machinery that looks
 * thorough and asserts nothing is the thing to defend against. So:
 *
 *  (i)   an import failure THROWS — never skipped, never caught into a
 *        "0 problems" pass;
 *  (ii)  at least one controller file is discovered;
 *  (iii) every discovered file yields >= 1 controller class;
 *  (iv)  every controller class yields >= 1 route handler;
 *  (v)   the FILENAME CONVENTION discovery rests on is enforced, not trusted.
 *
 * (v) is the one a reviewer catches and an author does not. Walking
 * `*.controller.ts` is a naming convention with nothing enforcing it: a
 * `@Controller` class in a differently-named file is invisible here, and its
 * routes would be free of both the decorator requirement and the reviewer's
 * attention — structurally the same failure as the hand-listed array, one level
 * down. A set that looks complete and is not, going green either way.
 * (ii)-(iv) do NOT close it; they assert the files *found* are non-empty and
 * yield routes, never that the walk found every file. So this spec text-scans
 * every `.ts` under `apps/api/src` for a line matching `^@Controller` and
 * asserts that file set is a subset of the discovered one. Anchoring at line
 * start is required — `mcp/mcp-resource.ts` and `analytics/analytics.module.ts`
 * both mention `@Controller` in prose.
 *
 * (ii)-(iv) are also what makes the NestJS metadata-key string literals below
 * acceptable. `@nestjs/common/constants` is not in that package's `exports`
 * map, so the superseded spec already hardcoded `'method'`; a rename of either
 * key collapses discovery to zero, which (iii) and (iv) catch respectively
 * rather than passing vacuously. Do not "fix" the literals by deep-importing.
 *
 * ## This spec is deliberately STRICTER than `RolesGuard` on one input
 *
 * The guard resolves the HANDLER as a unit and consults the class only when the
 * handler declares neither decorator — so a controller whose CLASS carries both
 * `@Roles()` and `@AnyRole()`, but whose every handler carries its own
 * `@Roles()`, is allowed at runtime. This spec fails it anyway.
 *
 * That is intentional, and it is NOT the "mirror stricter than the gate" defect
 * (#2240). There the mirror copied somebody else's gate, so extra strictness
 * refused work the destination would have accepted and the cost landed on a
 * user. Both sides here are ours, and what is refused is **meaningless rather
 * than workable**: a class declaring both states two different audiences for
 * one class, and it becomes a live trap the moment any handler stops
 * overriding — at which point the class silently widens. Refusing it costs
 * nobody anything. Do not narrow `contradicts` into agreement with the guard.
 *
 * Implementation: reads decorator metadata via `Reflect.getMetadata`. No DI, no
 * database — metadata is stored at class-definition time when the module is
 * imported.
 *
 * @module apps/api/src/auth
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROLES_KEY } from './decorators/roles.decorator';
import { ANY_ROLE_KEY } from './decorators/any-role.decorator';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

/** See the file header: deliberately literals, guarded by (iii) and (iv). */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

const SRC_ROOT = resolve(__dirname, '..');

interface DiscoveredRoute {
  readonly file: string;
  readonly controller: string;
  readonly handler: string;
  readonly verb: string;
  readonly isPublic: boolean;
  readonly hasRoles: boolean;
  readonly hasAnyRole: boolean;
  /** Both decorators on the SAME target — a configuration contradiction. */
  readonly contradicts: boolean;
  /** `@AnyRole()` on the controller CLASS — banned; see the decorator's header. */
  readonly classLevelAnyRole: boolean;
}

function walk(dir: string, predicate: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(entry.name)) out.push(full);
  }
  return out;
}

const controllerFiles = walk(SRC_ROOT, (n) => n.endsWith('.controller.ts')).sort();

function isControllerClass(exported: unknown): exported is new (...args: never[]) => unknown {
  if (typeof exported !== 'function') return false;
  if (!(exported as { prototype?: unknown }).prototype) return false;
  return Reflect.getMetadata(PATH_METADATA, exported) !== undefined;
}

/**
 * Guard (i): a require() failure propagates. Swallowing it would drop the
 * controller from the set and report green — the exact shape this spec exists
 * to prevent.
 */
function loadControllers(file: string): { name: string; cls: object }[] {
  // Discovery is a filesystem walk, so the path is only known at runtime; a static
  // import would reinstate the hand-listed set this spec exists to replace.
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- runtime-discovered module path
  const mod = require(file) as Record<string, unknown>;
  return Object.entries(mod)
    .filter(([, v]) => isControllerClass(v))
    .map(([name, cls]) => ({ name, cls: cls as object }));
}

function collectRoutes(file: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const { name, cls } of loadControllers(file)) {
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, cls) === true;
    const classRoles = Reflect.getMetadata(ROLES_KEY, cls) as unknown[] | undefined;
    const classAnyRole = Reflect.getMetadata(ANY_ROLE_KEY, cls) === true;
    const proto = (cls as { prototype: Record<string, unknown> }).prototype;

    for (const handler of Object.getOwnPropertyNames(proto)) {
      if (handler === 'constructor') continue;
      if (typeof proto[handler] !== 'function') continue;
      const fn = proto[handler] as object;

      const verb = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (verb === undefined) continue;

      const handlerRoles = Reflect.getMetadata(ROLES_KEY, fn) as unknown[] | undefined;
      const handlerAnyRole = Reflect.getMetadata(ANY_ROLE_KEY, fn) === true;
      const handlerHasRoles = Array.isArray(handlerRoles) && handlerRoles.length > 0;
      const classHasRoles = Array.isArray(classRoles) && classRoles.length > 0;

      // Mirrors RolesGuard: resolve the HANDLER as a unit, fall back to the
      // class only when the handler declares neither. Reading the two keys
      // independently would report a class @Roles alongside a handler
      // @AnyRole() as a contradiction when it is an ordinary override.
      const handlerDeclares = handlerHasRoles || handlerAnyRole;
      const hasRoles = handlerDeclares ? handlerHasRoles : classHasRoles;
      const hasAnyRole = handlerDeclares ? handlerAnyRole : classAnyRole;

      routes.push({
        file: file.replace(`${SRC_ROOT}/`, ''),
        controller: name,
        handler,
        verb: RequestMethod[verb],
        isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true,
        hasRoles,
        hasAnyRole,
        contradicts: (handlerHasRoles && handlerAnyRole) || (classHasRoles && classAnyRole),
        classLevelAnyRole: classAnyRole,
      });
    }
  }
  return routes;
}

const routesByFile = new Map<string, DiscoveredRoute[]>(
  controllerFiles.map((file) => [file, collectRoutes(file)])
);
const allRoutes = [...routesByFile.values()].flat();

function describeRoute(r: DiscoveredRoute): string {
  return `${r.file} :: ${r.controller}.${r.handler} (${r.verb})`;
}

describe('Route-authorization coverage invariant (#2079)', () => {
  describe('discovery is non-vacuous', () => {
    it('(ii) discovers at least one controller file', () => {
      expect(controllerFiles.length).toBeGreaterThan(0);
    });

    it('(iii) every discovered file exports at least one controller class', () => {
      const barren = controllerFiles.filter((f) => loadControllers(f).length === 0);
      expect(barren.map((f) => f.replace(`${SRC_ROOT}/`, ''))).toEqual([]);
    });

    it('(iv) every discovered file yields at least one route handler', () => {
      const routeless = [...routesByFile.entries()]
        .filter(([, routes]) => routes.length === 0)
        .map(([f]) => f.replace(`${SRC_ROOT}/`, ''));
      expect(routeless).toEqual([]);
    });

    it('(v) enforces the *.controller.ts convention discovery rests on', () => {
      const discovered = new Set(controllerFiles);
      // `.spec.ts` is excluded to RESTORE SYMMETRY, not to open a hole:
      // discovery already excludes specs implicitly (`foo.controller.spec.ts`
      // does not end `.controller.ts`), and a spec's decorated FIXTURE class
      // serves no route — see `roles.guard.spec.ts`, which declares several.
      // Scanning them would demand renaming a fixture to `*.controller.ts`,
      // which would then pull it into the route assertions below.
      const everyTsFile = walk(SRC_ROOT, (n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'));

      const declaringFiles = everyTsFile.filter((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          // Anchored: prose mentions of @Controller are indented or mid-line.
          .some((line) => line.startsWith('@Controller'))
      );

      const invisible = declaringFiles
        .filter((f) => !discovered.has(f))
        .map(
          (f) =>
            `${f.replace(`${SRC_ROOT}/`, '')} declares @Controller but is not named ` +
            '*.controller.ts, so this invariant cannot see its routes. Rename it.'
        );

      expect(invisible).toEqual([]);
      // A convention that matched nothing would make the subset check vacuous.
      expect(declaringFiles.length).toBeGreaterThan(0);
    });
  });

  describe('every route declares its audience', () => {
    it('carries exactly one of @Public(), @Roles() or @AnyRole()', () => {
      const undeclared = allRoutes
        .filter((r) => !r.isPublic && !r.hasRoles && !r.hasAnyRole)
        .map(
          (r) =>
            `${describeRoute(r)} carries neither @Roles() nor @AnyRole(). RolesGuard denies ` +
            'by default (#2079) — declare the audience, or @AnyRole() if every ' +
            'authenticated user may call it.'
        );

      expect(undeclared).toEqual([]);
    });

    // Deliberately stricter than RolesGuard — see the file header. A
    // contradictory CLASS is refused here even where every handler overrides
    // it, because it states two audiences for one class and silently widens the
    // day a handler stops overriding. Do not narrow this into agreement.
    it('never carries both @Roles() and @AnyRole() on the same target', () => {
      const contradictory = allRoutes
        .filter((r) => r.contradicts)
        .map(
          (r) =>
            `${describeRoute(r)} carries BOTH @Roles() and @AnyRole() on one target. Refused ` +
            'even when a handler-level decorator would override a contradictory class: two ' +
            'audiences for one class is meaningless, and widens silently once the override goes.'
        );

      expect(contradictory).toEqual([]);
    });

    it('never carries @AnyRole() at class level', () => {
      const classLevel = [
        ...new Set(
          allRoutes
            .filter((r) => r.classLevelAnyRole)
            .map(
              (r) =>
                `${r.file} :: ${r.controller} carries a class-level @AnyRole(). It would ` +
                'silently cover every route added to the class later, re-creating ' +
                '"undecorated inherits open" at class granularity. Decorate methods.'
            )
        ),
      ];

      expect(classLevel).toEqual([]);
    });
  });

  /**
   * `RolesGuard` short-circuits on `@Public()` BEFORE any role test. That is
   * load-bearing rather than defensive: `JwtAuthGuard` bypasses authentication
   * for public routes so `req.user` is absent, and before #2079 those routes
   * survived on the fail-open branch this change removes. Deleting the
   * short-circuit 403s login, refresh, every webhook delivery and the whole MCP
   * transport — so those four are pinned by name here rather than left to the
   * implementation happening to be correct.
   */
  describe('the four production shapes that depend on the @Public() short-circuit', () => {
    const cases: { label: string; file: string; controller: string; handler: string }[] = [
      { label: 'login', file: 'auth/auth.controller.ts', controller: 'AuthController', handler: 'login' },
      {
        label: 'refresh',
        file: 'auth/auth.controller.ts',
        controller: 'AuthController',
        handler: 'refresh',
      },
      {
        label: 'webhook delivery',
        file: 'webhooks/http/webhook.controller.ts',
        controller: 'WebhookController',
        handler: 'receiveWebhook',
      },
      {
        label: 'MCP transport',
        file: 'mcp/transport/mcp-transport.controller.ts',
        controller: 'McpTransportController',
        handler: 'handle',
      },
    ];

    it.each(cases)('$label is @Public() and carries no role decorator', (c) => {
      const route = allRoutes.find(
        (r) => r.file === c.file && r.controller === c.controller && r.handler === c.handler
      );

      // Not `toBeDefined()` alone: a renamed handler would silently stop
      // asserting anything at all.
      expect(route).toBeDefined();
      expect(route?.isPublic).toBe(true);
      expect(route?.hasRoles).toBe(false);
      expect(route?.hasAnyRole).toBe(false);
    });
  });
});
