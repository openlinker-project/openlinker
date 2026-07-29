/**
 * Shipment Dispatch Concurrency Integration Test (#1917)
 *
 * Regression guard for the duplicate-paid-label race. Before the per-order
 * lock, two dispatches for one order could both pass the `findActiveByOrderId`
 * read; the loser then reached `findBranchOneByOrderAndConnection`, found the
 * winner's just-created draft row and RESET it (the partial-unique
 * `UQ_shipments_branch_one_per_order_conn` index forbids inserting a second
 * waybill-less row, so it reused rather than inserted). Both then called
 * `generateLabel` with the same shipment id and the carrier minted two paid
 * labels under one reference.
 *
 * A mocked lock cannot prove this: the interesting behaviour is two real
 * concurrent calls against the real Redis lock and the real Postgres
 * constraint. The stub suspends the first `generateLabel` mid-flight so the
 * second dispatch runs inside exactly the window the lock exists to close.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  IShipmentDispatchService,
  ShipmentDispatchContendedException,
  ShipmentDispatchInput,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  INPOST_TEST_ADAPTER_KEY,
  InpostTestShippingStubHandle,
  installInpostTestShippingStub,
} from './helpers/inpost-test-shipping-stub.helper';

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

interface ShipmentRow {
  id: string;
  status: string;
  providerShipmentId: string | null;
}

describe('Shipment Dispatch Concurrency Integration (#1917)', () => {
  let harness: IntegrationTestHarness;
  let stub: InpostTestShippingStubHandle;

  beforeAll(async () => {
    harness = await getTestHarness();
    stub = installInpostTestShippingStub(harness);
  });

  afterEach(async () => {
    stub.resetFailures();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const dispatchService = (): IShipmentDispatchService =>
    harness.getApp().get<IShipmentDispatchService>(SHIPMENT_DISPATCH_SERVICE_TOKEN);
  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);

  async function shipmentRows(orderId: string): Promise<ShipmentRow[]> {
    return harness
      .getDataSource()
      .query(
        'SELECT "id", "status", "providerShipmentId" FROM "shipments" WHERE "orderId" = $1 ORDER BY "createdAt"',
        [orderId],
      ) as Promise<ShipmentRow[]>;
  }

  async function seedManagedCarrier(): Promise<{ sourceId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    const carrier = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: INPOST_TEST_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });
    await routingService().replaceRules(source.id, [
      {
        sourceDeliveryMethodId: 'allegro-courier',
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrier.id,
      },
    ]);
    return { sourceId: source.id };
  }

  function makeInput(sourceId: string, orderId: string): ShipmentDispatchInput {
    return {
      sourceConnectionId: sourceId,
      sourceDeliveryMethodId: 'allegro-courier',
      orderId,
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
    };
  }

  it('should call the carrier exactly once when two dispatches race the same order', async () => {
    const { sourceId } = await seedManagedCarrier();
    const orderId = 'ol_order_race_1';
    const input = makeInput(sourceId, orderId);

    // Suspend dispatch A inside `generateLabel` — it now holds the per-order
    // lock while B runs, which is the precise window that used to duplicate.
    const hold = stub.holdOrder(orderId);
    const first = dispatchService().dispatch(input);
    await hold.started;

    // B runs while A is mid-carrier-call, so its outcome is DETERMINISTIC: A
    // holds the lock, and A's persisted row is still a waybill-less draft, so B
    // has no finished shipment to hand back and must report the order as
    // contended rather than advertise a label that does not exist yet.
    const secondOutcome = await dispatchService()
      .dispatch(input)
      .then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    hold.release();
    const firstResult = await first;

    expect(firstResult.kind).toBe('dispatched');
    // The load-bearing assertion: one carrier call, so one paid label.
    expect(stub.generateLabelCallCount()).toBe(1);

    expect(secondOutcome.ok).toBe(false);
    expect(secondOutcome.ok ? null : secondOutcome.error).toBeInstanceOf(
      ShipmentDispatchContendedException,
    );

    const rows = await shipmentRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('generated');
    expect(rows[0].providerShipmentId).toMatch(/^stub-/);
  });

  it('should release the lock so a later dispatch for the same order still works', async () => {
    const { sourceId } = await seedManagedCarrier();
    const orderId = 'ol_order_race_2';
    const input = makeInput(sourceId, orderId);

    const firstResult = await dispatchService().dispatch(input);
    expect(firstResult.kind).toBe('dispatched');

    // A stuck lock would surface here as a contended throw rather than the
    // idempotent "return the active shipment" answer.
    const secondResult = await dispatchService().dispatch(input);
    expect(secondResult).toMatchObject({ kind: 'dispatched' });
    expect(stub.generateLabelCallCount()).toBe(1);
    expect(await shipmentRows(orderId)).toHaveLength(1);
  });
});
