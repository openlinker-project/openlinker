/**
 * useStockAtRiskText Hook
 *
 * The `orders.stockAtRisk` copy plus the plural and number formatters, bound
 * to the active language, for the stock-at-risk builders in
 * `lib/stock-at-risk.ts`. Exported from the orders barrel so a surface outside
 * the feature builds the same sentence without reading the namespace itself.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMemo } from 'react';
import { useFormat, useMessages, usePlural } from '../../../shared/i18n';
import type { StockAtRiskText } from '../lib/stock-at-risk.types';

export function useStockAtRiskText(): StockAtRiskText {
  const copy = useMessages('orders').stockAtRisk;
  const plural = usePlural();
  const format = useFormat();
  return useMemo(
    () => ({ copy, plural, number: (value: number) => format.number(value) }),
    [copy, plural, format]
  );
}
