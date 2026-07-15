/**
 * toIssueInvoiceCommand mapper — unit tests
 *
 * Pure function; Order fixtures only. Covers B2B/B2C derivation, multi-line
 * mapping, name/address fallbacks, PII-clean errors, documentType pass-through,
 * and the gross-only price-treatment guard.
 *
 * @module libs/core/src/invoicing/application/mappers
 */
import type { Address, Order, OrderItem } from '@openlinker/core/orders';

import { InvalidBuyerProfileError } from './errors/invalid-buyer-profile.error';
import { InvalidInvoiceLineError } from './errors/invalid-invoice-line.error';
import { UnsupportedPriceTreatmentError } from './errors/unsupported-price-treatment.error';
import { toIssueInvoiceCommand } from './order-to-issue-invoice-command.mapper';

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    firstName: 'Jan',
    lastName: 'Kowalski',
    address1: 'ul. Testowa 1',
    city: 'Poznań',
    postalCode: '60-001',
    country: 'PL',
    ...overrides,
  };
}

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    productId: 'prod-1',
    quantity: 1,
    price: 100,
    name: 'Widget',
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    status: 'processing',
    items: [makeItem()],
    totals: { subtotal: 100, tax: 23, shipping: 0, total: 123, currency: 'PLN', taxTreatment: 'inclusive' },
    billingAddress: makeAddress(),
    createdAt: new Date('2026-06-22T10:00:00.000Z'),
    updatedAt: new Date('2026-06-22T10:00:00.000Z'),
    ...overrides,
  };
}

describe('toIssueInvoiceCommand', () => {
  it('B2B: buyerTaxId present -> buyer.type "company", scheme-tagged taxId carried through', () => {
    const taxId = { scheme: 'pl-nip', value: '1234567890' };
    const cmd = toIssueInvoiceCommand({
      order: makeOrder({ billingAddress: makeAddress({ company: 'ACME Sp. z o.o.' }) }),
      connectionId: 'conn-1',
      buyerTaxId: taxId,
    });

    expect(cmd.buyer.type).toBe('company');
    expect(cmd.buyer.taxId).toEqual(taxId);
    expect(cmd.connectionId).toBe('conn-1');
    expect(cmd.orderId).toBe('order-1');
  });

  it('B2C: no buyerTaxId, no company -> buyer.type "private", buyer.taxId null', () => {
    const cmd = toIssueInvoiceCommand({ order: makeOrder(), connectionId: 'conn-1' });

    expect(cmd.buyer.type).toBe('private');
    expect(cmd.buyer.taxId).toBeNull();
    expect(cmd.buyer.name).toBe('Jan Kowalski');
  });

  it('multi-line: items -> lines, currency from totals.currency, name fallback to sku then productId', () => {
    const order = makeOrder({
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'EUR', taxTreatment: 'inclusive' },
      items: [
        makeItem({ id: 'a', name: 'Named', price: 10, quantity: 2 }),
        makeItem({ id: 'b', name: undefined, sku: 'SKU-9', price: 20, quantity: 1 }),
        makeItem({ id: 'c', name: undefined, sku: undefined, productId: 'PID-5', price: 30, quantity: 3 }),
      ],
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });

    expect(cmd.currency).toBe('EUR');
    expect(cmd.lines).toHaveLength(3);
    expect(cmd.lines[0]).toEqual({ name: 'Named', quantity: 2, unitPriceGross: 10, taxRate: '' });
    expect(cmd.lines[1].name).toBe('SKU-9');
    expect(cmd.lines[2].name).toBe('PID-5');
  });

  it('per-line taxRate: forwards OrderItem.taxRate when present, else falls back to empty (#1586 Phase 1)', () => {
    const order = makeOrder({
      items: [
        makeItem({ id: 'a', name: 'Std', taxRate: '23' }),
        makeItem({ id: 'b', name: 'Reduced', taxRate: '8' }),
        makeItem({ id: 'c', name: 'Unset' }), // no taxRate -> empty (default path)
      ],
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });

    expect(cmd.lines[0].taxRate).toBe('23');
    expect(cmd.lines[1].taxRate).toBe('8');
    expect(cmd.lines[2].taxRate).toBe('');
  });

  it('should fill saleDate from placedAt (ISO YYYY-MM-DD) when the order carries one', () => {
    const cmd = toIssueInvoiceCommand({
      order: makeOrder({ placedAt: new Date('2026-06-20T14:30:00.000Z') }),
      connectionId: 'conn-1',
    });

    expect(cmd.saleDate).toBe('2026-06-20');
  });

  it.each([
    ['zero', 0],
    ['negative', -2],
    ['NaN', Number.NaN],
  ])('should throw InvalidInvoiceLineError for a %s item quantity (#1525 review)', (_label, quantity) => {
    const order = makeOrder({ items: [makeItem({ quantity })] });
    expect(() => toIssueInvoiceCommand({ order, connectionId: 'conn-1' })).toThrow(
      InvalidInvoiceLineError,
    );
  });

  it('InvalidInvoiceLineError is PII-clean: cites only the order id', () => {
    const order = makeOrder({ items: [makeItem({ quantity: 0, name: 'SECRET_ITEM' })] });
    try {
      toIssueInvoiceCommand({ order, connectionId: 'conn-1' });
      fail('expected InvalidInvoiceLineError');
    } catch (error) {
      expect((error as Error).message).toContain('order-1');
      expect((error as Error).message).not.toContain('SECRET_ITEM');
    }
  });

  it('should leave saleDate undefined when placedAt is absent (never substitute createdAt)', () => {
    const cmd = toIssueInvoiceCommand({ order: makeOrder(), connectionId: 'conn-1' });

    // createdAt is set on the fixture; it must NOT leak into saleDate.
    expect(cmd.saleDate).toBeUndefined();
  });

  it('documentType pass-through: undefined stays undefined; supplied value verbatim; NO derivation', () => {
    const noDoc = toIssueInvoiceCommand({ order: makeOrder(), connectionId: 'conn-1' });
    expect(noDoc.documentType).toBeUndefined();

    const withDoc = toIssueInvoiceCommand({
      order: makeOrder(),
      connectionId: 'conn-1',
      documentType: 'proforma',
    });
    expect(withDoc.documentType).toBe('proforma');

    const idem = toIssueInvoiceCommand({
      order: makeOrder(),
      connectionId: 'conn-1',
      idempotencyKey: 'k1',
    });
    expect(idem.idempotencyKey).toBe('k1');
  });

  it('name derivation: firstName+lastName absent AND no company -> throws InvalidBuyerProfileError (no "undefined undefined")', () => {
    const order = makeOrder({
      billingAddress: makeAddress({ firstName: undefined, lastName: undefined, company: undefined }),
    });

    expect(() => toIssueInvoiceCommand({ order, connectionId: 'conn-1' })).toThrow(
      InvalidBuyerProfileError,
    );
  });

  it('name derivation: only firstName -> name is just that token (no trailing undefined)', () => {
    const order = makeOrder({
      billingAddress: makeAddress({ firstName: 'Solo', lastName: undefined }),
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });
    expect(cmd.buyer.name).toBe('Solo');
  });

  it('name derivation: company set -> company wins over person name', () => {
    const order = makeOrder({
      billingAddress: makeAddress({ firstName: 'Jan', lastName: 'Kowalski', company: 'Big Corp' }),
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1', buyerTaxId: { scheme: 'eu-vat', value: 'PL1' } });
    expect(cmd.buyer.name).toBe('Big Corp');
  });

  it('missing address: no billingAddress and no shippingAddress -> throws InvalidBuyerProfileError (NOT a raw TypeError)', () => {
    const order = makeOrder({ billingAddress: undefined, shippingAddress: undefined });

    expect(() => toIssueInvoiceCommand({ order, connectionId: 'conn-1' })).toThrow(
      InvalidBuyerProfileError,
    );
  });

  it('address fallback: only shippingAddress (no billing) -> maps via the shipping fallback', () => {
    const order = makeOrder({
      billingAddress: undefined,
      shippingAddress: makeAddress({ address1: 'ul. Shipping 9', city: 'Kraków', country: 'PL' }),
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });
    expect(cmd.buyer.address.line1).toBe('ul. Shipping 9');
    expect(cmd.buyer.address.city).toBe('Kraków');
    expect(cmd.buyer.address.countryIso2).toBe('PL');
  });

  it('mapper errors are PII-clean: thrown message contains order.id and does NOT echo buyer name/address/tax-id', () => {
    const order = makeOrder({
      id: 'order-pii',
      billingAddress: makeAddress({
        firstName: 'SecretFirst',
        lastName: 'SecretLast',
        company: undefined,
        address1: 'SecretStreet 42',
      }),
      shippingAddress: undefined,
    });
    // Force the name-derivation failure path.
    order.billingAddress = makeAddress({ firstName: undefined, lastName: undefined, address1: 'SecretStreet 42' });

    try {
      toIssueInvoiceCommand({ order, connectionId: 'conn-1' });
      fail('expected throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('order-pii');
      expect(message).not.toContain('SecretStreet');
    }
  });

  it('price treatment: totals.taxTreatment "inclusive" -> unitPriceGross = item.price', () => {
    const order = makeOrder({
      items: [makeItem({ price: 49.99 })],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN', taxTreatment: 'inclusive' },
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });
    expect(cmd.lines[0].unitPriceGross).toBe(49.99);
  });

  it('price treatment: totals.taxTreatment ABSENT -> unitPriceGross = item.price (gross assumption)', () => {
    const order = makeOrder({
      items: [makeItem({ price: 49.99 })],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });
    expect(cmd.lines[0].unitPriceGross).toBe(49.99);
  });

  it('price treatment: totals.taxTreatment "exclusive" -> throws UnsupportedPriceTreatmentError', () => {
    const order = makeOrder({
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN', taxTreatment: 'exclusive' },
    });

    expect(() => toIssueInvoiceCommand({ order, connectionId: 'conn-1' })).toThrow(
      UnsupportedPriceTreatmentError,
    );
  });

  it('shipping: totals.shipping > 0 -> appends one gross shipping line after the item lines (#1517)', () => {
    const order = makeOrder({
      items: [makeItem({ price: 499.99, quantity: 1 })],
      totals: {
        subtotal: 499.99,
        tax: 0,
        shipping: 10.49,
        total: 510.48,
        currency: 'PLN',
        taxTreatment: 'inclusive',
      },
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });

    expect(cmd.lines).toHaveLength(2);
    // Product lines come first; the shipping line is appended last.
    expect(cmd.lines[0].unitPriceGross).toBe(499.99);
    expect(cmd.lines[1]).toEqual({
      name: 'Shipping',
      quantity: 1,
      unitPriceGross: 10.49,
      taxRate: '',
    });
    // Invoice gross (summed by InvoiceService.buildContent over cmd.lines) now
    // equals the order total.
    const gross = cmd.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceGross, 0);
    expect(gross).toBeCloseTo(order.totals.total, 2);
  });

  it('shipping: taxRate left empty on the shipping line (provider adapter resolves the regime rate)', () => {
    const order = makeOrder({
      totals: { subtotal: 100, tax: 0, shipping: 15, total: 115, currency: 'PLN', taxTreatment: 'inclusive' },
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });

    const shippingLine = cmd.lines.find((l) => l.name === 'Shipping');
    expect(shippingLine).toBeDefined();
    expect(shippingLine?.taxRate).toBe('');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('shipping: totals.shipping %s -> no phantom shipping line (#1517)', (_label, shipping) => {
    const order = makeOrder({
      items: [makeItem({ price: 100, quantity: 1 })],
      totals: { subtotal: 100, tax: 0, shipping, total: 100, currency: 'PLN', taxTreatment: 'inclusive' },
    });

    const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1' });

    expect(cmd.lines).toHaveLength(1);
    expect(cmd.lines.some((l) => l.name === 'Shipping')).toBe(false);
  });

  it('shipping: caller-supplied shippingLineName overrides the neutral default label (#1517)', () => {
    const order = makeOrder({
      totals: { subtotal: 100, tax: 0, shipping: 15, total: 115, currency: 'PLN', taxTreatment: 'inclusive' },
    });

    const cmd = toIssueInvoiceCommand({
      order,
      connectionId: 'conn-1',
      shippingLineName: 'Koszt wysyłki',
    });

    const shippingLine = cmd.lines.find((l) => l.unitPriceGross === 15 && l.quantity === 1);
    expect(shippingLine?.name).toBe('Koszt wysyłki');
    // Neutral English default is not used when an override is supplied.
    expect(cmd.lines.some((l) => l.name === 'Shipping')).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])(
    'shipping: %s shippingLineName override falls back to the neutral default label (#1517)',
    (_label, shippingLineName) => {
      const order = makeOrder({
        totals: { subtotal: 100, tax: 0, shipping: 15, total: 115, currency: 'PLN', taxTreatment: 'inclusive' },
      });

      const cmd = toIssueInvoiceCommand({ order, connectionId: 'conn-1', shippingLineName });

      const shippingLine = cmd.lines.find((l) => l.unitPriceGross === 15 && l.quantity === 1);
      expect(shippingLine?.name).toBe('Shipping');
    },
  );
});
