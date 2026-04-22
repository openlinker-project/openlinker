import { type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { TimeDisplay } from '../../shared/ui/time-display';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import type { OrderRecord, OrderFilters, OrderSyncStatusValue } from '../../features/orders/api/orders.types';
import { OrderSyncStatusValues } from '../../features/orders/api/orders.types';

const PAGE_SIZE = 20;

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
};

const COLUMNS: DataTableColumn<OrderRecord>[] = [
  {
    id: 'internalOrderId',
    header: 'Order ID',
    cell: (order) => <span className="mono-text">{order.internalOrderId}</span>,
  },
  {
    id: 'sourceConnectionId',
    header: 'Source Connection',
    cell: (order) => <span className="mono-text">{order.sourceConnectionId}</span>,
    hideBelow: 768,
  },
  {
    id: 'customerId',
    header: 'Customer',
    cell: (order) =>
      order.customerId ? (
        <span className="mono-text">{order.customerId}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
    hideBelow: 1024,
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
    id: 'createdAt',
    header: 'Created',
    cell: (order) => <TimeDisplay iso={order.createdAt} format="date" />,
    accessor: (order) => order.createdAt,
    sortable: true,
  },
];

export function OrdersListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);

  const syncStatus = (searchParams.get('syncStatus') as OrderSyncStatusValue | null) ?? undefined;
  const sourceConnectionId = searchParams.get('sourceConnectionId') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const filters: OrderFilters = {
    syncStatus: syncStatus && OrderSyncStatusValues.includes(syncStatus) ? syncStatus : undefined,
    sourceConnectionId: sourceConnectionId || undefined,
  };
  const pagination = { limit: PAGE_SIZE, offset };

  const query = useOrdersQuery(filters, pagination);

  function handleStatusFilterChange(value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('syncStatus', value);
      } else {
        next.delete('syncStatus');
      }
      next.delete('offset');
      return next;
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

  return (
    <PageLayout
      eyebrow="Operations"
      title="Orders"
      description="Order monitoring — track sync status and troubleshoot failures."
      actions={
        <Link to="/orders/failed" className="button button--ghost">
          Failed Orders
        </Link>
      }
    >
      {/* Filter bar */}
      <div className="toolbar">
        <Select
          aria-label="Filter by sync status"
          value={syncStatus ?? ''}
          onChange={(e) => { handleStatusFilterChange(e.target.value); }}
        >
          <option value="">All statuses</option>
          {OrderSyncStatusValues.map((status) => (
            <option key={status} value={status}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <DataTableSkeleton columns={COLUMNS} />
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
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
            rowHref={(order) => order.internalOrderId}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (order) => order.internalOrderId,
              subtitle: (order) => <TimeDisplay iso={order.createdAt} format="date" />,
              meta: (order) =>
                order.syncStatus[0] ? (
                  <StatusBadge tone={SYNC_STATUS_TONES[order.syncStatus[0].status]} compact>
                    {order.syncStatus[0].status}
                  </StatusBadge>
                ) : null,
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
