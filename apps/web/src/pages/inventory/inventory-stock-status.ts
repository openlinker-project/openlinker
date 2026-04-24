/**
 * Inventory Stock Status
 *
 * Pure helper + lookup tables for deriving a qualitative stock status from
 * an available-quantity value, and mapping it to the StatusBadge and KpiCard
 * tones used in the detail-page hero and KPI block.
 *
 * Page-local logic (not shared across features), so colocated under
 * `pages/inventory/`.
 *
 * @module pages/inventory
 */
import type { KpiCardTone } from '../../shared/ui/kpi-card';
import type { StatusBadgeTone } from '../../shared/ui/status-badge';

export type StockStatus = 'out-of-stock' | 'low-stock' | 'in-stock';

/**
 * Default threshold for the "low stock" boundary (inclusive). Per-variant
 * overrides are not modelled yet — tracked as a follow-up issue after #381.
 * Exported as a named constant so every caller (helper default, tests, any
 * future consumer) references one grep-able value instead of a magic 5.
 */
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
