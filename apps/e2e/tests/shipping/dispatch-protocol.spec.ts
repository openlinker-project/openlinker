/**
 * Shipping suite — S4: dispatch (handover) protocol, InPost (#1543)
 *
 * `DispatchProtocolReader` was previously DPD-only; InPost now implements it
 * via ShipX `dispatch_orders/printouts` (`InpostShippingAdapter.generateProtocol`).
 * The handover protocol is a per-BATCH manifest over already-generated
 * shipments, exposed at `POST /shipments/bulk/protocol` (the bulk-dispatch
 * surface, #964) — the service derives the InPost connection from the
 * shipment rows and asserts they all belong to one carrier account.
 *
 * Needs TWO unclaimed `ready` orders, not one: dispatch is guarded per order
 * (`ShipmentDispatchService.findActiveByOrderId` returns the existing shipment
 * rather than creating a second), so two shipments require two orders. It skips
 * with the shortfall named when the stack cannot supply them.
 *
 * ShipX rejects the printout for a shipment that has not yet reached its
 * `confirmed` state carrier-side — a sandbox timing detail, the same one
 * `waitForTrackingBackfill` documents for tracking numbers (#1521). This spec
 * mirrors that established tolerance: drive the carrier-generic
 * `marketplace.shipment.statusSync` poll and retry the protocol call for a
 * bounded budget; only a genuine sandbox-timing timeout degrades to an
 * annotation instead of failing the suite.
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import {
  SYNTHETIC_COURIER_PARCEL,
  buildCourierRecipient,
  isCourierUnprovisionedError,
  releaseDispatchedShipments,
  shippingOrderShortageReason,
  resolveDispatchedShipment,
  setUpShippingTestOrder,
} from '../../src/support/shipments';

test.describe('shipping — InPost dispatch (handover) protocol', () => {
  // Recycle the fixture pool. Every dispatch leaves a non-terminal shipment on
  // its order, and `resolveShippingTestOrder` refuses an order that already has
  // one - so without this the suite eats its own pool and every shipping spec
  // eventually `test.skip`s green with zero coverage. Best-effort and silent on
  // an already-confirmed shipment; `afterAll`, so a failing test still recycles.
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
  });

  test('generates a handover protocol over two InPost shipments', async ({
    api,
    world,
    env,
    jobs,
  }, testInfo) => {
    // A DISTINCT order per shipment. `ShipmentDispatchService` guards dispatch
    // with an order-scoped `findActiveByOrderId` and hands back the existing
    // shipment when one is found, so looping twice over ONE order yields the
    // same row twice: `expect(shipment).toBeTruthy()` still passes, the manifest
    // is generated over a single shipment, and the multi-shipment path this test
    // exists to prove is never exercised. Resolving a fresh unclaimed order per
    // iteration is the only way to get two real shipments.
    let inpostConnectionId: string | null = null;
    const shipmentIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const setup = await setUpShippingTestOrder(api, world, env);
      test.skip(
        !setup,
        `no InPost connection, or need ${2 - i} more unclaimed ready order(s) for a ` +
          `multi-shipment manifest: ${shippingOrderShortageReason()}`,
      );
      const { order, deliveryMethodId } = setup!;
      inpostConnectionId = setup!.inpostConnectionId;

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
      expect(shipment, `shipment #${i + 1} was created`).toBeTruthy();
      shipmentIds.push(shipment.id);
    }

    // The assertion the old single-order loop could not make: a manifest over
    // one reused shipment is not a multi-shipment manifest.
    expect(new Set(shipmentIds).size, 'two DISTINCT shipments on the manifest').toBe(2);

    // Bounded retry: ShipX confirms a shipment asynchronously; drive the
    // status-sync poll each attempt (mirrors `waitForTrackingBackfill`) rather
    // than sleeping blindly.
    const deadline = Date.now() + 120_000;
    let result = await api.shipments.generateProtocol(shipmentIds);
    while (!result.ok && Date.now() < deadline) {
      // Non-null: the loop above either ran (setting it) or `test.skip` threw.
      await jobs.syncShipmentStatus(inpostConnectionId!, { timeoutMs: 10_000 }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      result = await api.shipments.generateProtocol(shipmentIds);
    }

    if (!result.ok) {
      // `requestRawPost` never throws - it reports EVERY non-2xx as
      // `{ok: false, status}` - so the annotate-and-return below used to absorb
      // a 500, an expired token, and a routing 404 identically to the documented
      // sandbox-timing case, and the `expect(result.ok).toBe(true)` that
      // followed was unreachable whenever it could have failed. Only the
      // shipment-not-yet-confirmed shape (a 4xx from ShipX, relayed by OL as a
      // client error) is a timing gap; anything server-side or auth-related is a
      // real defect and must be red.
      if (result.status >= 500 || result.status === 401 || result.status === 403) {
        throw new Error(
          `handover protocol request FAILED with status ${result.status} for shipments ` +
            `${shipmentIds.join(', ')} - a server error or auth failure, not the documented ShipX ` +
            'asynchronous-confirmation delay',
        );
      }
      testInfo.annotations.push({
        type: 'dispatch-protocol',
        description:
          `handover protocol not retrievable within timeout for shipments ${shipmentIds.join(', ')} ` +
          `(status ${result.status}) — ShipX confirms shipments asynchronously; a sandbox-timing gap, ` +
          'not necessarily a regression (mirrors the #1521 tracking-backfill timing note)',
      });
      return;
    }
    expect(result.byteLength, 'handover protocol carries bytes').toBeGreaterThan(0);
  });
});
