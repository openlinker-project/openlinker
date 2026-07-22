/**
 * Erli Order Mapper — unit tests (#994)
 *
 * Locks the Erli order → IncomingOrder translation: the status table, the
 * COD-arrives-paid payment encoding off `delivery.cod`, grosze→decimal money
 * conversion, totals reconciliation, address mapping, and the email-only
 * identity passthrough (no buyer id; no internal `ol_*` ids — the #995 boundary).
 *
 * Fixtures are authored from the #992-verified Erli order contract (sandbox was
 * empty at spike time): money is INTEGER grosze, the buyer is `user` with no id,
 * line items are `items`, COD is `delivery.cod`. PII is obviously-fake test data.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import type { ErliOrder } from '../erli-order.types';
import { mapErliOrderToIncomingOrder } from '../erli-order.mapper';

function buildErliOrder(overrides: Partial<ErliOrder> = {}): ErliOrder {
  return {
    id: 'erli-order-1001',
    externalOrderId: 'ERL-1001',
    status: 'purchased',
    sellerStatus: 'created',
    user: {
      email: 'buyer-1@example.test',
      deliveryAddress: {
        firstName: 'Jan',
        lastName: 'Testowy',
        address: 'ul. Testowa 1',
        street: 'Testowa',
        buildingNumber: '1',
        zip: '00-001',
        city: 'Testowo',
        country: 'PL',
        phone: '+48000000000',
      },
    },
    items: [
      {
        id: 1,
        externalId: 'erli-prod-aaa',
        quantity: 2,
        unitPrice: 5000, // 50.00 PLN in grosze
        name: 'Test Widget',
        sku: 'SKU-AAA',
      },
    ],
    delivery: { name: 'Kurier', typeId: 'courier', price: 1000, cod: true }, // 10.00 PLN
    totalPrice: 11000, // 110.00 PLN
    created: '2026-06-16T10:00:00.000Z',
    updated: '2026-06-16T10:05:00.000Z',
    purchasedAt: '2026-06-16T09:59:00.000Z',
    ...overrides,
  };
}

describe('mapErliOrderToIncomingOrder', () => {
  it('should map delivery.typeId and name onto the neutral shipping reference when present', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        delivery: { name: 'ERLI InPost Paczkomaty 24/7', typeId: 'erliPaczkomat', cod: false },
      }),
    );

    expect(result.shipping).toEqual({
      methodId: 'erliPaczkomat',
      methodName: 'ERLI InPost Paczkomaty 24/7',
    });
  });

  it('should keep shipping absent when delivery carries no typeId', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ delivery: { cod: false } }));

    expect(result.shipping).toBeUndefined();
  });

  it('should omit methodName when delivery has a typeId but no name', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ delivery: { typeId: 'dpd', cod: false } }),
    );

    expect(result.shipping).toEqual({ methodId: 'dpd' });
  });

  it('should map methodName from delivery.name so the delivery-method label populates (#1776)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ delivery: { name: 'DPD Kurier', typeId: 'dpd', cod: false } }),
    );

    expect(result.shipping?.methodName).toBe('DPD Kurier');
  });

  describe('ship-by derivation moved out of the pure mapper (#1776)', () => {
    // Ship-by is now derived in ErliOrderSourceAdapter.getOrder (needs per-offer
    // GETs → I/O), so the pure mapper never sets dispatchTime — regardless of
    // whether purchasedAt is present. See the order-source adapter spec for the
    // per-offer + MIN + estimated + graceful-degrade coverage.
    it('should never set dispatchTime (derivation lives in the order-source adapter)', () => {
      expect(
        mapErliOrderToIncomingOrder(buildErliOrder({ purchasedAt: '2026-06-16T09:59:00.000Z' }))
          .dispatchTime,
      ).toBeUndefined();
      expect(
        mapErliOrderToIncomingOrder(buildErliOrder({ purchasedAt: undefined })).dispatchTime,
      ).toBeUndefined();
    });
  });

  it('should map a COD purchased order to processing + paymentStatus cod', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ status: 'purchased', delivery: { cod: true } }),
    );

    expect(result.status).toBe('processing');
    expect(result.paymentStatus).toBe('cod');
  });

  it('should map a settled online (non-COD) purchased order to processing + paid', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ status: 'purchased', delivery: { cod: false } }),
    );

    expect(result.status).toBe('processing');
    expect(result.paymentStatus).toBe('paid');
  });

  it('should map a pending order to pending + paymentStatus awaiting', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'pending' }));

    expect(result.status).toBe('pending');
    expect(result.paymentStatus).toBe('awaiting');
  });

  it('should map a cancelled order to cancelled with undefined paymentStatus', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'cancelled' }));

    expect(result.status).toBe('cancelled');
    expect(result.paymentStatus).toBeUndefined();
  });

  it('should map a returned order to refunded + paymentStatus refunded', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'returned' }));

    expect(result.status).toBe('refunded');
    expect(result.paymentStatus).toBe('refunded');
  });

  it('should fall back to pending when the status is unknown', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ status: 'shipped' as unknown as ErliOrder['status'] }),
    );

    expect(result.status).toBe('pending');
    expect(result.paymentStatus).toBeUndefined();
  });

  it('should convert grosze to decimal PLN for line-item prices', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder());

    expect(result.items[0].price).toBe(50);
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[0].productRef).toEqual({ type: 'offer', externalId: 'erli-prod-aaa' });
    expect(result.items[0].id).toBe('1');
  });

  it('should reconcile totals from the gross total and delivery price (grosze → decimal)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        items: [
          { id: 1, externalId: 'erli-prod-aaa', quantity: 2, unitPrice: 5000, name: 'A' },
          { id: 2, externalId: 'erli-prod-bbb', quantity: 1, unitPrice: 3000, name: 'B' },
        ],
        delivery: { cod: true, price: 1000 },
        totalPrice: 14000, // 140.00
      }),
    );

    expect(result.items).toHaveLength(2);
    expect(result.totals.total).toBe(140);
    expect(result.totals.shipping).toBe(10);
    expect(result.totals.subtotal).toBe(130);
    expect(result.totals.tax).toBe(0);
    expect(result.totals.currency).toBe('PLN');
    expect(result.totals.taxTreatment).toBe('inclusive');
  });

  it('should round to 2 decimals after grosze conversion (no IEEE-754 residue)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        items: [{ id: 1, externalId: 'erli-prod-aaa', quantity: 3, unitPrice: 1999, name: 'A' }],
        delivery: { cod: false, price: 1000 },
        totalPrice: 6997, // 69.97
      }),
    );

    expect(result.items[0].price).toBe(19.99);
    expect(result.totals.total).toBe(69.97);
    expect(result.totals.shipping).toBe(10);
    expect(result.totals.subtotal).toBe(59.97);
  });

  it('should key identity on email only — no customerExternalId (Erli has no buyer id)', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder());

    expect(result.customerExternalId).toBeUndefined();
    expect(result.customerEmail).toBe('buyer-1@example.test');
    // metadata carries the non-PII seller status breadcrumb; the email is NEVER
    // duplicated into the untyped metadata bag (PR1078-SEC-01).
    expect(result.metadata).toEqual({ sellerStatus: 'created' });
    expect(JSON.stringify(result.metadata)).not.toContain('buyer-1@example.test');
  });

  it('should fall back to ingestion time when created/updated are absent', () => {
    const before = Date.now();
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ created: undefined, updated: undefined }),
    );
    const after = Date.now();

    const created = new Date(result.createdAt).getTime();
    expect(created).toBeGreaterThanOrEqual(before);
    expect(created).toBeLessThanOrEqual(after);
  });

  it('should map the delivery address using the full formatted line (zip → postalCode, country)', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder());

    expect(result.shippingAddress).toEqual({
      firstName: 'Jan',
      lastName: 'Testowy',
      company: undefined,
      address1: 'ul. Testowa 1',
      address2: undefined,
      city: 'Testowo',
      postalCode: '00-001',
      country: 'PL',
      phone: '+48000000000',
    });
  });

  it('should compose address1 from street + buildingNumber and surface flatNumber as address2', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        user: {
          email: 'b@example.test',
          invoiceAddress: {
            firstName: 'Anna',
            lastName: 'Przykład',
            companyName: 'Test Sp. z o.o.',
            street: 'Fakturowa',
            buildingNumber: '7',
            flatNumber: '3',
            zip: '11-111',
            city: 'Rachunkowo',
            country: 'PL',
            phone: '+48111111111',
          },
        },
      }),
    );

    expect(result.billingAddress).toEqual({
      firstName: 'Anna',
      lastName: 'Przykład',
      company: 'Test Sp. z o.o.',
      address1: 'Fakturowa 7',
      address2: 'm. 3',
      city: 'Rachunkowo',
      postalCode: '11-111',
      country: 'PL',
      phone: '+48111111111',
    });
  });

  it('should return undefined for an absent address', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ user: { email: 'b@example.test' } }),
    );

    expect(result.shippingAddress).toBeUndefined();
    expect(result.billingAddress).toBeUndefined();
  });

  it('should project delivery.pickupPlace onto the neutral pickupPoint (#1519)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        delivery: {
          cod: false,
          price: 1000,
          pickupPlace: {
            id: 42,
            externalId: 'POZ08A',
            type: 'paczkomat',
            provider: 'inpost',
            name: 'Paczkomat POZ08A',
            address: 'ul. Testowa 1',
            city: 'Testowo',
            zip: '00-001',
          },
        },
      }),
    );

    expect(result.pickupPoint).toEqual({
      id: 'POZ08A',
      name: 'Paczkomat POZ08A',
      description: 'ul. Testowa 1',
      pointType: 'apm',
    });
  });

  it('should fall back to the numeric pickupPlace id when externalId is absent (#1519)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        delivery: { cod: false, price: 1000, pickupPlace: { id: 42 } },
      }),
    );

    expect(result.pickupPoint?.id).toBe('42');
    expect(result.pickupPoint?.pointType).toBeUndefined();
  });

  it('should classify a PaczkoPunkt pickup point as pop (#1519)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        delivery: {
          cod: false,
          price: 1000,
          pickupPlace: { externalId: 'POP-123', type: 'paczkopunkt', name: 'PaczkoPunkt' },
        },
      }),
    );

    expect(result.pickupPoint?.id).toBe('POP-123');
    expect(result.pickupPoint?.pointType).toBe('pop');
  });

  it('should leave pickupPoint undefined for a courier / home-delivery order (#1519)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ delivery: { name: 'Kurier', typeId: 'courier', price: 1000, cod: true } }),
    );

    expect(result.pickupPoint).toBeUndefined();
  });

  it('should leave pickupPoint undefined when pickupPlace carries no resolvable id (#1519)', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        delivery: { cod: false, price: 1000, pickupPlace: { name: 'Some point', type: 'apm' } },
      }),
    );

    expect(result.pickupPoint).toBeUndefined();
  });

  it('should never emit an internal ol_ id anywhere in the output (the #995 identity boundary)', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder());

    expect(JSON.stringify(result)).not.toMatch(/ol_[a-z]+_/);
  });
});
