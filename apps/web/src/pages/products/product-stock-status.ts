/**
 * Product Stock Status
 *
 * Pure helper + lookup tables for deriving a qualitative stock status from
 * an aggregate available-quantity value, and mapping it to the StatusBadge
 * and KpiCard tones used on the product-detail hero and KPI strip.
 *
 * Page-local logic (not shared across features) — originally colocated as a
 * copy of the same pattern the standalone Inventory detail page used before
 * that page was removed (its stock/listings data is now merged into this one).
 *
 * @module pages/products
 */
import type { KpiCardTone } from '../../shared/ui/kpi-card';
import type { StatusBadgeTone } from '../../shared/ui/status-badge';

export type StockStatus = 'out-of-stock' | 'low-stock' | 'in-stock';

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function deriveStockStatus(
  availableQuantity: number,
  lowThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): StockStatus {
  if (availableQuantity <= 0) return 'out-of-stock';
  if (availableQuantity <= lowThreshold) return 'low-stock';
  return 'in-stock';
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  'out-of-stock': 'Out of stock',
  'low-stock': 'Low stock',
  'in-stock': 'In stock',
};

export const STOCK_STATUS_BADGE_TONE: Record<StockStatus, StatusBadgeTone> = {
  'out-of-stock': 'error',
  'low-stock': 'warning',
  'in-stock': 'success',
};

export const STOCK_STATUS_KPI_TONE: Record<StockStatus, KpiCardTone> = {
  'out-of-stock': 'error',
  'low-stock': 'warning',
  'in-stock': 'success',
};
