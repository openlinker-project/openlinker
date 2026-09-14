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
 * ## Known limitation, shared with `packer-exclusion.spec.ts`
 *
 * `Object.getOwnPropertyNames(proto)` does not see a handler INHERITED from a
 * base controller class, so a route declared on a base and exposed by a
 * subclass is invisible here and would escape the decorator requirement
 * entirely. No controller in `apps/api` extends another today. Stated so it is
 * a decision rather than an oversight — the sibling spec states it and, until
 * #2905, the stronger of the two did not.
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

/**
 * The three controllers that may carry `@Public()` on the CLASS.
 *
 * Module scope, matching `packer-exclusion.spec.ts`'s allow-lists: a reviewer
 * reading the file sees the reviewed set without opening an assertion body, and
 * a fourth entry is a visible diff line rather than an edit inside a test.
 * Sorted, because the assertion compares against a sorted set.
 */
const CLASS_LEVEL_PUBLIC_CONTROLLERS = [
  'AppController',
  'McpTransportController',
  'WebhookController',
] as const;

/**
 * A route path segment that marks a TEST-FIXTURE seam — a write that exists
 * only to reach a state no real flow can produce, and that must never run
 * against real data. See the `test-fixture route` describe block below.
 */
const TEST_FIXTURE_PATH_SEGMENT = 'test-fixtures';

/** The in-process gate every test-fixture route must reach before doing work. */
const TEST_FIXTURE_GATE_CALL = 'assertTestFixturesAllowed(';

/**
 * Calls that ARE the test-fixture seam, whichever route reaches them.
 *
 * The path-segment check below is keyed on a spelling; these are keyed on the
 * behaviour, so a seam mounted at `test-fixture`, `dev-fixtures` or no such
 * segment at all is still caught. See the complementary-direction block.
 */
const TEST_FIXTURE_SEAM_CALLS = [TEST_FIXTURE_GATE_CALL, 'markPreRolloutEraForTesting('] as const;

/** Names a controller cannot mention without being part of the fixture seam. */
const TEST_FIXTURE_SERVICE_REFERENCES = [
  'IOrderTestFixtureService',
  'ORDER_TEST_FIXTURE_SERVICE_TOKEN',
] as const;

interface DiscoveredRoute {
  readonly file: string;
  readonly controller: string;
  readonly handler: string;
  readonly verb: string;
  /** `@Controller(...)` prefix segments followed by the handler's own path segments. */
  readonly pathSegments: readonly string[];
  /** The RESOLVED role list (handler's, else the class's), `[]` when neither. */
  readonly roles: readonly string[];
  readonly isPublic: boolean;
  readonly hasRoles: boolean;
  readonly hasAnyRole: boolean;
  /** Both decorators on the SAME target — a configuration contradiction. */
  readonly contradicts: boolean;
  /** `@AnyRole()` on the controller CLASS — banned; see the decorator's header. */
  readonly classLevelAnyRole: boolean;
  /** `@Public()` on the controller CLASS — allow-listed; see the assertion. */
  readonly classLevelPublic: boolean;
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

      // `@Controller(['a', 'b'])` and `@Post(['x', 'y'])` are both legal, so
      // the metadata may be an array. Flattening rather than `String(...)`-ing
      // it keeps a multi-path route's segments separable instead of glueing
      // them with a comma — which would make a `test-fixtures` segment
      // unmatchable on exactly the shape most likely to hide one.
      const toSegments = (raw: unknown): string[] =>
        (Array.isArray(raw) ? raw : [raw])
          .flatMap((part) => String(part ?? '').split('/'))
          .filter((part) => part.length > 0);
      const resolvedRoles = (handlerDeclares ? handlerRoles : classRoles) ?? [];

      routes.push({
        file: file.replace(`${SRC_ROOT}/`, ''),
        controller: name,
        handler,
        verb: RequestMethod[verb],
        pathSegments: [
          ...toSegments(Reflect.getMetadata(PATH_METADATA, cls)),
          ...toSegments(Reflect.getMetadata(PATH_METADATA, fn)),
        ],
        roles: resolvedRoles.map((role) => String(role)),
        isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, fn) === true,
        hasRoles,
        hasAnyRole,
        contradicts: (handlerHasRoles && handlerAnyRole) || (classHasRoles && classAnyRole),
        classLevelAnyRole: classAnyRole,
        classLevelPublic: classPublic,
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

/**
 * The source text of one handler's body, by brace-matching from its
 * declaration. Reflection cannot answer "does this handler call X" — the
 * decorator metadata says nothing about the body — so the only way to assert
 * the in-process gate is reached is to read it.
 *
 * Returns `null` when the declaration is not found, which the caller must
 * treat as a FAILURE rather than as "no gate needed": a silent `null` here is
 * exactly the vacuity the file header's five guards exist to prevent.
 */
function extractHandlerBody(fileSource: string, handler: string): string | null {
  // Bounded by INDENTATION, not by brace counting. Prettier (`tabWidth: 2`)
  // puts every class member at two spaces and every statement inside one at
  // four or more, so `\n  }` is unambiguously the member's own closing brace.
  //
  // Brace counting was tried and rejected: it needs string and comment
  // literals masked out first, and masking single quotes without also
  // handling backticks pairs an apostrophe inside a template literal with a
  // real string quote and blanks whole methods. That failed OPEN — the slice
  // ran past the member and could find the gate call in the next one. This
  // cannot: the slice never crosses `\n  }`.
  const declaration = new RegExp(`\\n  (?:async )?${handler}\\s*\\(`).exec(fileSource);
  if (declaration === null) return null;

  const end = fileSource.indexOf('\n  }', declaration.index);
  if (end === -1) return null;

  return fileSource.slice(declaration.index, end + '\n  }'.length);
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

    /**
     * Class-level `@Public()` is the same defect one notch WORSE (#2905 review).
     *
     * `@AnyRole()` is banned at class level because a widening default silently
     * covers routes added to the class later. `@Public()` widens further: a new
     * route on such a class is not merely open to every role, it is
     * UNAUTHENTICATED — `JwtAuthGuard` bypasses it and `RolesGuard`
     * short-circuits before any role test, so there is no principal at all.
     *
     * It is allow-listed rather than banned because all three sites are correct
     * and none can be expressed per-method without repeating the decorator on
     * every route: two of them exist BECAUSE the whole controller is outside the
     * session model (`WebhookController` authenticates by HMAC signature,
     * `McpTransportController` by its own `OAuthTokenVerifier`), and
     * `AppController` is the unauthenticated health/root surface. What the
     * assertion buys is that a FOURTH requires a decision.
     */
    it('carries @Public() at class level only on the three reviewed controllers', () => {
      const found = [
        ...new Set(allRoutes.filter((r) => r.classLevelPublic).map((r) => r.controller)),
      ].sort();

      expect(found).toEqual([...CLASS_LEVEL_PUBLIC_CONTROLLERS]);
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

  /**
   * Test-fixture routes (#3127 review)
   *
   * A separate invariant sharing this file's discovery machinery, because a
   * second walk of `apps/api` would be a second set that could silently stop
   * agreeing with this one.
   *
   * `OrderTestFixtureService.assertTestFixturesAllowed()` is a METHOD the
   * controller must remember to call — precisely the "applies by remembering
   * rather than by omission" shape #2999 exists to remove one directory over.
   * The route that exists today calls it correctly, so both gates hold. What
   * fails silently is the NEXT `test-fixtures/*` route: `@Roles('admin')`
   * alone leaves it live in production, and nothing else in the build objects
   * — lint passes, type-check passes, and the coverage invariant above is
   * satisfied by the audience decorator without ever asking whether the gate
   * was reached.
   *
   * So the two halves are asserted here, over EVERY discovered route whose
   * path carries a `test-fixtures` segment:
   *
   *   1. it is `@Roles('admin')` exactly — never `@Public()`, never
   *      `@AnyRole()`, never a wider or different role set;
   *   2. its body reaches `assertTestFixturesAllowed(`.
   *
   * Non-vacuity, matching the file header's discipline: a filter that matches
   * nothing reads green, so the count is asserted first. If the seam is ever
   * removed, DELETE this block — do not let it pass over an empty set.
   *
   * The path segment is the discriminator rather than a decorator, because a
   * decorator is one more thing to remember and this check must fire on a
   * route whose author forgot everything except the URL they chose.
   *
   * That leaves one escape — a seam mounted WITHOUT that segment, which this
   * filter never sees. The nested block at the end closes it from the other
   * direction, by asking which routes reach the seam rather than which paths
   * look like it.
   */
  describe('test-fixture routes are admin-gated AND reach the in-process gate (#3127 review)', () => {
    const fixtureRoutes = allRoutes.filter((r) =>
      r.pathSegments.includes(TEST_FIXTURE_PATH_SEGMENT)
    );

    it('discovers at least one test-fixture route (non-vacuity)', () => {
      expect(fixtureRoutes.length).toBeGreaterThan(0);
    });

    it('every test-fixture route is @Roles(admin) exactly', () => {
      const offenders = fixtureRoutes
        .filter(
          (r) =>
            r.isPublic ||
            r.hasAnyRole ||
            r.roles.length !== 1 ||
            r.roles[0] !== 'admin'
        )
        .map((r) => `${describeRoute(r)} → roles=[${r.roles.join(', ')}] public=${r.isPublic}`);

      expect(offenders).toEqual([]);
    });

    it('every test-fixture route reaches assertTestFixturesAllowed()', () => {
      const offenders: string[] = [];

      for (const route of fixtureRoutes) {
        const source = readFileSync(join(SRC_ROOT, route.file), 'utf8');
        const body = extractHandlerBody(source, route.handler);

        // A body we could not locate is an offender, not a pass. Reporting it
        // as "no gate needed" is how this check would quietly stop checking.
        if (body === null) {
          offenders.push(`${describeRoute(route)} → handler body not found`);
          continue;
        }
        if (!body.includes(TEST_FIXTURE_GATE_CALL)) {
          offenders.push(`${describeRoute(route)} → does not call ${TEST_FIXTURE_GATE_CALL})`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it('the body extractor can fail, so a missing gate is really detected', () => {
      // Guard on the guard: `extractHandlerBody` returning a body that happens
      // to contain the call for unrelated reasons would make the assertion
      // above green forever. Feed it a handler that provably lacks the call,
      // and one that does not exist at all.
      const source = readFileSync(join(SRC_ROOT, 'auth/auth.controller.ts'), 'utf8');
      const body = extractHandlerBody(source, 'login');

      expect(body).not.toBeNull();
      expect(body).toContain('validateUser');
      expect(body).not.toContain(TEST_FIXTURE_GATE_CALL);
      expect(extractHandlerBody(source, 'noSuchHandlerExists')).toBeNull();
    });

    it('resolves a body for EVERY discovered route, so the indentation assumption is checked', () => {
      // `extractHandlerBody` bounds the slice on `\n  }`, which is only the
      // member's closing brace while every class member sits at two spaces.
      // That is Prettier's doing, not a language rule — so it is asserted
      // rather than assumed. If a formatting change ever breaks it, this goes
      // red here instead of silently turning the gate check above into a
      // "handler body not found" that someone deletes.
      const unresolved = allRoutes
        .filter((route) => {
          const source = readFileSync(join(SRC_ROOT, route.file), 'utf8');
          return extractHandlerBody(source, route.handler) === null;
        })
        .map(describeRoute);

      expect(unresolved).toEqual([]);
    });

    /**
     * The complementary direction (#3127 review, second pass)
     *
     * Everything above is keyed on the PATH SPELLING, so a future seam mounted
     * at `test-fixture`, `dev-fixtures`, or with no such segment at all,
     * escapes both of those assertions silently — the same "applies by
     * remembering" shape one level up that this whole block exists to remove.
     *
     * This closes it from the other end. Rather than asking whether a
     * fixture-shaped PATH is gated, it asks whether the fixture SEAM is
     * reachable from anywhere but a fixture-shaped path. Two scans, because
     * they fail differently:
     *
     *   A. per HANDLER — a body calling `assertTestFixturesAllowed(` or
     *      `markPreRolloutEraForTesting(` must sit on a `test-fixtures` path.
     *      This is what catches the off-convention spelling: such a route
     *      still calls the seam, so it is found here and fails for lacking
     *      the segment.
     *
     *   B. per FILE — a controller that so much as NAMES the fixture service
     *      must expose at least one `test-fixtures` route. `extractHandlerBody`
     *      sees one member, so a handler delegating through a private helper
     *      is invisible to (A); (B) does not care where in the file the
     *      reference sits.
     *
     * (B) matches a bare mention in a comment too, and that is deliberate
     * rather than sloppy — the same reasoning the file header gives for the
     * `contradicts` strictness. What it refuses is meaningless rather than
     * workable: a controller naming the fixture seam while exposing no
     * fixture route. The remedy is to drop the mention or mount the route.
     *
     * Read this as defence in depth. The real protection is that
     * `markPreRolloutEraForTesting` calls the gate as its own first
     * statement, so even an off-convention route stays triple-gated; what
     * these two buy is that such a route cannot exist *unnoticed*.
     */
    describe('the seam is reachable only from a test-fixture path', () => {
      const routesReachingSeam = allRoutes.filter((route) => {
        const source = readFileSync(join(SRC_ROOT, route.file), 'utf8');
        const body = extractHandlerBody(source, route.handler);
        // `null` cannot be treated as "does not reach the seam" — that would
        // hide exactly the handler this scan is for. The preceding test
        // asserts every route resolves, so a `null` here is already red there;
        // counting it as a match keeps this one honest if that ever changes.
        if (body === null) return true;
        return TEST_FIXTURE_SEAM_CALLS.some((call) => body.includes(call));
      });

      const filesNamingSeam = controllerFiles.filter((file) => {
        const source = readFileSync(file, 'utf8');
        return TEST_FIXTURE_SERVICE_REFERENCES.some((ref) => source.includes(ref));
      });

      it('finds the seam from both directions (non-vacuity)', () => {
        // Either scan silently matching nothing reads green. If the seam is
        // ever removed, DELETE this block rather than letting it pass over an
        // empty set.
        expect(routesReachingSeam.length).toBeGreaterThan(0);
        expect(filesNamingSeam.length).toBeGreaterThan(0);
      });

      it('(A) every route reaching the seam is mounted on a test-fixtures path', () => {
        const offenders = routesReachingSeam
          .filter((route) => !route.pathSegments.includes(TEST_FIXTURE_PATH_SEGMENT))
          .map((route) => `${describeRoute(route)} → path=/${route.pathSegments.join('/')}`);

        expect(offenders).toEqual([]);
      });

      it('(B) every controller naming the fixture service exposes a test-fixtures route', () => {
        const offenders = filesNamingSeam
          .map((file) => file.replace(`${SRC_ROOT}/`, ''))
          .filter((relative) => !fixtureRoutes.some((route) => route.file === relative));

        expect(offenders).toEqual([]);
      });

      it('both scans can produce a negative, so neither matches everything', () => {
        // Guard on the guard: a scan that matched every controller would make
        // (A) and (B) green for reasons unrelated to the seam. `AuthController`
        // neither names the fixture service nor reaches its calls.
        const authFile = join(SRC_ROOT, 'auth/auth.controller.ts');

        expect(filesNamingSeam).not.toContain(authFile);
        expect(routesReachingSeam.map((r) => r.file)).not.toContain('auth/auth.controller.ts');
      });
    });
  });
});
