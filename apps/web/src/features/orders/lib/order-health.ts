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
 * The words live in `orders.orderHealth`. Each function takes the namespace,
 * defaulting to the active language, so a caller outside React need not pass it.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  isFulfillmentRollupState,
  isSlaState,
  type OrderRecord,
  type OrderHandledInOpenLinker,
  type OrderHealthValue,
  type OrderSyncStatus,
  type SlaStateValue,
  type FulfillmentRollupStateValue,
} from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import { getMessages, interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { resolveDestinationRoutingCopy } from './destination-routing';
import { isHandledInOpenLinker } from './handled-in-openlinker';

type OrdersCopy = ResolvedCopy<Messages['orders']>;

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

/** Tone per bucket. The label is `orders.orderHealth.badges[bucket]`. */
export const ORDER_HEALTH_TONE: Record<OrderHealthValue, StatusBadgeTone> = {
  source_deleted: 'error',
  awaiting_mapping: 'warning',
  needs_attention: 'error',
  synced: 'success',
  awaiting_dispatch: 'info',
};

function healthView(
  key: OrderHealthValue,
  copy: OrdersCopy,
  reason?: string
): OrderHealthView {
  const view: OrderHealthView = { key, label: copy.orderHealth.badges[key], tone: ORDER_HEALTH_TONE[key] };
  return reason === undefined ? view : { ...view, reason };
}

/**
 * Classify an order into exactly one health bucket. Pure function of the
 * record's own already-loaded fields - no I/O.
 */
export function deriveOrderHealth(
  order: OrderRecord,
  copy: OrdersCopy = getMessages('orders')
): OrderHealthView {
  if (order.recordStatus === 'source_deleted') {
    return healthView('source_deleted', copy, order.mappingFailureReason ?? undefined);
  }

  if (order.recordStatus === 'awaiting_mapping') {
    return healthView('awaiting_mapping', copy, order.mappingFailureReason ?? undefined);
  }

  const failed = order.syncStatus.find((s) => s.status === 'failed');
  if (failed) {
    return healthView('needs_attention', copy, failed.error ?? undefined);
  }

  if (order.syncStatus.some((s) => s.status === 'synced')) {
    return healthView('synced', copy);
  }

  // #3482 - an order OpenLinker handles itself has no destination rows, so it used
  // to stay `awaiting_dispatch` for ever, even after delivery. While it is on the
  // bench it IS awaiting dispatch; once it has shipped it is `synced`. Twin of
  // `OrderRecordRepository.IS_SYNCED_HEALTH` - change both.
  if (
    isHandledInOpenLinker(order) &&
    (order.fulfillmentState === 'dispatched' || order.fulfillmentState === 'delivered')
  ) {
    return healthView('synced', copy);
  }

  return healthView('awaiting_dispatch', copy);
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

export function healthLabel(
  level: OrderHealthLevel,
  /** An order OpenLinker handles itself has no destination rows by design (#3482). */
  handled?: OrderHandledInOpenLinker,
  copy: OrdersCopy = getMessages('orders')
): string {
  const levels = copy.orderHealth.levels;
  switch (level) {
    case 'attention':
      return levels.attention;
    case 'pending':
      return levels.pending;
    case 'healthy':
      return levels.healthy;
    case 'unknown':
      return isHandledInOpenLinker({ handledInOpenLinker: handled })
        ? copy.handledInOpenLinker.syncLabel
        : levels.noDestinations;
  }
}

/**
 * "1 of 1 failed" / "2 of 3 synced" — the headline for the Sync health cell.
 *
 * `destinationRoutingBlockReason` (#2703) is OPTIONAL and only ever consulted on
 * the empty rollup. That is the whole fix: an empty `syncStatus[]` used to mean
 * "No destinations" whether nothing was configured or a working router had
 * decided this order needs none, and an operator could not tell a router making
 * a decision from a configuration that was never set up — which is precisely the
 * distinction routing exists to make.
 *
 * The reason is READ from the persisted column the backend wrote, never inferred
 * from the rollup (#2100's rule). An unrecognised value falls through to the
 * original wording rather than rendering a confident wrong sentence.
 */
export function syncCellLabel(
  rollup: SyncRollup,
  destinationRoutingBlockReason?: string | null,
  handled?: OrderHandledInOpenLinker,
  copy: OrdersCopy = getMessages('orders')
): string {
  if (rollup.total === 0) {
    // Precedence (#3482): handled in OpenLinker (it has live pack-bench work) ->
    // a router that chose nobody (#2703) -> nothing configured. An order the
    // router sent nowhere has no work, so the first arm never shadows the second.
    if (isHandledInOpenLinker({ handledInOpenLinker: handled })) {
      return copy.handledInOpenLinker.syncLabel;
    }
    return (
      resolveDestinationRoutingCopy(destinationRoutingBlockReason, copy)?.label ??
      copy.orderHealth.levels.noDestinations
    );
  }
  const cell = copy.orderHealth.syncCell;
  if (rollup.failed > 0) return interpolate(cell.failed, { failed: rollup.failed, total: rollup.total });
  if (rollup.skipped > 0)
    return interpolate(cell.syncedSkipped, {
      synced: rollup.synced,
      total: rollup.total,
      skipped: rollup.skipped,
    });
  return interpolate(cell.synced, { synced: rollup.synced, total: rollup.total });
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
 * **Twin (#1108, precedence revised #2727):** the BE `deriveFulfillmentRollup`
 * (`libs/core/src/shipping/domain/fulfillment-rollup.ts`) encodes the same
 * STATUS precedence to populate `order.fulfillmentState` (which the list reads
 * directly). Keep both in lockstep if the precedence changes; `unavailable`
 * is a FE-only render state that the BE rollup never produces.
 *
 * **The twin is deliberately ASYMMETRIC.** #2727 gave the BE rollup a second,
 * quantity-based half: a delivered order whose `shipment_lines` coverage falls
 * short of what it ordered is demoted to `dispatched`. That half is BE-only
 * because this function has no quantity input — it is handed shipment statuses
 * and nothing else. Only the status half is mirrored here, and the asymmetry is
 * intended rather than drift.
 */
export function deriveFulfillment(
  shipmentStatuses: readonly string[] | null,
  hasShippingCapability: boolean
): FulfillmentState {
  if (!hasShippingCapability) return 'unavailable';
  if (!shipmentStatuses || shipmentStatuses.length === 0) return 'not-shipped';
  // #2727: an in-progress parcel OUTRANKS a delivered sibling. This clause moved
  // above the `delivered` test; before that, an order with one parcel delivered
  // and one still in transit reported as fully delivered.
  if (shipmentStatuses.some((s) => s === 'dispatched' || s === 'in-transit' || s === 'generated')) {
    return 'dispatched';
  }
  if (shipmentStatuses.includes('delivered')) return 'delivered';
  if (shipmentStatuses.every((s) => s === 'failed' || s === 'cancelled')) return 'failed';
  return 'not-shipped';
}

export function fulfillmentLabel(
  state: FulfillmentState,
  copy: OrdersCopy = getMessages('orders')
): string {
  return copy.orderHealth.fulfilment[state];
}

/** Sum of item quantities — the "M unit" half of the header summary line. */
export function totalUnits(items: readonly { quantity: number }[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

// ── Ship-by SLA + fulfillment-rollup badges (#1108) ─────────────────────────
// The BE owns `slaState` + `fulfillmentState` (single source of truth); these
// maps only choose label + tone. Colour is never the only signal — paired with
// the badge label (StatusBadge enforces dot + text).

/**
 * Tone per ship-by SLA bucket; the label is `orders.orderHealth.sla[bucket]`.
 * `none` renders nothing (no affordance).
 */
export const ORDER_SLA_TONE: Record<Exclude<SlaStateValue, 'none'>, StatusBadgeTone> = {
  overdue: 'error',
  at_risk: 'warning',
  on_track: 'success',
};

/**
 * Resolve the SLA badge for an order, or `null` when there's nothing to show
 * (`none` — no deadline or already shipped). Reads the BE-owned `slaState`; the
 * FE never re-derives the bucket.
 */
export function slaBadge(
  slaState: string | null | undefined,
  copy: OrdersCopy = getMessages('orders')
): { label: string; tone: StatusBadgeTone } | null {
  // Only ABSENT short-circuits. An empty string is a value the backend sent and
  // this build cannot read, so it must reach `unknownStateBadge` exactly as it
  // does in `fulfillmentBadge` — `!slaState` would have swallowed it into the
  // same answer as `none`, which means "no badge, nothing is wrong".
  if (slaState === null || slaState === undefined) return null;
  // Membership is established BEFORE the `none` check, not after: `none` is a
  // MEMBER of the union (meaning "no deadline, or already shipped"), so testing
  // it first would conflate "the backend said none" with "the backend said
  // something this build cannot read" — two different facts with two different
  // right answers. It also re-widens the type past the narrowing, which is how
  // the compiler found this.
  if (!isSlaState(slaState)) return unknownStateBadge(slaState, copy);
  if (slaState === 'none') return null;
  return { label: copy.orderHealth.sla[slaState], tone: ORDER_SLA_TONE[slaState] };
}

/**
 * Tone per fulfillment-rollup value, for the list/detail row badge; the label is
 * `orders.orderHealth.fulfilment[value]`.
 */
export const ORDER_FULFILLMENT_TONE: Record<FulfillmentRollupStateValue, StatusBadgeTone> = {
  'not-shipped': 'neutral',
  dispatched: 'info',
  delivered: 'success',
  failed: 'error',
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
export function fulfillmentBadge(
  state: string | null | undefined,
  copy: OrdersCopy = getMessages('orders')
): {
  label: string;
  tone: StatusBadgeTone;
} {
  const view = (known: FulfillmentRollupStateValue): { label: string; tone: StatusBadgeTone } => ({
    label: copy.orderHealth.fulfilment[known],
    tone: ORDER_FULFILLMENT_TONE[known],
  });
  if (state === null || state === undefined) return view('not-shipped');
  if (!isFulfillmentRollupState(state)) return unknownStateBadge(state, copy);
  return view(state);
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
function unknownStateBadge(
  raw: string,
  copy: OrdersCopy
): { label: string; tone: StatusBadgeTone } {
  // A blank or whitespace-only value is still unreadable, but naming it is
  // impossible — `Unknown ()` claims to quote the offending value and quotes
  // nothing. Say only what is true: this build cannot read the state.
  const trimmed = raw.trim();
  if (trimmed === '') return { label: copy.orderHealth.unknown, tone: 'neutral' };
  const shown =
    trimmed.length > UNKNOWN_STATE_MAX_CHARS
      ? `${trimmed.slice(0, UNKNOWN_STATE_MAX_CHARS - 1)}…`
      : trimmed;
  return { label: interpolate(copy.orderHealth.unknownValue, { value: shown }), tone: 'neutral' };
}
