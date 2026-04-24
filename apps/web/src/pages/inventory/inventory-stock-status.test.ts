import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_KPI_TONE,
  STOCK_STATUS_LABEL,
} from './inventory-stock-status';

describe('deriveStockStatus', () => {
  it('returns out-of-stock when availableQuantity is zero', () => {
    expect(deriveStockStatus(0)).toBe('out-of-stock');
  });

  it('treats negative quantities as out-of-stock (defensive)', () => {
    expect(deriveStockStatus(-3)).toBe('out-of-stock');
  });

  it('returns low-stock at the default threshold boundary (inclusive)', () => {
    expect(deriveStockStatus(DEFAULT_LOW_STOCK_THRESHOLD)).toBe('low-stock');
    expect(deriveStockStatus(1)).toBe('low-stock');
  });

  it('returns in-stock one above the default threshold', () => {
    expect(deriveStockStatus(DEFAULT_LOW_STOCK_THRESHOLD + 1)).toBe('in-stock');
    expect(deriveStockStatus(100)).toBe('in-stock');
  });

  it('respects a custom lowThreshold override', () => {
    expect(deriveStockStatus(10, 20)).toBe('low-stock');
    expect(deriveStockStatus(20, 20)).toBe('low-stock');
    expect(deriveStockStatus(25, 20)).toBe('in-stock');
  });
});

describe('stock status lookups', () => {
  it('provides a user-facing label for each status', () => {
    expect(STOCK_STATUS_LABEL['out-of-stock']).toBe('Out of stock');
    expect(STOCK_STATUS_LABEL['low-stock']).toBe('Low stock');
    expect(STOCK_STATUS_LABEL['in-stock']).toBe('In stock');
  });

  it('maps each status to a semantic StatusBadge tone', () => {
    expect(STOCK_STATUS_BADGE_TONE['out-of-stock']).toBe('error');
    expect(STOCK_STATUS_BADGE_TONE['low-stock']).toBe('warning');
    expect(STOCK_STATUS_BADGE_TONE['in-stock']).toBe('success');
  });

  it('maps each status to a semantic KpiCard tone', () => {
    expect(STOCK_STATUS_KPI_TONE['out-of-stock']).toBe('error');
    expect(STOCK_STATUS_KPI_TONE['low-stock']).toBe('warning');
    expect(STOCK_STATUS_KPI_TONE['in-stock']).toBe('success');
  });
});
