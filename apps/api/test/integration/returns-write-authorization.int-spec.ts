/**
 * Returns Write Authorization Integration Test (#2376)
 *
 * #2376's third acceptance criterion: *"Every endpoint guarded; read-only role
 * refused on all writes."* The guard was present on all ten routes and nothing
 * asserted it, which is the gap this closes.
 *
 * ## Enumerated from route metadata, never from a hand-written list
 *
 * The routes are read out of Nest's own `PATH_METADATA` / `METHOD_METADATA` on
 * the controller prototypes, so **the assertion breaks when someone forgets**
 * rather than only when someone is wrong. A hand-written array would pass by
 * omission the moment an eleventh write route lands without `@Roles` — which is
 * precisely the failure mode being guarded, and exactly what a list-based test
 * cannot see. Same property as the `imports:`-array module-boundary guard: the
 * test must notice an ADDITION it was never told about.
 *
 * ## Why an empty body is enough
 *
 * Nest runs guards BEFORE pipes, so a refused principal never reaches
 * validation. Every route is therefore exercised with `{}` and must still answer
 * 403 — if one answers 400 instead, its guard did not run, which is the defect.
 *
 * ## Real ids, deliberately
 *
 * `:returnId` / `:lineId` are substituted with a genuinely seeded return and
 * line rather than fabricated ids. A 403 against a nonexistent id would also
 * pass, but it would not prove the request would otherwise have reached the
 * handler — the refusal has to be the guard's, not a 404 wearing its clothes.
 *
 * @module apps/api/test/integration
 */
import request from 'supertest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  RETURNS_SERVICE_TOKEN,
  type IReturnsService,
  type IncomingReturn,
} from '@openlinker/core/returns';
import { ReturnActionsController } from '../../src/returns/http/return-actions.controller';
import { ReturnWritesController } from '../../src/returns/http/return-writes.controller';
import { createTestConnection } from './helpers/test-connection.helper';
import { loginAsViewer } from './helpers/test-auth.helper';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

interface DiscoveredRoute {
  handler: string;
  method: RequestMethod;
  path: string;
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
      return [{ handler: name, method, path: `/v1/${joined}` }];
    });
}

/** A write is anything that is not a read. Enumerated, not listed. */
const WRITE_METHODS = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

describe('Returns Write Authorization Integration', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  let returnId: string;
  let lineId: string;

  const http = (): ReturnType<typeof request> => harness.getHttp();

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    // ONE login per test — the helper plain-INSERTs a fixed username.
    token = await loginAsViewer(http(), harness.getDataSource());

    const connectionId = (await createTestConnection(harness.getDataSource(), { name: 'Source A' }))
      .id;

    const observation: IncomingReturn = {
      externalReturnId: 'RET-AUTHZ-1',
      externalOrderId: null,
      rawStatus: 'WAITING_FOR_PARCEL',
      createdAt: '2026-08-01T10:00:00.000Z',
      lines: [{ quantity: 2, reasonRaw: 'withdrawal' }],
    };

    const { record } = await harness
      .getApp()
      .get<IReturnsService>(RETURNS_SERVICE_TOKEN, { strict: false })
      .upsertFromObservation(connectionId, observation);

    returnId = record.id;
    lineId = record.lines[0].id;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  const writeRoutes = (): DiscoveredRoute[] =>
    [...discoverRoutes(ReturnWritesController), ...discoverRoutes(ReturnActionsController)].filter(
      (route) => WRITE_METHODS.has(route.method)
    );

  it('should discover every returns write route from Nest metadata', () => {
    const routes = writeRoutes();

    // Guards the reader itself: were `discoverRoutes` to silently return [], the
    // per-route refusal test below would pass vacuously and assert nothing.
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((route) => route.path.startsWith('/v1/returns'))).toBe(true);
  });

  it('should refuse a read-only principal on EVERY discovered write route', async () => {
    const routes = writeRoutes();
    const outcomes: Array<{ route: string; status: number }> = [];

    for (const route of routes) {
      const path = route.path
        .replace(':returnId', encodeURIComponent(returnId))
        .replace(':lineId', encodeURIComponent(lineId));

      const verb =
        route.method === RequestMethod.POST
          ? 'post'
          : route.method === RequestMethod.PUT
            ? 'put'
            : route.method === RequestMethod.PATCH
              ? 'patch'
              : 'delete';

      const response = await http()
        [verb](path)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      outcomes.push({ route: `${verb.toUpperCase()} ${route.path}`, status: response.status });
    }

    // Asserted as one object so a failure NAMES the unguarded route rather than
    // reporting "expected 403, received 400" about an anonymous request.
    expect(outcomes).toEqual(outcomes.map((outcome) => ({ route: outcome.route, status: 403 })));
    expect(outcomes).toHaveLength(routes.length);
  });

  it('should not refuse the same principal on a returns READ, so 403 means the role', async () => {
    // Without this, a blanket misconfiguration that 403s everything would make
    // the test above pass while proving nothing about writes specifically.
    await http()
      .get(`/v1/returns/${encodeURIComponent(returnId)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
