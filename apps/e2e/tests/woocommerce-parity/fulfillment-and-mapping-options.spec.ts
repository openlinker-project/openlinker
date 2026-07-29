/**
 * WooCommerce parity — scenario 6 (FulfillmentStatusReader half) and
 * scenario 7 (DestinationOptionsReader via pairing-based resolution)
 *
 * Scenario 6 in the issue asks for both directions of the WC order-lifecycle
 * capability pair:
 *   - OrderStatusWriteback (OL -> WC): SKIPPED here. `OrderLifecycleRelayService
 *     .relay()` (#1157/ADR-027) has no HTTP entry point in this API surface —
 *     it is invoked internally from the shipment-dispatch-notification and
 *     order-ingestion flows, which for a full exercise would require driving
 *     a complete carrier/label pipeline (InPost) unrelated to WooCommerce
 *     parity. Not implemented; flagged as a product-surface gap in the PR
 *     description rather than worked around here.
 *   - FulfillmentStatusReader (WC -> OL): IMPLEMENTED below — the
 *     `marketplace.fulfillment.statusSync` job (#834/#1550) reads WC's order
 *     status back into a projected OL `Shipment` row, which IS reachable and
 *     assertable through the existing sync-job + Shipment API surface.
 *
 * Scenario 7 (DestinationOptionsReader in the mapping UI) USED to be a
 * documented product gap: `MappingOptionsController.resolvePartnerConnectionId`
 * hardcoded the mappings page to the Allegro<->PrestaShop pair and answered 400
 * for every other `platformType`, WooCommerce included. #1738 replaced that
 * platform switch with pairing-first, capability-checked resolution keyed on
 * `config.masterCatalogConnectionId`, so the gap is closed and this test now
 * asserts the SUCCESS behaviour it was written to graduate into.
 *
 * Note what "destination" means on this route: for a WooCommerce connection
 * used as an order SOURCE, the destination options are the PAIRED MASTER's
 * (PrestaShop) — that is the platform an ingested WC order is created on, and
 * therefore the vocabulary the operator maps WC statuses ONTO. Asserting the
 * paired master's list rather than WooCommerce's own is the point, not a
 * defect.
 *
 * @module tests/woocommerce-parity
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';

test.describe('WooCommerce fulfillment status read-back', () => {
  test('marketplace.fulfillment.statusSync projects a Shipment row from WC order status', async ({
    api,
    world,
    jobs,
  }) => {
    const wcDestination = world.connectionWithCapability('OrderProcessorManager', 'woocommerce');
    test.skip(!wcDestination, 'no WooCommerce connection configured as OrderProcessorManager on this stack');

    // Find an order this WC connection has already synced to (produced by
    // order-destination.spec.ts, or any prior run) — the job scans OL Order
    // Records mirrored to this connection, so it needs at least one to exist.
    const orders = await api.orders.list({ limit: 50 });
    const candidate = orders.items.find((o) =>
      o.syncStatus.some((s) => s.destinationConnectionId === wcDestination!.id && s.status === 'synced'),
    );
    test.skip(!candidate, 'no order synced to the WooCommerce destination connection yet (run order-destination.spec.ts first)');

    const job = await jobs.syncFulfillmentStatus(wcDestination!.id, {
      cursorKey: `e2e.${wcDestination!.id}.fulfillmentStatus.scanOffset`,
      timeoutMs: 60_000,
    });
    expect(job.status, 'fulfillment-status-sync job reached a terminal status').toBe('succeeded');

    const shipment = await api.shipments.active(candidate!.internalOrderId);
    // A branch-1 (OMP-fulfilled) Shipment row is projected only once the
    // reader observes a non-null WC status (pending/processing/on-hold/failed
    // read as "not yet fulfilled, skip"). Assert loosely: if a row exists, it
    // must be attributable to this connection.
    if (shipment) {
      expect(shipment.connectionId).toBe(wcDestination!.id);
      expect(shipment.orderId).toBe(candidate!.internalOrderId);
    }
  });
});

test.describe('WooCommerce mapping UI option lists (#1571 scenario 7, #1738)', () => {
  test("a WooCommerce connection resolves its paired master's destination option list", async ({
    api,
    world,
  }) => {
    const wc = world.connectionFor(PlatformType.woocommerce);
    test.skip(!wc, 'no WooCommerce connection on the stack');
    // Resolution is pairing-keyed: without `masterCatalogConnectionId` there is
    // no destination to read options from and the route legitimately 400s.
    const pairedMasterId = wc!.config?.['masterCatalogConnectionId'];
    test.skip(
      !pairedMasterId,
      'WooCommerce connection has no masterCatalogConnectionId — nothing to pair with',
    );

    const statuses = (await api.mappingOptions.getDestinationOrderStatuses(wc!.id)) as Array<{
      value?: unknown;
      label?: unknown;
    }>;
    expect(Array.isArray(statuses)).toBe(true);
    expect(
      statuses.length,
      'the paired master advertises at least one destination order status',
    ).toBeGreaterThan(0);
    // `{ value, label }` is the contract the mapping UI's selects bind to.
    for (const option of statuses) {
      expect(typeof option.value).toBe('string');
      expect(typeof option.label).toBe('string');
    }
  });
});
