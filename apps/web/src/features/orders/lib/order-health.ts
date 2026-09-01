/**
 * Order Health Derivations
 *
 * Pure, framework-free view-model helpers that derive an order's operator-facing
 * health from data already on the `OrderRecord`. Kept out of the page/components
 * so the rules are unit-testable in isolation.
 *
 * Two complementary models live here:
 * — The **list-row classification** (`deriveOrderHealth`, #929): one reconciled
 *   bucket per order, the FE twin of the SQL in `OrderRecordRepository`.
 * — The **detail-header rollup** (`rollupSyncStatus` / `deriveHealthLevel` /
 *   `deriveFulfillment` …, #924/#930): per-destination counts + fulfillment
 *   state for the single-order header.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  isFulfillmentRollupState,
  isSlaState,
  type OrderRecord,
  type OrderHealthValue,
  type OrderSyncStatus,
  type SlaStateValue,
  type FulfillmentRollupStateValue,
} from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

// ── List-row health classification (#929) ──────────────────────────────────
// CANONICAL PRECEDENCE (highest wins) — single FE source of truth and the twin
// of the SQL in `OrderRecordRepository.countByHealth` / `applyHealthFilter`;
// keep both in lockstep:
//   1. source_deleted    — recordStatus = 'source_deleted' (permanently
//                          unresolvable — deleted at the master, #1689)
//   2. awaiting_mapping  — recordStatus = 'awaiting_mapping' (can't sync yet)
//   3. needs_attention   — not awaiting_mapping/source_deleted AND any destination failed
//   4. synced            — not awaiting_mapping/source_deleted, no failed, AND any synced
//   5. awaiting_dispatch — the residual (no failed, no synced)

export interface OrderHealthView {
  key: OrderHealthValue;
  tone: StatusBadgeTone;
  /** Row-badge label. */
  label: string;
  /**
   * Plain-language cause. Present for `needs_attention` (destination sync
   * error), and for `source_deleted` / `awaiting_mapping` (#1689) when the
   * BE supplied `mappingFailureReason`.
   */
  reason?: string;
}

/** Static label + tone per bucket. Shared by the row badge and the KPI segments. */
export const ORDER_HEALTH_META: Record<OrderHealthValue, { label: string; tone: StatusBadgeTone }> =
  {
    source_deleted: { label: 'Source deleted', tone: 'error' },
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
  if (order.recordStatus === 'source_deleted') {
    return {
      key: 'source_deleted',
      ...ORDER_HEALTH_META.source_deleted,
      reason: order.mappingFailureReason ?? undefined,
    };
  }

  if (order.recordStatus === 'awaiting_mapping') {
    return {
      key: 'awaiting_mapping',
      ...ORDER_HEALTH_META.awaiting_mapping,
      reason: order.mappingFailureReason ?? undefined,
    };
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

// ── Detail-header rollup + fulfillment (#924/#930) ──────────────────────────

export interface SyncRollup {
  total: number;
  failed: number;
  synced: number;
  /** pending + syncing — anything not yet terminal. */
  pending: number;
  /**
   * `skipped_cancelled` (#2284) — terminal, and neither a failure nor
   * outstanding work: the source cancelled the order before any destination
   * order existed, so provisioning was deliberately withheld. Counted on its own
   * so it can never inflate `failed` (it is not an error) or `pending` (it would
   * leave the order reading as stuck forever).
   */
  skipped: number;
}

export function rollupSyncStatus(syncStatus: readonly OrderSyncStatus[]): SyncRollup {
  let failed = 0;
  let synced = 0;
  let pending = 0;
  let skipped = 0;
  for (const s of syncStatus) {
    if (s.status === 'failed') failed += 1;
    else if (s.status === 'synced') synced += 1;
    // Explicit branch on purpose: the catch-all `else` below is not
    // compiler-guarded, so a widened union would silently land here and be
    // counted as pending.
    else if (s.status === 'skipped_cancelled') skipped += 1;
    else pending += 1;
  }
  return { total: syncStatus.length, failed, synced, pending, skipped };
}

export const OrderHealthLevelValues = ['attention', 'pending', 'healthy', 'unknown'] as const;
export type OrderHealthLevel = (typeof OrderHealthLevelValues)[number];

/**
 * A `skipped_cancelled`-only order resolves to `'healthy'`: it is terminal with
 * no outstanding work and nothing failed (#2284). The health PARTITION is
 * deliberately unchanged — a dedicated bucket would need the SQL twin plus the
 * list KPI cards, which is out of scope.
 */
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
  if (rollup.skipped > 0)
    return `${rollup.synced} of ${rollup.total} synced (${rollup.skipped} skipped)`;
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
 *
 * **Twin (#1108):** the BE `deriveFulfillmentRollup`
 * (`libs/core/src/shipping/domain/fulfillment-rollup.ts`) encodes the same
 * precedence to populate `order.fulfillmentState` (which the list reads
 * directly). Keep both in lockstep if the precedence changes; `unavailable`
 * is a FE-only render state that the BE rollup never produces.
 */
export function deriveFulfillment(
  shipmentStatuses: readonly string[] | null,
  hasShippingCapability: boolean
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

// ── Ship-by SLA + fulfillment-rollup badges (#1108) ─────────────────────────
// The BE owns `slaState` + `fulfillmentState` (single source of truth); these
// maps only choose label + tone. Colour is never the only signal — paired with
// the badge label (StatusBadge enforces dot + text).

/** Label + tone per ship-by SLA bucket. `none` renders nothing (no affordance). */
export const ORDER_SLA_META: Record<
  Exclude<SlaStateValue, 'none'>,
  { label: string; tone: StatusBadgeTone }
> = {
  overdue: { label: 'Overdue', tone: 'error' },
  at_risk: { label: 'At risk', tone: 'warning' },
  on_track: { label: 'On track', tone: 'success' },
};

/**
 * Resolve the SLA badge for an order, or `null` when there's nothing to show
 * (`none` — no deadline or already shipped). Reads the BE-owned `slaState`; the
 * FE never re-derives the bucket.
 */
export function slaBadge(
  slaState: string | null | undefined
): { label: string; tone: StatusBadgeTone } | null {
  if (!slaState) return null;
  // Membership is established BEFORE the `none` check, not after: `none` is a
  // MEMBER of the union (meaning "no deadline, or already shipped"), so testing
  // it first would conflate "the backend said none" with "the backend said
  // something this build cannot read" — two different facts with two different
  // right answers. It also re-widens the type past the narrowing, which is how
  // the compiler found this.
  if (!isSlaState(slaState)) return unknownStateBadge(slaState);
  if (slaState === 'none') return null;
  return ORDER_SLA_META[slaState];
}

/** Label + tone per fulfillment-rollup value, for the list/detail row badge. */
export const ORDER_FULFILLMENT_META: Record<
  FulfillmentRollupStateValue,
  { label: string; tone: StatusBadgeTone }
> = {
  'not-shipped': { label: 'Not shipped', tone: 'neutral' },
  dispatched: { label: 'Dispatched', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  failed: { label: 'Dispatch failed', tone: 'error' },
};

/**
 * Fulfillment badge for an order row. NULL/absent ≡ `not-shipped` — that is a
 * real backend contract, not a fallback.
 *
 * An UNRECOGNISED value is a different case and gets a different answer
 * (#2678). The parameter is typed `string` rather than the union because that
 * is what actually arrives: `GET /orders` is not schema-parsed anywhere in
 * `features/orders/api/`, so the declared union is a claim about the wire, not
 * a guarantee about it. A rolling deploy, a stale bundle or a replayed cached
 * response can all put a value here that this build does not know.
 *
 * Before this it was `ORDER_FULFILLMENT_META[state ?? 'not-shipped']`, which
 * returned `undefined`, and all three call sites read `.tone` off it
 * immediately — inside a `DataTable` cell renderer, so the throw unmounted the
 * whole `/orders` page rather than one cell.
 *
 * Two fixes were rejected. Coalescing to `not-shipped` would render "Not
 * shipped" about an order whose state this build cannot name — a quiet lie
 * about the operator's own data, and worse than the crash it replaces.
 * Returning `null` would render nothing, which reads as a row that simply has
 * no fulfilment fact. So the value is surfaced verbatim in a neutral badge, the
 * way an unrecognised marketplace code is surfaced rather than dropped (#2231).
 */
export function fulfillmentBadge(state: string | null | undefined): {
  label: string;
  tone: StatusBadgeTone;
} {
  if (state === null || state === undefined) return ORDER_FULFILLMENT_META['not-shipped'];
  if (!isFulfillmentRollupState(state)) return unknownStateBadge(state);
  return ORDER_FULFILLMENT_META[state];
}

/**
 * How long an unrecognised raw value may be inside a status pill. A status pill
 * is budgeted at ~17 characters (see `frontend-ui-style-guide.md` § Order-row
 * signal placement), and `Unknown ()` already spends 10 of them. A real enum
 * member is short, so this only bites a pathological value — where legibility
 * of the row beats the budget anyway.
 */
const UNKNOWN_STATE_MAX_CHARS = 16;

/**
 * The one shared shape for "the backend said something this build does not
 * know". Shared by `slaBadge` and `fulfillmentBadge` so the two cannot drift
 * into describing the same condition differently.
 *
 * `neutral`, never a status tone: OL has no idea whether this state is good or
 * bad, and picking a tone would assert one.
 */
function unknownStateBadge(raw: string): { label: string; tone: StatusBadgeTone } {
  const shown =
    raw.length > UNKNOWN_STATE_MAX_CHARS ? `${raw.slice(0, UNKNOWN_STATE_MAX_CHARS - 1)}…` : raw;
  return { label: `Unknown (${shown})`, tone: 'neutral' };
}
