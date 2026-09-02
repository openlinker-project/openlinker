/**
 * OMS Write Authorization Integration Test (review of PR #2675)
 *
 * Waves 1b–3a added five controllers' worth of write surface — order holds and
 * the packed mark, the fulfilment worklist actions, the authority preset apply,
 * the automation rule CRUD plus run retry/dismiss, and inventory-location CRUD.
 * Every one of those routes carries a `@Roles(...)`, and until this file
 * **nothing asserted it** for the majority of them: `viewer-role-authz` covers
 * the three inventory-location writes and the orders retry, `automation-api`
 * covers three of the six automation writes, and the fulfilment worklist, the
 * authority apply, the order holds, the packed mark and the automation
 * run-actions had no authorization assertion at all.
 *
 * ## Enumerated from Nest's own route metadata, never from a hand-written list
 *
 * The returns sibling (`returns-write-authorization.int-spec.ts`) established
 * the shape and the reason: a hand-written array passes by OMISSION the moment
 * a new write route lands without a guard, which is precisely the failure being
 * guarded against. Reading `PATH_METADATA` / `METHOD_METADATA` off the
 * controller prototypes makes the assertion notice an ADDITION nobody told it
 * about.
 *
 * ## Why fake ids are sound here
 *
 * `RolesGuard` is an `APP_GUARD` and runs before the handler body, so a refused
 * principal never reaches the lookup. A guarded route therefore answers 403 for
 * a nonexistent id, and an UNGUARDED one answers 404/400/422 — which is exactly
 * the distinction being asserted. The final case pins the other direction: the
 * same principal must get 200 on a read, or a blanket misconfiguration that
 * 403s everything would make this file pass while proving nothing.
 *
 * ## The one viewer-permitted write verb
 *
 * `POST /fulfillment-authority/presets/preview` is a POST that commits nothing
 * and is deliberately authorised as a read (its controller docblock says why),
 * so it is listed as an explicit exception AND asserted in the opposite
 * direction. Being an exception list rather than an inclusion list, a new route
 * still fails closed: it is absent from the exceptions, so 403 is expected of it.
 *
 * @module apps/api/test/integration
 */
import request from 'supertest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AutomationsController } from '../../src/automation/http/automations.controller';
import { FulfillmentAuthorityController } from '../../src/fulfillment-authority/http/fulfillment-authority.controller';
import { FulfillmentWorkController } from '../../src/fulfillment/http/fulfillment-work.controller';
import { InventoryLocationsController } from '../../src/inventory/http/inventory-locations.controller';
import { OrdersController } from '../../src/orders/http/orders.controller';
import { loginAsViewer } from './helpers/test-auth.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

interface DiscoveredRoute {
  readonly controller: string;
  readonly handler: string;
  readonly method: RequestMethod;
  readonly path: string;
}

/** Nest's own metadata, so the enumeration cannot drift from the router. */
function discoverRoutes(controller: new (...args: never[]) => object): DiscoveredRoute[] {
  const prefix = (Reflect.getMetadata(PATH_METADATA, controller) as string) ?? '';
  const proto = controller.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .flatMap((name) => {
      const handler = proto[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) return [];

      const joined = [prefix, path].filter((part) => part !== '' && part !== '/').join('/');
      return [{ controller: controller.name, handler: name, method, path: `/v1/${joined}` }];
    });
}

/** A write is anything that is not a read. Enumerated, not listed. */
const WRITE_METHODS = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

const CONTROLLERS = [
  OrdersController,
  FulfillmentWorkController,
  FulfillmentAuthorityController,
  AutomationsController,
  InventoryLocationsController,
] as const;

/**
 * Write verbs a read-only principal is deliberately allowed to call.
 *
 * Each entry needs a stated reason; an unexplained entry is how a real gap gets
 * silenced.
 */
const VIEWER_PERMITTED_WRITES = new Set<string>([
  // Commits nothing — an in-memory re-resolution and diff, authorised as a read
  // so the confirm dialog renders for a role that then cannot save.
  'POST /v1/fulfillment-authority/presets/preview',
]);

const VERB_BY_METHOD: Partial<Record<RequestMethod, 'post' | 'put' | 'patch' | 'delete'>> = {
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/**
 * Any syntactically plausible value. The guard fires before the lookup, so the
 * id never has to resolve — see the module docblock.
 */
function substituteParams(path: string): string {
  return path
    .replace(':connectionId', '00000000-0000-4000-8000-000000000001')
    .replace(':internalOrderId', 'ol_order_authz')
    .replace(':holdId', 'ol_hold_authz')
    .replace(':workId', 'ol_fulfillment_work_authz')
    // A genuinely operator-invocable action, so a missing guard would be
    // refused by the action allowlist rather than by authorization — the
    // ambiguity this test exists to remove.
    .replace(':action', 'start')
    .replace(':runId', 'ol_automation_run_authz')
    .replace(':id', 'ol_authz_placeholder');
}

describe('OMS Write Authorization Integration', () => {
  let harness: IntegrationTestHarness;
  let token: string;

  const http = (): ReturnType<typeof request> => harness.getHttp();

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    // ONE login per test — the helper plain-INSERTs a fixed username, so a
    // second call in the same test violates the users unique constraint.
    token = await loginAsViewer(http(), harness.getDataSource());
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  const writeRoutes = (): DiscoveredRoute[] =>
    CONTROLLERS.flatMap((controller) => discoverRoutes(controller)).filter((route) =>
      WRITE_METHODS.has(route.method)
    );

  it('should discover write routes on every OMS controller under review', () => {
    const routes = writeRoutes();

    // Guards the reader itself: were `discoverRoutes` to silently return [],
    // the refusal test below would pass vacuously and assert nothing.
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes.map((route) => route.controller))).toEqual(
      new Set(CONTROLLERS.map((controller) => controller.name))
    );
  });

  it('should refuse a read-only principal on EVERY discovered write route', async () => {
    const routes = writeRoutes().filter(
      (route) =>
        !VIEWER_PERMITTED_WRITES.has(
          `${(VERB_BY_METHOD[route.method] ?? 'post').toUpperCase()} ${route.path}`
        )
    );
    const outcomes: Array<{ route: string; status: number }> = [];

    for (const route of routes) {
      const verb = VERB_BY_METHOD[route.method];
      if (verb === undefined) continue;

      const response = await http()
        [verb](substituteParams(route.path))
        .set('Authorization', `Bearer ${token}`)
        .send({});

      outcomes.push({ route: `${verb.toUpperCase()} ${route.path}`, status: response.status });
    }

    // Asserted as one object so a failure NAMES the unguarded route rather than
    // reporting a bare "expected 403, received 404".
    expect(outcomes).toEqual(outcomes.map((outcome) => ({ route: outcome.route, status: 403 })));
    expect(outcomes.length).toBe(routes.length);
  });

  it('should NOT refuse the read-only principal on the preset preview, which is a read', async () => {
    // The exception asserted in its own direction: were it silently narrowed to
    // admin, the list above would still pass and the confirm dialog would break.
    const response = await http()
      .post('/v1/fulfillment-authority/presets/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ presetId: 'openlinker-decides' });

    expect(response.status).not.toBe(403);
  });

  it('should not refuse the same principal on an OMS read, so 403 means the role', async () => {
    // Without this, a blanket misconfiguration that 403s everything would make
    // the refusal test pass while proving nothing about writes specifically.
    await http()
      .get('/v1/fulfillment/works')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
