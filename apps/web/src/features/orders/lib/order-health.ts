/**
 * Order Health View-Model
 *
 * Derives a single operator-facing health classification for an order row by
 * reconciling `recordStatus` with the per-destination `syncStatus[]` (#929).
 * Replaces the old per-destination badge list (and the blank "—" for orders
 * with an empty `syncStatus[]`) with one reconciled `StatusBadge`.
 *
 * CANONICAL PRECEDENCE (highest wins) — this is the single FE source of truth
 * and the twin of the SQL `CASE` in `OrderRecordRepository` (#929); keep both
 * in lockstep:
 *   1. awaiting_mapping  — recordStatus = 'awaiting_mapping' (can't sync yet)
 *   2. needs_attention   — ready AND any destination failed
 *   3. synced            — ready, no failed, AND any destination synced
 *   4. awaiting_dispatch — everything else (ready, no failed, no synced)
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderRecord, OrderHealthValue } from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

export interface OrderHealthView {
  key: OrderHealthValue;
  tone: StatusBadgeTone;
  /** Row-badge label. */
  label: string;
  /** Plain-language cause, present only for `needs_attention`. */
  reason?: string;
}

/** Static label + tone per bucket. Shared by the row badge and the KPI segments. */
export const ORDER_HEALTH_META: Record<OrderHealthValue, { label: string; tone: StatusBadgeTone }> =
  {
    awaiting_mapping: { label: 'Awaiting mapping', tone: 'warning' },
    needs_attention: { label: 'Sync failed', tone: 'error' },
    synced: { label: 'Synced', tone: 'success' },
    awaiting_dispatch: { label: 'Awaiting dispatch', tone: 'info' },
  };

/**
 * Classify an order into exactly one health bucket. Pure function of the
 * record's own already-loaded fields — no I/O.
 */
export function deriveOrderHealth(order: OrderRecord): OrderHealthView {
  if (order.recordStatus === 'awaiting_mapping') {
    return { key: 'awaiting_mapping', ...ORDER_HEALTH_META.awaiting_mapping };
  }

  const failed = order.syncStatus.find((s) => s.status === 'failed');
  if (failed) {
    return {
      key: 'needs_attention',
      ...ORDER_HEALTH_META.needs_attention,
      reason: failed.error ?? undefined,
    };
  }

  if (order.syncStatus.some((s) => s.status === 'synced')) {
    return { key: 'synced', ...ORDER_HEALTH_META.synced };
  }

  return { key: 'awaiting_dispatch', ...ORDER_HEALTH_META.awaiting_dispatch };
}
