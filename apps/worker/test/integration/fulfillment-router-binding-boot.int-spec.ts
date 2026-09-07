/**
 * Fulfilment router binding — worker boot integration test (#2408)
 *
 * **Both production call sites execute in the worker**: #2396's ingestion
 * intercept inside `OrderIngestionService`, and `FulfillmentWorkRouteHandler`.
 * An api-only wiring test therefore leaves the host that matters unproven, which
 * is the whole reason this file exists beside
 * `apps/api/test/integration/fulfillment-router-wiring.int-spec.ts`.
 *
 * ## What only a boot can prove
 *
 * `FULFILLMENT_ROUTER_RESOLVER_TOKEN` is injected **REQUIRED**, never
 * `@Optional()` — an optional token defaulting to `null` would make a host that
 * FORGOT the binding indistinguishable from one deliberately running
 * router-less, and that misconfiguration is otherwise invisible because the
 * router-less path is a silent, fully-specified pass-through. So a missing or
 * unexported binding is a BOOT failure, and only booting the real container can
 * observe it. Lint, type-check and every unit suite stay green either way.
 *
 * The resolution below deliberately goes through `select(OrdersModule)` rather
 * than the root injector: `FulfillmentRouterBindingModule` is `@Global()`, and
 * `@Global()` publishes a module's **exports**, not its providers. The root
 * injector would answer even if `OrdersModule` could not see the token — which
 * is exactly the bug the `exports` line prevents, and `OrdersModule` is where
 * `OrderIngestionService` is declared and therefore where its injection
 * resolves from.
 *
 * Note (#786): `apps/worker/test/**` is excluded from `pnpm lint` and
 * `pnpm type-check`, so this file compiles only under ts-jest at integration
 * time. A green lint/type-check says nothing about it.
 *
 * @module apps/worker/test/integration
 */
import {
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  type FulfillmentRouterResolverPort,
} from '@openlinker/core/fulfillment';
import { ORDER_INGESTION_SERVICE_TOKEN, OrdersModule } from '@openlinker/core/orders';

import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

describe('Fulfilment router binding — worker (#2408)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    // Set BEFORE the container boots (the `oms-module-boot` precedent): running
    // this file alone via `--runTestsByPath` is the diagnostic path that matters
    // for a boot gate, and without this it dies in `getPiiConfig` first.
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';

    // The assertion begins here. `AppModule.forRoles()` composes
    // `FulfillmentRouterBindingModule` into the SHARED array; if it were absent,
    // or bound without the `exports` line, the REQUIRED injection in
    // `OrderIngestionService` would fail and this call would throw.
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('boots the real worker container with the binding in place', () => {
    // The successful `beforeAll` is the claim; this pins that the harness really
    // came up rather than the suite passing on an unresolved promise.
    expect(harness).toBeDefined();
  });

  it('resolves the router resolver from OrdersModule, where the REQUIRED injection resolves from', () => {
    const resolver = harness
      .getAppContext()
      .select(OrdersModule)
      .get<FulfillmentRouterResolverPort>(FULFILLMENT_ROUTER_RESOLVER_TOKEN);

    expect(resolver).toBeDefined();
    expect(typeof resolver.resolve).toBe('function');
  });

  it('constructs OrderIngestionService, which requires that token', () => {
    // The consumer, not just the token. `OrderIngestionService` takes the
    // resolver as a non-optional constructor dependency, so resolving the
    // service is what actually proves the injection was satisfiable rather than
    // merely that a provider exists somewhere in the graph.
    const ingestion = harness
      .getAppContext()
      .select(OrdersModule)
      .get<{ ingestOrders: unknown }>(ORDER_INGESTION_SERVICE_TOKEN);

    expect(ingestion).toBeDefined();
    expect(typeof ingestion.ingestOrders).toBe('function');
  });

  it('answers null for a connection it cannot read, rather than throwing', async () => {
    // The degenerate pass-through, exercised against the REAL composed resolver
    // in the host that runs it. Degrading to today's path is the safe direction:
    // an unrouted order is recoverable by hand, two shipments are not.
    const resolver = harness
      .getAppContext()
      .select(OrdersModule)
      .get<FulfillmentRouterResolverPort>(FULFILLMENT_ROUTER_RESOLVER_TOKEN);

    expect(await resolver.resolve('00000000-0000-0000-0000-0000000000ff')).toBeNull();
  });
});
