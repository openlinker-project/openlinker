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
import type { Shipment } from '../../src/api/api.types';
import { PlatformType } from '../../src/world/world';
import {
  buildPickupRecipient,
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

/**
 * The newest Allegro order on this stack whose active shipment matches.
 *
 * Reads shipments per order rather than filtering the order list, because
 * `OrderRecord` carries no fulfilment state on the wire - the rollup is
 * derived for the UI and is not part of this list response. Bounded to one
 * page: the question is whether a matching sale exists to observe, not how
 * many there are.
 */
async function findAllegroShipment(
  api: ApiClient,
  sourceConnectionId: string,
  matches: (shipment: Shipment) => boolean,
): Promise<{ orderId: string; shipment: Shipment } | null> {
  const orders = await api.orders.list({ sourceConnectionId, limit: 25 });
  for (const order of orders.items) {
    const shipment = await api.shipments.active(order.internalOrderId);
    if (shipment !== null && matches(shipment)) {
      return { orderId: order.internalOrderId, shipment };
    }
  }
  return null;
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

    // PICKUP POINT, not courier (#3365 audit).
    //
    // This dispatched with `deliveryIntent: 'address'`, and the suite's own
    // helper records - verified live against `GET /v1/organizations` - that the
    // ShipX sandbox organization enrolls no courier carrier at all. So the
    // dispatch threw, the spec skipped, and the ONLY assertion that the relay
    // fires without an operator click never ran, on any run, while the project
    // reported green. Every sibling spec that needs a label actually bought
    // uses a locker for the same reason (`cod.spec.ts`, `routing-matrix.spec.ts`,
    // `declared-value.spec.ts`).
    test.skip(!env.paczkomatId, 'no locker id configured (set E2E_PACZKOMAT_ID)');
    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order.internalOrderId,
      deliveryIntent: 'pickup_point',
      recipient: buildPickupRecipient(order),
      parcel: { template: 'small' },
      paczkomatId: env.paczkomatId!,
    });

    const shipment = await resolveDispatchedShipment(api, dispatch, order.internalOrderId);
    expect(shipment, 'a shipment was created').toBeTruthy();

    // Deliberately nothing between the label and the assertion. Any call to
    // `api.shipments.notifyDispatched` here would make this test pass for the
    // reason it exists to rule out.
    const status = await waitForSelfDispatch(api, shipment.id, 120_000);

    // An ALLOW-LIST, not `not.toBe('generated')` (#3365 review). That negation
    // also passes for `failed` and `cancelled` - a shipment that went wrong
    // leaves 'generated' too, so the weaker assertion reports a broken dispatch
    // as a successful one. These three are the states that mean the shipment
    // really did advance under its own steam.
    expect(
      ['dispatched', 'in-transit', 'delivered'],
      `shipment ${shipment.id} was "${status}" two minutes after the label was bought. ` +
        `Nothing advanced it under its own steam, so no waybill relay fired and the ` +
        `marketplace was never told - the exact state before #3365, when only the "Mark ` +
        `dispatched" button could move it. Check that shipping.shipment.notifyDispatched ` +
        `was enqueued and ran.`,
    ).toContain(status);
  });

  // THE ASSERTION THIS SUITE HAS NEVER BEEN ABLE TO MAKE (#3365).
  //
  // The header above says this file does not assert that Allegro received the
  // waybill, because until now nothing could: `OrderStatusWriteback` is
  // fire-and-forget by ADR-027, so every "the marketplace was told" check in
  // this repository asserts an OpenLinker row or a mock, and the marketplace
  // side was a human's word in a project CI cannot select.
  //
  // `GET /orders/:id/source-fulfillment` asks the marketplace. It was PROBED
  // live before being built - `GET /order/checkout-forms/{id}/shipments`
  // answered 200 with the tracking numbers OpenLinker had attached - so this
  // reads a route that is known to exist rather than one assumed to.
  //
  // Both tests below observe a sale this stack ALREADY carries rather than
  // producing one: the claim under test is about what the marketplace says,
  // and buying a second order would not make it any truer.
  test('the SOURCE marketplace confirms the dispatch OpenLinker relayed', async ({
    api,
    world,
  }) => {
    const source = world.connectionFor(PlatformType.allegro);
    test.skip(!source, 'no Allegro connection on this stack');

    // Deliberately NOT filtered on `status === 'dispatched'` (#3365 audit).
    // When the relay is REJECTED, `notifyDispatched` leaves the row at
    // `generated` on purpose - so a `dispatched` filter selects nothing, the
    // test skips, and the exact regression it exists to catch reports green.
    // Any shipment that reached the carrier is a valid subject; what is under
    // test is what ALLEGRO says about it.
    const dispatched = await findAllegroShipment(api, source!.id, (shipment) =>
      ['generated', 'dispatched', 'in-transit', 'delivered'].includes(shipment.status),
    );
    test.skip(
      dispatched === null,
      'no Allegro shipment on this stack - buy an order and generate a label first',
    );

    const view = await api.orders.sourceFulfillment(dispatched!.orderId);

    // ASSERTED FIRST, and separately (#3365 audit). `unsupported` means the
    // source reports nothing back and `unavailable` that it could not be
    // reached; folding either into the waybill or dispatch assertion below
    // would report an Allegro outage as "the relay did not land".
    expect(
      view.readback?.outcome,
      `the source did not answer for ${dispatched!.orderId}: ` +
        `${view.readback?.detail ?? view.unmappedReason ?? 'no reason given'}`,
    ).toBe('read');

    // What the MARKETPLACE says, not what OpenLinker recorded.
    expect(
      view.readback?.dispatched,
      `OpenLinker recorded this order as dispatched, but ${view.sourceConnectionName} reports ` +
        `"${view.readback?.rawStatus}" - the relay did not land, or landed as something else.`,
    ).toBe(true);
  });

  // The waybill half, kept SEPARATE because a source may report a status and
  // not its shipments, and `null` there means "not reported" rather than "none
  // attached". Asserting both in one test would make an honest `null` look
  // like a missing waybill.
  test('the SOURCE marketplace reports back the waybill OpenLinker attached', async ({
    api,
    world,
  }) => {
    const source = world.connectionFor(PlatformType.allegro);
    test.skip(!source, 'no Allegro connection on this stack');

    const relayed = await findAllegroShipment(
      api,
      source!.id,
      (shipment) =>
        typeof shipment.trackingNumber === 'string' && shipment.trackingNumber.length > 0,
    );
    test.skip(
      relayed === null,
      'no Allegro order on this stack carries a shipment with a tracking number',
    );

    const waybill = relayed!.shipment.trackingNumber as string;
    const view = await api.orders.sourceFulfillment(relayed!.orderId);

    // The OUTCOME first: an `unavailable` Allegro carries `waybills: null`, and
    // without this the next assertion would report a marketplace outage as a
    // missing waybill (#3365 audit).
    expect(
      view.readback?.outcome,
      `the source did not answer for ${relayed!.orderId}: ` +
        `${view.readback?.detail ?? view.unmappedReason ?? 'no reason given'}`,
    ).toBe('read');

    // `null` is "this source does not report waybills". Asserted on the
    // readback itself rather than through optional chaining, because
    // `view.readback?.waybills` yields `undefined` when `readback` is null -
    // which is not null, so the guard whose whole job is to prevent vacuity was
    // itself vacuous.
    expect(
      view.readback,
      `no readback at all for ${relayed!.orderId}`,
    ).not.toBeNull();
    expect(
      view.readback!.waybills,
      `${view.sourceConnectionName} reported no waybill list at all for ${relayed!.orderId}`,
    ).not.toBeNull();

    expect(
      (view.readback?.waybills ?? []).map((entry) => entry.waybill),
      `OpenLinker relayed ${waybill} to ${view.sourceConnectionName}, and the ` +
        `marketplace does not list it among the waybills attached to this order.`,
    ).toContain(waybill);
  });
});
