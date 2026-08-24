/**
 * Orders List Page
 *
 * Operator triage queue for the orders backbone (#778, redesigned #929;
 * filter/sort bar + identity-cell fixes #939). Composes:
 * — status segments (5 clickable `MetricCard`s backed by the single
 *   `/orders/status-summary` count endpoint) that **partition** the order set,
 *   so the counts sum to the total and double as the `health` URL-state filter;
 * — a filter/sort bar (#939) — source-connection, created-date range, and sort
 *   controls, all URL-state-backed (mirrors the connections-list toolbar);
 * — a dense `DataTable` whose rows lead with human identity — the shared
 *   `OrderIdentityCell` since #2091, so this page, Shipments and Invoices answer
 *   "which order is this row?" with one renderer instead of three (#1996) —
 *   surface customer + contents (parsed from `orderSnapshot`, with an email
 *   fallback when the source omits a buyer name — #939), the source→destination
 *   channel, one reconciled health `StatusBadge` (`deriveOrderHealth`, replacing
 *   the per-destination list and the blank "—"), a "Created" time, a **Ship-by**
 *   SLA countdown (#927; server-sorted soonest-first, with a
 *   "breaching ≤24h / overdue" filter chip), a ghost Payment column (#928), and
 *   an inline Retry for failed rows;
 * — loading / error / empty (incl. all-clear) states via shared feedback prims.
 *
 * Pure presentation — all data flows through feature query hooks; no transport
 * logic at this layer.
 *
 * @module pages/orders
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams, type SetURLSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { BulkActionBar } from '../../shared/ui/bulk-action-bar';
import { CheckboxCell } from '../../shared/ui/checkbox-cell';
import { Chip } from '../../shared/ui/chip';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { MetricCard, type MetricCardTone } from '../../shared/ui/metric-card';
import { useToast } from '../../shared/ui/toast-provider';
import { formatShipBy, type ShipByLevel } from '../../shared/format/format-ship-by';
import { useTranslation, getBcp47Locale } from '../../shared/i18n';
import type { LocaleCode } from '../../shared/i18n';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useOrderStatusSummaryQuery } from '../../features/orders/hooks/use-order-status-summary-query';
import { useOrderSlaSummaryQuery } from '../../features/orders/hooks/use-order-sla-summary-query';
import { useOrderLifecycleSummaryQuery } from '../../features/orders/hooks/use-order-lifecycle-summary-query';
import { OrderPhaseBadge } from '../../features/orders/components/order-phase-badge';
import {
  OrderLifecyclePhaseValues,
  ORDER_LIFECYCLE_PHASE_META,
  isOrderLifecyclePhase,
  type OrderLifecyclePhaseValue,
} from '../../features/orders/lib/order-lifecycle-phase';
import { useRetryOrderDestinationMutation } from '../../features/orders/hooks/use-retry-order-destination-mutation';
import { ReadOnlyLock } from '../../shared/ui/read-only-lock';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { DEMO_READ_ONLY_ACTION_MESSAGE } from '../../shared/config/demo-mode';
import { useDemoMode } from '../../features/system';
import { captureDemoEvent } from '../../features/demo';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';
import { deriveOrderHealth, slaBadge, fulfillmentBadge } from '../../features/orders/lib/order-health';
import { paymentBadge } from '../../features/orders/lib/order-row';
import { OrderIdentityCell } from '../../features/orders';
import { OrderInvoicingCell } from '../../features/orders/components/order-invoicing-cell';
import { OrderPackedTick } from '../../features/orders/components/order-packed-tick';
import { deriveDeliveryOutcome, hasLiveOlCarrierRoute } from '../../features/orders/lib/delivery-outcome';
import { DeliveryOutcomeChip } from '../../features/orders/components/delivery-chip';
import { resolveDeliveryOwner } from '../../features/orders/lib/delivery-owner';
import { capSelectionPerSource, sourcesAtCap } from '../../features/orders/lib/dispatch-input';
import { BulkDispatchDialog } from '../../features/orders/components/bulk-dispatch-dialog';
import { OrderRowDetail } from '../../features/orders/components/order-row-detail';
import { BULK_DISPATCH_MAX_ITEMS } from '../../features/shipments';
import type {
  OrderRecord,
  OrderFilters,
  OrderHealthValue,
  OrderHealthSummary,
  OrderSortValue,
  OrderSortDirection,
  SlaStateValue,
  FulfillmentRollupStateValue,
  OrderLifecyclePhaseSummary,
} from '../../features/orders/api/orders.types';
import {
  OrderHealthValues,
  OrderSortValues,
  OrderSortDirectionValues,
  SlaStateValues,
  FulfillmentRollupStateValues,
} from '../../features/orders/api/orders.types';
import { useConnectionsQuery } from '../../features/connections';
import { resolvePlatformLabel } from '../../features/mappings';
import { usePlatforms } from '../../shared/plugins';

const PAGE_SIZE = 20;

/**
 * Status segments — partition the order set (#929). The "All" card carries the
 * total; the four health cards map 1:1 to the `health` URL filter and their
 * counts sum to that total. Tone communicates operational alarm at a glance.
 */
interface HealthSegment {
  key: OrderHealthValue;
  label: string;
  tone: MetricCardTone;
  countKey: keyof Omit<OrderHealthSummary, 'total'>;
}

const HEALTH_SEGMENTS: readonly HealthSegment[] = [
  { key: 'source_deleted', label: 'Source deleted', tone: 'error', countKey: 'sourceDeleted' },
  { key: 'needs_attention', label: 'Needs attention', tone: 'error', countKey: 'needsAttention' },
  { key: 'awaiting_mapping', label: 'Awaiting mapping', tone: 'warning', countKey: 'awaitingMapping' },
  { key: 'awaiting_dispatch', label: 'Awaiting dispatch', tone: 'info', countKey: 'awaitingDispatch' },
  { key: 'synced', label: 'Synced', tone: 'success', countKey: 'synced' },
];

/**
 * Type-guard for the `health` URL param. `includes` widens the haystack to
 * `readonly string[]` so the predicate narrows cleanly without a cast.
 */
function isOrderHealth(value: string | null): value is OrderHealthValue {
  return value !== null && (OrderHealthValues as readonly string[]).includes(value);
}

/**
 * Whether the row's delivery rider is one OpenLinker could take over (#1776) —
 * drives the quiet accent-edge + caret marker on a shop-fulfilled chip. The list
 * stays button-free; the fix-it action lives on the order detail.
 */
function isTakeoverRider(rider: OrderRecord['deliveryRider']): boolean {
  return (
    rider?.rider === 'unmapped' || rider?.rider === 'not-connected' || rider?.rider === 'disabled'
  );
}

/** Triage default ordering — soonest ship-by first (NULLs last), server-backed. */
const DEFAULT_SORT: OrderSortValue = 'dispatchBy';

/** Type-guard for the `sort` URL param (#939). Same widen-then-narrow shape as `isOrderHealth`. */
function isOrderSort(value: string | null): value is OrderSortValue {
  return value !== null && (OrderSortValues as readonly string[]).includes(value);
}

/** Type-guard for the `dir` URL param (#944). */
function isOrderDir(value: string | null): value is OrderSortDirection {
  return value !== null && (OrderSortDirectionValues as readonly string[]).includes(value);
}

/**
 * First-click direction per sort key (#944): the operator-intuitive default
 * when a column is newly selected. Re-clicking the active column flips it.
 * Ship-by asc (soonest first) is the list's default sort state.
 */
const DEFAULT_DIR: Record<OrderSortValue, OrderSortDirection> = {
  dispatchBy: 'asc',
  createdAt: 'desc',
  customer: 'asc',
  items: 'desc',
  status: 'asc',
  total: 'desc',
  fulfillment: 'asc',
  payment: 'asc',
};

/** Type-guard for the `slaState` URL filter (#1108). */
function isSlaState(value: string | null): value is SlaStateValue {
  return value !== null && (SlaStateValues as readonly string[]).includes(value);
}

/** Type-guard for the `fulfillmentState` URL filter (#1108). */
function isFulfillmentState(value: string | null): value is FulfillmentRollupStateValue {
  return value !== null && (FulfillmentRollupStateValues as readonly string[]).includes(value);
}

/** SLA filter dropdown options (#1108) — `none` is omitted (not a triage state). */
const SLA_FILTER_OPTIONS: readonly { value: SlaStateValue; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'on_track', label: 'On track' },
];

/** Fulfillment filter dropdown options (#1108). */
const FULFILLMENT_FILTER_OPTIONS: readonly { value: FulfillmentRollupStateValue; label: string }[] = [
  { value: 'not-shipped', label: 'Not shipped' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Dispatch failed' },
];

/** Map the neutral ship-by urgency level (#927) to a StatusBadge tone. */
const SHIP_BY_TONE: Record<ShipByLevel, StatusBadgeTone> = {
  ok: 'info',
  soon: 'warning',
  overdue: 'error',
};

/** "Breaching soon" window — surface orders due within this horizon (or overdue). */
const BREACHING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the per-row total via the i18n seam (#612). Currency varies per row
 * so we instantiate per call; locale comes from the LocaleProvider.
 */
function formatCurrency(amount: number, currency: string, locale: LocaleCode): string {
  return new Intl.NumberFormat(getBcp47Locale(locale), { style: 'currency', currency }).format(
    amount,
  );
}

/**
 * Buyer identity for the customer cell (#939). Prefers the shipping-address
 * name; falls back to the buyer email when the source omits a name (so the cell
 * stays useful instead of blanking). `null` only when neither is present.
 */
function customerName(parsed: ReturnType<typeof parseOrderSnapshot>): string | null {
  const a = parsed.shippingAddress;
  const name = [a?.firstName, a?.lastName].filter(Boolean).join(' ').trim();
  if (name.length > 0) return name;
  return parsed.customerEmail ?? null;
}

/**
 * Cockpit "data freshness" line — freshest `updatedAt` across visible rows,
 * rendered as a locale-aware HH:MM. Same locale-resolution path as
 * `formatCurrency` so the i18n seam stays single-source-of-truth.
 */
function formatFreshness(items: readonly OrderRecord[], locale: LocaleCode): string | null {
  if (items.length === 0) return null;
  let mostRecentMs = 0;
  for (const item of items) {
    const ms = Date.parse(item.updatedAt);
    if (Number.isFinite(ms) && ms > mostRecentMs) mostRecentMs = ms;
  }
  if (mostRecentMs === 0) return null;
  const time = new Intl.DateTimeFormat(getBcp47Locale(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(mostRecentMs));
  return `Synced ${time}`;
}

/**
 * URL param name for every `OrderFilters` key this page can narrow by (#2148).
 *
 * `Record<..., string>` makes this exhaustive: TypeScript fails the build when a new
 * `OrderFilters` key isn't accounted for here — either mapped to a real URL param or added
 * to the `Exclude` list below — so an unlisted filter can't silently fall through to the
 * "nothing has synced" copy the way `due` / `slaState` / `fulfillmentState` /
 * `sourceConnectionId` / `createdFrom` / `createdTo` did before this fix.
 *
 * Excluded deliberately: `sort` / `dir` change presentation, not membership (an empty
 * result is never their doing, and "View all orders" has no business resetting the
 * operator's column sort); `syncStatus` / `customerId` / `recordStatus` are query-only
 * filters this page's UI does not expose as controls — `cancelled` (#2306) joins
 * that group: the dispatch-risk page pins it, this list does not surface it.
 */
type NarrowingOrderFilterKey = Exclude<
  keyof OrderFilters,
  'sort' | 'dir' | 'syncStatus' | 'customerId' | 'recordStatus' | 'cancelled'
>;

const NARROWING_FILTER_URL_PARAM: Record<NarrowingOrderFilterKey, string> = {
  health: 'health',
  sourceConnectionId: 'sourceConnectionId',
  createdFrom: 'createdFrom',
  createdTo: 'createdTo',
  dueBefore: 'due',
  slaState: 'slaState',
  fulfillmentState: 'fulfillmentState',
  salesDocumentBlocked: 'invoicing',
  phase: 'phase',
};

/**
 * Phase → `OrderLifecyclePhaseSummary` field (#2310). The summary is camelCase
 * per bucket while the phase union is snake_case, so the two cannot be derived
 * from one another; an exhaustive `Record` makes a new phase a compile error
 * here rather than a silently missing count.
 */
const PHASE_SUMMARY_KEY: Record<
  OrderLifecyclePhaseValue,
  keyof Omit<OrderLifecyclePhaseSummary, 'total'>
> = {
  cancelled: 'cancelled',
  vendor_authoritative: 'vendorAuthoritative',
  delivered: 'delivered',
  in_transit: 'inTransit',
  fulfillment_failed: 'fulfillmentFailed',
  held: 'held',
  amending: 'amending',
  blocked: 'blocked',
  ready: 'ready',
};

/** Every URL param that narrows the result set — derived, not hand-maintained (#2148). */
const FILTER_PARAMS: readonly string[] = Object.values(NARROWING_FILTER_URL_PARAM);

/**
 * Clear every filter in ONE write (#2148).
 *
 * One call, not one per param: `setSearchParams` is not a queued reducer - React Router
 * builds the next params from the CURRENT render's params, so two calls in one handler
 * both start from the same base and the second navigation supersedes the first. A "View
 * all orders" button that cleared filters one at a time would leave all but the last one
 * applied.
 */
function clearAllFilters(setSearchParams: SetURLSearchParams): void {
  setSearchParams((prev) => {
    const p = new URLSearchParams(prev);
    for (const key of FILTER_PARAMS) {
      p.delete(key);
    }
    p.delete('offset');
    return p;
  });
}

export function OrdersListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { locale } = useTranslation();
  const { showToast } = useToast();

  const rawHealth = searchParams.get('health');
  const health = isOrderHealth(rawHealth) ? rawHealth : undefined;
  const sourceConnectionId = searchParams.get('sourceConnectionId') ?? undefined;
  const rawSort = searchParams.get('sort');
  const sort = isOrderSort(rawSort) ? rawSort : DEFAULT_SORT;
  const rawDir = searchParams.get('dir');
  // Direction defaults to the active key's first-click default until a header
  // click pins an explicit one (#944).
  const dir: OrderSortDirection = isOrderDir(rawDir) ? rawDir : DEFAULT_DIR[sort];
  // Date filters stay calendar-date (YYYY-MM-DD) in the URL so the native date
  // input round-trips; they're widened to start-/end-of-day UTC instants only
  // when building the query, so the `createdTo` bound is inclusive of that day.
  const createdFrom = searchParams.get('createdFrom') || undefined;
  const createdTo = searchParams.get('createdTo') || undefined;
  const createdFromIso = createdFrom ? `${createdFrom}T00:00:00.000Z` : undefined;
  const createdToIso = createdTo ? `${createdTo}T23:59:59.999Z` : undefined;
  const breaching = searchParams.get('due') === 'breaching';
  const rawSla = searchParams.get('slaState');
  const slaState = isSlaState(rawSla) ? rawSla : undefined;
  const rawFulfillment = searchParams.get('fulfillmentState');
  const fulfillmentState = isFulfillmentState(rawFulfillment) ? rawFulfillment : undefined;
  // #2100 — an independent axis, so it lives in its own param and composes with
  // `health` rather than replacing it. Present-only toggle: the URL never carries
  // `invoicing=false`, so the filter is either "blocked only" or absent.
  const invoicingBlocked = searchParams.get('invoicing') === 'blocked';
  // #2310 — the derived lifecycle phase. An unrecognised value falls back to
  // "unfiltered" rather than being passed through: the server would reject it,
  // and an operator with a stale bookmark should see their orders, not an error.
  const rawPhase = searchParams.get('phase');
  const phase = isOrderLifecyclePhase(rawPhase) ? rawPhase : undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  // "Breaching soon / overdue" cutoff — stable per toggle (not recomputed each
  // render) so the query key doesn't churn. `now + 24h` catches overdue too.
  const dueBefore = useMemo(
    () => (breaching ? new Date(Date.now() + BREACHING_WINDOW_MS).toISOString() : undefined),
    [breaching],
  );

  const filters: OrderFilters = {
    health,
    sourceConnectionId: sourceConnectionId || undefined,
    // Server-side ordering driven by clickable column headers (#944); defaults
    // to the triage sort (soonest ship-by first, NULLs last).
    sort,
    dir,
    createdFrom: createdFromIso,
    createdTo: createdToIso,
    dueBefore,
    slaState,
    fulfillmentState,
    // Present-only (#2100): `true` when the chip is on, `undefined` otherwise —
    // never `false`, which would mean "hide blocked orders" and is not something
    // the UI offers.
    salesDocumentBlocked: invoicingBlocked ? true : undefined,
    // #2310 — orthogonal to `health`; both compose server-side.
    phase,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useOrdersQuery(filters, pagination);

  // Single count endpoint — partitions the set, so segment counts sum to total.
  // Scoped by the same source + date axes as the table (NOT `health`, so the
  // aggregate can't be self-filtered) — keeps the segment counts coherent with
  // an active source/date filter.
  const summaryScope = useMemo(
    () => ({
      sourceConnectionId: sourceConnectionId || undefined,
      createdFrom: createdFromIso,
      createdTo: createdToIso,
    }),
    [sourceConnectionId, createdFromIso, createdToIso],
  );
  const summaryQuery = useOrderStatusSummaryQuery(summaryScope);
  const summary = summaryQuery.data;
  // SLA KPI counts (#1108) — same scope as the health summary.
  const slaSummaryQuery = useOrderSlaSummaryQuery(summaryScope);
  const slaSummary = slaSummaryQuery.data;
  // Lifecycle-phase chip counts (#2310) — same scope again, so the chips cannot
  // be self-filtered by the phase they set.
  const lifecycleSummaryQuery = useOrderLifecycleSummaryQuery(summaryScope);
  const lifecycleSummary = lifecycleSummaryQuery.data;

  const retryMutation = useRetryOrderDestinationMutation();
  const demoMode = useDemoMode();
  // Per-row "Retry" fires the retry mutation immediately (a direct-write
  // action, no intermediate form) - visible-but-disabled with a read-only
  // tooltip for a demo viewer, per the #1615 precedent.
  const retryWrite = useWriteAccess('orders:write', demoMode);

  // Channel lookup: connectionId → platformType, cached app-wide via TanStack.
  const connectionsQuery = useConnectionsQuery();
  const platformByConnection = useMemo(() => {
    const map = new Map<string, string>();
    (connectionsQuery.data ?? []).forEach((c) => {
      map.set(c.id, c.platformType);
    });
    return map;
  }, [connectionsQuery.data]);

  // id → {name, platformType} for the delivery badge's owner resolution (#1776).
  // Presentation-only lookup: it names the connection the BE already routed to.
  const connectionInfoById = useMemo(() => {
    const map = new Map<string, { name: string; platformType: string }>();
    (connectionsQuery.data ?? []).forEach((c) => {
      map.set(c.id, { name: c.name, platformType: c.platformType });
    });
    return map;
  }, [connectionsQuery.data]);

  // Registry-resolved, never a local map: the four-entry `CHANNEL_LABELS` this
  // replaced (#2088) had no row for `erli` or `woocommerce`, so both rendered
  // raw and lowercase here while rendering correctly two pages over.
  const platforms = usePlatforms();

  const channelLabel = (platform: string | undefined): string | undefined =>
    platform ? resolvePlatformLabel(platforms, platform) : undefined;

  // Resolve a connectionId to a human channel label (never undefined) for the
  // bulk-dispatch per-row source pill.
  const channelLabelForBulk = (connectionId: string): string =>
    channelLabel(platformByConnection.get(connectionId)) ?? 'Source';

  // ── Bulk dispatch selection (#1109) ───────────────────────────────────────
  // Local Set (not URL state — the URL would balloon on every checkbox toggle).
  // The 25-cap is enforced PER SOURCE connection, since the bulk endpoint takes
  // one source per request and the dialog fans out one call per source group.
  const items = query.data?.items ?? [];
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  // Fire once per successful list load, not on every filter/page refetch —
  // demo-mode analytics only (#1788), no-op elsewhere.
  const hasFiredOrdersViewedRef = useRef(false);
  useEffect(() => {
    if (query.data && !hasFiredOrdersViewedRef.current) {
      hasFiredOrdersViewedRef.current = true;
      captureDemoEvent('demo_orders_viewed', {});
    }
  }, [query.data]);

  // Parse each row's snapshot once per page (#1713) — the order / customer /
  // shipment / money cells and the mobile summary all read the same parse
  // instead of re-parsing per cell. Keyed by internalOrderId over the current
  // page's items.
  const parsedByOrder = useMemo(() => {
    const map = new Map<string, ReturnType<typeof parseOrderSnapshot>>();
    for (const order of query.data?.items ?? []) {
      map.set(order.internalOrderId, parseOrderSnapshot(order.orderSnapshot));
    }
    return map;
  }, [query.data?.items]);
  const parsedFor = useCallback(
    (order: OrderRecord): ReturnType<typeof parseOrderSnapshot> =>
      parsedByOrder.get(order.internalOrderId) ?? parseOrderSnapshot(order.orderSnapshot),
    [parsedByOrder],
  );

  /**
   * ONE renderer for the desktop Order column and the mobile card title (#2091).
   * The two used to be separate hand-rolled `EntityLabel`s that nothing kept in
   * sync — the exact drift the shared cell exists to end (#1996) — so this is a
   * function, not two call sites that happen to agree today.
   *
   * `itemCount` is `parsed.items.length`, deliberately NOT the old
   * `itemsSummary()` count: that helper dropped nameless lines before counting
   * the rest, so the same `+N` chip meant "other NAMED lines" here and "other
   * lines" on Shipments / Invoices, which read the `buildOrderSummary`
   * projection (#1995). `firstItemName` is item[0]'s name verbatim for the same
   * reason — the projection names the FIRST item, not the first named one, so a
   * nameless leading line now renders the cell's "N line items" branch instead
   * of silently promoting a later item's name onto line 2.
   *
   * The convergence is NEAR, not exact, and nobody should later treat the two
   * counts as provably identical: `parseOrderSnapshot` drops any item failing
   * `orderItemSchema` (`id: string`, `quantity: number`, `price: number` are all
   * required) before this reads `items.length`, whereas `buildOrderSummary`
   * counts the RAW array. A snapshot carrying a money-as-string `price` therefore
   * reads lower here than on Shipments / Invoices for the same order.
   *
   * `onNavigate` keeps the row-open demo-analytics event (#1788) that the
   * pre-#2091 `EntityLabel` carried at both call sites.
   */
  const renderOrderIdentity = useCallback(
    (order: OrderRecord): ReactElement => {
      const parsed = parsedFor(order);
      const firstItem = parsed.items[0];
      return (
        <OrderIdentityCell
          orderId={order.internalOrderId}
          orderNumber={parsed.orderNumber}
          firstItemName={firstItem?.name}
          firstItemImageUrl={firstItem?.imageUrl}
          itemCount={parsed.items.length}
          onNavigate={() => captureDemoEvent('demo_order_opened', {})}
        />
      );
    },
    [parsedFor],
  );

  // Whether ANY connection exposes the Invoicing capability (#1713). When none
  // does, the "Issue invoice" CTA degrades to an em dash — the platform can't
  // issue invoices, so offering the action would dead-end. An existing invoice
  // pill still renders regardless (the record exists independent of this gate).
  const hasInvoicingCapability = useMemo(
    () => (connectionsQuery.data ?? []).some((c) => c.enabledCapabilities.includes('Invoicing')),
    [connectionsQuery.data],
  );

  // Already-shipped orders can't be dispatched — their checkbox is disabled.
  const isSelectable = (order: OrderRecord): boolean =>
    order.fulfillmentState !== 'dispatched' && order.fulfillmentState !== 'delivered';

  const selectableItems = useMemo(() => items.filter(isSelectable), [items]);
  const selectedOrders = useMemo(
    () => items.filter((o) => selectedIds.has(o.internalOrderId)),
    [items, selectedIds],
  );
  // Source groups that have hit the per-source cap — their unselected rows
  // disable (but already-selected rows stay toggleable so you can deselect).
  const atCapSources = useMemo(
    () => sourcesAtCap(selectedOrders, BULK_DISPATCH_MAX_ITEMS),
    [selectedOrders],
  );
  // The header "select all" caps each source independently, so its target count
  // is the capped selectable set — header reads `all` only once that's reached.
  const cappedSelectableCount = useMemo(
    () => capSelectionPerSource(selectableItems, BULK_DISPATCH_MAX_ITEMS).length,
    [selectableItems],
  );
  const selectedVisibleCount = useMemo(
    () => selectableItems.reduce((n, o) => n + (selectedIds.has(o.internalOrderId) ? 1 : 0), 0),
    [selectableItems, selectedIds],
  );
  const headerCheckboxState: 'all' | 'some' | 'none' =
    selectedVisibleCount === 0
      ? 'none'
      : selectedVisibleCount >= cappedSelectableCount
        ? 'all'
        : 'some';
  const distinctSelectedSources = useMemo(
    () => new Set(selectedOrders.map((o) => o.sourceConnectionId)).size,
    [selectedOrders],
  );

  function toggleSelectRow(order: OrderRecord): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const id = order.internalOrderId;
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // Enforce the per-source cap on add (count from current page's selection).
      const sourceCount = items.reduce(
        (n, o) =>
          o.sourceConnectionId === order.sourceConnectionId && prev.has(o.internalOrderId) ? n + 1 : n,
        0,
      );
      if (sourceCount >= BULK_DISPATCH_MAX_ITEMS) return prev;
      next.add(id);
      return next;
    });
  }

  function toggleSelectHeader(): void {
    setSelectedIds((prev) => {
      const allSelected =
        selectableItems.length > 0 && selectableItems.every((o) => prev.has(o.internalOrderId));
      if (allSelected) return new Set();
      return new Set(
        capSelectionPerSource(selectableItems, BULK_DISPATCH_MAX_ITEMS).map((o) => o.internalOrderId),
      );
    });
  }

  function clearSelection(): void {
    setSelectedIds(new Set());
  }

  /**
   * Per-row selection checkbox (#1109) — shared verbatim by the desktop select
   * column and the mobile card select slot (#1620) so multi-select behaves
   * identically in both layouts (already-shipped rows disabled; per-source cap
   * enforced on add).
   */
  function renderSelectCheckbox(order: OrderRecord): ReactElement {
    if (!isSelectable(order)) {
      return (
        <CheckboxCell
          state="none"
          disabled
          onToggle={() => {}}
          ariaLabel={`${order.internalOrderId} is already shipped`}
          tooltip="Already shipped"
        />
      );
    }
    const checked = selectedIds.has(order.internalOrderId);
    const disabled = !checked && atCapSources.has(order.sourceConnectionId);
    return (
      <CheckboxCell
        state={checked ? 'all' : 'none'}
        disabled={disabled}
        onToggle={() => { toggleSelectRow(order); }}
        ariaLabel={checked ? `Unselect ${order.internalOrderId}` : `Select ${order.internalOrderId}`}
        tooltip={disabled ? `Max ${BULK_DISPATCH_MAX_ITEMS} per source` : undefined}
      />
    );
  }

  /**
   * Apply a server-side sort (#1713): clicking a sort key flips its direction
   * when it's already active, else starts at the key's default direction. The
   * single entry point for both the native react-table columns (customer /
   * status) and the merged-column per-label sort buttons. Drops `offset` so a
   * re-sort lands on page 1. Stable across renders except when the active
   * sort/dir change, so the columns memo (which renders the sort buttons in its
   * headers) rebuilds exactly when the active-state arrows need to.
   */
  const applySort = useCallback(
    (key: OrderSortValue): void => {
      const nextDir: OrderSortDirection =
        key === sort ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[key];
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set('sort', key);
        p.set('dir', nextDir);
        p.delete('offset');
        return p;
      });
    },
    [sort, dir, setSearchParams],
  );

  /** Render one per-label sort control for a merged-column header (#1713). */
  const sortLabel = useCallback(
    (label: string, key: OrderSortValue): ReactElement => {
      const active = sort === key;
      return (
        <button
          type="button"
          className={['orders-sortbtn', active ? 'orders-sortbtn--active' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => { applySort(key); }}
          aria-pressed={active}
          aria-label={
            active
              ? `${label}, sorted ${dir === 'asc' ? 'ascending' : 'descending'}`
              : `${label}, sort`
          }
        >
          {label}
          <span className="orders-sortbtn__ind" aria-hidden="true">
            {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      );
    },
    [sort, dir, applySort],
  );

  const columns: DataTableColumn<OrderRecord>[] = useMemo(
    () => [
      {
        id: 'select',
        // Header rendered manually for the indeterminate (tri-state) checkbox.
        header: (
          <CheckboxCell
            state={headerCheckboxState}
            onToggle={toggleSelectHeader}
            ariaLabel={
              headerCheckboxState === 'all' ? 'Unselect all visible orders' : 'Select all visible orders'
            }
          />
        ),
        cell: (order) => renderSelectCheckbox(order),
        align: 'left',
      },
      {
        id: 'order',
        header: 'Order',
        cell: (order) => {
          const sourcePlatform = platformByConnection.get(order.sourceConnectionId);
          const source = channelLabel(sourcePlatform);
          const destPlatform = order.syncStatus[0]
            ? platformByConnection.get(order.syncStatus[0].destinationConnectionId)
            : undefined;
          const dest = channelLabel(destPlatform);
          // Multi-destination indicator (#1713): an order fanned out to more than
          // one destination shows `→ Dest +N` where N is the extra destinations.
          const extraDests = order.syncStatus.length > 1 ? order.syncStatus.length - 1 : 0;
          // The inline Retry lives under the order name rather than in its own
          // trailing column (#1713): a column that only ever renders for failed
          // rows widened the table past the viewport for every other row.
          const failed = order.syncStatus.find((s) => s.status === 'failed');
          const canRetry =
            failed !== undefined &&
            order.recordStatus !== 'awaiting_mapping' &&
            order.recordStatus !== 'source_deleted' &&
            retryWrite.visible;
          const isRetrying =
            retryMutation.isPending &&
            retryMutation.variables?.internalOrderId === order.internalOrderId;
          return (
            <span className="orders-cell-stack">
              {/* Thumbnail + order ref + item name/`+N`, all owned by the shared
                  cell since #2091. The channel fold and the inline Retry stay
                  siblings BELOW it: both are row affordances rather than part of
                  the order's identity, and #2094 owns relocating the fold. */}
              {renderOrderIdentity(order)}
              {/* Channel folds under the order name below the Channel column's
                  hide breakpoint (#1713) — hidden on wide screens where the
                  standalone Channel column is visible. */}
              {source ? (
                <span className="orders-order-channel">
                  <span className="channel-pill" data-channel={sourcePlatform}>
                    {source}
                  </span>
                  {dest ? (
                    <span className="text-muted orders-cell-sub">
                      → {dest}
                      {extraDests > 0 ? ` +${extraDests}` : ''}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {canRetry && failed ? (
                <ReadOnlyLock active={retryWrite.demoReadOnly} message={DEMO_READ_ONLY_ACTION_MESSAGE}>
                  <Button
                    tone="ghost"
                    className="button--sm orders-row-retry"
                    disabled={isRetrying || retryWrite.demoReadOnly}
                    onClick={() => { handleRetry(order.internalOrderId, failed.destinationConnectionId); }}
                  >
                    {isRetrying ? 'Retrying…' : 'Retry'}
                  </Button>
                </ReadOnlyLock>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'customer',
        // Non-sortable in react-table's model (#1713) — the header renders the
        // same per-label sort control as the merged columns, routed through
        // `applySort`, so every sortable header shares one affordance.
        header: <span className="orders-sortstack">{sortLabel('Customer', 'customer')}</span>,
        cell: (order) => {
          const parsed = parsedFor(order);
          const name = customerName(parsed);
          if (!name) return <span className="text-muted">—</span>;
          const city = parsed.shippingAddress?.city;
          return (
            <span className="orders-cell-stack">
              <span>{name}</span>
              {city ? <span className="text-muted orders-cell-sub">{city}</span> : null}
            </span>
          );
        },
      },
      {
        id: 'channel',
        header: 'Channel',
        // Folds under the order name below 1024px (#1713) — the order cell then
        // renders the channel pill inline instead.
        hideBelow: 1024,
        cell: (order) => {
          const source = channelLabel(platformByConnection.get(order.sourceConnectionId));
          const destPlatform = order.syncStatus[0]
            ? platformByConnection.get(order.syncStatus[0].destinationConnectionId)
            : undefined;
          const dest = channelLabel(destPlatform);
          if (!source) return <span className="text-muted">—</span>;
          return (
            <span className="orders-cell-stack">
              <span className="channel-pill" data-channel={platformByConnection.get(order.sourceConnectionId)}>
                {source}
              </span>
              {dest ? <span className="text-muted orders-cell-sub">→ {dest}</span> : null}
            </span>
          );
        },
      },
      {
        id: 'status',
        // Non-sortable in react-table's model (#1713) — header uses the shared
        // per-label sort control (see the customer column).
        header: <span className="orders-sortstack">{sortLabel('Status', 'status')}</span>,
        cell: (order) => {
          const h = deriveOrderHealth(order);
          return (
            <span className="orders-cell-stack">
              <StatusBadge tone={h.tone} withDot compact>
                {h.label}
              </StatusBadge>
              {/* #2310 — BESIDE the health badge, never instead of it: health
                  says "is something wrong", the phase says "what stage is it
                  at" (ADR-059). */}
              <OrderPhaseBadge phase={order.lifecyclePhase} compact />
              {h.reason ? (
                <span className="orders-status-reason" title={h.reason}>
                  {h.reason}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'shipment',
        // Merged dispatch column (#1713): fulfillment status + ship-by SLA (with
        // the live countdown) + carrier, one per-label sort control each in the
        // header. Not `sortable` — the header renders its own sort buttons.
        header: (
          <span className="orders-sortstack orders-sortstack--left">
            {sortLabel('Shipment', 'fulfillment')}
            {sortLabel('Ship-by', 'dispatchBy')}
          </span>
        ),
        cell: (order) => {
          const parsed = parsedFor(order);
          const f = fulfillmentBadge(order.fulfillmentState);
          // BE-owned SLA bucket drives the badge (#1108); the live countdown
          // stays client-side, falling back to the client-derived urgency for
          // older payloads without slaState.
          const sla = slaBadge(order.slaState);
          const due = order.dispatchByAt ?? null;
          const view = formatShipBy(due);
          // Estimated ship-by qualifier (#1776): a muted "est." label when the
          // deadline is an OL-side estimate (Erli), absent for authoritative
          // marketplace commitments (Allegro). Labelled for screen readers +
          // hover so the convention isn't sight-only, and rendered as the same
          // "est." text on every surface (order-detail, row-detail, list).
          const estMark = order.dispatchByEstimated ? (
            <span
              className="text-muted"
              aria-label="Estimated"
              title="OpenLinker estimate - not a marketplace-confirmed deadline"
            >
              est.{' '}
            </span>
          ) : null;
          // Carrier at row level (#1617): the list can't fetch per-order
          // shipments, so `shipping.methodName` (the source's stated delivery
          // method) is the best signal, then the raw method id (#1776), then
          // the pickup-point name. Snapshot-only is the correct ceiling here.
          const carrier =
            parsed.shipping?.methodName ??
            parsed.shipping?.methodId ??
            parsed.pickupPoint?.name ??
            null;
          // Mapping-aware delivery chip (#1793): outcome + rider stacked. The
          // rider comes straight off the order response (BE-gated to `default`
          // resolutions).
          const deliveryOutcome = deriveDeliveryOutcome({
            processorKind: order.deliveryResolution?.processorKind,
            // Use the typed #1792 source-method fields (not the snapshot carrier
            // proxy) so the list agrees with the detail for methodId-only orders.
            hasMethod: Boolean(order.sourceDeliveryMethodId ?? order.sourceDeliveryMethodName),
            // Snapshot-only divergence (documented, not silent): the list uses
            // the rollup `fulfillmentState` because it can't fetch per-row
            // shipments, whereas the detail uses booked-shipment presence.
            isFulfilled:
              order.fulfillmentState === 'dispatched' || order.fulfillmentState === 'delivered',
            processorAvailable: order.deliveryResolution?.processorAvailable,
            cancelled: parsed.status === 'cancelled',
          });
          // "Generate label" is offered ONLY when OpenLinker has a live own-carrier
          // route (#1799): fulfillment EXPLICITLY not-shipped, the order isn't
          // cancelled (#1713), and routing resolved to an available OL carrier.
          // Shop-fulfilled / no-method / unmapped / not-connected / disabled-carrier
          // orders have no OL label to generate — the passive fulfillment badge (and
          // the delivery rider) show instead, never a dead-end action.
          const canGenerateLabel =
            order.fulfillmentState === 'not-shipped' &&
            parsed.status !== 'cancelled' &&
            hasLiveOlCarrierRoute(order.deliveryResolution);
          return (
            <span className="orders-cell-stack">
              {/* Packed sits FIRST: the shipment cell reads as time (packed →
                  shipped → due → carrier), and packing precedes everything else
                  in it. It is also the one slot that never depends on a sibling —
                  the fulfillment badge below is conditional. */}
              <OrderPackedTick packedAt={order.packedAt} layout="stack" emptyFallback={null} />
              {/* When the row offers "Generate label" the CTA is deferred to sit
                  directly under the Awaiting-label delivery chip (the state it
                  resolves), so the top slot only carries the passive fulfillment
                  badge for non-actionable rows. */}
              {canGenerateLabel ? null : (
                <StatusBadge tone={f.tone} withDot compact>
                  {f.label}
                </StatusBadge>
              )}
              {sla ? (
                <span className="orders-shipby-row">
                  <StatusBadge tone={sla.tone} withDot compact>
                    {sla.label}
                  </StatusBadge>
                  {view ? (
                    <span className="text-muted orders-cell-sub mono tabular">
                      {estMark}
                      {view.remaining}
                    </span>
                  ) : null}
                </span>
              ) : due && view ? (
                <StatusBadge tone={SHIP_BY_TONE[view.level]} withDot compact>
                  {estMark}
                  {view.remaining}
                </StatusBadge>
              ) : null}
              {/* The list carries no rider chip and no button: the owner badge
                  says who ships, and a quiet accent edge + caret marks the rows
                  OpenLinker could take over. The actionable banner + fix-it
                  button live on the order-detail Delivery panel. */}
              <DeliveryOutcomeChip
                outcome={deliveryOutcome}
                owner={resolveDeliveryOwner(
                  order.deliveryResolution,
                  order.deliveryRider,
                  connectionInfoById,
                )}
                switchable={deliveryOutcome === 'shop-fulfilled' && isTakeoverRider(order.deliveryRider)}
              />
              {canGenerateLabel ? (
                <Link
                  className="orders-row-cta"
                  to={`/orders/${order.internalOrderId}#shipment`}
                >
                  <span className="orders-row-cta__plus" aria-hidden="true">
                    +
                  </span>{' '}
                  Generate label
                </Link>
              ) : null}
              {carrier ? (
                <span className="text-muted orders-cell-sub orders-carrier" title={carrier}>
                  {carrier}
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'money',
        align: 'right',
        // Merged money column (#1713): total + payment pill + created, each an
        // independent per-label sort control in the header. Not `sortable` — the
        // header renders its own sort buttons.
        header: (
          <span className="orders-sortstack orders-sortstack--right">
            {sortLabel('Total', 'total')}
            {sortLabel('Payment', 'payment')}
            {sortLabel('Created', 'createdAt')}
          </span>
        ),
        cell: (order) => {
          const parsed = parsedFor(order);
          const pay = paymentBadge(parsed.paymentStatus);
          return (
            <span className="orders-cell-stack orders-cell-stack--end">
              {parsed.totals ? (
                <span className="mono tabular orders-money-total">
                  {formatCurrency(parsed.totals.total, parsed.totals.currency, locale)}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
              {pay ? (
                <StatusBadge tone={pay.tone} withDot compact>
                  {pay.label}
                </StatusBadge>
              ) : null}
              {/* Invoice pill, block badge and "Issue invoice" CTA — independent
                  parts, not a three-way choice; see `OrderInvoicingCell`. Shared
                  verbatim with the mobile card so the two cannot drift again. */}
              <OrderInvoicingCell
                internalOrderId={order.internalOrderId}
                invoice={parsed.invoice}
                blockReason={order.salesDocumentBlockReason}
                unresolvedReason={order.salesDocumentUnresolvedReason}
                hasInvoicingCapability={hasInvoicingCapability}
                layout="stack"
                emptyFallback={<span className="text-muted">—</span>}
              />
              <span className="text-muted orders-cell-sub mono tabular">
                <TimeDisplay iso={order.createdAt} format="datetime" />
              </span>
            </span>
          );
        },
      },
    ],
    // Deps: columns rebuild when locale, the channel lookup, or the retry
    // mutation's pending/variables change — the last two so the inline Retry
    // reflects its in-flight state. `handleRetry` closes over the stable
    // `mutate` handle, so it doesn't need to be a dep.
    [
      locale,
      platformByConnection,
      // `channelLabel` closes over the plugin registry as of #2088. The registry
      // array is referentially stable (a provider-level memo over a module
      // constant), so listing it costs no rebuild — but that invariant lives two
      // files away, and a stale closure here would render stale channel labels.
      platforms,
      retryMutation.isPending,
      retryMutation.variables,
      retryWrite.visible,
      retryWrite.demoReadOnly,
      // Selection state — the select column re-renders as checkboxes toggle (#1109).
      selectedIds,
      atCapSources,
      headerCheckboxState,
      // Sort controls in the merged-column headers (#1713) — rebuild so the
      // active-state arrows track the current sort/dir. `sortLabel` is a
      // useCallback keyed on sort/dir, so this rebuilds exactly on a sort change.
      sortLabel,
      // Per-page snapshot cache + invoicing-capability gate (#1713).
      parsedFor,
      // The shared Order cell renderer (#2091) — a `useCallback` over
      // `parsedFor`, so this rebuilds exactly when the parse cache does.
      renderOrderIdentity,
      hasInvoicingCapability,
    ],
  );

  function handleRetry(internalOrderId: string, destinationConnectionId: string): void {
    retryMutation.mutate(
      { internalOrderId, destinationConnectionId },
      {
        onSuccess: () => {
          showToast({ tone: 'success', title: 'Retry queued', description: 'Sync re-enqueued.' });
        },
        onError: (error) => {
          showToast({ tone: 'error', title: 'Retry failed', description: error.message });
        },
      },
    );
  }

  function setHealthFilter(next: OrderHealthValue | null): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next) {
        p.set('health', next);
      } else {
        p.delete('health');
      }
      p.delete('offset');
      return p;
    });
  }

  /**
   * Set/clear a single filter URL param (#939) and reset paging. Empty string
   * removes the param (e.g. the "All sources" / default-sort option). Mirrors
   * the connections-list filter pattern; `offset` is dropped so a new filter
   * always lands on page 1.
   */
  function setFilterParam(key: string, value: string): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (value) {
        p.set(key, value);
      } else {
        p.delete(key);
      }
      p.delete('offset');
      return p;
    });
  }

  function toggleBreaching(): void {
    captureDemoEvent('demo_orders_filtered', {
      filter: 'sla_breaching',
      value: String(!breaching),
    });
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (breaching) {
        p.delete('due');
      } else {
        p.set('due', 'breaching');
      }
      p.delete('offset');
      return p;
    });
  }

  /** Is the current view narrowed at all? Drives the empty-state copy (#2148). */
  const hasActiveFilters = FILTER_PARAMS.some((key) => searchParams.get(key) !== null);

  /** #2100 — mirrors `toggleBreaching`: an independent, present-only chip filter. */
  function toggleInvoicingBlocked(): void {
    captureDemoEvent('demo_orders_filtered', {
      filter: 'invoicing_blocked',
      value: String(!invoicingBlocked),
    });
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (invoicingBlocked) {
        p.delete('invoicing');
      } else {
        p.set('invoicing', 'blocked');
      }
      // Any filter change invalidates the current page offset.
      p.delete('offset');
      return p;
    });
  }

  /**
   * Select / deselect a lifecycle-phase chip (#2310). ONE `setSearchParams`
   * write, like every sibling handler: two calls in one handler both build from
   * the current render's params, so the second supersedes the first and all but
   * the last change is lost. Clicking the active chip clears the param, which
   * restores the unfiltered list.
   */
  function togglePhase(next: OrderLifecyclePhaseValue): void {
    const clearing = phase === next;
    captureDemoEvent('demo_orders_filtered', {
      filter: 'phase',
      value: clearing ? 'all' : next,
    });
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (clearing) {
        p.delete('phase');
      } else {
        p.set('phase', next);
      }
      p.delete('offset');
      return p;
    });
  }

  function setOffset(next: number): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === 0) {
        p.delete('offset');
      } else {
        p.set('offset', String(next));
      }
      return p;
    });
  }

  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  const freshness = useMemo(
    () => formatFreshness(query.data?.items ?? [], locale),
    [query.data?.items, locale],
  );

  function refreshAll(): void {
    void query.refetch();
    void summaryQuery.refetch();
    void slaSummaryQuery.refetch();
  }

  // `R` keyboard shortcut — operator-cockpit "refresh everything visible".
  useEffect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        refreshAll();
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => { document.removeEventListener('keydown', onKeydown); };
    // Empty deps: the listener fires `refreshAll`, which closes over the two
    // React-Query refetch handles (stable per query instance) — no rebind
    // needed; the handler reads fresh state at fire-time via the closure.
  }, []);

  const segmentCount = (segment: HealthSegment): string =>
    summary ? String(summary[segment.countKey]) : '—';

  return (
    <PageLayout
      eyebrow={freshness ?? 'Operations'}
      title="Orders"
      actions={
        <Button tone="ghost" className="button--sm" onClick={refreshAll}>
          Refresh
          <span className="button__shortcut">R</span>
        </Button>
      }
    >
      {/* Status segments — partition the set; click to filter by `health`. */}
      <div className="ds-grid ds-grid--5 orders-segments">
        <button
          type="button"
          className={['orders-segment', health === undefined ? 'orders-segment--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-pressed={health === undefined}
          onClick={() => {
            captureDemoEvent('demo_orders_filtered', { filter: 'health', value: 'all' });
            setHealthFilter(null);
          }}
        >
          <MetricCard label="All orders" value={summary ? String(summary.total) : '—'} />
        </button>
        {HEALTH_SEGMENTS.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className={['orders-segment', health === segment.key ? 'orders-segment--active' : '']
              .filter(Boolean)
              .join(' ')}
            aria-pressed={health === segment.key}
            onClick={() => {
              captureDemoEvent('demo_orders_filtered', { filter: 'health', value: segment.key });
              setHealthFilter(segment.key);
            }}
          >
            <MetricCard label={segment.label} tone={segment.tone} value={segmentCount(segment)} />
          </button>
        ))}
      </div>

      {/* Filter bar (#939) — source + created-date controls in URL state
          (mirrors the connections-list toolbar). Sorting moved to clickable
          column headers (#944). */}
      <div className="toolbar orders-toolbar">
        <div className="toolbar__group">
          <Select
            aria-label="Filter by source"
            value={sourceConnectionId ?? ''}
            onChange={(e) => { setFilterParam('sourceConnectionId', e.target.value); }}
          >
            <option value="">All sources</option>
            {(connectionsQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <label className="orders-toolbar__field">
            <span className="orders-toolbar__label">From</span>
            <input
              type="date"
              className="control"
              aria-label="Created from"
              value={createdFrom ?? ''}
              onChange={(e) => { setFilterParam('createdFrom', e.target.value); }}
            />
          </label>
          <label className="orders-toolbar__field">
            <span className="orders-toolbar__label">To</span>
            <input
              type="date"
              className="control"
              aria-label="Created to"
              value={createdTo ?? ''}
              onChange={(e) => { setFilterParam('createdTo', e.target.value); }}
            />
          </label>
          <Select
            aria-label="Filter by ship-by SLA"
            value={slaState ?? ''}
            onChange={(e) => { setFilterParam('slaState', e.target.value); }}
          >
            <option value="">Any SLA</option>
            {SLA_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by fulfillment"
            value={fulfillmentState ?? ''}
            onChange={(e) => { setFilterParam('fulfillmentState', e.target.value); }}
          >
            <option value="">Any fulfillment</option>
            {FULFILLMENT_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="ds-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip tone="warning" active={breaching} onClick={toggleBreaching}>
          Ship-by ≤ 24h / overdue
        </Chip>
        {/*
          #2100 — an independent filter, NOT a sixth health segment: an invoicing
          block is orthogonal to sync health (a blocked order is usually also
          `synced`), and the KPI segments above are a partition whose counts sum
          to the total.

          Hidden when the count is zero so an install that never hits this state
          sees no extra control — but ALWAYS rendered while the filter is active,
          even at zero. Gating on the count alone unmounted the only control for
          `?invoicing=blocked` the moment the remediation succeeded, leaving an
          applied filter with no way to clear it and an empty state that claimed
          "no order records have been synced yet" (#2100 review). The sibling
          ship-by chip is unconditional for the same reason.
        */}
        {invoicingBlocked || summary?.salesDocumentBlocked ? (
          <Chip tone="error" active={invoicingBlocked} onClick={toggleInvoicingBlocked}>
            {/* The count is omitted until the summary resolves rather than
                defaulted to 0 — asserting a number the client does not have yet
                would be worse than showing none. */}
            Invoicing blocked
            {summary?.salesDocumentBlocked === undefined
              ? ''
              : ` ${summary.salesDocumentBlocked}`}
          </Chip>
        ) : null}
        {/* SLA KPI affordance (#1108) — at-a-glance overdue / at-risk counts.
            The BADGES stay conditional (a zero-count badge is a dead signal),
            but the LINK below is not: see its comment. */}
        <span className="ds-row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
          {slaSummary && (slaSummary.overdue > 0 || slaSummary.atRisk > 0) ? (
            <>
              <StatusBadge tone="error" withDot compact>
                {slaSummary.overdue} overdue
              </StatusBadge>
              <StatusBadge tone="warning" withDot compact>
                {slaSummary.atRisk} at risk
              </StatusBadge>
            </>
          ) : null}
          {/* #2306 — the ranked triage surface; this list keeps SLA as one
              column among many, the risk page makes it the primary axis.

              Rendered UNCONDITIONALLY (#2441 review I3). Gating it on
              `overdue > 0 || atRisk > 0` made this the sole entry point in the
              app to a page whose two most useful states are only reachable when
              nothing is breaching: the `on_track` bucket, and the
              `noDeadlinesAnywhere` empty state whose copy is a *configuration*
              answer ("deadlines come from the marketplace dispatch window") —
              i.e. the diagnostic an install needs, gated behind the condition
              that proves it does not need it. The page's own empty states do
              the talking; only the copy varies here.

              `.nav-link` for the ≥44 px coarse-pointer floor (#2441 review I4)
              — a bare `<a>` gets none of it, and orders is a mobile surface.
              As a flex item the link is blockified, so `min-height` applies. */}
          <Link className="nav-link" to="/orders/dispatch-risk">
            {/* Copy varies with the state, so a clear install is not told to
                "review risk" it does not have — the counts themselves stay on
                the badges beside this link rather than being repeated here. */}
            {slaSummary && (slaSummary.overdue > 0 || slaSummary.atRisk > 0)
              ? 'Review dispatch risk'
              : 'Dispatch risk overview'}
          </Link>
        </span>
        {query.data && (
          <span
            className="text-muted mono tabular"
            style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
          >
            {query.data.total.toLocaleString()} results
          </span>
        )}
      </div>

      {/*
        Lifecycle-phase chips (#2310) — a SECOND orthogonal partition beside the
        health segments above, deliberately NOT a sixth health segment: the KPI
        cards are a partition whose counts must keep summing to the total, and a
        held order is usually also `synced` (ADR-059).

        Visibility follows the invoicing chip (#2100): a zero-count chip is
        hidden so an install that never reaches a phase sees no dead control —
        but the ACTIVE chip is always rendered, even at zero, or the only way to
        clear an applied `?phase=` unmounts the moment its last order moves on.
        `vendor_authoritative` / `held` / `amending` are therefore simply absent
        until Waves 2 and 4 give them producers, which is correct, not a gap.
      */}
      <div
        className="ds-row orders-phase-chips"
        style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}
        role="group"
        aria-label="Filter by lifecycle phase"
      >
        {OrderLifecyclePhaseValues.map((value) => {
          const count = lifecycleSummary?.[PHASE_SUMMARY_KEY[value]];
          const active = phase === value;
          if (!active && !count) return null;
          const meta = ORDER_LIFECYCLE_PHASE_META[value];
          return (
            <Chip
              key={value}
              tone={meta.tone === 'review' ? 'neutral' : meta.tone}
              active={active}
              onClick={() => { togglePhase(value); }}
            >
              {/* The count is omitted until the summary resolves rather than
                  defaulted to 0 — the same rule the invoicing chip follows. */}
              {meta.label}
              {count === undefined ? '' : ` ${count}`}
            </Chip>
          );
        })}
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={columns} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load orders"
          message={query.error.message}
          action={<Button onClick={() => { void query.refetch(); }}>Retry</Button>}
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        health === 'needs_attention' ? (
          // `off`: this arm is reached from the health segment's own click, which is
          // itself the operator-visible signal — no separate announcement is needed.
          <EmptyState
            liveRegion="off"
            title="All clear — nothing needs your attention"
            message="No failed syncs or unmapped orders right now. New issues surface here the moment they happen."
            action={
              <Button onClick={() => { clearAllFilters(setSearchParams); }}>
                View all orders
              </Button>
            }
          />
        ) : invoicingBlocked ? (
          /*
            #2100 — `invoicing=blocked` gets its own copy ahead of the generic
            `hasActiveFilters` arm below: "no orders matched" is technically true
            but uninformative for a state whose entire point is "nothing is
            currently blocked from invoicing" — a good outcome, not a narrowed
            search coming up empty. Checked before `hasActiveFilters` (which would
            otherwise catch it too, since `salesDocumentBlocked` is one of the
            `FILTER_PARAMS`) so this copy isn't shadowed by the generic one.
          */
          <EmptyState
            liveRegion="off"
            title="Nothing is blocked from invoicing"
            message="No order is waiting on an invoicing decision right now."
            action={
              <Button onClick={() => { clearAllFilters(setSearchParams); }}>
                View all orders
              </Button>
            }
          />
        ) : hasActiveFilters ? (
          /*
            #2148 — one arm for every narrowing filter, not one arm per param.
            `health` used to be the only filter with an arm, so `due=breaching`,
            `slaState`, `fulfillmentState`, `sourceConnectionId` and the date
            range all fell through to "No order records have been synced yet" —
            a statement about the whole dataset, read by an operator who has
            thousands of orders and simply filtered to a narrow slice. The
            recovery action was a link to /connections, which left the filter
            applied and pointed at an ingestion problem that did not exist.

            No `liveRegion` override here (defaults to "polite"): unlike its
            sibling arms, this one is reached by a transition from a prior loaded
            table (the operator applies a filter and the table is replaced by this
            card), which is exactly the case `feedback-state.tsx` reserves the
            "polite" default for.
          */
          <EmptyState
            title="No orders in this view"
            message="No orders match the current filters. Clear them to see everything."
            action={
              <Button onClick={() => { clearAllFilters(setSearchParams); }}>
                View all orders
              </Button>
            }
          />
        ) : (
          // `off`: this arm renders on initial page load with no prior loaded state
          // to transition from (an operator landing on an empty, never-synced deployment).
          <EmptyState
            liveRegion="off"
            title="No orders found"
            message="No order records have been synced yet."
            action={
              <Link className="button button--primary" to="/connections">
                Manage connections
              </Link>
            }
          />
        )
      ) : (
        <>
          <DataTable
            caption="Orders"
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
            // Top-aligns every cell in the row (#2091, `.orders-table td`). Row
            // height here comes from the money column's four-item stack, so a
            // middle-aligned Order cell sat below the top-aligned expander and
            // beside a centred checkbox — three anchors in one row.
            className="orders-table"
            stickyLeftColumns={2}
            footer={
              <BulkActionBar
                count={selectedOrders.length}
                itemNoun="order"
                hint={
                  distinctSelectedSources > 1
                    ? `${distinctSelectedSources} sources · max ${BULK_DISPATCH_MAX_ITEMS} per source`
                    : `Max ${BULK_DISPATCH_MAX_ITEMS} per source`
                }
                actions={
                  <>
                    <Button tone="ghost" onClick={clearSelection}>
                      Clear
                    </Button>
                    <Button tone="primary" onClick={() => { setBulkOpen(true); }}>
                      Dispatch {selectedOrders.length}
                    </Button>
                  </>
                }
              />
            }
            expandable={{
              // Non-essential fields (order ref, items, exact ship-by, carrier,
              // created, payment, addresses) live in the accordion (#1620); the
              // row keeps the scannable essentials + status badges.
              renderDetail: (order) => (
                <OrderRowDetail
                  order={order}
                  channelLabel={channelLabel}
                  platformByConnection={platformByConnection}
                />
              ),
              toggleLabel: (order, expanded) =>
                `${expanded ? 'Collapse' : 'Expand'} details for order ${order.internalOrderId}`,
            }}
            // Server-side ordering (#944/#1713): every sortable header (customer,
            // status, and the merged shipment/money columns) renders its own
            // per-label sort control that calls `applySort` directly, so no
            // column is react-table-sortable and `onSortChange` never fires.
            // `manualSorting` keeps react-table from client-sorting the page.
            manualSorting
            cardView={{
              // Per-row select stays usable in the mobile card layout (#1109/#1620).
              select: (order) => renderSelectCheckbox(order),
              // The SAME renderer as the desktop Order column (#2091). Safe to
              // put a link + Copy button here because this page drives its rows
              // with `expandable` and passes no `rowHref`: `DataTableCard` only
              // wraps `title` + `subtitle` in the row's own `<Link>` when a
              // href exists, and nesting interactive content inside that anchor
              // is what bit Invoices (#2090).
              title: renderOrderIdentity,
              subtitle: (order) => {
                const source = channelLabel(platformByConnection.get(order.sourceConnectionId));
                const destPlatform = order.syncStatus[0]
                  ? platformByConnection.get(order.syncStatus[0].destinationConnectionId)
                  : undefined;
                const dest = channelLabel(destPlatform);
                // Multi-destination indicator (#1713) — extra destinations beyond
                // the first, mirroring the desktop order cell.
                const extraDests = order.syncStatus.length > 1 ? order.syncStatus.length - 1 : 0;
                return (
                  <span className="orders-card-sub">
                    {source ? (
                      <span
                        className="channel-pill"
                        data-channel={platformByConnection.get(order.sourceConnectionId)}
                      >
                        {source}
                      </span>
                    ) : null}
                    {dest ? (
                      <span className="text-muted orders-cell-sub">
                        → {dest}
                        {extraDests > 0 ? ` +${extraDests}` : ''}
                      </span>
                    ) : null}
                    <TimeDisplay iso={order.createdAt} format="relative" />
                  </span>
                );
              },
              // Full field set behind a "View full details" disclosure (#1713) —
              // the mobile counterpart of the desktop accordion. Collapsed by
              // default so the card leads with the summary, not a wall of fields.
              collapsibleDetail: true,
              detail: (order) => (
                <OrderRowDetail
                  order={order}
                  channelLabel={channelLabel}
                  platformByConnection={platformByConnection}
                />
              ),
              // Scannable essentials shown before expanding (#1713): a tight
              // facts grid (total / payment / invoice / customer / shipment).
              // The items line that used to head this block moved out with
              // #2091 — the card title now carries the first item name and the
              // `+N` chip, and printing the same two strings twice, 20px apart,
              // is not a summary.
              summary: (order) => {
                const parsed = parsedFor(order);
                const pay = paymentBadge(parsed.paymentStatus);
                const cust = customerName(parsed);
                // Snapshot-only (#1776): method name → method id → pickup name.
                const carrier =
                  parsed.shipping?.methodName ??
                  parsed.shipping?.methodId ??
                  parsed.pickupPoint?.name ??
                  null;
                // Mapping-aware delivery chip (#1793) — same derivation as the
                // desktop cell.
                const deliveryOutcome = deriveDeliveryOutcome({
                  processorKind: order.deliveryResolution?.processorKind,
                  // Typed #1792 source-method fields, to match the detail (see desktop cell).
                  hasMethod: Boolean(
                    order.sourceDeliveryMethodId ?? order.sourceDeliveryMethodName,
                  ),
                  // Snapshot-only divergence (documented): list uses the rollup
                  // fulfillmentState; detail uses booked-shipment presence.
                  isFulfilled:
                    order.fulfillmentState === 'dispatched' ||
                    order.fulfillmentState === 'delivered',
                  processorAvailable: order.deliveryResolution?.processorAvailable,
                  cancelled: parsed.status === 'cancelled',
                });
                const fulfillment = fulfillmentBadge(order.fulfillmentState);
                // "Generate label" only when there's a live OL carrier route
                // (#1799), same gate as the desktop cell — otherwise the passive
                // fulfillment badge (shop-fulfilled / unmapped / disabled / etc.).
                const canGenerateLabel =
                  order.fulfillmentState === 'not-shipped' &&
                  parsed.status !== 'cancelled' &&
                  hasLiveOlCarrierRoute(order.deliveryResolution);
                return (
                  <div className="orders-card-summary">
                    <dl className="orders-card-facts">
                      <div>
                        <dt>Total</dt>
                        <dd className="mono tabular">
                          {parsed.totals
                            ? formatCurrency(parsed.totals.total, parsed.totals.currency, locale)
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>Payment</dt>
                        <dd>
                          {pay ? (
                            <StatusBadge tone={pay.tone} withDot compact>
                              {pay.label}
                            </StatusBadge>
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Invoice</dt>
                        <dd>
                          {/* SAME component as the desktop cell — this used to be a
                              hand-duplicated parallel render path, and the two
                              diverged. */}
                          <OrderInvoicingCell
                            internalOrderId={order.internalOrderId}
                            invoice={parsed.invoice}
                            blockReason={order.salesDocumentBlockReason}
                            unresolvedReason={order.salesDocumentUnresolvedReason}
                            hasInvoicingCapability={hasInvoicingCapability}
                            layout="row"
                            emptyFallback="—"
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Customer</dt>
                        <dd>{cust ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Packed</dt>
                        <dd>
                          {/* SAME component as the desktop cell. On a narrow
                              viewport the desktop tick becomes a labelled fact,
                              so the empty case needs a dash rather than nothing —
                              a <dd> may not be empty. */}
                          <OrderPackedTick
                            packedAt={order.packedAt}
                            layout="row"
                            emptyFallback="—"
                          />
                        </dd>
                      </div>
                      <div className="orders-card-facts__wide">
                        <dt>Shipment</dt>
                        <dd>
                          <span className="orders-cell-stack">
                            {/* CTA deferred under the Awaiting-label chip, mirroring
                                the desktop shipment column. */}
                            {canGenerateLabel ? null : (
                              <StatusBadge tone={fulfillment.tone} withDot compact>
                                {fulfillment.label}
                              </StatusBadge>
                            )}
                            {/* Owner badge + quiet takeover marker, no rider chip
                                and no button - mirrors the desktop cell. */}
                            <DeliveryOutcomeChip
                              outcome={deliveryOutcome}
                              owner={resolveDeliveryOwner(
                                order.deliveryResolution,
                                order.deliveryRider,
                                connectionInfoById,
                              )}
                              switchable={
                                deliveryOutcome === 'shop-fulfilled' &&
                                isTakeoverRider(order.deliveryRider)
                              }
                            />
                            {canGenerateLabel ? (
                              <Link
                                className="orders-row-cta"
                                to={`/orders/${order.internalOrderId}#shipment`}
                              >
                                <span className="orders-row-cta__plus" aria-hidden="true">
                                  +
                                </span>{' '}
                                Generate label
                              </Link>
                            ) : null}
                            {carrier ? (
                              <span className="text-muted orders-cell-sub" title={carrier}>
                                {carrier}
                              </span>
                            ) : null}
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              },
              meta: (order) => {
                const h = deriveOrderHealth(order);
                const shipBy = formatShipBy(order.dispatchByAt ?? null);
                const sla = slaBadge(order.slaState);
                const fulfillment = fulfillmentBadge(order.fulfillmentState);
                const failed = order.syncStatus.find((s) => s.status === 'failed');
                const isRetrying =
                  retryMutation.isPending &&
                  retryMutation.variables?.internalOrderId === order.internalOrderId;
                return (
                  <span className="data-table__badge-row">
                    <StatusBadge tone={h.tone} withDot compact>
                      {h.label}
                    </StatusBadge>
                    <OrderPhaseBadge phase={order.lifecyclePhase} compact />
                    <StatusBadge tone={fulfillment.tone} withDot compact>
                      {fulfillment.label}
                    </StatusBadge>
                    {sla ? (
                      <StatusBadge tone={sla.tone} withDot compact>
                        {sla.label}
                      </StatusBadge>
                    ) : shipBy ? (
                      <StatusBadge tone={SHIP_BY_TONE[shipBy.level]} withDot compact>
                        {order.dispatchByEstimated ? (
                          <span
                            className="text-muted"
                            aria-label="Estimated"
                            title="OpenLinker estimate - not a marketplace-confirmed deadline"
                          >
                            est.{' '}
                          </span>
                        ) : null}
                        {shipBy.remaining}
                      </StatusBadge>
                    ) : null}
                    {failed &&
                    order.recordStatus !== 'awaiting_mapping' &&
                    order.recordStatus !== 'source_deleted' &&
                    retryWrite.visible ? (
                      <ReadOnlyLock
                        active={retryWrite.demoReadOnly}
                        message={DEMO_READ_ONLY_ACTION_MESSAGE}
                      >
                        <Button
                          tone="ghost"
                          className="button--sm"
                          disabled={isRetrying || retryWrite.demoReadOnly}
                          onClick={() => { handleRetry(order.internalOrderId, failed.destinationConnectionId); }}
                        >
                          {isRetrying ? 'Retrying…' : 'Retry'}
                        </Button>
                      </ReadOnlyLock>
                    ) : null}
                  </span>
                );
              },
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div className="pagination__actions">
              <Button disabled={!hasPrev} onClick={() => { setOffset(offset - PAGE_SIZE); }}>
                Previous
              </Button>
              <Button disabled={!hasNext} onClick={() => { setOffset(offset + PAGE_SIZE); }}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <BulkDispatchDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        orders={selectedOrders}
        channelLabelFor={channelLabelForBulk}
        onComplete={clearSelection}
      />
    </PageLayout>
  );
}
