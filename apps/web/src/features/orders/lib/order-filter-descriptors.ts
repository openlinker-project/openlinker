/**
 * Orders list filter descriptors (#3507)
 *
 * The single table every orders-list filter is described by: which URL param
 * carries it, which panel group it belongs to, and how its current value reads
 * as an active-filter chip ("Source: Allegro"). Keyed by
 * `NarrowingOrderFilterKey` through a `Record`, so adding a key to
 * `OrderFilters` without a descriptor is a COMPILE error — a new filter cannot
 * ship without its chip, its group, its "Clear all" coverage and its line in
 * the export dialog's scope description (the #2148 technique, extended).
 *
 * Also owns the URL ↔ state parsing the page used to do inline: the URL
 * contract is unchanged (same params, same values), with one widening —
 * `packed` now accepts `false` ("Not packed yet", M4 `packed`), which the API
 * already took.
 *
 * Pure: no React, no I/O.
 *
 * @module apps/web/src/features/orders/lib
 */
import {
  FulfillmentRollupStateValues,
  OrderHealthValues,
  SlaStateValues,
  type FulfillmentRollupStateValue,
  type OrderFilters,
  type OrderHealthValue,
  type OrderTag,
  type SlaStateValue,
} from '../api/orders.types';
import { interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { holdReasonLabel, isHoldReason, type HoldReason } from './order-hold.types';
import { isOrderLifecyclePhase } from './order-lifecycle-phase';
import type { OrderLifecyclePhaseValue } from './order-lifecycle-phase.types';

type OrdersCopy = ResolvedCopy<Messages['orders']>;

/** Ship-by SLA buckets offered as a filter - `none` is not a triage state (#1108). */
export const SLA_FILTER_VALUES: readonly Exclude<SlaStateValue, 'none'>[] = [
  'overdue',
  'at_risk',
  'on_track',
];

/** Fulfilment rollup values offered as a filter (#1108), labelled from `listFilters.fulfilmentOptions`. */
export const FULFILLMENT_FILTER_VALUES: readonly FulfillmentRollupStateValue[] = [
  'not-shipped',
  'dispatched',
  'delivered',
  'failed',
];

/**
 * Every `OrderFilters` key this list can narrow by.
 *
 * Excluded deliberately: `sort` / `dir` change presentation, not membership;
 * `syncStatus` / `customerId` / `recordStatus` / `cancelled` are query-only
 * filters this page exposes no control for (the dispatch-risk page pins
 * `cancelled`).
 */
export type NarrowingOrderFilterKey = Exclude<
  keyof OrderFilters,
  'sort' | 'dir' | 'syncStatus' | 'customerId' | 'recordStatus' | 'cancelled'
>;

/**
 * Where a filter lives in the UI. `search`, `health` and `phase` own a visible
 * control of their own (the search box, the KPI cards, the phase chips), so
 * they are neither counted in "Filters (n)" nor repeated as an active chip.
 */
export type OrderFilterGroup =
  | 'search'
  | 'health'
  | 'phase'
  | 'source'
  | 'shipment'
  | 'exceptions'
  | 'tags';

const UNCOUNTED_GROUPS: ReadonlySet<OrderFilterGroup> = new Set(['search', 'health', 'phase']);

/** The parsed, URL-level filter state — calendar dates stay `YYYY-MM-DD`. */
export interface OrderListFilterState {
  health?: OrderHealthValue;
  sourceConnectionId?: string;
  createdFrom?: string;
  createdTo?: string;
  /** `?due=breaching` — "ship-by ≤ 24h or overdue". */
  breaching: boolean;
  slaState?: SlaStateValue;
  fulfillmentState?: FulfillmentRollupStateValue;
  invoicingBlocked: boolean;
  /** `?routing=blocked` — a routing decision narrowed the destination fan-out (#2703/#2704). */
  routingBlocked: boolean;
  /** `?waiting=true` - OpenLinker holds the order as waiting (#3482). */
  waitingInOpenLinker: boolean;
  /** `?packBench=true` - the order has work on the pack bench, box not shut (#3482). */
  onPackBench: boolean;
  phase?: OrderLifecyclePhaseValue;
  rateConflict: boolean;
  holdReason?: HoldReason;
  omsAttention: boolean;
  /** #3961 - only orders the shop changed after packing started, waiting for a decision. */
  shopChanged: boolean;
  /** `true` packed only, `false` not packed yet, `undefined` any. */
  packed?: boolean;
  openReturn: boolean;
  /** `?hasBuyerNote=true` - only orders whose source reported a note (#3539). */
  hasBuyerNote: boolean;
  tag?: string;
  untagged: boolean;
  /** The URL value (updates every keystroke); the query uses a debounced copy. */
  search: string;
}

/** What a chip needs from outside this module to name a value. */
export interface OrderFilterChipContext {
  connectionName: (connectionId: string) => string | undefined;
  tagById: (tagId: string) => OrderTag | undefined;
  /** `YYYY-MM-DD` → a short human date in the active locale. */
  formatDay: (ymd: string) => string;
  /** The `orders` namespace in the active language - every chip word comes from it. */
  copy: OrdersCopy;
}

export interface OrderFilterChipSpec {
  label: string;
  valueText: string;
  /** Present for the tag chip, which renders the tag pill as its value. */
  tag?: OrderTag;
  /** Keys removed together when this chip is removed (one URL write). */
  clears: readonly NarrowingOrderFilterKey[];
}

export interface OrderFilterDescriptor {
  /** The URL search param — the existing contract, unchanged. */
  param: string;
  group: OrderFilterGroup;
  /** Analytics name for `demo_orders_filtered` (#1788). */
  analyticsName: string;
  /** Is this key currently narrowing? */
  isActive: (state: OrderListFilterState) => boolean;
  /** The chip for the current value, or `null` when inactive / folded into a sibling chip. */
  chip: (state: OrderListFilterState, ctx: OrderFilterChipContext) => OrderFilterChipSpec | null;
}

function single(
  key: NarrowingOrderFilterKey,
  label: string,
  valueText: string | null,
): OrderFilterChipSpec | null {
  return valueText === null ? null : { label, valueText, clears: [key] };
}

export const ORDER_FILTER_DESCRIPTORS: Record<NarrowingOrderFilterKey, OrderFilterDescriptor> = {
  search: {
    param: 'search',
    group: 'search',
    analyticsName: 'search',
    isActive: (s) => s.search.trim().length > 0,
    chip: (s, ctx) =>
      single('search', ctx.copy.listFilters.chips.search, s.search.trim() ? interpolate(ctx.copy.listFilters.chips.searchValue, { query: s.search.trim() }) : null),
  },
  health: {
    param: 'health',
    group: 'health',
    analyticsName: 'health',
    isActive: (s) => s.health !== undefined,
    chip: (s, ctx) => single('health', ctx.copy.listFilters.chips.health, s.health ? ctx.copy.listFilters.healthLabels[s.health] : null),
  },
  phase: {
    param: 'phase',
    group: 'phase',
    analyticsName: 'phase',
    isActive: (s) => s.phase !== undefined,
    chip: (s, ctx) =>
      single('phase', ctx.copy.listFilters.chips.phase, s.phase ? ctx.copy.lifecyclePhase.labels[s.phase] : null),
  },
  sourceConnectionId: {
    param: 'sourceConnectionId',
    group: 'source',
    analyticsName: 'source',
    isActive: (s) => Boolean(s.sourceConnectionId),
    chip: (s, ctx) =>
      s.sourceConnectionId
        ? single(
            'sourceConnectionId',
            ctx.copy.listFilters.chips.source,
            ctx.connectionName(s.sourceConnectionId) ?? ctx.copy.listFilters.chips.unknownSource,
          )
        : null,
  },
  // The two date bounds read as ONE chip ("Created 1 Sep – 25 Sep 2026") and
  // are removed together; `createdTo` only renders its own chip when there is
  // no lower bound to fold into.
  createdFrom: {
    param: 'createdFrom',
    group: 'source',
    analyticsName: 'created_from',
    isActive: (s) => Boolean(s.createdFrom),
    chip: (s, ctx) => {
      if (!s.createdFrom) return null;
      const valueText = s.createdTo
        ? interpolate(ctx.copy.listFilters.chips.createdRange, {
            from: ctx.formatDay(s.createdFrom),
            to: ctx.formatDay(s.createdTo),
          })
        : interpolate(ctx.copy.listFilters.chips.createdFrom, { date: ctx.formatDay(s.createdFrom) });
      return { label: ctx.copy.listFilters.chips.created, valueText, clears: ['createdFrom', 'createdTo'] };
    },
  },
  createdTo: {
    param: 'createdTo',
    group: 'source',
    analyticsName: 'created_to',
    isActive: (s) => Boolean(s.createdTo),
    chip: (s, ctx) =>
      s.createdTo && !s.createdFrom
        ? single('createdTo', ctx.copy.listFilters.chips.created, interpolate(ctx.copy.listFilters.chips.createdTo, { date: ctx.formatDay(s.createdTo) }))
        : null,
  },
  dueBefore: {
    param: 'due',
    group: 'shipment',
    analyticsName: 'sla_breaching',
    isActive: (s) => s.breaching,
    chip: (s, ctx) => single('dueBefore', ctx.copy.listFilters.chips.due, s.breaching ? ctx.copy.listFilters.chips.dueValue : null),
  },
  slaState: {
    param: 'slaState',
    group: 'shipment',
    analyticsName: 'sla_state',
    isActive: (s) => s.slaState !== undefined,
    chip: (s, ctx) =>
      single(
        'slaState',
        ctx.copy.listFilters.chips.shipBy,
        s.slaState === undefined
          ? null
          : s.slaState === 'none'
            ? s.slaState
            : ctx.copy.listFilters.slaOptions[s.slaState],
      ),
  },
  fulfillmentState: {
    param: 'fulfillmentState',
    group: 'shipment',
    analyticsName: 'fulfillment_state',
    isActive: (s) => s.fulfillmentState !== undefined,
    chip: (s, ctx) =>
      single(
        'fulfillmentState',
        ctx.copy.listFilters.chips.fulfilment,
        s.fulfillmentState ? ctx.copy.listFilters.fulfilmentOptions[s.fulfillmentState] : null,
      ),
  },
  packed: {
    param: 'packed',
    group: 'shipment',
    analyticsName: 'packed',
    isActive: (s) => s.packed !== undefined,
    chip: (s, ctx) =>
      single(
        'packed',
        ctx.copy.listFilters.chips.packing,
        s.packed === undefined ? null : s.packed ? ctx.copy.listFilters.packedYes : ctx.copy.listFilters.packedNo,
      ),
  },
  holdReason: {
    param: 'hold',
    group: 'exceptions',
    analyticsName: 'hold_reason',
    isActive: (s) => s.holdReason !== undefined,
    chip: (s, ctx) =>
      single('holdReason', ctx.copy.listFilters.chips.hold, s.holdReason ? holdReasonLabel(s.holdReason) : null),
  },
  salesDocumentBlocked: {
    param: 'invoicing',
    group: 'exceptions',
    analyticsName: 'invoicing_blocked',
    isActive: (s) => s.invoicingBlocked,
    chip: (s, ctx) =>
      single('salesDocumentBlocked', ctx.copy.listFilters.chips.salesDocs, s.invoicingBlocked ? ctx.copy.listFilters.chips.blocked : null),
  },
  attention: {
    param: 'attention',
    group: 'exceptions',
    analyticsName: 'oms_attention',
    isActive: (s) => s.omsAttention,
    chip: (s, ctx) => single('attention', ctx.copy.listFilters.chips.oms, s.omsAttention ? ctx.copy.listFilters.chips.stopped : null),
  },
  attentionReason: {
    param: 'attentionReason',
    group: 'exceptions',
    analyticsName: 'shop_changed',
    isActive: (s) => s.shopChanged,
    chip: (s, ctx) =>
      single(
        'attentionReason',
        ctx.copy.listFilters.chips.shopChanged,
        s.shopChanged ? ctx.copy.listFilters.chips.shopChangedValue : null
      ),
  },
  waitingInOpenLinker: {
    param: 'waiting',
    group: 'exceptions',
    analyticsName: 'waiting_in_openlinker',
    isActive: (s) => s.waitingInOpenLinker,
    chip: (s, ctx) =>
      single('waitingInOpenLinker', ctx.copy.listFilters.chips.waiting, s.waitingInOpenLinker ? ctx.copy.listFilters.chips.waitingValue : null),
  },
  onPackBench: {
    param: 'packBench',
    group: 'shipment',
    analyticsName: 'on_pack_bench',
    isActive: (s) => s.onPackBench,
    chip: (s, ctx) => single('onPackBench', ctx.copy.listFilters.chips.packBench, s.onPackBench ? ctx.copy.listFilters.chips.packBenchValue : null),
  },
  destinationRoutingBlocked: {
    param: 'routing',
    group: 'exceptions',
    analyticsName: 'destination_routing_blocked',
    isActive: (s) => s.routingBlocked,
    chip: (s, ctx) =>
      single('destinationRoutingBlocked', ctx.copy.listFilters.chips.routing, s.routingBlocked ? ctx.copy.listFilters.chips.blocked : null),
  },
  taxRateConflict: {
    param: 'taxRate',
    group: 'exceptions',
    analyticsName: 'tax_rate_conflict',
    isActive: (s) => s.rateConflict,
    chip: (s, ctx) => single('taxRateConflict', ctx.copy.listFilters.chips.taxRate, s.rateConflict ? ctx.copy.listFilters.chips.conflict : null),
  },
  openReturn: {
    param: 'openReturn',
    group: 'exceptions',
    analyticsName: 'open_return',
    isActive: (s) => s.openReturn,
    chip: (s, ctx) => single('openReturn', ctx.copy.listFilters.chips.return, s.openReturn ? ctx.copy.listFilters.chips.open : null),
  },
  hasBuyerNote: {
    param: 'hasBuyerNote',
    group: 'exceptions',
    analyticsName: 'has_buyer_note',
    isActive: (s) => s.hasBuyerNote,
    chip: (s, ctx) =>
      single('hasBuyerNote', ctx.copy.listFilters.chips.buyerNote, s.hasBuyerNote ? ctx.copy.listFilters.chips.buyerNoteValue : null),
  },
  // `tag` and `untagged` are mutually exclusive by convention; removing either
  // chip clears BOTH params in one write so a stale pair can never survive.
  tag: {
    param: 'tag',
    group: 'tags',
    analyticsName: 'tag',
    isActive: (s) => Boolean(s.tag),
    chip: (s, ctx) => {
      if (!s.tag) return null;
      const tag = ctx.tagById(s.tag);
      return {
        label: ctx.copy.listFilters.chips.tag,
        valueText: tag?.name ?? ctx.copy.listFilters.chips.unknownTag,
        tag,
        clears: ['tag', 'untagged'],
      };
    },
  },
  untagged: {
    param: 'untagged',
    group: 'tags',
    analyticsName: 'untagged',
    isActive: (s) => s.untagged,
    chip: (s, ctx) =>
      s.untagged && !s.tag
        ? { label: ctx.copy.listFilters.chips.tag, valueText: ctx.copy.listFilters.tags.none, clears: ['tag', 'untagged'] }
        : null,
  },
};

export const NARROWING_ORDER_FILTER_KEYS = Object.keys(
  ORDER_FILTER_DESCRIPTORS,
) as NarrowingOrderFilterKey[];

/** Every URL param that narrows the result set — derived, never hand-listed (#2148). */
export const ORDER_FILTER_PARAMS: readonly string[] = NARROWING_ORDER_FILTER_KEYS.map(
  (key) => ORDER_FILTER_DESCRIPTORS[key].param,
);

/** Is this key counted in "Filters (n)" and shown as a removable chip? */
export function isCountedFilter(key: NarrowingOrderFilterKey): boolean {
  return !UNCOUNTED_GROUPS.has(ORDER_FILTER_DESCRIPTORS[key].group);
}

function pick<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/**
 * Read the filter state from the URL. Unrecognised enum values fall back to
 * "unfiltered" rather than passing through: the server would reject them, and
 * an operator with a stale bookmark should see their orders, not an error.
 */
/** The one attention reason the "Changed by the shop" filter narrows to (#3961). */
const SHOP_CHANGED_REASON = 'source-change-unapplied';

export function parseOrderListFilterState(params: URLSearchParams): OrderListFilterState {
  const rawPhase = params.get('phase');
  const rawHold = params.get('hold');
  const rawPacked = params.get('packed');
  return {
    health: pick(OrderHealthValues, params.get('health')),
    sourceConnectionId: params.get('sourceConnectionId') || undefined,
    createdFrom: params.get('createdFrom') || undefined,
    createdTo: params.get('createdTo') || undefined,
    breaching: params.get('due') === 'breaching',
    slaState: pick(SlaStateValues, params.get('slaState')),
    fulfillmentState: pick(FulfillmentRollupStateValues, params.get('fulfillmentState')),
    invoicingBlocked: params.get('invoicing') === 'blocked',
    routingBlocked: params.get('routing') === 'blocked',
    waitingInOpenLinker: params.get('waiting') === 'true',
    onPackBench: params.get('packBench') === 'true',
    phase: isOrderLifecyclePhase(rawPhase) ? rawPhase : undefined,
    rateConflict: params.get('taxRate') === 'conflict',
    holdReason: isHoldReason(rawHold) ? rawHold : undefined,
    omsAttention: params.get('attention') === 'true',
    shopChanged: params.get('attentionReason') === SHOP_CHANGED_REASON,
    packed: rawPacked === 'true' ? true : rawPacked === 'false' ? false : undefined,
    openReturn: params.get('openReturn') === 'true',
    hasBuyerNote: params.get('hasBuyerNote') === 'true',
    tag: params.get('tag') || undefined,
    untagged: params.get('untagged') === 'true',
    search: params.get('search') ?? '',
  };
}

/**
 * The present-only toggles and the value each writes. The URL never carries
 * their inverse (`invoicing=false` etc.) — "hide blocked orders" is not
 * something the UI offers.
 */
export const ORDER_TOGGLE_FILTER_VALUES = {
  dueBefore: 'breaching',
  salesDocumentBlocked: 'blocked',
  destinationRoutingBlocked: 'blocked',
  waitingInOpenLinker: 'true',
  onPackBench: 'true',
  taxRateConflict: 'conflict',
  attention: 'true',
  attentionReason: 'source-change-unapplied',
  openReturn: 'true',
  hasBuyerNote: 'true',
} as const satisfies Partial<Record<NarrowingOrderFilterKey, string>>;

export type OrderToggleFilterKey = keyof typeof ORDER_TOGGLE_FILTER_VALUES;

/** Build the query's `OrderFilters` (without sort/dir) from the URL state. */
export function toOrderQueryFilters(
  state: OrderListFilterState,
  derived: { dueBefore: string | undefined; search: string },
): Omit<OrderFilters, 'sort' | 'dir'> {
  return {
    health: state.health,
    sourceConnectionId: state.sourceConnectionId,
    // Calendar days in the URL widen to start/end-of-day UTC instants only
    // here, so the `createdTo` bound is inclusive of that day.
    createdFrom: state.createdFrom ? `${state.createdFrom}T00:00:00.000Z` : undefined,
    createdTo: state.createdTo ? `${state.createdTo}T23:59:59.999Z` : undefined,
    dueBefore: derived.dueBefore,
    slaState: state.slaState,
    fulfillmentState: state.fulfillmentState,
    salesDocumentBlocked: state.invoicingBlocked ? true : undefined,
    destinationRoutingBlocked: state.routingBlocked ? true : undefined,
    waitingInOpenLinker: state.waitingInOpenLinker ? true : undefined,
    onPackBench: state.onPackBench ? true : undefined,
    phase: state.phase,
    taxRateConflict: state.rateConflict ? true : undefined,
    holdReason: state.holdReason,
    attention: state.omsAttention ? true : undefined,
    attentionReason: state.shopChanged ? SHOP_CHANGED_REASON : undefined,
    packed: state.packed,
    search: derived.search || undefined,
    openReturn: state.openReturn ? true : undefined,
    hasBuyerNote: state.hasBuyerNote ? true : undefined,
    tag: state.tag,
    untagged: state.untagged ? true : undefined,
  };
}

/** The keys narrowing the set right now, in descriptor order. */
export function activeOrderFilterKeys(state: OrderListFilterState): NarrowingOrderFilterKey[] {
  return NARROWING_ORDER_FILTER_KEYS.filter((key) => ORDER_FILTER_DESCRIPTORS[key].isActive(state));
}

/** Chip specs for every counted, active filter (folded pairs produce one chip). */
export function buildOrderFilterChips(
  state: OrderListFilterState,
  ctx: OrderFilterChipContext,
  options: { includeUncounted?: boolean } = {},
): Array<OrderFilterChipSpec & { key: NarrowingOrderFilterKey }> {
  const out: Array<OrderFilterChipSpec & { key: NarrowingOrderFilterKey }> = [];
  for (const key of NARROWING_ORDER_FILTER_KEYS) {
    if (!options.includeUncounted && !isCountedFilter(key)) continue;
    const spec = ORDER_FILTER_DESCRIPTORS[key].chip(state, ctx);
    if (spec) out.push({ ...spec, key });
  }
  return out;
}

/**
 * One line describing the current view, every narrowing axis included —
 * "Status Needs attention · Source Allegro · Created 1 Sep – 25 Sep 2026".
 * The export dialog's "Current view" card and the filtered empty state read
 * this, so they name exactly what the chips name. Empty string = unfiltered.
 */
export function describeOrderFilterScope(
  state: OrderListFilterState,
  ctx: OrderFilterChipContext,
): string {
  return buildOrderFilterChips(state, ctx, { includeUncounted: true })
    .map((chip) =>
      interpolate(ctx.copy.listFilters.scopeItem, { label: chip.label, value: chip.valueText }),
    )
    .join(' · ');
}

/** Count the chips a "Filters (n)" badge reports — the same set the chip row shows. */
export function countActiveOrderFilters(
  state: OrderListFilterState,
  ctx: OrderFilterChipContext,
): number {
  return buildOrderFilterChips(state, ctx).length;
}
