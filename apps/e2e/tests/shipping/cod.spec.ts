/**
 * Shipping suite — S2: COD (pobranie), incl. validation
 *
 * InPost cash-on-delivery is caller-supplied and pass-through (#966): the
 * `GenerateLabelDto.cod` field carries `{ amount, currency }` to the dispatch
 * seam, which the InPost mapper (`inpost-shipx.mapper.ts`) translates to
 * ShipX's `cod` object. #1554 (closed) added locker support: COD on a
 * `paczkomat` shipment is a `cod` add-on on the standard locker service (same
 * shape as the courier path), NOT a distinct COD-capable service — so a
 * paczkomat dispatch with `cod` set succeeds like any other, verified live
 * against the ShipX sandbox (an earlier draft of this spec asserted the
 * pre-#1554 rejection behavior; corrected here).
 *
 * Validation is defense-in-depth at two layers: the DTO's `@Matches` guards the
 * decimal shape (400 on malformed amount) before the request ever reaches the
 * carrier; the adapter's own preflight guards the ShipX-accepted currency set
 * (502 `ShippingProviderRejectionException` on an unsupported currency).
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import { ApiError } from '../../src/api/api-error';
import {
  buildCourierRecipient,
  buildPickupRecipient,
  isCourierUnprovisionedError,
  setUpShippingTestOrder,
  SYNTHETIC_COURIER_PARCEL,
} from '../../src/support/shipments';

test.describe('shipping — InPost COD (pobranie)', () => {
  test('generates a courier label with a valid COD amount', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, 'no InPost connection, or no ready order available (set E2E_ORDER_ID or run the golden path first)');
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
        cod: { amount: '129.90', currency: 'PLN' },
      });
    } catch (error) {
      if (isCourierUnprovisionedError(error)) {
        test.skip(true, 'ShipX sandbox organization has no courier carrier/trucker assigned (verified live via GET /v1/organizations)');
        return;
      }
      throw error;
    }
    const shipment = dispatch.shipment ?? (await api.shipments.active(order.internalOrderId));
    expect(shipment, 'a COD shipment was created').toBeTruthy();
    expect(shipment!.shippingMethod).toBe('kurier');
  });

  test('generates a paczkomat label with a valid COD amount (#1554)', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, 'no InPost connection, or no ready order available (set E2E_ORDER_ID or run the golden path first)');
    test.skip(!env.paczkomatId, 'no locker id configured (set E2E_PACZKOMAT_ID)');
    const { order, deliveryMethodId } = setup!;

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order.internalOrderId,
      deliveryIntent: 'pickup_point',
      recipient: buildPickupRecipient(order),
      parcel: { template: 'small' },
      paczkomatId: env.paczkomatId!,
      cod: { amount: '50.00', currency: 'PLN' },
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(order.internalOrderId));
    expect(shipment, 'a COD paczkomat shipment was created').toBeTruthy();
    expect(shipment!.shippingMethod).toBe('paczkomat');
  });

  test('rejects a malformed COD amount at the API boundary (400)', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, 'no InPost connection, or no ready order available (set E2E_ORDER_ID or run the golden path first)');
    const { order, deliveryMethodId } = setup!;

    let caught: ApiError | undefined;
    try {
      await api.shipments.generateLabel({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'address',
        recipient: buildCourierRecipient(order),
        parcel: { ...SYNTHETIC_COURIER_PARCEL },
        cod: { amount: 'not-a-number', currency: 'PLN' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'a malformed COD amount must not reach the carrier').toBeTruthy();
    expect(caught!.status, `expected 400 (DTO validation), got ${caught!.status}`).toBe(400);
  });

  test('rejects an unsupported COD currency (502, carrier preflight)', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, 'no InPost connection, or no ready order available (set E2E_ORDER_ID or run the golden path first)');
    const { order, deliveryMethodId } = setup!;

    let caught: ApiError | undefined;
    try {
      await api.shipments.generateLabel({
        sourceConnectionId: order.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order.internalOrderId,
        deliveryIntent: 'address',
        recipient: buildCourierRecipient(order),
        parcel: { ...SYNTHETIC_COURIER_PARCEL },
        // InPost COD is domestic-PL only — a well-formed but non-PLN currency
        // passes DTO validation (any non-empty string) and is refused by the
        // adapter's own preflight instead.
        cod: { amount: '50.00', currency: 'EUR' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'a non-PLN COD currency is rejected by the InPost preflight').toBeTruthy();
    expect(caught!.status, `expected 502 (carrier rejection), got ${caught!.status}`).toBe(502);
  });
});
