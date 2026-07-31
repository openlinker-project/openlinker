/**
 * Shipping suite — S7: tracking-number backfill (#1521 generalized)
 *
 * #1521 ("assert InPost tracking-number backfill in the golden-path E2E") is
 * ALREADY covered: PR #1681 hardened full-flow S6 (`08-s6-inpost-labels.spec.ts`) to poll
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
  SYNTHETIC_COURIER_PARCEL,
  assertTrackingBackfill,
  buildCourierRecipient,
  isCourierUnprovisionedError,
  releaseDispatchedShipments,
  shippingOrderShortageReason,
  resolveDispatchedShipment,
  setUpShippingTestOrder,
  waitForTrackingBackfill,
} from '../../src/support/shipments';

test.describe('shipping — tracking-number backfill (courier)', () => {
  // Recycle the fixture pool. Every dispatch leaves a non-terminal shipment on
  // its order, and `resolveShippingTestOrder` refuses an order that already has
  // one - so without this the suite eats its own pool and every shipping spec
  // eventually `test.skip`s green with zero coverage. Best-effort and silent on
  // an already-confirmed shipment; `afterAll`, so a failing test still recycles.
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
  });

  test('backfills the InPost tracking number for a courier shipment', async ({
    api,
    world,
    env,
    jobs,
  }, testInfo) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
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
    const shipment = await resolveDispatchedShipment(api, dispatch, order.internalOrderId);
    expect(shipment, 'a courier shipment was created').toBeTruthy();

    // Identical poller to golden-path S6 (#1521 / PR #1681) — the ShipX
    // sandbox mints `tracking_number` only once the shipment is confirmed, so
    // a bounded, sandbox-timing-tolerant wait is required here too.
    const backfill = await waitForTrackingBackfill(
      api,
      jobs,
      { shipmentId: shipment.id, inpostConnectionId },
      { timeoutMs: 120_000, intervalMs: 5_000 },
    );
    // `assertTrackingBackfill` owns the classification, so this spec and
    // golden-path S6 cannot drift apart on what counts as a defect: it THROWS
    // when the carrier has already moved the parcel (ShipX minted a tracking
    // number and OL dropped it), and only returns an annotation for the
    // documented not-yet-confirmed sandbox state. The previous shape annotated
    // and `return`ed on EVERY timeout, so a total #1426 regression reported
    // green from a test named "backfills the InPost tracking number".
    const unverified = assertTrackingBackfill(backfill, 'courier shipment');
    if (unverified) {
      testInfo.annotations.push({ type: 'tracking', description: unverified });
    }
  });
});
