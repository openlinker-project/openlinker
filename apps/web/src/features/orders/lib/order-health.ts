/**
 * Order Health Derivations
 *
 * Pure, framework-free view-model helpers that derive an order's operator-facing
 * health from data already on the `OrderRecord` (per-destination `syncStatus`)
 * and the shipments query. Kept out of the page/components so the rules are
 * unit-testable in isolation (#924).
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderSyncStatus } from '../api/orders.types';

export interface SyncRollup {
  total: number;
  failed: number;
  synced: number;
  /** pending + syncing — anything not yet terminal. */
  pending: number;
}

export function rollupSyncStatus(syncStatus: readonly OrderSyncStatus[]): SyncRollup {
  let failed = 0;
  let synced = 0;
  let pending = 0;
  for (const s of syncStatus) {
    if (s.status === 'failed') failed += 1;
    else if (s.status === 'synced') synced += 1;
    else pending += 1;
  }
  return { total: syncStatus.length, failed, synced, pending };
}

export const OrderHealthLevelValues = ['attention', 'pending', 'healthy', 'unknown'] as const;
export type OrderHealthLevel = (typeof OrderHealthLevelValues)[number];

export function deriveHealthLevel(rollup: SyncRollup): OrderHealthLevel {
  if (rollup.total === 0) return 'unknown';
  if (rollup.failed > 0) return 'attention';
  if (rollup.pending > 0) return 'pending';
  return 'healthy';
}

export function healthLabel(level: OrderHealthLevel): string {
  switch (level) {
    case 'attention':
      return 'Needs attention';
    case 'pending':
      return 'In progress';
    case 'healthy':
      return 'Synced';
    case 'unknown':
      return 'No destinations';
  }
}

/** "1 of 1 failed" / "2 of 3 synced" — the headline for the Sync health cell. */
export function syncCellLabel(rollup: SyncRollup): string {
  if (rollup.total === 0) return 'No destinations';
  if (rollup.failed > 0) return `${rollup.failed} of ${rollup.total} failed`;
  return `${rollup.synced} of ${rollup.total} synced`;
}

export const FulfillmentStateValues = [
  'not-shipped',
  'dispatched',
  'delivered',
  'failed',
  'unavailable',
] as const;
export type FulfillmentState = (typeof FulfillmentStateValues)[number];

/**
 * Derive the fulfillment state from the order's shipment statuses. `null` /
 * empty means no shipment exists yet. When no connection declares the
 * ShippingProviderManager capability the order can't be dispatched at all, so
 * the state collapses to `unavailable` (the panel + cell hide the affordance).
 */
export function deriveFulfillment(
  shipmentStatuses: readonly string[] | null,
  hasShippingCapability: boolean,
): FulfillmentState {
  if (!hasShippingCapability) return 'unavailable';
  if (!shipmentStatuses || shipmentStatuses.length === 0) return 'not-shipped';
  if (shipmentStatuses.includes('delivered')) return 'delivered';
  if (shipmentStatuses.some((s) => s === 'dispatched' || s === 'in-transit' || s === 'generated')) {
    return 'dispatched';
  }
  if (shipmentStatuses.every((s) => s === 'failed' || s === 'cancelled')) return 'failed';
  return 'not-shipped';
}

export function fulfillmentLabel(state: FulfillmentState): string {
  switch (state) {
    case 'not-shipped':
      return 'Not shipped';
    case 'dispatched':
      return 'Dispatched';
    case 'delivered':
      return 'Delivered';
    case 'failed':
      return 'Dispatch failed';
    case 'unavailable':
      return 'Not tracked';
  }
}

/** Sum of item quantities — the "M unit" half of the header summary line. */
export function totalUnits(items: readonly { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
