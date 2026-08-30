import { describe, expect, it } from 'vitest';
import {
  deriveCoverageHeadline,
  deriveFailedSyncHeadline,
  deriveStockHeadline,
} from './needs-attention-copy.lib';
import type {
  CoverageGapItem,
  FailedSyncValueSummary,
  StockAtRiskItem,
} from '../api/needs-attention.types';

const connectionName = (id: string): string => (id === 'conn-1' ? 'Allegro' : `Connection ${id}`);

describe('deriveCoverageHeadline', () => {
  it('should name the connection when every item is missing from the same single channel', () => {
    const items: CoverageGapItem[] = [
      { variantId: 'v1', productId: 'p1', listedOnConnectionIds: ['conn-2'], missingFromConnectionIds: ['conn-1'] },
      { variantId: 'v2', productId: 'p1', listedOnConnectionIds: ['conn-2'], missingFromConnectionIds: ['conn-1'] },
    ];

    const result = deriveCoverageHeadline(items, items.length, connectionName);

    expect(result.headline).toBe('2 variants missing from Allegro');
  });

  it('should fall back to a connection-agnostic headline when items miss different channels', () => {
    const items: CoverageGapItem[] = [
      { variantId: 'v1', productId: 'p1', listedOnConnectionIds: ['conn-2'], missingFromConnectionIds: ['conn-1'] },
      { variantId: 'v2', productId: 'p1', listedOnConnectionIds: ['conn-1'], missingFromConnectionIds: ['conn-3'] },
    ];

    const result = deriveCoverageHeadline(items, 2, connectionName);

    expect(result.headline).toBe('2 variants with a listing gap on at least one channel');
  });

  it('should fall back to a connection-agnostic headline when an item misses more than one channel', () => {
    const items: CoverageGapItem[] = [
      {
        variantId: 'v1',
        productId: 'p1',
        listedOnConnectionIds: [],
        missingFromConnectionIds: ['conn-1', 'conn-2'],
      },
    ];

    const result = deriveCoverageHeadline(items, 1, connectionName);

    expect(result.headline).toBe('1 variant with a listing gap on at least one channel');
  });

  it('should use singular wording for a totalCount of 1 in the connection-named branch', () => {
    const items: CoverageGapItem[] = [
      { variantId: 'v1', productId: 'p1', listedOnConnectionIds: [], missingFromConnectionIds: ['conn-1'] },
    ];

    const result = deriveCoverageHeadline(items, 1, connectionName);

    expect(result.headline).toBe('1 variant missing from Allegro');
  });

  it('should fall back to the ambiguous headline when the items array is empty but totalCount is positive', () => {
    const result = deriveCoverageHeadline([], 5, connectionName);

    expect(result.headline).toBe('5 variants with a listing gap on at least one channel');
  });

  it('should NOT name a connection when the sample shares one channel but the sample is smaller than the total (#2120 BLOCKING)', () => {
    // 20-item sample (the DEFAULT_AGGREGATE_LIMIT preview) all missing from
    // conn-1, but totalCount (412) says there are 392 more variants this
    // sample never verified are also missing from conn-1.
    const items: CoverageGapItem[] = Array.from({ length: 20 }, (_, i) => ({
      variantId: `v${i}`,
      productId: 'p1',
      listedOnConnectionIds: ['conn-2'],
      missingFromConnectionIds: ['conn-1'],
    }));

    const result = deriveCoverageHeadline(items, 412, connectionName);

    expect(result.headline).toBe('412 variants with a listing gap on at least one channel');
    expect(result.headline).not.toContain('Allegro');
  });
});

describe('deriveStockHeadline', () => {
  it('should name the connection and buffer when every item shares both', () => {
    const items: StockAtRiskItem[] = [
      { variantId: 'v1', productId: 'p1', connectionId: 'conn-1', masterStock: 1, stockSafetyBuffer: 2, stockZeroThreshold: 0 },
      { variantId: 'v2', productId: 'p1', connectionId: 'conn-1', masterStock: 0, stockSafetyBuffer: 2, stockZeroThreshold: 0 },
    ];

    const result = deriveStockHeadline(items, items.length, connectionName);

    expect(result.headline).toBe('2 variants publishing no stock on Allegro');
    expect(result.sub).toContain('buffer 2');
  });

  it('should fall back to the ambiguous headline when connections differ', () => {
    const items: StockAtRiskItem[] = [
      { variantId: 'v1', productId: 'p1', connectionId: 'conn-1', masterStock: 1, stockSafetyBuffer: 2, stockZeroThreshold: 0 },
      { variantId: 'v2', productId: 'p1', connectionId: 'conn-2', masterStock: 1, stockSafetyBuffer: 2, stockZeroThreshold: 0 },
    ];

    const result = deriveStockHeadline(items, 2, connectionName);

    expect(result.headline).toBe('2 variants are publishing no stock to their channel');
  });

  it('should name the low-stock floor when that is what silenced the line (#2610)', () => {
    const items: StockAtRiskItem[] = [
      {
        variantId: 'v1',
        productId: 'p1',
        connectionId: 'conn-1',
        masterStock: 3,
        stockSafetyBuffer: 0,
        stockZeroThreshold: 5,
      },
    ];

    const result = deriveStockHeadline(items, 1, connectionName);

    expect(result.sub).toContain('low-stock floor 5');
  });

  it('should fall back to the ambiguous headline when buffers differ on the same connection', () => {
    const items: StockAtRiskItem[] = [
      { variantId: 'v1', productId: 'p1', connectionId: 'conn-1', masterStock: 1, stockSafetyBuffer: 1, stockZeroThreshold: 0 },
      { variantId: 'v2', productId: 'p1', connectionId: 'conn-1', masterStock: 1, stockSafetyBuffer: 2, stockZeroThreshold: 0 },
    ];

    const result = deriveStockHeadline(items, 2, connectionName);

    expect(result.headline).toBe('2 variants are publishing no stock to their channel');
  });

  it('should NOT name a connection/buffer when the sample shares both but the sample is smaller than the total (#2120 BLOCKING)', () => {
    const items: StockAtRiskItem[] = Array.from({ length: 20 }, (_, i) => ({
      variantId: `v${i}`,
      productId: 'p1',
      connectionId: 'conn-1',
      masterStock: 1,
      stockSafetyBuffer: 2,
      stockZeroThreshold: 0,
    }));

    const result = deriveStockHeadline(items, 300, connectionName);

    expect(result.headline).toBe('300 variants are publishing no stock to their channel');
    expect(result.headline).not.toContain('Allegro');
  });
});

describe('deriveFailedSyncHeadline', () => {
  it('should render only the count, never the total value', () => {
    const summary: FailedSyncValueSummary = {
      count: 3,
      totalValue: 1234.5,
      mixedCurrency: false,
      oldestFailedAt: '2026-08-01T00:00:00.000Z',
    };

    const result = deriveFailedSyncHeadline(summary);

    expect(result.headline).toBe('3 orders never reached a destination');
    expect(result.headline).not.toContain('1,234.5');
    expect(result.headline).not.toContain('1234.5');
  });

  it('should note the currency mismatch in the sub-line when mixedCurrency is true', () => {
    const summary: FailedSyncValueSummary = {
      count: 5,
      totalValue: 999,
      mixedCurrency: true,
      oldestFailedAt: null,
    };

    const result = deriveFailedSyncHeadline(summary);

    expect(result.headline).toBe('5 orders never reached a destination');
    expect(result.headline).not.toContain('999');
    expect(result.sub).toBe('affected orders span multiple currencies');
  });

  it('should use singular order wording when count is 1', () => {
    const summary: FailedSyncValueSummary = {
      count: 1,
      totalValue: 50,
      mixedCurrency: false,
      oldestFailedAt: null,
    };

    const result = deriveFailedSyncHeadline(summary);

    expect(result.headline).toBe('1 order never reached a destination');
  });
});
