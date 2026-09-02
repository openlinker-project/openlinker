/**
 * Product Stock Status
 *
 * Pure helper + lookup tables for deriving a qualitative stock status from
 * an aggregate available-quantity value, and mapping it to the StatusBadge
 * and KpiCard tones used on the product-detail hero and KPI strip.
 *
 * Promoted from `pages/products/` (#2765 follow-up) once Analytics' Top
 * Products variant-sales panel became a second real consumer — the same
 * `ok`/`low`/`out` distinction the products cockpit already renders per
 * variant, so it belongs in `features/products` rather than being
 * recopied. `DEFAULT_LOW_STOCK_THRESHOLD` mirrors the backend's own
 * `LOW_STOCK_THRESHOLD` (`@openlinker/core/products`) by value, not by
 * import — `apps/web` cannot depend on `@openlinker/core` (#591).
 *
 * @module apps/web/src/features/products/lib
 */
import type { KpiCardTone } from '../../../shared/ui/kpi-card';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

export type StockStatus = 'oversold' | 'out-of-stock' | 'low-stock' | 'in-stock';

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function deriveStockStatus(
  availableQuantity: number,
  lowThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): StockStatus {
  // Oversold before out-of-stock (#1720): a negative aggregate means more was
  // sold than the master holds - the loudest state, not just "empty".
  if (availableQuantity < 0) return 'oversold';
  if (availableQuantity <= 0) return 'out-of-stock';
  if (availableQuantity <= lowThreshold) return 'low-stock';
  return 'in-stock';
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  oversold: 'Oversold',
  'out-of-stock': 'Out of stock',
  'low-stock': 'Low stock',
  'in-stock': 'In stock',
};

export const STOCK_STATUS_BADGE_TONE: Record<StockStatus, StatusBadgeTone> = {
  oversold: 'error',
  'out-of-stock': 'error',
  'low-stock': 'warning',
  'in-stock': 'success',
};

export const STOCK_STATUS_KPI_TONE: Record<StockStatus, KpiCardTone> = {
  oversold: 'error',
  'out-of-stock': 'error',
  'low-stock': 'warning',
  'in-stock': 'success',
};
