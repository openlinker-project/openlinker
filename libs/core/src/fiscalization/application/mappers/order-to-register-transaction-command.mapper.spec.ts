/**
 * Order -> RegisterTransactionCommand mapper - unit tests
 *
 * @module libs/core/src/fiscalization/application/mappers
 */
import type { Order } from '@openlinker/core/orders';

import { toRegisterTransactionCommand } from './order-to-register-transaction-command.mapper';
import { InvalidFiscalLineError } from './errors/invalid-fiscal-line.error';
import { UnsupportedFiscalPriceTreatmentError } from './errors/unsupported-fiscal-price-treatment.error';

const NOW = new Date('2026-08-14T09:00:00.000Z');

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ol_order_1',
    status: 'new',
    items: [
      { id: 'i1', productId: 'ol_product_1', quantity: 2, price: 24.6, name: 'Widget', sku: 'W-1' },
    ],
    totals: { subtotal: 49.2, tax: 9.2, shipping: 0, total: 49.2, currency: 'PLN' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Order;
}

describe('toRegisterTransactionCommand', () => {
  it('should compose a command from the order snapshot', () => {
    const cmd = toRegisterTransactionCommand({
      order: order(),
      connectionId: 'conn-1',
      idempotencyKey: 'fiscal:conn-1:ol_order_1',
    });

    expect(cmd.connectionId).toBe('conn-1');
    expect(cmd.orderId).toBe('ol_order_1');
    expect(cmd.idempotencyKey).toBe('fiscal:conn-1:ol_order_1');
    expect(cmd.currency).toBe('PLN');
    expect(cmd.totalGross).toBe(49.2);
    expect(cmd.lines).toEqual([
      { name: 'Widget', quantity: 2, unitPriceGross: 24.6, taxRate: '', sku: 'W-1' },
    ]);
  });

  it('should never name a tax rate of its own', () => {
    // ADR-042 decision 8 (negative half, settled): fiscalization transmits
    // amounts it must not recompute and never infers or defaults a rate. An
    // empty code means "OL resolved none", NOT "the rate is zero".
    const cmd = toRegisterTransactionCommand({
      order: order(),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.lines.every((line) => line.taxRate === '')).toBe(true);
  });

  it('should append a gross shipping line so the registered total matches what the buyer paid', () => {
    const cmd = toRegisterTransactionCommand({
      order: order({
        totals: { subtotal: 49.2, tax: 9.2, shipping: 12.5, total: 61.7, currency: 'PLN' },
      }),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });

    expect(cmd.lines).toHaveLength(2);
    expect(cmd.lines[1]).toEqual({
      name: 'Shipping',
      quantity: 1,
      unitPriceGross: 12.5,
      taxRate: '',
      sku: null,
    });
  });

  it('should honour a caller-supplied shipping line label', () => {
    const cmd = toRegisterTransactionCommand({
      order: order({
        items: [{ id: 'i1', productId: 'ol_product_1', quantity: 1, price: 10 }],
        totals: { subtotal: 10, tax: 0, shipping: 5, total: 15, currency: 'PLN' },
      }),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
      shippingLineName: 'Dostawa',
    });
    expect(cmd.lines[1]?.name).toBe('Dostawa');
  });

  it('should emit no shipping line when the buyer paid nothing for shipping', () => {
    const cmd = toRegisterTransactionCommand({
      order: order(),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.lines).toHaveLength(1);
  });

  it('should fall back to sku then productId for a line with no source label', () => {
    const cmd = toRegisterTransactionCommand({
      order: order({
        items: [
          { id: 'i1', productId: 'ol_product_1', quantity: 1, price: 5, sku: 'SKU-1' },
          { id: 'i2', productId: 'ol_product_2', quantity: 1, price: 5 },
        ],
        totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
      }),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.lines.map((line) => line.name)).toEqual(['SKU-1', 'ol_product_2']);
  });

  it('should carry the SOURCE placement time, not OL`s ingestion clock', () => {
    const placedAt = new Date('2026-08-01T07:30:00.000Z');
    const cmd = toRegisterTransactionCommand({
      order: order({ placedAt }),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.occurredAt).toBe(placedAt);
  });

  it('should leave occurredAt absent when the source reported no placement time', () => {
    // `createdAt` is when OL ingested the order, not when the sale happened, so
    // substituting it would misdate the registration.
    const cmd = toRegisterTransactionCommand({
      order: order(),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.occurredAt).toBeUndefined();
  });

  it('should reject a net-priced order rather than register net amounts as gross', () => {
    expect(() =>
      toRegisterTransactionCommand({
        order: order({
          totals: {
            subtotal: 40,
            tax: 9.2,
            shipping: 0,
            total: 40,
            currency: 'PLN',
            taxTreatment: 'exclusive',
          },
        }),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
      }),
    ).toThrow(UnsupportedFiscalPriceTreatmentError);
  });

  it('should accept an order whose treatment is absent (the documented gross assumption)', () => {
    expect(() =>
      toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
      }),
    ).not.toThrow();
  });

  it('should reject an item whose quantity is not a positive finite number', () => {
    expect(() =>
      toRegisterTransactionCommand({
        order: order({
          items: [{ id: 'i1', productId: 'ol_product_1', quantity: 0, price: 5 }],
        }),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
      }),
    ).toThrow(InvalidFiscalLineError);
  });

  it('should cite only the order id when rejecting a line (PII-clean)', () => {
    try {
      toRegisterTransactionCommand({
        order: order({
          items: [
            { id: 'i1', productId: 'ol_product_1', quantity: -1, price: 5, name: 'Jan Kowalski' },
          ],
        }),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
      });
      fail('expected InvalidFiscalLineError');
    } catch (error) {
      expect((error as Error).message).toContain('ol_order_1');
      expect((error as Error).message).not.toContain('Jan Kowalski');
    }
  });

  describe('the lines must add up to the total', () => {
    it('should refuse a sale whose lines do not sum to the reported gross total', () => {
      // `OrderTotals` has no discount field, so a source that folds a coupon into
      // `total` reports lines that sum higher. A fiscal document may not transmit
      // amounts that contradict each other, so this blocks BEFORE any persist or
      // provider call rather than printing a receipt that does not add up.
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [{ id: 'i1', productId: 'ol_product_1', quantity: 1, price: 100 }],
            totals: { subtotal: 100, tax: 0, shipping: 0, total: 90, currency: 'PLN' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).toThrow(InvalidFiscalLineError);
    });

    it('should refuse zero-priced lines under a non-zero total', () => {
      // The shape a partially malformed snapshot takes: `readItems` zero-defaults
      // every missing numeric, so the sale would register as free.
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [{ id: 'i1', productId: 'ol_product_1', quantity: 1, price: 0 }],
            totals: { subtotal: 0, tax: 0, shipping: 0, total: 123.45, currency: 'PLN' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).toThrow(InvalidFiscalLineError);
    });

    it('should refuse a sale with lines but a zero-defaulted total', () => {
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [{ id: 'i1', productId: 'ol_product_1', quantity: 1, price: 50 }],
            totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).toThrow(InvalidFiscalLineError);
    });

    it('should tolerate float accumulation across many lines', () => {
      // 3 x 0.1 is 0.30000000000000004 in IEEE-754; rejecting that would block
      // ordinary baskets.
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [
              { id: 'i1', productId: 'p1', quantity: 1, price: 0.1 },
              { id: 'i2', productId: 'p2', quantity: 1, price: 0.1 },
              { id: 'i3', productId: 'p3', quantity: 1, price: 0.1 },
            ],
            totals: { subtotal: 0.3, tax: 0, shipping: 0, total: 0.3, currency: 'PLN' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).not.toThrow();
    });

    it('should tolerate only ONE minor unit of drift in a 0-decimal currency', () => {
      // JPY has no minor unit, so a fixed 0.01 tolerance would be a hundredth of
      // the smallest amount the currency can express - and a whole-yen basket
      // carrying float dust would be refused. One minor unit means 1 here.
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [{ id: 'i1', productId: 'p1', quantity: 3, price: 100 }],
            totals: { subtotal: 300, tax: 0, shipping: 0, total: 300.5, currency: 'JPY' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).not.toThrow();
    });

    it('should refuse drift wider than one minor unit in a 3-decimal currency', () => {
      // KWD is 3-decimal, so a fixed 0.01 would silently tolerate TEN of its own
      // minor units of unexplained difference between the lines and the total.
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10 }],
            totals: { subtotal: 10, tax: 0, shipping: 0, total: 10.005, currency: 'KWD' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).toThrow(InvalidFiscalLineError);
    });

    it('should fall back to two minor-unit digits for an unrecognised currency code', () => {
      // Unknown code -> the ISO default. Stricter than an unknown 0-decimal
      // currency needs, never laxer, and it keeps ordinary baskets passing.
      expect(() =>
        toRegisterTransactionCommand({
          order: order({
            items: [{ id: 'i1', productId: 'p1', quantity: 1, price: 10 }],
            totals: { subtotal: 10, tax: 0, shipping: 0, total: 10.005, currency: 'ZZZ' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        }),
      ).not.toThrow();
    });

    it('should cite only ids and amounts when refusing (PII-clean)', () => {
      try {
        toRegisterTransactionCommand({
          order: order({
            items: [
              { id: 'i1', productId: 'p1', quantity: 1, price: 100, name: 'Jan Kowalski' },
            ],
            totals: { subtotal: 100, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
          }),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
        });
        fail('expected InvalidFiscalLineError');
      } catch (error) {
        expect((error as Error).message).toContain('ol_order_1');
        expect((error as Error).message).not.toContain('Jan Kowalski');
      }
    });
  });

  it('should derive a delivery target when the snapshot carries one', () => {
    const cmd = toRegisterTransactionCommand({
      order: order({ customerEmail: 'buyer@example.test' }),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.recipient).toEqual({ email: 'buyer@example.test', phone: null });
  });

  describe("the order's tax-rate era (#2260 review)", () => {
    it('should carry a pre-rollout marker onto the command', () => {
      // The write-path guard reads it; without it a pre-rollout order passes the
      // era-aware auto-issue gate and is then refused by the era-blind one.
      const cmd = toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
        taxRateEra: 'pre-rollout',
      });
      expect(cmd.taxRateEra).toBe('pre-rollout');
    });

    it('should leave the field absent when the caller has no marker', () => {
      expect(
        toRegisterTransactionCommand({ order: order(), connectionId: 'conn-1', idempotencyKey: 'k' })
          .taxRateEra,
      ).toBeUndefined();
      expect(
        toRegisterTransactionCommand({
          order: order(),
          connectionId: 'conn-1',
          idempotencyKey: 'k',
          taxRateEra: null,
        }).taxRateEra,
      ).toBeUndefined();
    });
  });

  it('should omit the delivery target entirely under a hash-only PII configuration', () => {
    // Not an error: an adapter whose provider returns the artefact inline needs
    // no target at all.
    const cmd = toRegisterTransactionCommand({
      order: order(),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });
    expect(cmd.recipient).toBeUndefined();
  });
});
