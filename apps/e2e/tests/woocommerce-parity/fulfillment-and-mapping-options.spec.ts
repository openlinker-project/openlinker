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
  // NOT "projects a Shipment row": the projection is conditional and this spec
  // cannot create the condition. `FulfillmentStatusReader` projects a branch-1
  // row only once WC reports a FULFILLED status; the orders this suite creates
  // are `processing`, which the reader correctly reads as "not yet fulfilled,
  // skip", so no row exists and the `if (shipment)` block asserts nothing. The
  // assertion the old title promised needs the destination WC order driven to
  // `completed` first (`WooCommerceRestClient.updateOrderStatus`) - a further
  // real-shop mutation this spec deliberately does not make. What IS asserted
  // unconditionally: the sync job runs to `succeeded` against a live WC
  // destination, and any row it does project is attributable to that connection
  // and order.
  test('marketplace.fulfillment.statusSync runs against a WC destination (Shipment row asserted only when WC reports one)', async ({
    api,
    world,
    jobs,
  }) => {
    // Resolve the destination FROM an already-synced order rather than
    // guessing a connection up front. `world.connectionWithCapability(...)`
    // returns the first WC connection carrying `OrderProcessorManager` in
    // connection-creation order — on a stack where the SAME WC store is
    // registered twice (one connection as OrderSource, a distinct one as
    // OrderProcessorManager, per `order-destination.spec.ts`'s own topology
    // requirement), the source connection also carries OrderProcessorManager
    // and was created first, so the naive lookup silently picked the SOURCE.
    // `OrderSyncService` never syncs an order back to its own source, so no
    // order could ever satisfy the (wrong) candidate connection and this test
    // self-skipped unconditionally, independent of whether a real sync had
    // happened. Scanning orders first and deriving the connection from an
    // actual `synced` entry is correct regardless of connection topology or
    // creation order.
    //
    // `status === 'active'` is load-bearing, not defensive.
    // `connectionsWithCapability` does NOT filter by status (see `world.ts`),
    // and `order-destination.spec.ts` deliberately DISABLES its spec-owned
    // destination connection on the way out. Playwright orders files
    // alphabetically, so `fulfillment-…` runs BEFORE `order-destination…`: from
    // run 2 onward this spec would resolve the previous run's synced order onto
    // a now-disabled connection, and `syncFulfillmentStatus` would then die
    // inside the adapter with a `ConnectionDisabledException` reported as a job
    // failure. Skipping is the honest outcome - there is genuinely no live WC
    // destination to read fulfillment status from.
    const wcConnectionIds = new Set(
      world.connectionsWithCapability('OrderProcessorManager')
        .filter((c) => c.platformType === 'woocommerce' && c.status === 'active')
        .map((c) => c.id),
    );
    test.skip(
      wcConnectionIds.size === 0,
      'no ACTIVE WooCommerce connection configured as OrderProcessorManager on this stack ' +
        "(order-destination.spec.ts owns one but disables it on teardown, and runs AFTER this " +
        'file alphabetically - enable it by hand to exercise this case)',
    );

    const orders = await api.orders.list({ limit: 50 });
    let wcDestinationId: string | undefined;
    const candidate = orders.items.find((o) =>
      o.syncStatus.some((s) => {
        const match = wcConnectionIds.has(s.destinationConnectionId) && s.status === 'synced';
        if (match) wcDestinationId = s.destinationConnectionId;
        return match;
      }),
    );
    test.skip(!candidate, 'no order synced to a WooCommerce destination connection yet (run order-destination.spec.ts first)');
    const wcDestination = world.connections.find((c) => c.id === wcDestinationId)!;

    const job = await jobs.syncFulfillmentStatus(wcDestination.id, {
      cursorKey: `e2e.${wcDestination.id}.fulfillmentStatus.scanOffset`,
      timeoutMs: 60_000,
    });
    expect(job.status, 'fulfillment-status-sync job reached a terminal status').toBe('succeeded');

    const shipment = await api.shipments.active(candidate!.internalOrderId);
    // A branch-1 (OMP-fulfilled) Shipment row is projected only once the
    // reader observes a non-null WC status (pending/processing/on-hold/failed
    // read as "not yet fulfilled, skip"). Assert loosely: if a row exists, it
    // must be attributable to this connection.
    if (shipment) {
      expect(shipment.connectionId).toBe(wcDestination.id);
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
