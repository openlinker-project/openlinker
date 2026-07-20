/**
 * Shipping suite — S2: COD (pobranie), incl. validation
 *
 * InPost cash-on-delivery is caller-supplied and pass-through (#966): the
 * `GenerateLabelDto.cod` field carries `{ amount, currency }` to the dispatch
 * seam, which the InPost mapper (`inpost-shipx.mapper.ts`) translates to
 * ShipX's `cod` object — but ONLY for the `kurier` (courier) method. COD on a
 * `paczkomat` (locker) shipment is explicitly refused by this adapter version
 * (`preflight.cod-locker-unsupported`, #1554 follow-up), so that is asserted as
 * a rejection, not a gap.
 *
 * Validation is defense-in-depth at two layers: the DTO's `@Matches` guards the
 * decimal shape (400 on malformed amount) before the request ever reaches the
 * carrier; the adapter's own preflight guards the ShipX-accepted currency set
 * (502 `ShippingProviderRejectionException` on an unsupported currency).
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import { PlatformType } from '../../src/world/world';
import { ApiError } from '../../src/api/api-error';
import type { OrderRecord } from '../../src/api/api.types';
import {
  buildCourierRecipient,
  buildPickupRecipient,
  ensureCarrierRouting,
  resolveOrderDeliveryMethodId,
  resolveShippingTestOrder,
  SYNTHETIC_COURIER_PARCEL,
} from '../../src/support/shipments';

test.describe('shipping — InPost COD (pobranie)', () => {
  let order: OrderRecord | null = null;
  let inpostConnectionId: string | null = null;
  let deliveryMethodId = 'default';

  test.beforeAll(async ({ api, world, env }) => {
    const inpost = world.connectionFor(PlatformType.inpost);
    inpostConnectionId = inpost?.id ?? null;
    order = await resolveShippingTestOrder(api, env);
    if (order && inpostConnectionId) {
      deliveryMethodId = resolveOrderDeliveryMethodId(order);
      await ensureCarrierRouting(api, order.sourceConnectionId, deliveryMethodId, inpostConnectionId);
    }
  });

  test('generates a courier label with a valid COD amount', async ({ api }) => {
    test.skip(!inpostConnectionId, 'no InPost connection on this stack');
    test.skip(!order, 'no ready order available (set E2E_ORDER_ID or run the golden path first)');

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order!.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order!.internalOrderId,
      deliveryIntent: 'address',
      recipient: buildCourierRecipient(order!),
      parcel: { ...SYNTHETIC_COURIER_PARCEL },
      cod: { amount: '129.90', currency: 'PLN' },
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(order!.internalOrderId));
    expect(shipment, 'a COD shipment was created').toBeTruthy();
    expect(shipment!.shippingMethod).toBe('kurier');
  });

  test('rejects COD on a paczkomat (locker) shipment as unsupported', async ({ api, env }) => {
    test.skip(!inpostConnectionId, 'no InPost connection on this stack');
    test.skip(!order, 'no ready order available (set E2E_ORDER_ID or run the golden path first)');
    test.skip(!env.paczkomatId, 'no locker id configured (set E2E_PACZKOMAT_ID)');

    let caught: ApiError | undefined;
    try {
      await api.shipments.generateLabel({
        sourceConnectionId: order!.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order!.internalOrderId,
        deliveryIntent: 'pickup_point',
        recipient: buildPickupRecipient(order!),
        parcel: { template: 'small' },
        paczkomatId: env.paczkomatId!,
        cod: { amount: '50.00', currency: 'PLN' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'COD on a locker shipment is rejected, not silently accepted').toBeTruthy();
    expect(caught!.status, `expected 502 (carrier rejection), got ${caught!.status}`).toBe(502);
  });

  test('rejects a malformed COD amount at the API boundary (400)', async ({ api }) => {
    test.skip(!inpostConnectionId, 'no InPost connection on this stack');
    test.skip(!order, 'no ready order available (set E2E_ORDER_ID or run the golden path first)');

    let caught: ApiError | undefined;
    try {
      await api.shipments.generateLabel({
        sourceConnectionId: order!.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order!.internalOrderId,
        deliveryIntent: 'address',
        recipient: buildCourierRecipient(order!),
        parcel: { ...SYNTHETIC_COURIER_PARCEL },
        cod: { amount: 'not-a-number', currency: 'PLN' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'a malformed COD amount must not reach the carrier').toBeTruthy();
    expect(caught!.status, `expected 400 (DTO validation), got ${caught!.status}`).toBe(400);
  });

  test('rejects an unsupported COD currency (502, carrier preflight)', async ({ api }) => {
    test.skip(!inpostConnectionId, 'no InPost connection on this stack');
    test.skip(!order, 'no ready order available (set E2E_ORDER_ID or run the golden path first)');

    let caught: ApiError | undefined;
    try {
      await api.shipments.generateLabel({
        sourceConnectionId: order!.sourceConnectionId,
        sourceDeliveryMethodId: deliveryMethodId,
        orderId: order!.internalOrderId,
        deliveryIntent: 'address',
        recipient: buildCourierRecipient(order!),
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
