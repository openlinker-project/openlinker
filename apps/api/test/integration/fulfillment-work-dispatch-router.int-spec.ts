/**
 * Shipment-first dispatch recovery — integration (#3506, G02-4)
 *
 * The defect, end to end against real Postgres: a parcel closes, the work's
 * one linked `generated` shipment is notified, the SOURCE rejects the relay,
 * and the reconcile sweep later re-drives the work. Before the fix the sweep
 * went straight to the tracking-less work-grain relay, so the channel was told
 * "sent" with no waybill, the work's slot was burnt and the shipment sat at
 * `generated` forever.
 *
 * Both legs go through `IFulfillmentWorkDispatchRouterService` — the exact
 * seam the parcel-closure notifier (first attempt) and the
 * `fulfillment.work.relaySweep` handler (every retry) call — and the
 * frontier between them is read through the real
 * `IFulfillmentRelayReconcileService`, which is what decides whether the
 * sweep sees the work at all. The worker handler itself is a thin loop over
 * those two seams and is pinned by its unit spec.
 *
 * Only the marketplace and carrier HTTP calls are stubbed (the dispatch-notify
 * stub adapters); identifier mappings, the shipment row, the work's relay slot
 * and the progress claim are all real rows.
 *
 * @module apps/api/test/integration
 */
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  FULFILLMENT_RELAY_RECONCILE_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentRelayReconcileService,
} from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  type IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  FULFILLMENT_WORK_DISPATCH_ROUTER_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  type IFulfillmentWorkDispatchRouterService,
  type IShipmentDispatchService,
  type IShipmentQueryService,
} from '@openlinker/core/shipping';

import { createTestOrderRecord } from './fixtures/order.fixtures';
import {
  DISPATCH_CARRIER_ADAPTER_KEY,
  DISPATCH_CARRIER_TRACKING_NUMBER,
  DISPATCH_SOURCE_ADAPTER_KEY,
  type DispatchNotifyTestStubs,
  installDispatchNotifyTestStubs,
} from './helpers/dispatch-notify-test-stubs.helper';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  getTestHarness,
  type IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * The repository port is deliberately off the barrel (a `*RepositoryPort` is an
 * intra-context contract), so the work is created through a local structural
 * view — the `fulfillment-relay-sweep.int-spec.ts` shape.
 */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  findById(workId: string): Promise<FulfillmentWork | null>;
}

const SOURCE_EXTERNAL_ID = 'allegro-checkout-G02-4';
const SOURCE_DELIVERY_METHOD_ID = 'allegro-courier';
const GRACE_MS = 15 * 60 * 1000;
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
const RECIPIENT = {
  email: 'buyer@example.com',
  phone: '+48500600700',
  address: {
    street: 'Krakowska',
    buildingNumber: '12',
    city: 'Poznań',
    postCode: '60-001',
    countryCode: 'PL',
  },
};
const PARCEL = { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 };

describe('Shipment-first dispatch recovery (#3506, G02-4)', () => {
  let harness: IntegrationTestHarness;
  let stubs: DispatchNotifyTestStubs;

  beforeAll(async () => {
    harness = await getTestHarness();
    stubs = installDispatchNotifyTestStubs(harness);
  }, 180000);

  beforeEach(() => {
    stubs.source.writebackCalls.length = 0;
    stubs.source.queuedWriteOutcomes.length = 0;
    stubs.dest.writebackCalls.length = 0;
    stubs.dest.calls.length = 0;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const get = <T>(token: symbol): T => harness.getApp().get<T>(token);
  const router = (): IFulfillmentWorkDispatchRouterService =>
    get<IFulfillmentWorkDispatchRouterService>(FULFILLMENT_WORK_DISPATCH_ROUTER_SERVICE_TOKEN);
  const shipments = (): IShipmentQueryService =>
    get<IShipmentQueryService>(SHIPMENT_QUERY_SERVICE_TOKEN);
  const works = (): WorkRepositoryView =>
    get<WorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  const frontier = (): Promise<readonly string[]> =>
    get<IFulfillmentRelayReconcileService>(FULFILLMENT_RELAY_RECONCILE_SERVICE_TOKEN)
      .listUnrelayedDispatches({
        limit: 25,
        graceMs: GRACE_MS,
        stuckAfterMs: STUCK_AFTER_MS,
        now: new Date(),
      })
      .then((page) => page.candidates.map((candidate) => candidate.intent.workId));

  /**
   * A closed work with one linked `generated` shipment carrying a waybill, and
   * the `shipped` progress claim a parcel close writes — backdated past the
   * sweep's grace window so the frontier would select it.
   */
  async function seedClosedWorkWithGeneratedShipment(
    orderId: string
  ): Promise<{ workId: string; shipmentId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: DISPATCH_SOURCE_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
    });
    const carrier = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: DISPATCH_CARRIER_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });

    await get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN).replaceRules(
      source.id,
      [
        {
          sourceDeliveryMethodId: SOURCE_DELIVERY_METHOD_ID,
          processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
          processorConnectionId: carrier.id,
        },
      ]
    );
    await get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN).createMapping(
      CORE_ENTITY_TYPE.Order,
      SOURCE_EXTERNAL_ID,
      source.id,
      orderId
    );
    await createTestOrderRecord(dataSource, {
      internalOrderId: orderId,
      sourceConnectionId: source.id,
      syncStatus: [],
    });

    const work = await works().create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: source.id,
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 1 }],
    });

    const dispatched = await get<IShipmentDispatchService>(
      SHIPMENT_DISPATCH_SERVICE_TOKEN
    ).dispatch({
      sourceConnectionId: source.id,
      sourceDeliveryMethodId: SOURCE_DELIVERY_METHOD_ID,
      orderId,
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
      fulfillmentWorkId: work.id,
    });
    if (dispatched.kind !== 'dispatched') {
      throw new Error(`expected a dispatched shipment, got ${dispatched.kind}`);
    }

    await dataSource.query(
      `INSERT INTO "fulfillment_progress_claims"
         ("workId", "idempotencyKey", "connectionId", "eventKind", "claimedAt")
       VALUES ($1, $2, $3, 'shipped', now() - interval '60 minutes')`,
      [work.id, `parcel-closed:${work.id}:1`, source.id]
    );

    return { workId: work.id, shipmentId: dispatched.shipment.id };
  }

  it('should deliver the waybill through the shipment when the sweep re-drives a relay the source rejected', async () => {
    const { workId, shipmentId } = await seedClosedWorkWithGeneratedShipment('ol_order_g02_4_a');
    expect((await shipments().getById(shipmentId))?.status).toBe('generated');

    // First attempt (the parcel close): the source rejects the relay.
    stubs.source.queuedWriteOutcomes.push({
      outcome: 'rejected',
      detail: 'Allegro API server error (500)',
    });
    const first = await router().routeDispatch(workId);

    expect(first).toMatchObject({ status: 'shipment-failed', shipmentId });
    expect((await shipments().getById(shipmentId))?.status).toBe('generated');
    expect((await works().findById(workId))?.dispatchRelayedAt ?? null).toBeNull();
    // The slot is still open, so the reconcile sweep selects the work.
    expect(await frontier()).toEqual([workId]);

    // The sweep's re-drive: the source now accepts.
    const second = await router().routeDispatch(workId);

    expect(second).toEqual({ status: 'via-shipment', shipmentId });
    const shipment = await shipments().getById(shipmentId);
    expect(shipment?.status).toBe('dispatched');
    expect(shipment?.dispatchedAt).not.toBeNull();
    expect((await works().findById(workId))?.dispatchRelayedAt ?? null).not.toBeNull();
    expect(await frontier()).toEqual([]);

    // BOTH attempts carried the waybill — the retry was not the tracking-less
    // work-grain relay the pre-fix sweep sent.
    expect(stubs.source.writebackCalls).toEqual([
      expect.objectContaining({
        type: 'dispatched',
        externalOrderId: SOURCE_EXTERNAL_ID,
        trackingNumber: DISPATCH_CARRIER_TRACKING_NUMBER,
      }),
      expect.objectContaining({
        type: 'dispatched',
        externalOrderId: SOURCE_EXTERNAL_ID,
        trackingNumber: DISPATCH_CARRIER_TRACKING_NUMBER,
      }),
    ]);
  });

  it('should relay nothing further when a recovered work is re-driven again', async () => {
    const { workId } = await seedClosedWorkWithGeneratedShipment('ol_order_g02_4_b');
    stubs.source.queuedWriteOutcomes.push({ outcome: 'rejected', detail: 'boom' });
    await router().routeDispatch(workId);
    await router().routeDispatch(workId);
    const relaysSoFar = stubs.source.writebackCalls.length;

    // The shipment is now `dispatched`, so the router falls through to the
    // work-grain relay, whose claim is already held: a no-op, not a duplicate.
    await expect(router().routeDispatch(workId)).resolves.toEqual({ status: 'already-relayed' });
    expect(stubs.source.writebackCalls).toHaveLength(relaysSoFar);
  });
});
