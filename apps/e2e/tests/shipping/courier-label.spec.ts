/**
 * Shipping suite — S1: InPost courier label (deliveryIntent: address)
 *
 * The golden path (`full-flow.spec.ts` S6) only exercises the paczkomat
 * (pickup-point) path, because the attended purchase always instructs the
 * buyer to choose InPost Paczkomat delivery. This spec closes the courier gap
 * (#1572): dispatch a label with `deliveryIntent: 'address'`, which the
 * dispatch seam resolves to InPost's `kurier` shipping method (requires
 * `recipient.address` + `parcel.dimensions`/`weightGrams`, per
 * `inpost-shipx.mapper.ts`).
 *
 * Unattended — reuses an existing `ready` order (see `resolveShippingTestOrder`)
 * rather than driving a marketplace purchase, so it runs standalone in the
 * `shipping` project.
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import {
  buildCourierRecipient,
  ensureCarrierRouting,
  resolveOrderDeliveryMethodId,
  resolveShippingTestOrder,
  SYNTHETIC_COURIER_PARCEL,
} from '../../src/support/shipments';

test.describe('shipping — InPost courier label', () => {
  test('generates a courier (address-delivery) label and a retrievable PDF', async ({
    api,
    world,
    env,
    poll,
  }) => {
    const inpost = world.connectionFor(PlatformType.inpost);
    test.skip(!inpost, 'no InPost connection on this stack');

    const order = await resolveShippingTestOrder(api, env);
    test.skip(
      !order,
      'no ready order available (set E2E_ORDER_ID or run the golden path first)',
    );

    const deliveryMethodId = resolveOrderDeliveryMethodId(order!);
    await ensureCarrierRouting(api, order!.sourceConnectionId, deliveryMethodId, inpost!.id);

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order!.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order!.internalOrderId,
      deliveryIntent: 'address',
      recipient: buildCourierRecipient(order!),
      parcel: { ...SYNTHETIC_COURIER_PARCEL },
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(order!.internalOrderId));
    expect(shipment, 'a shipment was created for the courier dispatch').toBeTruthy();
    expect(shipment!.connectionId, 'shipment routed to the InPost connection').toBe(inpost!.id);
    expect(shipment!.shippingMethod, 'resolved carrier method for deliveryIntent=address').toBe(
      'kurier',
    );
    expect(shipment!.providerShipmentId, 'ShipX assigned a provider shipment id').toBeTruthy();

    // ShipX renders the label document asynchronously — poll briefly rather
    // than asserting the first response (mirrors golden-path S6).
    await poll.until(
      () => api.shipments.getLabel(shipment!.id),
      (l) => l.ok && l.byteLength > 0,
      { message: 'courier label PDF to become retrievable', timeoutMs: 60_000, intervalMs: 5_000 },
    );
  });
});
