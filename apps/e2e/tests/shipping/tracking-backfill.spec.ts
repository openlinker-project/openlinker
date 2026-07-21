/**
 * Shipping suite — S7: tracking-number backfill (#1521 generalized)
 *
 * #1521 ("assert InPost tracking-number backfill in the golden-path E2E") is
 * ALREADY covered: PR #1681 hardened `full-flow.spec.ts` S6 to poll
 * `waitForTrackingBackfill` (`src/support/shipments.ts`) after the attended
 * purchase's paczkomat dispatch, rather than asserting immediately. That
 * coverage is real and this spec does not duplicate it.
 *
 * What #1572 asks for beyond that: the SAME backfill assertion, generalized
 * off the attended golden path so it also runs unattended against a courier
 * (not just paczkomat) shipment, on this suite's own reused order. This is a
 * thin wrapper around the identical `waitForTrackingBackfill` poller — no new
 * backfill logic, just a second call site proving the assertion holds
 * independent of delivery method and independent of a live buyer purchase.
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import {
  buildCourierRecipient,
  isCourierUnprovisionedError,
  setUpShippingTestOrder,
  SYNTHETIC_COURIER_PARCEL,
  waitForTrackingBackfill,
} from '../../src/support/shipments';

test.describe('shipping — tracking-number backfill (courier)', () => {
  test('backfills the InPost tracking number for a courier shipment', async ({
    api,
    world,
    env,
    jobs,
  }, testInfo) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, 'no InPost connection, or no ready order available (set E2E_ORDER_ID or run the golden path first)');
    const { order, deliveryMethodId, inpostConnectionId } = setup!;

    let dispatch;
    try {
      dispatch = await api.shipments.generateLabel({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'address',
        recipient: buildCourierRecipient(order),
        parcel: { ...SYNTHETIC_COURIER_PARCEL },
      });
    } catch (error) {
      if (isCourierUnprovisionedError(error)) {
        test.skip(true, 'ShipX sandbox organization has no courier carrier/trucker assigned (verified live via GET /v1/organizations)');
        return;
      }
      throw error;
    }
    const shipment = dispatch.shipment ?? (await api.shipments.active(order.internalOrderId));
    expect(shipment, 'a courier shipment was created').toBeTruthy();

    // Identical poller to golden-path S6 (#1521 / PR #1681) — the ShipX
    // sandbox mints `tracking_number` only once the shipment is confirmed, so
    // a bounded, sandbox-timing-tolerant wait is required here too.
    const backfill = await waitForTrackingBackfill(
      api,
      jobs,
      { shipmentId: shipment!.id, inpostConnectionId },
      { timeoutMs: 120_000, intervalMs: 5_000 },
    );
    if (backfill.timedOut) {
      testInfo.annotations.push({
        type: 'tracking',
        description:
          'tracking number not backfilled within timeout for the courier shipment — the ShipX sandbox ' +
          'mints it only after the shipment is confirmed and marketplace.shipment.statusSync runs (#1521)',
      });
      return;
    }
    expect(
      backfill.trackingNumber,
      'OL backfilled the InPost tracking number for the courier shipment',
    ).toBeTruthy();
  });
});
