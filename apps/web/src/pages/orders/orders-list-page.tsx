/**
 * Orders List Page
 *
 * Cockpit-style operator surface for the orders backbone (#778). Composes:
 * — KPI strip (4 MetricCards backed by cheap count-only `useOrdersQuery`
 *   calls; cached per filter via TanStack query keys),
 * — chip-based status filter (`Chip` + `DropdownMenu`, URL-state),
 * — dense `DataTable` with `EntityLabel` identity, channel-pill (resolved
 *   via `useConnectionsQuery`), pulse-on-syncing `StatusBadge`, and
 *   mono+tabular totals formatted through the i18n seam (#612).
 *
 * Pure presentation — all data flows through feature query hooks; no
 * transport logic at this layer.
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
import { Chip } from '../../shared/ui/chip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown-menu';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { MetricCard } from '../../shared/ui/metric-card';
import { EntityLabel } from '../../shared/ui/entity-label';
import { useTranslation } from '../../shared/i18n';
import type { LocaleCode } from '../../shared/i18n';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';
import type {
  OrderRecord,
  OrderFilters,
  OrderSyncStatusValue,
} from '../../features/orders/api/orders.types';
import { OrderSyncStatusValues } from '../../features/orders/api/orders.types';
import { useConnectionsQuery } from '../../features/connections';

const PAGE_SIZE = 20;

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
};

const STATUS_FILTER_LABELS: Record<OrderSyncStatusValue, string> = {
  pending: 'Pending',
  syncing: 'Syncing',
  synced: 'Synced',
  failed: 'Failed',
};

const CHANNEL_LABELS: Record<string, string> = {
  allegro: 'Allegro',
  prestashop: 'PrestaShop',
  amazon: 'Amazon',
  shopify: 'Shopify',
};

/**
 * Type-guard for the syncStatus URL param. `OrderSyncStatusValues.includes`
 * widens the haystack to `readonly string[]` so the predicate accepts any
 * string and narrows cleanly to `OrderSyncStatusValue` without a cast.
 */
function isOrderSyncStatus(value: string | null): value is OrderSyncStatusValue {
  return value !== null && (OrderSyncStatusValues as readonly string[]).includes(value);
}

/**
 * Resolve the per-row total via the i18n seam (#612). Currency varies per row
 * so we instantiate per call — locale comes from the LocaleProvider rather
 * than being pinned to en-US. Mirrors `localeToBcp47` from `useNumberFormat`
 * to keep the seam single-source-of-truth on locale resolution.
 */
function formatCurrency(amount: number, currency: string, locale: LocaleCode): string {
  const bcp47 = locale === 'en' ? 'en-US' : locale;
  return new Intl.NumberFormat(bcp47, { style: 'currency', currency }).format(amount);
}

/**
 * Cockpit-style "data freshness" line — the freshest `updatedAt` across
 * visible rows, rendered as a locale-aware HH:MM. The temporal eyebrow is
 * the operator's "how stale is this view" signal; same locale-resolution
 * path as `formatCurrency` so the i18n seam stays single-source-of-truth.
 */
function formatFreshness(items: readonly OrderRecord[], locale: LocaleCode): string | null {
  if (items.length === 0) return null;
  let mostRecentMs = 0;
  for (const item of items) {
    const ms = Date.parse(item.updatedAt);
    if (Number.isFinite(ms) && ms > mostRecentMs) mostRecentMs = ms;
  }
  if (mostRecentMs === 0) return null;
  const bcp47 = locale === 'en' ? 'en-US' : locale;
  const time = new Intl.DateTimeFormat(bcp47, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(mostRecentMs),
  );
  return `Synced ${time}`;
}

export function OrdersListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);
  const { locale } = useTranslation();

  const rawSyncStatus = searchParams.get('syncStatus');
  const syncStatus = isOrderSyncStatus(rawSyncStatus) ? rawSyncStatus : undefined;
  const sourceConnectionId = searchParams.get('sourceConnectionId') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: OrderFilters = {
    syncStatus,
    sourceConnectionId: sourceConnectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useOrdersQuery(filters, pagination);

  // KPI strip — four cheap count-only queries. limit:1 ships ~empty results;
  // we only read `.total`. Each call has its own queryKey so TanStack caches
  // them independently across the app session.
  const allOrdersKpi = useOrdersQuery(undefined, { limit: 1 });
  const syncedKpi = useOrdersQuery({ syncStatus: 'synced' }, { limit: 1 });
  const pendingKpi = useOrdersQuery({ syncStatus: 'pending' }, { limit: 1 });
  const failedKpi = useOrdersQuery({ syncStatus: 'failed' }, { limit: 1 });

  // Channel lookup: build connectionId → platformType once per
  // connections-query data change. Already cached app-wide via TanStack.
  const connectionsQuery = useConnectionsQuery();
  const platformByConnection = useMemo(() => {
    const map = new Map<string, string>();
    (connectionsQuery.data ?? []).forEach((c) => {
      map.set(c.id, c.platformType);
    });
    return map;
  }, [connectionsQuery.data]);

  const columns: DataTableColumn<OrderRecord>[] = useMemo(
    () => [
      {
        id: 'createdAt',
        header: 'Created',
        cell: (order) => <TimeDisplay iso={order.createdAt} format="date" />,
        accessor: (order) => order.createdAt,
        sortable: true,
      },
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
        id: 'channel',
        header: 'Channel',
        cell: (order) => {
          const platform = platformByConnection.get(order.sourceConnectionId);
          if (!platform) {
            return <span className="text-muted">—</span>;
          }
          return (
            <span className="channel-pill" data-channel={platform}>
              {CHANNEL_LABELS[platform] ?? platform}
            </span>
          );
        },
        hideBelow: 768,
      },
      {
        id: 'syncStatus',
        header: 'Sync Status',
        cell: (order) => {
          if (order.syncStatus.length === 0) {
            return <span className="text-muted">—</span>;
          }
          return (
            <span className="data-table__badge-row">
              {order.syncStatus.map((s) => (
                <StatusBadge
                  key={s.destinationConnectionId}
                  tone={SYNC_STATUS_TONES[s.status]}
                  pulse={s.status === 'syncing'}
                  withDot={s.status !== 'syncing'}
                  compact
                >
                  {s.status}
                </StatusBadge>
              ))}
            </span>
          );
        },
      },
      {
        id: 'total',
        header: 'Total',
        align: 'right',
        cell: (order) => {
          const parsed = parseOrderSnapshot(order.orderSnapshot);
          if (!parsed.totals) {
            return <span className="text-muted">—</span>;
          }
          return (
            <span className="mono tabular">
              {formatCurrency(parsed.totals.total, parsed.totals.currency, locale)}
            </span>
          );
        },
      },
    ],
    [locale, platformByConnection],
  );

  function handleStatusFilterChange(next: OrderSyncStatusValue | ''): void {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next) {
        p.set('syncStatus', next);
      } else {
        p.delete('syncStatus');
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

  function clearFilters(): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('syncStatus');
      next.delete('sourceConnectionId');
      next.delete('offset');
      return next;
    });
  }

  const filtersActive = Boolean(syncStatus || sourceConnectionId);
  const total = query.data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Temporal eyebrow — freshest `updatedAt` across the visible page. Falls
  // back to the static "Operations" label when nothing has loaded yet, so the
  // header layout is stable on first paint.
  const freshness = useMemo(
    () => formatFreshness(query.data?.items ?? [], locale),
    [query.data?.items, locale],
  );

  // `R` keyboard shortcut — operator-cockpit affordance for "refresh
  // everything visible." Skips when modifier keys are pressed (Cmd+R is
  // browser reload) and when a text input has focus.
  function refreshAll(): void {
    void query.refetch();
    void allOrdersKpi.refetch();
    void syncedKpi.refetch();
    void pendingKpi.refetch();
    void failedKpi.refetch();
  }

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
    // Empty deps: `refreshAll` closes over the five React-Query refetch
    // handles, whose identities are stable per query instance — the
    // listener doesn't need to rebind on every render. The handler will
    // see fresh refetch handles at fire-time via the closure.
  }, []);

  return (
    <PageLayout
      eyebrow={freshness ?? 'Operations'}
      title="Orders"
      actions={
        <>
          <Button tone="ghost" className="button--sm" onClick={refreshAll}>
            Refresh
            <span className="button__shortcut">R</span>
          </Button>
          <Link to="/orders/failed" className="button button--ghost">
            Failed Orders
          </Link>
        </>
      }
    >
      {/* KPI strip — counts by sync status. Tone-tinted; '—' placeholders
          while queries resolve so the layout stays stable. */}
      <div className="ds-grid ds-grid--4">
        <MetricCard
          label="All orders"
          value={allOrdersKpi.data ? allOrdersKpi.data.total : '—'}
        />
        <MetricCard
          label="Synced"
          tone="success"
          value={syncedKpi.data ? syncedKpi.data.total : '—'}
        />
        <MetricCard
          label="Pending"
          tone="warning"
          value={pendingKpi.data ? pendingKpi.data.total : '—'}
        />
        <MetricCard
          label="Failed"
          tone="error"
          value={failedKpi.data ? failedKpi.data.total : '—'}
        />
      </div>

      {/* Chip filter row — Status filter (active when set). Status chip
          serves as both indicator and trigger via DropdownMenu. */}
      <div className="ds-row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip active={Boolean(syncStatus)} aria-label="Filter by sync status">
              Status: {syncStatus ? STATUS_FILTER_LABELS[syncStatus] : 'All'}
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => { handleStatusFilterChange(''); }}>
              All
            </DropdownMenuItem>
            {OrderSyncStatusValues.map((status) => (
              <DropdownMenuItem
                key={status}
                onSelect={() => { handleStatusFilterChange(status); }}
              >
                {STATUS_FILTER_LABELS[status]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {filtersActive && (
          <Button
            tone="ghost"
            className="button--sm"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        )}

        {/* Right-aligned results-count signal. Surfaces the total above
            the table — operators don't need to scan to the paginator to
            tell whether the filter is doing anything. */}
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
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title="No orders found"
          message={
            filtersActive
              ? 'No orders match the current filters.'
              : 'No order records have been synced yet.'
          }
          action={
            filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : (
              <Link className="button button--primary" to="/connections">
                Manage connections
              </Link>
            )
          }
        />
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
              subtitle: (order) => <TimeDisplay iso={order.createdAt} format="date" />,
              meta: (order) => {
                const platform = platformByConnection.get(order.sourceConnectionId);
                const primary = order.syncStatus[0];
                return (
                  <span className="data-table__badge-row">
                    {platform && (
                      <span className="channel-pill" data-channel={platform}>
                        {CHANNEL_LABELS[platform] ?? platform}
                      </span>
                    )}
                    {primary && (
                      <StatusBadge
                        tone={SYNC_STATUS_TONES[primary.status]}
                        pulse={primary.status === 'syncing'}
                        withDot={primary.status !== 'syncing'}
                        compact
                      >
                        {primary.status}
                      </StatusBadge>
                    )}
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
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                Previous
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
