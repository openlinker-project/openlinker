/**
 * Shipping suite — S3: declared value / insurance (#1542)
 *
 * Unlike COD, InPost ShipX insurance is supported on BOTH the `paczkomat`
 * (locker) and `kurier` (courier) methods (`buildLockerRequest` /
 * `buildCourierRequest` in `inpost-shipx.mapper.ts` both translate
 * `cmd.insuredValue` to the ShipX `insurance` object). Validation mirrors COD:
 * the DTO's `@Matches` guards the decimal shape (400) before the carrier is
 * ever called; the adapter's own preflight guards the ShipX-accepted currency
 * (502, domestic-PL only).
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

test.describe('shipping — InPost declared value / insurance', () => {
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

  test('generates a paczkomat label with a declared value (insurance)', async ({ api, env }) => {
    test.skip(!inpostConnectionId, 'no InPost connection on this stack');
    test.skip(!order, 'no ready order available (set E2E_ORDER_ID or run the golden path first)');
    test.skip(!env.paczkomatId, 'no locker id configured (set E2E_PACZKOMAT_ID)');

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order!.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order!.internalOrderId,
      deliveryIntent: 'pickup_point',
      recipient: buildPickupRecipient(order!),
      parcel: { template: 'small' },
      paczkomatId: env.paczkomatId!,
      insuredValue: { amount: '250.00', currency: 'PLN' },
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(order!.internalOrderId));
    expect(shipment, 'an insured paczkomat shipment was created').toBeTruthy();
    expect(shipment!.shippingMethod).toBe('paczkomat');
  });

  test('generates a courier label with a declared value (insurance)', async ({ api }) => {
    test.skip(!inpostConnectionId, 'no InPost connection on this stack');
    test.skip(!order, 'no ready order available (set E2E_ORDER_ID or run the golden path first)');

    const dispatch = await api.shipments.generateLabel({
      sourceConnectionId: order!.sourceConnectionId,
      sourceDeliveryMethodId: deliveryMethodId,
      orderId: order!.internalOrderId,
      deliveryIntent: 'address',
      recipient: buildCourierRecipient(order!),
      parcel: { ...SYNTHETIC_COURIER_PARCEL },
      insuredValue: { amount: '400.00', currency: 'PLN' },
    });
    const shipment = dispatch.shipment ?? (await api.shipments.active(order!.internalOrderId));
    expect(shipment, 'an insured courier shipment was created').toBeTruthy();
    expect(shipment!.shippingMethod).toBe('kurier');
  });

  test('rejects a malformed insured-value amount at the API boundary (400)', async ({ api }) => {
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
        insuredValue: { amount: '12,50', currency: 'PLN' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'a malformed insured-value amount must not reach the carrier').toBeTruthy();
    expect(caught!.status, `expected 400 (DTO validation), got ${caught!.status}`).toBe(400);
  });

  test('rejects an unsupported insured-value currency (502, carrier preflight)', async ({ api }) => {
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
        // InPost insurance is domestic-PL only — a well-formed but non-PLN
        // currency passes DTO validation and is refused by the adapter's
        // own preflight instead.
        insuredValue: { amount: '100.00', currency: 'USD' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'a non-PLN insured-value currency is rejected by the InPost preflight').toBeTruthy();
    expect(caught!.status, `expected 502 (carrier rejection), got ${caught!.status}`).toBe(502);
  });
});
