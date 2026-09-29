import { OrderRecord } from './entities/order-record.entity';
import {
  narrowOrderExportColumns,
  resolveOrderExportCell,
  ORDER_EXPORT_DEFAULT_COLUMNS,
} from './order-export-columns';
import { REDACTED_PLACEHOLDER } from './order-address-redaction';

function makeOrder(snapshot: Record<string, unknown>): OrderRecord {
  return new OrderRecord(
    'ol_order_test_1',
    null,
    '11111111-1111-4111-8111-111111111111',
    null,
    snapshot,
    [],
    'ready',
    new Date('2026-05-01T10:00:00Z'), // createdAt
    new Date('2026-05-02T08:30:00Z'), // updatedAt
    [], // syncAttempts
    null, // dispatchByAt
    null, // fulfillmentState
    null, // mappingFailureReason
    new Date('2026-05-02T08:30:00Z'), // placedAt
  );
}

describe('narrowOrderExportColumns', () => {
  it('drops a column id this build does not recognise', () => {
    expect(narrowOrderExportColumns(['orderNumber', 'bogus', 'currency'])).toEqual([
      'orderNumber',
      'currency',
    ]);
  });

  it('returns an empty array (never the default) when nothing matches', () => {
    expect(narrowOrderExportColumns(['bogus'])).toEqual([]);
  });
});

describe('resolveOrderExportCell', () => {
  it('resolves the basic scalar columns', () => {
    const order = makeOrder({
      orderNumber: 'PL-1001',
      customerEmail: 'buyer@example.com',
      totals: { total: 99.5 },
      currency: 'PLN',
      items: [{ sku: 'A-1' }, { sku: 'A-2' }],
    });

    expect(resolveOrderExportCell(order, 'internalOrderId')).toBe('ol_order_test_1');
    expect(resolveOrderExportCell(order, 'orderNumber')).toBe('PL-1001');
    expect(resolveOrderExportCell(order, 'customerEmail')).toBe('buyer@example.com');
    expect(resolveOrderExportCell(order, 'totalAmount')).toBe(99.5);
    expect(resolveOrderExportCell(order, 'currency')).toBe('PLN');
    expect(resolveOrderExportCell(order, 'itemCount')).toBe(2);
    expect(resolveOrderExportCell(order, 'skus')).toBe('A-1; A-2');
    expect(resolveOrderExportCell(order, 'placedAt')).toBe('2026-05-02T08:30:00.000Z');
  });

  it('reads a redacted PII field as an EMPTY cell, never the literal [REDACTED] string', () => {
    const order = makeOrder({
      billingAddress: { firstName: REDACTED_PLACEHOLDER, lastName: REDACTED_PLACEHOLDER },
      customerEmail: undefined,
    });

    expect(resolveOrderExportCell(order, 'customerName')).toBeNull();
    expect(resolveOrderExportCell(order, 'customerEmail')).toBeNull();
  });

  it('blanks a PII column unconditionally when storePii is false, even over a raw, unredacted snapshot', () => {
    const order = makeOrder({
      billingAddress: { firstName: 'Norbert', lastName: 'Kulus' },
      customerEmail: 'norbert@example.com',
    });

    // With the flag on (default), the raw values pass through untouched.
    expect(resolveOrderExportCell(order, 'customerName')).toBe('Norbert Kulus');
    expect(resolveOrderExportCell(order, 'customerEmail')).toBe('norbert@example.com');

    // A row ingested while PII storage was ON still carries the buyer's real
    // data — flipping the flag at export time must still blank it.
    expect(resolveOrderExportCell(order, 'customerName', false)).toBeNull();
    expect(resolveOrderExportCell(order, 'customerEmail', false)).toBeNull();
  });

  it('never blanks a non-PII column when storePii is false', () => {
    const order = makeOrder({
      orderNumber: 'PL-1001',
      country: 'PL',
      totals: { total: 12.5 },
      currency: 'PLN',
    });

    expect(resolveOrderExportCell(order, 'orderNumber', false)).toBe('PL-1001');
    expect(resolveOrderExportCell(order, 'totalAmount', false)).toBe(12.5);
    expect(resolveOrderExportCell(order, 'currency', false)).toBe('PLN');
  });

  it('country survives redaction (order-address-redaction.ts: "country is kept")', () => {
    const order = makeOrder({
      shippingAddress: {
        firstName: REDACTED_PLACEHOLDER,
        lastName: REDACTED_PLACEHOLDER,
        country: 'PL',
      },
    });

    expect(resolveOrderExportCell(order, 'country')).toBe('PL');
  });

  it('reports packed as a boolean derived from packedAt', () => {
    const order = makeOrder({});
    expect(resolveOrderExportCell(order, 'packed')).toBe(false);
  });

  it('the default column set is non-empty and every id is recognised', () => {
    expect(ORDER_EXPORT_DEFAULT_COLUMNS.length).toBeGreaterThan(0);
    expect(narrowOrderExportColumns([...ORDER_EXPORT_DEFAULT_COLUMNS])).toEqual([
      ...ORDER_EXPORT_DEFAULT_COLUMNS,
    ]);
  });
});
