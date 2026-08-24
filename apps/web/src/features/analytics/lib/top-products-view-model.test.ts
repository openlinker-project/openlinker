import { describe, expect, it } from 'vitest';
import type { ProductChannelSales, TopProductRow } from '../api/top-products.types';
import { channelCellFor, deriveChannelColumns, isMissingFrom } from './top-products-view-model';

function channel(overrides: Partial<ProductChannelSales> = {}): ProductChannelSales {
  return {
    sourceConnectionId: 'conn-1',
    units: 5,
    revenue: 100,
    unconvertedRevenue: 0,
    currency: 'PLN',
    ...overrides,
  };
}

function row(overrides: Partial<TopProductRow> = {}): TopProductRow {
  return {
    productId: 'p1',
    name: 'Widget',
    sku: 'WID-1',
    units: 5,
    revenue: 100,
    unconvertedRevenue: 0,
    unconvertedOrderCount: 0,
    currency: 'PLN',
    unconvertedCurrency: null,
    channels: [channel()],
    missingFromConnectionIds: [],
    ...overrides,
  };
}

describe('deriveChannelColumns', () => {
  it('returns [] for no rows', () => {
    expect(deriveChannelColumns([])).toEqual([]);
  });

  it('unions channel ids across rows in first-seen order, without duplicates', () => {
    const rows = [
      row({ channels: [channel({ sourceConnectionId: 'conn-a' }), channel({ sourceConnectionId: 'conn-b' })] }),
      row({ channels: [channel({ sourceConnectionId: 'conn-b' }), channel({ sourceConnectionId: 'conn-c' })] }),
    ];

    expect(deriveChannelColumns(rows)).toEqual(['conn-a', 'conn-b', 'conn-c']);
  });
});

describe('channelCellFor', () => {
  it('returns the matching channel entry', () => {
    const r = row({ channels: [channel({ sourceConnectionId: 'conn-a' })] });
    expect(channelCellFor(r, 'conn-a')?.sourceConnectionId).toBe('conn-a');
  });

  it('returns undefined when the connection has no entry', () => {
    const r = row({ channels: [channel({ sourceConnectionId: 'conn-a' })] });
    expect(channelCellFor(r, 'conn-b')).toBeUndefined();
  });
});

describe('isMissingFrom', () => {
  it('is true when the connection id is in missingFromConnectionIds', () => {
    const r = row({ missingFromConnectionIds: ['conn-b'] });
    expect(isMissingFrom(r, 'conn-b')).toBe(true);
  });

  it('is false otherwise', () => {
    const r = row({ missingFromConnectionIds: [] });
    expect(isMissingFrom(r, 'conn-b')).toBe(false);
  });
});
