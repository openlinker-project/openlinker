/**
 * Shipping — the marketplace is told WITHOUT a click (#3365)
 *
 * `IShipmentDispatchNotificationService.notifyDispatched` had exactly one
 * caller in the whole tree: `POST /shipments/:id/notify-dispatched`, the
 * operator's "Mark dispatched" button. Nothing advanced a shipment out of
 * `generated` on its own, and `ShipmentStatusSyncService`'s push gate opens
 * only at `dispatched` - so a tracking number reached the marketplace only if
 * a human additionally clicked, and a label bought by
 * `fulfillment.work.autoDispatch` told nobody at all.
 *
 * This spec buys a label and then does NOTHING. No `notifyDispatched` call.
 * If the shipment reaches `dispatched` by itself, the enqueued
 * `shipping.shipment.notifyDispatched` job ran and the relay fired.
 *
 * The one programmatic notify anywhere in this suite today is
 * `golden-path/full-flow/08-s6-inpost-labels.spec.ts:105`, and it is explicit
 * - which is exactly why the automatic path had no coverage: every existing
 * spec that wanted a dispatched shipment asked for one.
 *
 * WHAT THIS DOES NOT ASSERT: that Allegro received the waybill. No OpenLinker
 * API can read a marketplace order's status back (the relay is fire-and-
 * forget, as `12-s6x-status-writeback.spec.ts` states), so the marketplace
 * side stays an attended checkpoint. What is assertable, and is asserted, is
 * the half that was missing - that OpenLinker sets the relay going on its own.
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import type { ApiClient } from '../../src/api/api-client';
import {
  SYNTHETIC_COURIER_PARCEL,
  buildCourierRecipient,
  isCourierUnprovisionedError,
  releaseDispatchedShipments,
  resolveDispatchedShipment,
  setUpShippingTestOrder,
  shippingOrderShortageReason,
} from '../../src/support/shipments';

/**
 * Poll until the shipment leaves `generated` on its own.
 *
 * Bounded rather than immediate: the notification is a queued job, so it
 * drains behind whatever the stack already has queued. A timeout here is a
 * real result - it means nothing advanced the row - so the caller reports the
 * last status seen rather than a bare "timed out".
 */
async function waitForSelfDispatch(
  api: ApiClient,
  shipmentId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let status = 'unknown';
  while (Date.now() < deadline) {
    const shipment = await api.shipments.getById(shipmentId);
    status = shipment.status;
    if (status !== 'generated') return status;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return status;
}

test.describe('shipping — automatic dispatch notification (#3365)', () => {
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
  });

  test('a bought label notifies the order participants with no operator action', async ({
    api,
    world,
    env,
  }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
    const { order, deliveryMethodId } = setup!;

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
        test.skip(
          true,
          'ShipX sandbox organization has no courier carrier/trucker assigned (verified live via GET /v1/organizations)',
        );
        return;
      }
      throw error;
    }

    const shipment = await resolveDispatchedShipment(api, dispatch, order.internalOrderId);
    expect(shipment, 'a shipment was created').toBeTruthy();

    // Deliberately nothing between the label and the assertion. Any call to
    // `api.shipments.notifyDispatched` here would make this test pass for the
    // reason it exists to rule out.
    const status = await waitForSelfDispatch(api, shipment.id, 120_000);

    expect(
      status,
      `shipment ${shipment.id} was still "${status}" two minutes after the label was bought. ` +
        `Nothing advanced it, so no waybill relay fired and the marketplace was never told - ` +
        `which is the exact state before #3365, when only the "Mark dispatched" button could ` +
        `move it. Check that shipping.shipment.notifyDispatched was enqueued and ran.`,
    ).not.toBe('generated');
  });
});
