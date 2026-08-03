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
 * READ-SIDE GAP - what the SUCCESS cases can and cannot prove. `ShipmentResponseDto`
 * (`apps/api/src/shipping/http/dto/shipment-response.dto.ts`) exposes no
 * `insuredValue` field, and nothing else OL serves reads the declared value
 * back, so the two success tests below would pass verbatim with their
 * `insuredValue:` argument DELETED. What they do prove is real but narrower
 * than the titles suggest: that an insurance-carrying dispatch is ACCEPTED
 * end-to-end (OL DTO -> mapper -> ShipX) rather than rejected, on both delivery
 * intents. Confirming the amount actually reached the carrier needs either
 * `insuredValue` on the read DTO or a ShipX shipment read, neither of which
 * exists here. The 400/502 cases are unaffected - a rejection status is fully
 * observable, so they are the real insurance coverage in this file.
 *
 * @module tests/shipping
 */
import { test, expect } from '../../src/fixtures/test';
import { ApiError } from '../../src/api/api-error';
import {
  SYNTHETIC_COURIER_PARCEL,
  buildCourierRecipient,
  buildPickupRecipient,
  isCourierUnprovisionedError,
  releaseDispatchedShipments,
  shippingOrderShortageReason,
  resolveDispatchedShipment,
  setUpShippingTestOrder,
} from '../../src/support/shipments';

test.describe('shipping — InPost declared value / insurance', () => {
  // Recycle the fixture pool. Every dispatch leaves a non-terminal shipment on
  // its order, and `resolveShippingTestOrder` refuses an order that already has
  // one - so without this the suite eats its own pool and every shipping spec
  // eventually `test.skip`s green with zero coverage. Best-effort and silent on
  // an already-confirmed shipment; `afterAll`, so a failing test still recycles.
  test.afterAll(async ({ api }) => {
    await releaseDispatchedShipments(api);
  });

  test('generates a paczkomat label with a declared value (insurance)', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
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
      insuredValue: { amount: '250.00', currency: 'PLN' },
    });
    const shipment = await resolveDispatchedShipment(api, dispatch, order.internalOrderId);
    expect(shipment, 'an insured paczkomat shipment was created').toBeTruthy();
    expect(shipment.shippingMethod).toBe('paczkomat');
  });

  test('generates a courier label with a declared value (insurance)', async ({ api, world, env }) => {
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
        insuredValue: { amount: '400.00', currency: 'PLN' },
      });
    } catch (error) {
      if (isCourierUnprovisionedError(error)) {
        test.skip(true, 'ShipX sandbox organization has no courier carrier/trucker assigned (verified live via GET /v1/organizations)');
        return;
      }
      throw error;
    }
    const shipment = await resolveDispatchedShipment(api, dispatch, order.internalOrderId);
    expect(shipment, 'an insured courier shipment was created').toBeTruthy();
    expect(shipment.shippingMethod).toBe('kurier');
  });

  test('rejects a malformed insured-value amount at the API boundary (400)', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
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
        insuredValue: { amount: '12,50', currency: 'PLN' },
      });
    } catch (error) {
      caught = error instanceof ApiError ? error : undefined;
    }
    expect(caught, 'a malformed insured-value amount must not reach the carrier').toBeTruthy();
    expect(caught!.status, `expected 400 (DTO validation), got ${caught!.status}`).toBe(400);
  });

  test('rejects an unsupported insured-value currency (502, carrier preflight)', async ({ api, world, env }) => {
    const setup = await setUpShippingTestOrder(api, world, env);
    test.skip(!setup, `no InPost connection, or ${shippingOrderShortageReason()}`);
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
