/**
 * buildOrderSummary Unit Tests (#1995)
 *
 * @module libs/core/src/orders/domain
 */
import { buildOrderSummary } from './order-summary-projection';
import { OrderRecord } from './entities/order-record.entity';

describe('buildOrderSummary', () => {
  const buildRecord = (orderSnapshot: Record<string, unknown>): OrderRecord =>
    new OrderRecord(
      'order-123',
      'customer-456',
      'source-connection-123',
      'event-456',
      orderSnapshot,
      [],
      'ready',
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-01T00:00:00Z')
    );

  it('returns null when no record resolves', () => {
    expect(buildOrderSummary(undefined)).toBeNull();
  });

  it('returns null when the snapshot has no items array', () => {
    const record = buildRecord({ orderNumber: 'ORD-001' });
    expect(buildOrderSummary(record)).toBeNull();
  });

  it('returns null when items is an empty array', () => {
    const record = buildRecord({ orderNumber: 'ORD-001', items: [] });
    expect(buildOrderSummary(record)).toBeNull();
  });

  it('returns null when items is not an array', () => {
    const record = buildRecord({ orderNumber: 'ORD-001', items: 'not-an-array' });
    expect(buildOrderSummary(record)).toBeNull();
  });

  it('projects the first item of a single-item snapshot', () => {
    const record = buildRecord({
      orderNumber: 'ORD-001',
      items: [{ name: 'Terra Wool Coat', imageUrl: 'https://example.com/coat.png' }],
    });

    expect(buildOrderSummary(record)).toEqual({
      orderNumber: 'ORD-001',
      firstItemName: 'Terra Wool Coat',
      firstItemImageUrl: 'https://example.com/coat.png',
      itemCount: 1,
    });
  });

  it('surfaces only the first item of a multi-item snapshot but reports the full count', () => {
    const record = buildRecord({
      orderNumber: 'ORD-002',
      items: [
        { name: 'First Item', imageUrl: null },
        { name: 'Second Item', imageUrl: 'https://example.com/second.png' },
        { name: 'Third Item' },
      ],
    });

    expect(buildOrderSummary(record)).toEqual({
      orderNumber: 'ORD-002',
      firstItemName: 'First Item',
      firstItemImageUrl: null,
      itemCount: 3,
    });
  });

  it('falls back to null orderNumber when the snapshot omits it, without losing item fields', () => {
    const record = buildRecord({
      items: [{ name: 'Terra Wool Coat' }],
    });

    expect(buildOrderSummary(record)).toEqual({
      orderNumber: null,
      firstItemName: 'Terra Wool Coat',
      firstItemImageUrl: null,
      itemCount: 1,
    });
  });

  it('degrades gracefully when the first item is malformed (not an object)', () => {
    const record = buildRecord({ orderNumber: 'ORD-003', items: ['not-an-object'] });

    expect(buildOrderSummary(record)).toEqual({
      orderNumber: 'ORD-003',
      firstItemName: null,
      firstItemImageUrl: null,
      itemCount: 1,
    });
  });
});
