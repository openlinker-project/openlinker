/**
 * Fulfilment router WIRING — end to end through the injector (#2408)
 *
 * `resolveFulfillmentRouter` used to be a dependency-free module function that
 * returned `null`. #2408 replaced it with `FulfillmentRouterResolverPort`, bound
 * host-side because the one implementation lives in `@openlinker/oms` and
 * `libs/core` may not import it. This file proves that binding is real.
 *
 * ## Why it resolves from `OrdersModule`'s injector and not the root's
 *
 * `FulfillmentRouterBindingModule` is `@Global()`, and `@Global()` publishes a
 * module's **exports**, not its providers. `OrderIngestionService` is declared in
 * `OrdersModule`, so that is the injector its REQUIRED injection resolves from —
 * and the root injector would answer even if `OrdersModule` could not see the
 * token, which is exactly the bug the `exports` line prevents. So every
 * resolution below goes through `app.select(OrdersModule)`.
 *
 * A test that constructs its own `OlFulfillmentRouter` and calls
 * `RoutingCommitService.route()` proves nothing at all about the wiring; the
 * router used in the routing case below is the one the RESOLVER handed back.
 *
 * ## THE TRAP, for whoever writes the next routing test
 *
 * `RoutingCommitService.refusalFor` refuses any plan carrying `unfulfillable`
 * lines (`plan-carries-unfulfillable`) or holds (`plan-carries-holds`).
 * `OlFulfillmentRouter` never emits holds — but it DOES emit `unfulfillable`
 * whenever a line cannot be sourced, and `evaluate-routing.ts` reports the whole
 * order unfulfillable when *every candidate location was eliminated by the
 * configured filters*, which includes there being no candidate at all.
 *
 * So a fixture with **no active `inventory_locations` row**, or with a location
 * carrying **less stock than the line asks for**, or whose `inventory_items` row
 * has a NULL `locationId` (`loadStock` skips those — a pooled position is not
 * located stock), comes back as `{ status: 'refused', reason:
 * 'plan-carries-unfulfillable' }`. That is a routing REFUSAL, correctly
 * reported. It is NOT broken wiring, and it is not a bug in the resolver. If you
 * are staring at a `refused` outcome, check the fixture's stock and locations
 * before you touch anything under `libs/core/src/fulfillment`.
 *
 * The ruleset is deliberately left EMPTY (`oms_routing_rules` has no rows): with
 * no rules `evaluateRouting` applies no filters and
 * `mostRestrictiveAfterAction([])` returns `quantity-split`, so an empty
 * operator configuration is inert and every active location is a candidate. That
 * is the simplest fixture that still exercises the real pipeline, and there is
 * no HTTP surface for authoring rules yet (#2953).
 *
 * ## Dispatch is driven IN-TEST, never enqueued
 *
 * `fulfillment.work.dispatch` deliberately has zero producers in the tree
 * (#2955), so this file calls `FulfillmentHandshakeService.dispatch` directly
 * with the real `OlFulfillmentExecutorAdapter` — which auto-accepts — rather
 * than adding one. Accepting is what makes the work visible to the bench, whose
 * list filters on `BENCH_WORK_REQUEST_STATUSES = ['accepted']`.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_HANDSHAKE_SERVICE_TOKEN,
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  ROUTING_COMMIT_SERVICE_TOKEN,
  buildRoutingShipTo,
  type FulfillmentRouterResolverPort,
  type IFulfillmentHandshakeService,
  type IRoutingCommitService,
  type RoutingLockPort,
} from '@openlinker/core/fulfillment';
import { LOCATION_SERVICE_TOKEN, type ILocationService } from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { OrdersModule } from '@openlinker/core/orders';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { OMS_PLATFORM_TYPE, OlFulfillmentExecutorAdapter } from '@openlinker/oms';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsPacker } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';

/**
 * A local, in-process lock.
 *
 * `RoutingLockPort` is a structurally-satisfied leaf port (that is how
 * `SyncLockPort` fits it without an edge), and the lock is not the subject of
 * this file — the resolver binding and the routed rows are. Using a real one
 * here would only add a Redis dependency to an assertion about wiring.
 */
const singleUseLock = (): RoutingLockPort => {
  const held = new Set<string>();
  return {
    acquire: async (key: string) => {
      if (held.has(key)) return null;
      held.add(key);
      return 'token';
    },
    release: async (key: string) => held.delete(key),
  };
};

describe('Fulfilment router wiring (#2408)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /**
   * The resolver as `OrderIngestionService` sees it.
   *
   * `select(OrdersModule)` is the whole point — see this file's header.
   */
  const resolverFromOrdersModule = (): FulfillmentRouterResolverPort =>
    harness
      .getApp()
      .select(OrdersModule)
      .get<FulfillmentRouterResolverPort>(FULFILLMENT_ROUTER_RESOLVER_TOKEN);

  const createOmsConnection = async (name = 'OpenLinker OMS') =>
    createTestConnection(harness.getDataSource(), {
      platformType: OMS_PLATFORM_TYPE,
      name,
      status: 'active',
      // NULL, exactly as the connection form leaves it — the registry resolves
      // the default adapter key (`openlinker.oms.v1`).
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      // A2 is `config-only` (#2403). Not read by `RoutingCommitService` — which
      // takes `routerConnectionId` as an argument — but this is the state a real
      // install is in when the router runs, so the fixture says so.
      config: { sourcingAuthority: { enabled: true } },
    });

  describe('the resolver reaches OrdersModule, and answers per connection', () => {
    it('returns a router for an OMS connection', async () => {
      const oms = await createOmsConnection();

      const router = await resolverFromOrdersModule().resolve(oms.id);

      // Non-null is the claim: the binding exists, is exported to
      // `OrdersModule`, and `createOmsFulfillmentRouterResolver` could build the
      // router from providers the host really supplies (rules, locations,
      // inventory, work query). A missing provider would have thrown at boot.
      expect(router).not.toBeNull();
      expect(typeof router?.route).toBe('function');
      expect(typeof router?.evaluate).toBe('function');
    });

    it('returns null for a non-OMS connection', async () => {
      // The `platformType` discriminator. A PrestaShop connection may claim A2 —
      // nothing stops it, because A2 is config-only — and OpenLinker has no
      // router for it. `null` here is the specified answer, not an error.
      const prestashop = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        name: 'A shop claiming sourcing authority',
        config: { baseUrl: 'https://shop.example.com', sourcingAuthority: { enabled: true } },
      });

      expect(await resolverFromOrdersModule().resolve(prestashop.id)).toBeNull();
    });

    it('returns null rather than throwing for a connection that cannot be read', async () => {
      // Degrading to today's path is the safe direction: an unrouted order is
      // recoverable by hand, two shipments are not.
      expect(
        await resolverFromOrdersModule().resolve('00000000-0000-0000-0000-0000000000ff')
      ).toBeNull();
    });
  });

  describe('routed -> work rows -> accepted -> visible at the bench', () => {
    it('commits fulfillment_works from the RESOLVED router, and the bench lists the accepted parcel', async () => {
      const dataSource = harness.getDataSource();
      const oms = await createOmsConnection('Warehouse packing');

      // --- fixture: one active location holding enough stock -----------------
      // Read the TRAP in this file's header before changing any of this.
      const location = await harness
        .getApp()
        .get<ILocationService>(LOCATION_SERVICE_TOKEN)
        .createLocation({
          code: 'WH1',
          name: 'Main warehouse',
          kind: 'warehouse',
          countryIso2: 'PL',
          postcode: '30-001',
        });

      const productId = 'ol_product_routewire';
      const variantId = 'ol_variant_routewire';
      await dataSource
        .getRepository(ProductOrmEntity)
        .save({ id: productId, name: 'Routed product', sku: null, price: null });
      await dataSource
        .getRepository(ProductVariantOrmEntity)
        .save({ id: variantId, productId, sku: 'RW-1' });
      await dataSource.getRepository(InventoryItemOrmEntity).save({
        id: 'ol_inventory_routewire',
        productId,
        productVariantId: variantId,
        // `locationId` must be NON-NULL: `OlFulfillmentRouter.loadStock` skips
        // pooled positions, so a NULL here reads as zero stock and the whole
        // order comes back unfulfillable.
        locationId: location.id,
        availableQuantity: 10,
        reservedQuantity: 0,
      });

      // --- route through the router the RESOLVER handed back -----------------
      const router = await resolverFromOrdersModule().resolve(oms.id);
      expect(router).not.toBeNull();

      const orderId = 'ol_order_routewire';
      const outcome = await harness
        .getApp()
        .select(OrdersModule)
        .get<IRoutingCommitService>(ROUTING_COMMIT_SERVICE_TOKEN)
        .route({
          orderId,
          routerConnectionId: oms.id,
          lines: [{ orderLineId: 'line-1', productVariantId: variantId, quantity: 2 }],
          shipTo: buildRoutingShipTo(
            { countryIso2: 'PL', postalCode: '30-001', city: 'Kraków', addressHash: null },
            { storePii: true }
          ),
          requestedDeliveryMethod: 'courier',
          router: router!,
          lock: singleUseLock(),
          isCancelled: async () => false,
        });

      // Asserted as the WHOLE outcome, so a `refused` arm cannot slip past a
      // narrower check — see the TRAP note in this file's header.
      expect(outcome.status).toBe('routed');
      if (outcome.status !== 'routed') throw new Error('unreachable');
      expect(outcome.workIds).toHaveLength(1);

      // --- the rows the routing commit is FOR -------------------------------
      const works = (await dataSource.query(
        `SELECT id, "orderId", "locationId", "assignedConnectionId", "deliveryMethod", "requestStatus"
           FROM "fulfillment_works" WHERE "orderId" = $1`,
        [orderId]
      )) as {
        id: string;
        locationId: string | null;
        assignedConnectionId: string | null;
        deliveryMethod: string | null;
        requestStatus: string;
      }[];
      expect(works).toHaveLength(1);
      expect(works[0].locationId).toBe(location.id);
      // The holder is THIS connection: OpenLinker's own OMS fulfils what it routes.
      expect(works[0].assignedConnectionId).toBe(oms.id);
      expect(works[0].deliveryMethod).toBe('courier');
      expect(works[0].requestStatus).toBe('unsubmitted');

      const lines = (await dataSource.query(
        `SELECT "productVariantId", "totalQuantity" FROM "fulfillment_work_lines" WHERE "workId" = $1`,
        [works[0].id]
      )) as { productVariantId: string; totalQuantity: number }[];
      expect(lines).toHaveLength(1);
      expect(lines[0].productVariantId).toBe(variantId);
      expect(Number(lines[0].totalQuantity)).toBe(2);

      // The intent row, terminalised in the SAME transaction as the work rows.
      const decisions = (await dataSource.query(
        `SELECT state, "routerConnectionId", "routerDecisionRef"
           FROM "routing_decisions" WHERE "orderId" = $1`,
        [orderId]
      )) as { state: string; routerConnectionId: string; routerDecisionRef: string | null }[];
      expect(decisions).toHaveLength(1);
      expect(decisions[0].state).toBe('committed');
      expect(decisions[0].routerConnectionId).toBe(oms.id);
      // The ROUTER's own reference, `oms:{idempotencyKey}` — proof the plan came
      // from `OlFulfillmentRouter` rather than from anything this test built.
      expect(decisions[0].routerDecisionRef).toMatch(/^oms:/);

      // --- dispatch + accept, driven in-test (no producer exists, #2955) -----
      const handshake = harness
        .getApp()
        .get<IFulfillmentHandshakeService>(FULFILLMENT_HANDSHAKE_SERVICE_TOKEN);
      const result = await handshake.dispatch({
        workId: works[0].id,
        expectedAssignmentAttempt: null,
        shipTo: buildRoutingShipTo(
          { countryIso2: 'PL', postalCode: '30-001', city: 'Kraków', addressHash: null },
          { storePii: true }
        ),
        // The real OL executor — it auto-accepts, and holds no state of its own.
        executor: new OlFulfillmentExecutorAdapter(),
      });
      expect(result.outcome).toBe('accepted');
      expect(result.idempotencyKey).toBe(`work:${works[0].id}:1`);

      // --- and now the bench can see it -------------------------------------
      const token = await loginAsPacker(harness.getHttp(), dataSource);
      const res = await harness
        .getHttp()
        .get('/v1/bench/work')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.routing).toEqual({ ready: true, reason: null });
      expect(res.body.executorName).toBe('Warehouse packing');
      const listed = (res.body.works as { workId: string; state: string }[]).find(
        (row) => row.workId === works[0].id
      );
      expect(listed).toBeDefined();
      expect(listed?.state).toBe('packable');
    });
  });
});
