/**
 * Orders List Page
 *
 * Operator triage queue for the orders backbone (#778, redesigned #929).
 * Composes:
 * — status segments (5 clickable `MetricCard`s backed by the single
 *   `/orders/status-summary` count endpoint) that **partition** the order set,
 *   so the counts sum to the total and double as the `health` URL-state filter;
 * — a dense `DataTable` whose rows lead with human identity (`EntityLabel`),
 *   surface customer + contents (parsed from `orderSnapshot`), the source→
 *   destination channel, one reconciled health `StatusBadge` (`deriveOrderHealth`,
 *   replacing the per-destination list and the blank "—"), an honest "Created"
 *   time, ghost Ship-by / Payment columns (capture-gap epic #925), and an inline
 *   Retry for failed rows;
 * — loading / error / empty (incl. all-clear) states via shared feedback prims.
 *
 * Pure presentation — all data flows through feature query hooks; no transport
 * logic at this layer.
 *
 * @module pages/orders
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge } from '../../shared/ui/status-badge';
import { MetricCard, type MetricCardTone } from '../../shared/ui/metric-card';
import { EntityLabel } from '../../shared/ui/entity-label';
import { useToast } from '../../shared/ui/toast-provider';
import { useTranslation, getBcp47Locale } from '../../shared/i18n';
import type { LocaleCode } from '../../shared/i18n';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useOrderStatusSummaryQuery } from '../../features/orders/hooks/use-order-status-summary-query';
import { useRetryOrderDestinationMutation } from '../../features/orders/hooks/use-retry-order-destination-mutation';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';
import { deriveOrderHealth } from '../../features/orders/lib/order-health';
import type {
  OrderRecord,
  OrderFilters,
  OrderHealthValue,
  OrderHealthSummary,
} from '../../features/orders/api/orders.types';
import { OrderHealthValues } from '../../features/orders/api/orders.types';
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

/**
 * Resolve the per-row total via the i18n seam (#612). Currency varies per row
 * so we instantiate per call; locale comes from the LocaleProvider.
 */
function formatCurrency(amount: number, currency: string, locale: LocaleCode): string {
  return new Intl.NumberFormat(getBcp47Locale(locale), { style: 'currency', currency }).format(
    amount,
  );
}

/** Buyer name from the snapshot's shipping address — null when absent. */
function customerName(parsed: ReturnType<typeof parseOrderSnapshot>): string | null {
  const a = parsed.shippingAddress;
  if (!a) return null;
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
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
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);
  const { locale } = useTranslation();
  const { showToast } = useToast();

  const rawHealth = searchParams.get('health');
  const health = isOrderHealth(rawHealth) ? rawHealth : undefined;
  const sourceConnectionId = searchParams.get('sourceConnectionId') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: OrderFilters = {
    health,
    sourceConnectionId: sourceConnectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useOrdersQuery(filters, pagination);

  // Single count endpoint — partitions the set, so segment counts sum to total.
  // Scoped by source only (the table's other axis); `health` is intentionally
  // never part of the summary scope.
  const summaryScope = useMemo(
    () => ({ sourceConnectionId: sourceConnectionId || undefined }),
    [sourceConnectionId],
  );
  const summaryQuery = useOrderStatusSummaryQuery(summaryScope);
  const summary = summaryQuery.data;

  const retryMutation = useRetryOrderDestinationMutation();

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

  const columns: DataTableColumn<OrderRecord>[] = useMemo(
    () => [
      {
        id: 'order',
        header: 'Order',
        cell: (order) => {
          const parsed = parseOrderSnapshot(order.orderSnapshot);
          return (
            <EntityLabel
              id={order.internalOrderId}
              name={parsed.orderNumber ?? order.internalOrderId}
            />
          );
        },
      },
      {
        id: 'customer',
        header: 'Customer',
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
        hideBelow: 768,
      },
      {
        id: 'items',
        header: 'Items',
        cell: (order) => {
          const parsed = parseOrderSnapshot(order.orderSnapshot);
          const count = parsed.items.length;
          if (count === 0) return <span className="text-muted">—</span>;
          const first = parsed.items[0]?.name;
          return (
            <span className="orders-cell-stack">
              <span>
                {count} {count === 1 ? 'item' : 'items'}
              </span>
              {first ? <span className="text-muted orders-cell-sub">{first}</span> : null}
            </span>
          );
        },
        hideBelow: 1024,
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
        hideBelow: 768,
      },
      {
        id: 'status',
        header: 'Status',
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
        cell: () => <span className="orders-ghost" title="Dispatch SLA — arrives with #927">soon</span>,
        hideBelow: 1024,
      },
      {
        id: 'createdAt',
        header: 'Created',
        cell: (order) => <TimeDisplay iso={order.createdAt} format="relative" />,
        accessor: (order) => order.createdAt,
        sortable: true,
      },
      {
        id: 'payment',
        header: 'Payment',
        cell: () => <span className="orders-ghost" title="Payment status — arrives with #928">soon</span>,
        hideBelow: 1024,
      },
      {
        id: 'total',
        header: 'Total',
        align: 'right',
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
          if (order.recordStatus === 'awaiting_mapping' || !failed) return null;
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
    [locale, platformByConnection, retryMutation.isPending, retryMutation.variables],
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
  }

  // `R` keyboard shortcut — operator-cockpit "refresh everything visible".
  useEffect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
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

      <div className="ds-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
            rowHref={(order) => order.internalOrderId}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (order) => {
                const parsed = parseOrderSnapshot(order.orderSnapshot);
                return (
                  <EntityLabel
                    id={order.internalOrderId}
                    name={parsed.orderNumber ?? order.internalOrderId}
                  />
                );
              },
              subtitle: (order) => <TimeDisplay iso={order.createdAt} format="relative" />,
              meta: (order) => {
                const h = deriveOrderHealth(order);
                const source = channelLabel(platformByConnection.get(order.sourceConnectionId));
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
                    {failed && order.recordStatus !== 'awaiting_mapping' ? (
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
        </>
      )}
    </PageLayout>
  );
}
