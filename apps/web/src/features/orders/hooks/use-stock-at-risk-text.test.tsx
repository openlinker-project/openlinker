import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../shared/i18n';
import type { OrderReservationShortfall } from '../api/orders.types';
import { stockAtRiskTitle } from '../lib/stock-at-risk';
import { useStockAtRiskText } from './use-stock-at-risk-text';

describe('useStockAtRiskText', () => {
  it('should hand the stock-at-risk copy to the builders', () => {
    const { result } = renderHook(() => useStockAtRiskText());

    expect(result.current.copy).toEqual(getMessages('orders').stockAtRisk);
  });

  it('should format numbers for the active language', () => {
    const { result } = renderHook(() => useStockAtRiskText());

    expect(result.current.number(2000)).toBe('2,000');
  });

  it('should give a stable object between renders', () => {
    const { result, rerender } = renderHook(() => useStockAtRiskText());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('should drive the summary title for several shortfalls through the plural', () => {
    const { result } = renderHook(() => useStockAtRiskText());
    const shortfall: OrderReservationShortfall = {
      episodeId: 'ep-1',
      inventoryItemId: 'ol_inventoryitem_1',
      productVariantId: 'ol_variant_1',
      sku: 'SKU-1',
      shortQuantity: 1,
      positionShortfall: 2,
      openedAt: '2026-08-27T10:00:00.000Z',
    };

    const title = stockAtRiskTitle(
      [shortfall, { ...shortfall, episodeId: 'ep-2', sku: 'SKU-2' }],
      result.current
    );

    expect(title).toBe(result.current.plural(2, result.current.copy.titleSeveral));
  });
});
