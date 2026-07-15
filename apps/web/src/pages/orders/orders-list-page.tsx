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
 * — a dense `DataTable` whose rows lead with human identity (`EntityLabel`,
 *   showing a shortened channel order reference — #939), surface customer +
 *   contents (parsed from `orderSnapshot`, with an email fallback when the
 *   source omits a buyer name — #939), the source→destination channel, one
 *   reconciled health `StatusBadge` (`deriveOrderHealth`, replacing the
 *   per-destination list and the blank "—"), a "Created" time, a **Ship-by**
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
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { EntityLabel } from '../../shared/ui/entity-label';
import { useToast } from '../../shared/ui/toast-provider';
import { formatShipBy, type ShipByLevel } from '../../shared/format/format-ship-by';
import { useTranslation, getBcp47Locale } from '../../shared/i18n';
import type { LocaleCode } from '../../shared/i18n';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useOrderStatusSummaryQuery } from '../../features/orders/hooks/use-order-status-summary-query';
import { useOrderSlaSummaryQuery } from '../../features/orders/hooks/use-order-sla-summary-query';
import { useRetryOrderDestinationMutation } from '../../features/orders/hooks/use-retry-order-destination-mutation';
import { usePermission } from '../../shared/auth/use-permission';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';
import { deriveOrderHealth, slaBadge, fulfillmentBadge } from '../../features/orders/lib/order-health';
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
} from '../../features/orders/api/orders.types';
import {
  OrderHealthValues,
  OrderSortValues,
  OrderSortDirectionValues,
  SlaStateValues,
  FulfillmentRollupStateValues,
} from '../../features/orders/api/orders.types';
import { useConnectionsQuery } from '../../features/connections';

const PAGE_SIZE = 20;

const CHANNEL_LABELS: Record<string, string> = {
  allegro: 'Allegro',
  prestashop: 'PrestaShop',
  amazon: 'Amazon',
  shopify: 'Shopify',
};

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
 * Sortable-column wiring (#944). The table column `id` and the server sort key
 * diverge only for ship-by (`shipBy` column ↔ `dispatchBy` key); the rest match.
 * Columns not in these maps (Order / Channel / Payment / actions) aren't sortable.
 */
const SORT_KEY_TO_COLUMN: Record<OrderSortValue, string> = {
  dispatchBy: 'shipBy',
  createdAt: 'createdAt',
  customer: 'customer',
  items: 'items',
  status: 'status',
  total: 'total',
  fulfillment: 'fulfillment',
};
const COLUMN_TO_SORT_KEY: Record<string, OrderSortValue> = {
  shipBy: 'dispatchBy',
  createdAt: 'createdAt',
  customer: 'customer',
  items: 'items',
  status: 'status',
  total: 'total',
  fulfillment: 'fulfillment',
};

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

/**
 * Order-column primary label (#939). The source marketplace often has no
 * human-friendly order number — Allegro's `orderNumber` is its `checkoutFormId`,
 * a 36-char UUID that reads as noise when rendered verbatim. Shorten long ids to
 * a `head…tail` form so the cell reads as a reference; short numbers (most
 * shops) pass through untouched. Returns `''` when no order number is present so
 * the caller can fall back to the internal id. The marketplace itself is already
 * conveyed by the dedicated Channel column, so no channel prefix is added here.
 */
function formatOrderRef(orderNumber: string | undefined): string {
  if (!orderNumber) return '';
  if (orderNumber.length <= 18) return orderNumber;
  return `${orderNumber.slice(0, 8)}…${orderNumber.slice(-6)}`;
}

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

  const retryMutation = useRetryOrderDestinationMutation();
  const canRetryOrder = usePermission('orders:write');

  // Channel lookup: connectionId → platformType, cached app-wide via TanStack.
  const connectionsQuery = useConnectionsQuery();
  const platformByConnection = useMemo(() => {
    const map = new Map<string, string>();
    (connectionsQuery.data ?? []).forEach((c) => {
      map.set(c.id, c.platformType);
    });
    return map;
  }, [connectionsQuery.data]);

  const channelLabel = (platform: string | undefined): string | undefined =>
    platform ? (CHANNEL_LABELS[platform] ?? platform) : undefined;

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
          const parsed = parseOrderSnapshot(order.orderSnapshot);
          return (
            <EntityLabel
              id={order.internalOrderId}
              name={formatOrderRef(parsed.orderNumber) || order.internalOrderId}
              to={order.internalOrderId}
            />
          );
        },
      },
      {
        id: 'customer',
        header: 'Customer',
        sortable: true,
        cell: (order) => {
          const parsed = parseOrderSnapshot(order.orderSnapshot);
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
        header: 'Status',
        sortable: true,
        cell: (order) => {
          const h = deriveOrderHealth(order);
          return (
            <span className="orders-cell-stack">
              <StatusBadge tone={h.tone} withDot compact>
                {h.label}
              </StatusBadge>
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
        id: 'shipBy',
        header: 'Ship-by',
        sortable: true,
        cell: (order) => {
          const due = order.dispatchByAt ?? null;
          const view = formatShipBy(due);
          if (!due || !view) return <span className="text-muted">—</span>;
          // BE-owned SLA bucket drives the badge (#1108) — single source of truth
          // the filter agrees with; the live countdown stays client-side. Falls
          // back to the client-derived urgency for older payloads without slaState.
          // The exact ship-by date moved to the expandable detail panel (#1620).
          const sla = slaBadge(order.slaState);
          const tone = sla ? sla.tone : SHIP_BY_TONE[view.level];
          const label = sla ? sla.label : view.remaining;
          return (
            <span className="orders-cell-stack">
              <StatusBadge tone={tone} withDot compact>
                {label}
              </StatusBadge>
              {sla ? (
                <span className="text-muted orders-cell-sub mono tabular">{view.remaining}</span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: 'fulfillment',
        header: 'Fulfillment',
        sortable: true,
        cell: (order) => {
          const f = fulfillmentBadge(order.fulfillmentState);
          return (
            <StatusBadge tone={f.tone} withDot compact>
              {f.label}
            </StatusBadge>
          );
        },
      },
      {
        id: 'total',
        header: 'Total',
        align: 'right',
        sortable: true,
        cell: (order) => {
          const parsed = parseOrderSnapshot(order.orderSnapshot);
          if (!parsed.totals) return <span className="text-muted">—</span>;
          return (
            <span className="mono tabular">
              {formatCurrency(parsed.totals.total, parsed.totals.currency, locale)}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        align: 'right',
        cell: (order) => {
          const failed = order.syncStatus.find((s) => s.status === 'failed');
          if (order.recordStatus === 'awaiting_mapping' || !failed || !canRetryOrder) return null;
          const isRetrying =
            retryMutation.isPending &&
            retryMutation.variables?.internalOrderId === order.internalOrderId;
          return (
            <Button
              tone="ghost"
              className="button--sm"
              disabled={isRetrying}
              onClick={() => { handleRetry(order.internalOrderId, failed.destinationConnectionId); }}
            >
              {isRetrying ? 'Retrying…' : 'Retry'}
            </Button>
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
      retryMutation.isPending,
      retryMutation.variables,
      // Selection state — the select column re-renders as checkboxes toggle (#1109).
      selectedIds,
      atCapSources,
      headerCheckboxState,
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

  // Controlled (server-side) sort state for the DataTable (#944): the active
  // sort key → its table column id, plus direction. Structurally a
  // `SortingState` ({ id, desc }[]) without importing the react-table type.
  const sortingState = [{ id: SORT_KEY_TO_COLUMN[sort], desc: dir === 'desc' }];

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
          onClick={() => { setHealthFilter(null); }}
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
            onClick={() => { setHealthFilter(segment.key); }}
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
        {/* SLA KPI affordance (#1108) — at-a-glance overdue / at-risk counts. */}
        {slaSummary && (slaSummary.overdue > 0 || slaSummary.atRisk > 0) && (
          <span className="ds-row" style={{ gap: 'var(--space-2)', alignItems: 'center' }}>
            <StatusBadge tone="error" withDot compact>
              {slaSummary.overdue} overdue
            </StatusBadge>
            <StatusBadge tone="warning" withDot compact>
              {slaSummary.atRisk} at risk
            </StatusBadge>
          </span>
        )}
        {query.data && (
          <span
            className="text-muted mono tabular"
            style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
          >
            {query.data.total.toLocaleString()} results
          </span>
        )}
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
          <EmptyState
            liveRegion="off"
            title="All clear — nothing needs your attention"
            message="No failed syncs or unmapped orders right now. New issues surface here the moment they happen."
            action={<Button onClick={() => { setHealthFilter(null); }}>View all orders</Button>}
          />
        ) : health !== undefined ? (
          <EmptyState
            liveRegion="off"
            title="No orders in this view"
            message="No orders match the current filter."
            action={<Button onClick={() => { setHealthFilter(null); }}>View all orders</Button>}
          />
        ) : (
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
            manualSorting
            sort={sortingState}
            onSortChange={(updater) => {
              // Server-side sort (#944): take the column the user interacted
              // with (the new state's column, or the active one when react-table
              // cleared on a third click), then apply our own asc⇄desc toggle —
              // same column flips, a new column starts at its default direction.
              const next =
                typeof updater === 'function' ? updater(sortingState) : updater;
              const clickedColumnId =
                next.length > 0 ? next[0].id : SORT_KEY_TO_COLUMN[sort];
              const key = COLUMN_TO_SORT_KEY[clickedColumnId];
              if (!key) return;
              const nextDir: OrderSortDirection =
                key === sort ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[key];
              setSearchParams((prev) => {
                const p = new URLSearchParams(prev);
                p.set('sort', key);
                p.set('dir', nextDir);
                p.delete('offset');
                return p;
              });
            }}
            cardView={{
              // Per-row select stays usable in the mobile card layout (#1109/#1620).
              select: (order) => renderSelectCheckbox(order),
              title: (order) => {
                const parsed = parseOrderSnapshot(order.orderSnapshot);
                return (
                  <EntityLabel
                    id={order.internalOrderId}
                    name={formatOrderRef(parsed.orderNumber) || order.internalOrderId}
                    to={order.internalOrderId}
                  />
                );
              },
              subtitle: (order) => <TimeDisplay iso={order.createdAt} format="relative" />,
              // Full field set below the badges — the mobile counterpart of the
              // desktop accordion; a collapsed card still shows every field (#1620).
              detail: (order) => (
                <OrderRowDetail
                  order={order}
                  channelLabel={channelLabel}
                  platformByConnection={platformByConnection}
                />
              ),
              meta: (order) => {
                const h = deriveOrderHealth(order);
                const source = channelLabel(platformByConnection.get(order.sourceConnectionId));
                const shipBy = formatShipBy(order.dispatchByAt ?? null);
                const sla = slaBadge(order.slaState);
                const fulfillment = fulfillmentBadge(order.fulfillmentState);
                const failed = order.syncStatus.find((s) => s.status === 'failed');
                const isRetrying =
                  retryMutation.isPending &&
                  retryMutation.variables?.internalOrderId === order.internalOrderId;
                return (
                  <span className="data-table__badge-row">
                    {source && (
                      <span
                        className="channel-pill"
                        data-channel={platformByConnection.get(order.sourceConnectionId)}
                      >
                        {source}
                      </span>
                    )}
                    <StatusBadge tone={h.tone} withDot compact>
                      {h.label}
                    </StatusBadge>
                    <StatusBadge tone={fulfillment.tone} withDot compact>
                      {fulfillment.label}
                    </StatusBadge>
                    {sla ? (
                      <StatusBadge tone={sla.tone} withDot compact>
                        {sla.label}
                      </StatusBadge>
                    ) : shipBy ? (
                      <StatusBadge tone={SHIP_BY_TONE[shipBy.level]} withDot compact>
                        {shipBy.remaining}
                      </StatusBadge>
                    ) : null}
                    {failed && order.recordStatus !== 'awaiting_mapping' && canRetryOrder ? (
                      <Button
                        tone="ghost"
                        className="button--sm"
                        disabled={isRetrying}
                        onClick={() => { handleRetry(order.internalOrderId, failed.destinationConnectionId); }}
                      >
                        {isRetrying ? 'Retrying…' : 'Retry'}
                      </Button>
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

          {/* Bulk dispatch (#1109) — multi-select → batch generate-labels. The
              cap is per source; a selection may span sources (dispatched in
              per-source groups). */}
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
