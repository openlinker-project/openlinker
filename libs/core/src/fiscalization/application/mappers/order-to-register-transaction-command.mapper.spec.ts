/**
 * Order -> RegisterTransactionCommand mapper - unit tests
 *
 * @module libs/core/src/fiscalization/application/mappers
 */
import { addedLineToOrderItem, type Order } from '@openlinker/core/orders';
import type { ResolvedDeliveryLine } from '@openlinker/core/sales-documents';

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
    // `productId` rides along beside `sku` so a destination that keeps a
    // catalogue can link the line to a real product instead of emitting free
    // text - a free-text line moves no stock (#3445). Carried, never invented.
    expect(cmd.lines).toEqual([
      {
        name: 'Widget',
        productId: 'ol_product_1',
        quantity: 2,
        unitPriceGross: 24.6,
        taxRate: '',
        sku: 'W-1',
      },
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

  // The mirror of the invoicing mapper's test: the shipping split weights each
  // rate by its share of the basket's GROSS value, and on a net-priced source
  // reporting its own gross figures (#3365) `price` is net. Only a MIXED-rate
  // basket shows it, because net scales to gross by a different factor per
  // rate. Net weights would give 11.40/11.40 here.
  it('should weight the shipping split by gross, not by net, on a mixed-rate net-priced order', () => {
    const cmd = toRegisterTransactionCommand({
      order: order({
        items: [
          { id: 'a', productId: 'p1', quantity: 1, price: 100, unitPriceGross: 123, taxRate: '23' },
          { id: 'b', productId: 'p2', quantity: 1, price: 100, unitPriceGross: 105, taxRate: '5' },
        ],
        totals: {
          subtotal: 200,
          tax: 28,
          shipping: 18.54,
          shippingGross: 22.8,
          total: 250.8,
          currency: 'PLN',
          taxTreatment: 'exclusive',
        },
      }),
      connectionId: 'conn-1',
      idempotencyKey: 'k',
    });

    const shipping = cmd.lines.filter((line) => line.name.startsWith('Shipping'));
    expect(shipping.map((line) => ({ taxRate: line.taxRate, amount: line.unitPriceGross }))).toEqual(
      [
        { taxRate: '23', amount: 12.3 },
        { taxRate: '5', amount: 10.5 },
      ]
    );
    // The name carries the rate, so one name is never sent at two rates (#3905).
    expect(shipping.map((line) => line.name)).toEqual(['Shipping 23%', 'Shipping 5%']);
    // The composed lines still reconcile against the order's own total, which
    // is the guard this mapper already enforces - so a re-weighting that moved
    // money rather than re-labelling it would have thrown instead.
    expect(shipping.reduce((sum, line) => sum + line.unitPriceGross, 0)).toBeCloseTo(22.8, 2);
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

  it('net-priced order: the refusal names the actual constraint (#2835)', () => {
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
    ).toThrow(
      /ol_order_1 cannot be fiscally registered: its source reports net \(tax-exclusive\) line prices/,
    );
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
    it('should split a multi-unit line so the receipt equals the discounted total when 3 units cannot carry it evenly (E-45 receipt)', () => {
      const cmd = toRegisterTransactionCommand({
        order: order({
          items: [
            { id: 'i1', productId: 'ol_product_1', quantity: 3, price: 56.94, name: 'Widget', sku: 'W-1' },
          ],
          totals: {
            subtotal: 170.81,
            tax: 0,
            shipping: 0,
            total: 170.81,
            discountTotal: 9.19,
            currency: 'PLN',
          },
        }),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
      });

      const sum = cmd.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceGross * 100), 0);
      expect(sum).toBe(17081);
      expect(cmd.lines.map((l) => [l.quantity, l.unitPriceGross])).toEqual([
        [2, 56.94],
        [1, 56.93],
      ]);
    });

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

  describe("the buyer's tax number (#3187, ADR-073 decision 1)", () => {
    it('should carry the tax number onto the command when the persisted column holds one', () => {
      const cmd = toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
        buyerTaxId: '5213796333',
      });
      expect(cmd.buyerTaxId).toBe('5213796333');
    });

    it('should leave the field absent when the caller has no column value ("not asserted")', () => {
      expect(
        toRegisterTransactionCommand({ order: order(), connectionId: 'conn-1', idempotencyKey: 'k' })
          .buyerTaxId,
      ).toBeUndefined();
    });

    it('should leave the field absent for the "asserted none" state (an empty-string column)', () => {
      // #3187 scope item 5: `readSourceBuyerTaxId` never returns `null`, so
      // this state is unreachable from any shipped source and needs a fixture
      // to exercise at all — this is that fixture. `encodeBuyerTaxIdColumn`
      // persists "the buyer has none" as an empty string, decoded back to
      // `null` by `decodeBuyerTaxIdColumn`; there is nothing for a receipt to
      // transmit either way, so the command carries no field.
      const cmd = toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
        buyerTaxId: '',
      });
      expect(cmd.buyerTaxId).toBeUndefined();
    });

    it('should leave the field absent for a WHITESPACE-only column (#3220 review)', () => {
      // `decodeBuyerTaxIdColumn` guards on `column.length === 0`, so a blank
      // column decodes to the blank string rather than to `null` and would
      // have gone out as `consumerTIN: "   "` on a real fiscal document.
      // Unreachable through `encodeBuyerTaxIdColumn`, which trims - so, like
      // the empty-string case above, this needs a fixture to exercise at all.
      const cmd = toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
        buyerTaxId: '   ',
      });
      expect(cmd.buyerTaxId).toBeUndefined();
    });

    it('should leave the field absent when the caller explicitly passes null', () => {
      const cmd = toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
        buyerTaxId: null,
      });
      expect(cmd.buyerTaxId).toBeUndefined();
    });

    it('should never validate, normalise or reject the value (ADR-073 decision 5)', () => {
      // Core has no basis to judge which tax numbers a provider accepts, and
      // acquiring one would mean holding a country's identifier rules here.
      const cmd = toRegisterTransactionCommand({
        order: order(),
        connectionId: 'conn-1',
        idempotencyKey: 'k',
        buyerTaxId: 'not-a-real-looking-value-at-all',
      });
      expect(cmd.buyerTaxId).toBe('not-a-real-looking-value-at-all');
    });
  });
  describe('delivery line (#3905, ADR-082)', () => {
    const basket = (shipping: number, total: number): Partial<Order> => ({
      items: [
        { id: 'a', productId: 'p1', quantity: 1, price: 100, taxRate: '23', name: 'A' },
        { id: 'b', productId: 'p2', quantity: 1, price: 50, taxRate: '5', name: 'B' },
      ],
      totals: { subtotal: 150, tax: 0, shipping, total, currency: 'PLN' },
    });
    const delivery = (over: Partial<ResolvedDeliveryLine> = {}): ResolvedDeliveryLine => ({
      name: 'Koszt dostawy',
      invoiceName: 'Dostawa',
      rate: 'goods',
      freeDelivery: 'omit',
      rateFormat: 'plain',
      ...over,
    });

    it('should name a single-rate delivery line with its rate when nothing is configured', () => {
      const cmd = toRegisterTransactionCommand({
        order: order({
          items: [{ id: 'a', productId: 'p1', quantity: 1, price: 10, taxRate: '23' }],
          totals: { subtotal: 10, tax: 0, shipping: 5, total: 15, currency: 'PLN' },
        }),
        connectionId: 'c',
        idempotencyKey: 'k',
      });
      expect(cmd.lines[1]?.name).toBe('Shipping 23%');
    });

    it('should use the source delivery rate when items carry none (#3910)', () => {
      const cmd = toRegisterTransactionCommand({
        order: order({
          items: [{ id: 'a', productId: 'p1', quantity: 1, price: 10, name: 'A' }],
          totals: {
            subtotal: 10,
            tax: 0,
            shipping: 5,
            total: 15,
            currency: 'PLN',
            shippingTaxRate: '23',
          },
        }),
        connectionId: 'c',
        idempotencyKey: 'k',
      });
      expect(cmd.lines[1]).toMatchObject({ name: 'Shipping 23%', taxRate: '23', unitPriceGross: 5 });
    });

    it('should split a 23% + 5% basket into two suffixed lines with unchanged amounts', () => {
      const cmd = toRegisterTransactionCommand({
        order: order(basket(15, 165)),
        connectionId: 'c',
        idempotencyKey: 'k',
        deliveryLine: delivery({ rateFormat: 'brackets' }),
      });
      const lines = cmd.lines.slice(2);
      expect(lines.map((l) => l.name)).toEqual(['Koszt dostawy (23%)', 'Koszt dostawy (5%)']);
      expect(lines.reduce((sum, l) => sum + l.unitPriceGross, 0)).toBeCloseTo(15, 2);
    });

    it('should emit one line at the fixed rate with no split', () => {
      const cmd = toRegisterTransactionCommand({
        order: order(basket(15, 165)),
        connectionId: 'c',
        idempotencyKey: 'k',
        deliveryLine: delivery({ rate: 'fixed', fixedRate: '23', rateFormat: 'labelled', rateLabel: 'VAT' }),
      });
      expect(cmd.lines.slice(2)).toEqual([
        {
          name: 'Koszt dostawy VAT 23%',
          quantity: 1,
          unitPriceGross: 15,
          taxRate: '23',
          sku: null,
        },
      ]);
    });

    it('should fold the delivery into product lines in spread mode and still reconcile', () => {
      const cmd = toRegisterTransactionCommand({
        order: order(basket(15, 165)),
        connectionId: 'c',
        idempotencyKey: 'k',
        deliveryLine: delivery({ rate: 'spread' }),
      });
      expect(cmd.lines).toHaveLength(2);
      const sum = cmd.lines.reduce((s, l) => s + l.quantity * l.unitPriceGross, 0);
      expect(sum).toBeCloseTo(165, 2);
    });

    it('should raise copies of the product lines in spread mode, never the order it was given', () => {
      const given = order(basket(15, 165));
      for (const item of given.items) Object.freeze(item);
      Object.freeze(given.items);
      const cmd = toRegisterTransactionCommand({
        order: given,
        connectionId: 'c',
        idempotencyKey: 'k',
        deliveryLine: delivery({ rate: 'spread' }),
      });
      // 15 split by gross 100 : 50 -> 10 and 5, each on a quantity-1 line.
      expect(cmd.lines.map((l) => l.unitPriceGross)).toEqual([110, 55]);
      expect(given.items.map((item) => item.price)).toEqual([100, 50]);
    });

    it('should fall back to a delivery line when the spread cannot be exact', () => {
      const cmd = toRegisterTransactionCommand({
        order: order({
          items: [{ id: 'a', productId: 'p1', quantity: 3, price: 10, taxRate: '23', name: 'A' }],
          totals: { subtotal: 30, tax: 0, shipping: 0.1, total: 30.1, currency: 'PLN' },
        }),
        connectionId: 'c',
        idempotencyKey: 'k',
        deliveryLine: delivery({ rate: 'spread' }),
      });
      expect(cmd.lines).toHaveLength(2);
      expect(cmd.lines[1]?.name).toBe('Koszt dostawy 23%');
      // The product line keeps its own price: nothing was folded into it.
      expect(cmd.lines[0]?.unitPriceGross).toBe(10);
    });

    it('should never emit a zero delivery line on a receipt, even with free delivery shown', () => {
      const cmd = toRegisterTransactionCommand({
        order: order(basket(0, 150)),
        connectionId: 'c',
        idempotencyKey: 'k',
        deliveryLine: delivery({ freeDelivery: 'show' }),
      });
      expect(cmd.lines).toHaveLength(2);
    });
  });
});

describe('toRegisterTransactionCommand - gift lines (#3930)', () => {
  const giftOrder = (): Order =>
    order({
      items: [
        { id: 'i1', productId: 'p1', quantity: 2, price: 24.6, name: 'Widget', taxRate: '23' },
        { id: 'i2', productId: 'p2', quantity: 1, price: 0, name: 'Spoon', taxRate: '23', gift: { source: 'channel' } },
      ],
    } as Partial<Order>);
  const total = (lines: { quantity: number; unitPriceGross: number }[]): number =>
    lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceGross * 100), 0);

  it('should omit a gift by default and equal what was paid', () => {
    const cmd = toRegisterTransactionCommand({
      order: giftOrder(),
      connectionId: 'c',
      idempotencyKey: 'k',
      giftConnectionForm: 'omit',
    });
    expect(cmd.lines.map((l) => l.name)).toEqual(['Widget']);
    expect(total(cmd.lines)).toBe(4920);
  });

  it('should take 0.01 from a same-rate paid line when the provider refuses zero', () => {
    const cmd = toRegisterTransactionCommand({
      order: giftOrder(),
      connectionId: 'c',
      idempotencyKey: 'k',
      giftConnectionForm: 'show-zero',
      acceptsZeroValueLine: false,
    });
    expect(cmd.lines).toHaveLength(3);
    expect(cmd.lines.at(-1)?.unitPriceGross).toBeCloseTo(0.01);
    expect(total(cmd.lines)).toBe(4920);
  });

  it('should still floor the gift at 0.01 when the provider declares it accepts zero (a receipt always refuses zero)', () => {
    const cmd = toRegisterTransactionCommand({
      order: giftOrder(),
      connectionId: 'c',
      idempotencyKey: 'k',
      giftConnectionForm: 'show-zero',
      acceptsZeroValueLine: true,
    });
    expect(cmd.lines.at(-1)?.unitPriceGross).toBeCloseTo(0.01);
    expect(total(cmd.lines)).toBe(4920);
  });
});

describe('toRegisterTransactionCommand - bundle components (#3934)', () => {
  const bundleOrder = (): Order =>
    order({
      items: [{ id: 'set', productId: 'ps', quantity: 1, price: 49.2, name: 'Set', taxRate: '23' }],
    } as Partial<Order>);
  const mixedDocument = {
    byLineId: {
      set: [
        { lineId: 'set~c:a', variantId: 'a', productId: 'pa', name: 'Soap', sku: 'S-1', quantity: 1, unitPriceGross: 30, taxRate: '23' },
        { lineId: 'set~c:b', variantId: 'b', productId: 'pb', name: 'Towel', quantity: 1, unitPriceGross: 20, taxRate: '8' },
        { lineId: 'set~c:g', variantId: 'g', productId: 'pg', name: 'Candle', quantity: 1, giftSlot: true, unitPriceGross: 9, taxRate: '8' },
      ],
    },
  };
  const total = (lines: { quantity: number; unitPriceGross: number }[]): number =>
    lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceGross * 100), 0);
  const perRate = (lines: { quantity: number; unitPriceGross: number; taxRate: string }[]) => {
    const out: Record<string, number> = {};
    for (const l of lines) {
      out[l.taxRate] = (out[l.taxRate] ?? 0) + Math.round(l.quantity * l.unitPriceGross * 100);
    }
    return out;
  };

  it('should register a mixed-rate set as its components, each at its own rate, total equal to what was paid', () => {
    const cmd = toRegisterTransactionCommand({
      order: bundleOrder(),
      connectionId: 'c',
      idempotencyKey: 'k',
      bundleDocument: mixedDocument,
      giftConnectionForm: 'omit',
    });
    expect(cmd.lines.map((l) => [l.name, l.taxRate])).toEqual([
      ['Soap', '23'],
      ['Towel', '8'],
    ]);
    expect(cmd.lines[0].sku).toBe('S-1');
    expect(total(cmd.lines)).toBe(4920);
    // 30:20 of 49.20 split proportionally, per-rate sums add back to the payment.
    expect(perRate(cmd.lines)).toEqual({ '23': 2952, '8': 1968 });
  });

  it('should never repeat one name at two rates, even when a component has no name', () => {
    const unnamed = {
      byLineId: {
        set: mixedDocument.byLineId.set.map((c) => ({ ...c, name: null, sku: null })),
      },
    };
    const cmd = toRegisterTransactionCommand({
      order: bundleOrder(),
      connectionId: 'c',
      idempotencyKey: 'k',
      bundleDocument: unnamed,
    });
    const ratesByName = new Map<string, Set<string>>();
    for (const l of cmd.lines) {
      ratesByName.set(l.name, (ratesByName.get(l.name) ?? new Set()).add(l.taxRate));
    }
    expect([...ratesByName.values()].every((rates) => rates.size === 1)).toBe(true);
    expect(cmd.lines.map((l) => l.name)).not.toContain('Set');
  });

  it('should keep one line when every component has the set rate', () => {
    const cmd = toRegisterTransactionCommand({
      order: bundleOrder(),
      connectionId: 'c',
      idempotencyKey: 'k',
      bundleDocument: {
        byLineId: { set: mixedDocument.byLineId.set.map((c) => ({ ...c, taxRate: '23' })) },
      },
    });
    expect(cmd.lines.map((l) => l.name)).toEqual(['Set']);
  });

  it('should refuse a set it cannot split without guessing', () => {
    expect(() =>
      toRegisterTransactionCommand({
        order: bundleOrder(),
        connectionId: 'c',
        idempotencyKey: 'k',
        bundleDocument: {
          byLineId: { set: mixedDocument.byLineId.set.map((c) => ({ ...c, taxRate: null })) },
        },
      }),
    ).toThrow('no known tax rate');
  });
});

describe('toRegisterTransactionCommand - net-priced order with an OpenLinker rule gift', () => {
  it('should compose without refusal and sum to what was paid', () => {
    const cmd = toRegisterTransactionCommand({
      order: order({
        items: [
          { id: 'i1', productId: 'p1', quantity: 1, price: 100, unitPriceGross: 123, name: 'Widget', taxRate: '23' },
          addedLineToOrderItem('ol-gift:rule-1:1', {
            changeId: 'rule-1',
            editedAt: '2026-11-02T10:00:00.000Z',
            editedBy: null,
            productId: 'p2',
            quantity: 1,
            name: 'Spoon',
            taxRate: '23',
            gift: { source: 'ol-rule', ruleRef: 'rule-1' },
          }),
        ],
        totals: { subtotal: 100, tax: 23, shipping: 0, total: 123, currency: 'PLN', taxTreatment: 'exclusive' },
      } as Partial<Order>),
      connectionId: 'c',
      idempotencyKey: 'k',
      giftConnectionForm: 'omit',
    });
    const sum = cmd.lines.reduce((acc, l) => acc + Math.round(l.quantity * l.unitPriceGross * 100), 0);
    expect(sum).toBe(12300);
  });
});
