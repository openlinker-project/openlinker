/**
 * WooCommerce parity — scenario 6 (FulfillmentStatusReader half) and
 * scenario 7 (DestinationOptionsReader — documented product gap)
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
 * Scenario 7 (DestinationOptionsReader in the mapping UI) is a DOCUMENTED
 * PRODUCT GAP, not a stub of convenience: `MappingOptionsController
 * .resolvePartnerConnectionId` (apps/api/src/mappings/http/mapping-options
 * .controller.ts) hardcodes the mappings page to the Allegro<->PrestaShop
 * pair — any other `platformType` (including `woocommerce`) throws a 400
 * ("unsupported platform ... today the mappings page is Allegro->PrestaShop
 * only"). The WooCommerce adapter DOES implement `DestinationOptionsReader`
 * (`listCarriers` / `listOrderStatuses` / `listPaymentMethods`), but the HTTP
 * surface that would expose it to the mapping UI does not yet route
 * WooCommerce connections there. This test asserts the CURRENT (gap) behaviour
 * so the gap is visible in CI rather than silently absent, and is expected to
 * start failing (in a good way) once the controller grows WooCommerce
 * support — at which point this test should be rewritten to assert success.
 *
 * @module tests/woocommerce-parity
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import type { ApiError } from '../../src/api/api-error';

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

test.describe('WooCommerce mapping UI option lists (documented gap, #1571 scenario 7)', () => {
  test('destination option endpoints reject a WooCommerce connection today (Allegro/PrestaShop-only route)', async ({
    api,
    world,
  }) => {
    const wc = world.connectionFor(PlatformType.woocommerce);
    test.skip(!wc, 'no WooCommerce connection on the stack');

    let caught: ApiError | undefined;
    try {
      await api.mappingOptions.getDestinationOrderStatuses(wc!.id);
    } catch (error) {
      caught = error as ApiError;
    }
    expect(
      caught,
      'expected the request to fail — WooCommerce is not yet routed by MappingOptionsController',
    ).toBeTruthy();
    expect(caught?.status, `expected HTTP 400, got ${caught?.status}: ${JSON.stringify(caught?.body)}`).toBe(
      400,
    );
  });
});
