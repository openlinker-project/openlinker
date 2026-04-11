import { type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
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
  },
  {
    id: 'syncStatus',
    header: 'Sync Status',
    cell: (order) => {
      if (order.syncStatus.length === 0) {
        return <span className="text-muted">—</span>;
      }
      return (
        <span style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
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
    cell: (order) => new Date(order.createdAt).toLocaleDateString(),
  },
  {
    id: 'detail',
    header: '',
    cell: (order) => (
      <Link to={order.internalOrderId} className="button button--ghost button--compact">
        View
      </Link>
    ),
  },
];

export function OrdersListPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

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
        <LoadingState
          liveRegion="off"
          title="Loading orders"
          message="Fetching order records…"
        />
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
            syncStatus
              ? 'No orders match the selected status filter.'
              : 'No order records have been synced yet.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Orders"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
          />

          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="text-muted">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
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
