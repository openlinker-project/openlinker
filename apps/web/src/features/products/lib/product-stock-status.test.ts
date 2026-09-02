import { describe, expect, it } from 'vitest';
import {
  deriveStockStatus,
  STOCK_STATUS_BADGE_TONE,
  STOCK_STATUS_KPI_TONE,
  STOCK_STATUS_LABEL,
} from './product-stock-status';

describe('deriveStockStatus', () => {
  it('should return oversold when the total is negative', () => {
    expect(deriveStockStatus(-1)).toBe('oversold');
    expect(deriveStockStatus(-100)).toBe('oversold');
  });

  it('should return out-of-stock when the total is exactly zero', () => {
    expect(deriveStockStatus(0)).toBe('out-of-stock');
  });

  it('should return low-stock within the threshold and in-stock above it', () => {
    expect(deriveStockStatus(1)).toBe('low-stock');
    expect(deriveStockStatus(5)).toBe('low-stock');
    expect(deriveStockStatus(6)).toBe('in-stock');
  });

  it('should respect a custom low threshold', () => {
    expect(deriveStockStatus(9, 10)).toBe('low-stock');
    expect(deriveStockStatus(11, 10)).toBe('in-stock');
  });

  it('should map oversold to error tones and an explicit label', () => {
    expect(STOCK_STATUS_LABEL.oversold).toBe('Oversold');
    expect(STOCK_STATUS_BADGE_TONE.oversold).toBe('error');
    expect(STOCK_STATUS_KPI_TONE.oversold).toBe('error');
  });
});
