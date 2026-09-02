/**
 * Order Amendment Diff — unit tests
 *
 * @module libs/core/src/orders/domain
 */
import { diffOrderAmendment } from './order-amendment-diff';
import type { IncomingOrder } from './types/incoming-order.types';

function incomingOrder(overrides: Partial<IncomingOrder> = {}): IncomingOrder {
  return {
    externalOrderId: 'EXT-1',
    status: 'new',
    items: [
      { id: 'line-1', productRef: { type: 'product', externalId: 'p1' }, quantity: 2, price: 10, sku: 'SKU-1' },
    ],
    totals: { subtotal: 20, tax: 0, shipping: 0, total: 20, currency: 'PLN' },
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  } as IncomingOrder;
}

const address = {
  firstName: 'Anna',
  lastName: 'Nowak',
  address1: 'ul. Kwiatowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
};

const PII_ON = { storePii: true };
const PII_OFF = { storePii: false };

describe('diffOrderAmendment', () => {
  describe('lines', () => {
    it('should report nothing when the incoming order matches the stored snapshot', () => {
      const prior = { items: [{ id: 'line-1', quantity: 2, sku: 'SKU-1' }] };
      expect(diffOrderAmendment(prior, incomingOrder(), PII_ON)).toEqual([]);
    });

    it('should report a removed line when the source dropped it', () => {
      const prior = {
        items: [
          { id: 'line-1', quantity: 2, sku: 'SKU-1' },
          { id: 'line-2', quantity: 5, sku: 'SKU-2' },
        ],
      };
      expect(diffOrderAmendment(prior, incomingOrder(), PII_ON)).toEqual([
        { kind: 'line-removed', lineId: 'line-2', sku: 'SKU-2', fromQuantity: 5 },
      ]);
    });

    it('should report an added line when the source introduced one', () => {
      const prior = { items: [{ id: 'line-1', quantity: 2, sku: 'SKU-1' }] };
      const incoming = incomingOrder({
        items: [
          { id: 'line-1', productRef: { type: 'product', externalId: 'p1' }, quantity: 2, price: 10, sku: 'SKU-1' },
          { id: 'line-9', productRef: { type: 'product', externalId: 'p9' }, quantity: 1, price: 5, sku: 'SKU-9' },
        ],
      });

      expect(diffOrderAmendment(prior, incoming, PII_ON)).toEqual([
        { kind: 'line-added', lineId: 'line-9', sku: 'SKU-9', toQuantity: 1 },
      ]);
    });

    it('should report a quantity change with both quantities', () => {
      const prior = { items: [{ id: 'line-1', quantity: 5, sku: 'SKU-1' }] };
      expect(diffOrderAmendment(prior, incomingOrder(), PII_ON)).toEqual([
        {
          kind: 'line-quantity-changed',
          lineId: 'line-1',
          sku: 'SKU-1',
          fromQuantity: 5,
          toQuantity: 2,
        },
      ]);
    });

    it('should ignore a price change, which is ordinary churn rather than an amendment', () => {
      const prior = { items: [{ id: 'line-1', quantity: 2, sku: 'SKU-1', price: 999 }] };
      expect(diffOrderAmendment(prior, incomingOrder(), PII_ON)).toEqual([]);
    });

    it('should key on line id rather than position, so a reordered feed reports nothing', () => {
      const prior = {
        items: [
          { id: 'line-2', quantity: 1 },
          { id: 'line-1', quantity: 2 },
        ],
      };
      const incoming = incomingOrder({
        items: [
          { id: 'line-1', productRef: { type: 'product', externalId: 'p1' }, quantity: 2, price: 10 },
          { id: 'line-2', productRef: { type: 'product', externalId: 'p2' }, quantity: 1, price: 3 },
        ],
      });
      expect(diffOrderAmendment(prior, incoming, PII_ON)).toEqual([]);
    });

    it('should diff a ready-path snapshot the same way as a raw-path one', () => {
      // Ready path carries internalised productId/variantId beside the same
      // source-native `id` — the diff key must be unaffected.
      const readyPrior = {
        items: [
          { id: 'line-1', productId: 'ol_product_x', variantId: 'ol_variant_y', quantity: 7, sku: 'SKU-1' },
        ],
      };
      expect(diffOrderAmendment(readyPrior, incomingOrder(), PII_ON)).toEqual([
        {
          kind: 'line-quantity-changed',
          lineId: 'line-1',
          sku: 'SKU-1',
          fromQuantity: 7,
          toQuantity: 2,
        },
      ]);
    });
  });

  describe('defensive reads', () => {
    it('should report nothing on a first ingestion (null prior)', () => {
      expect(diffOrderAmendment(null, incomingOrder(), PII_ON)).toEqual([]);
      expect(diffOrderAmendment(undefined, incomingOrder(), PII_ON)).toEqual([]);
    });

    it('should report nothing when the prior snapshot carries no usable items array', () => {
      expect(diffOrderAmendment({}, incomingOrder(), PII_ON)).toEqual([]);
      expect(diffOrderAmendment({ items: 'not-an-array' }, incomingOrder(), PII_ON)).toEqual([]);
      expect(diffOrderAmendment({ items: null }, incomingOrder(), PII_ON)).toEqual([]);
    });

    it('should not throw on malformed line entries and should skip them individually', () => {
      const prior = {
        items: [null, 'nope', { quantity: 3 }, { id: 'line-1', quantity: 'two' }, { id: 'line-1', quantity: 2 }],
      };
      expect(() => diffOrderAmendment(prior, incomingOrder(), PII_ON)).not.toThrow();
      expect(diffOrderAmendment(prior, incomingOrder(), PII_ON)).toEqual([]);
    });
  });

  describe('shipping address', () => {
    it('should report the changed field names and never their values', () => {
      const prior = { items: [{ id: 'line-1', quantity: 2 }], shippingAddress: address };
      const incoming = incomingOrder({
        shippingAddress: { ...address, city: 'Kraków', postalCode: '30-001' },
      });

      const changes = diffOrderAmendment(prior, incoming, PII_ON);
      expect(changes).toEqual([
        { kind: 'shipping-address-changed', fields: ['city', 'postalCode'] },
      ]);
      expect(JSON.stringify(changes)).not.toContain('Kraków');
      expect(JSON.stringify(changes)).not.toContain('30-001');
    });

    it('should treat absent, null and blank address fields as one value', () => {
      const prior = {
        items: [{ id: 'line-1', quantity: 2 }],
        shippingAddress: { ...address, address2: null, company: '' },
      };
      const incoming = incomingOrder({ shippingAddress: { ...address } });
      expect(diffOrderAmendment(prior, incoming, PII_ON)).toEqual([]);
    });

    it('should report nothing when only one side carries an address', () => {
      const prior = { items: [{ id: 'line-1', quantity: 2 }], shippingAddress: address };
      expect(diffOrderAmendment(prior, incomingOrder(), PII_ON)).toEqual([]);

      const noAddressPrior = { items: [{ id: 'line-1', quantity: 2 }] };
      expect(
        diffOrderAmendment(noAddressPrior, incomingOrder({ shippingAddress: address }), PII_ON)
      ).toEqual([]);
    });

    it('should not report a change against a redacted prior in hash-only mode', () => {
      // The false-positive guard: without projecting the incoming address
      // through the same redaction rule, EVERY poll of EVERY order would report
      // a shipping-address change forever.
      const redactedPrior = {
        items: [{ id: 'line-1', quantity: 2 }],
        shippingAddress: {
          address1: '[REDACTED]',
          city: '[REDACTED]',
          postalCode: '[REDACTED]',
          country: 'PL',
        },
      };
      expect(
        diffOrderAmendment(redactedPrior, incomingOrder({ shippingAddress: address }), PII_OFF)
      ).toEqual([]);
    });

    it('should still detect a country change in hash-only mode', () => {
      const redactedPrior = {
        items: [{ id: 'line-1', quantity: 2 }],
        shippingAddress: {
          address1: '[REDACTED]',
          city: '[REDACTED]',
          postalCode: '[REDACTED]',
          country: 'PL',
        },
      };
      expect(
        diffOrderAmendment(
          redactedPrior,
          incomingOrder({ shippingAddress: { ...address, country: 'DE' } }),
          PII_OFF
        )
      ).toEqual([{ kind: 'shipping-address-changed', fields: ['country'] }]);
    });

    it('should store no raw address value in hash-only mode even when a change is reported', () => {
      const redactedPrior = {
        items: [{ id: 'line-1', quantity: 2 }],
        shippingAddress: {
          address1: '[REDACTED]',
          city: '[REDACTED]',
          postalCode: '[REDACTED]',
          country: 'PL',
        },
      };
      const serialised = JSON.stringify(
        diffOrderAmendment(
          redactedPrior,
          incomingOrder({ shippingAddress: { ...address, country: 'DE' } }),
          PII_OFF
        )
      );
      for (const value of ['Anna', 'Nowak', 'Kwiatowa', 'Warszawa', '00-001']) {
        expect(serialised).not.toContain(value);
      }
    });
  });

  it('should report line and address changes together', () => {
    const prior = {
      items: [{ id: 'line-1', quantity: 9, sku: 'SKU-1' }],
      shippingAddress: address,
    };
    const incoming = incomingOrder({ shippingAddress: { ...address, city: 'Gdańsk' } });

    expect(diffOrderAmendment(prior, incoming, PII_ON)).toEqual([
      {
        kind: 'line-quantity-changed',
        lineId: 'line-1',
        sku: 'SKU-1',
        fromQuantity: 9,
        toQuantity: 2,
      },
      { kind: 'shipping-address-changed', fields: ['city'] },
    ]);
  });
});
