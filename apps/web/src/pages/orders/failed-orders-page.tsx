/**
 * Failed Orders Page
 *
 * Displays order records with awaiting_mapping status — orders where one or more
 * offer→variant mappings were missing at ingestion time. The job runner retries
 * these automatically once the mapping is created via marketplace.offers.sync.
 *
 * @module apps/web/src/pages/orders
 */
import { type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { TimeDisplay } from '../../shared/ui/time-display';
import type { OrderRecord } from '../../features/orders/api/orders.types';

const PAGE_SIZE = 25;

function snapshotItemCount(snapshot: Record<string, unknown>): number {
  const items = snapshot['items'];
  if (Array.isArray(items)) return items.length;
  return 0;
}

const COLUMNS: DataTableColumn<OrderRecord>[] = [
  {
    id: 'internalOrderId',
    header: 'Order ID',
    cell: (order) => <span className="mono-text">{order.internalOrderId.slice(0, 16)}…</span>,
  },
  {
    id: 'sourceConnectionId',
    header: 'Connection',
    cell: (order) => <span className="mono-text">{order.sourceConnectionId.slice(0, 8)}…</span>,
    hideBelow: 1024,
  },
  {
    id: 'items',
    header: 'Items',
    cell: (order) => snapshotItemCount(order.orderSnapshot),
    align: 'center',
    hideBelow: 480,
  },
  {
    id: 'createdAt',
    header: 'First Seen',
    cell: (order) => <TimeDisplay iso={order.createdAt} />,
    accessor: (order) => order.createdAt,
    sortable: true,
  },
];

export function FailedOrdersPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sort, setSort } = useTableSort([{ id: 'createdAt', desc: true }]);

  const connectionId = searchParams.get('connectionId') ?? undefined;
  const offset = Number(searchParams.get('offset') ?? '0');

  const query = useOrdersQuery(
    { recordStatus: 'awaiting_mapping', sourceConnectionId: connectionId },
    { limit: PAGE_SIZE, offset },
  );
  const connectionsQuery = useConnectionsQuery();

  function handleConnectionFilterChange(value: string): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set('connectionId', value);
      } else {
        next.delete('connectionId');
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
  const connections = connectionsQuery.data ?? [];

  return (
    <PageLayout
      eyebrow="Orders"
      title="Awaiting Mapping"
      description="Orders with unresolved offer→variant mappings. These retry automatically once the mapping is created."
      actions={
        <Link to="/orders" className="button button--ghost">
          ← All Orders
        </Link>
      }
    >
      <div className="toolbar">
        <Select
          aria-label="Filter by connection"
          value={connectionId ?? ''}
          onChange={(e) => { handleConnectionFilterChange(e.target.value); }}
        >
          <option value="">All connections</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <StatusBadge tone="warning" compact>
          {total} awaiting mapping
        </StatusBadge>
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title="Loading orders"
          message="Fetching orders awaiting mapping…"
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
          title="No orders awaiting mapping"
          message={
            connectionId
              ? 'No orders with missing mappings for the selected connection.'
              : 'All orders have been fully resolved. No mapping issues detected.'
          }
        />
      ) : (
        <>
          <DataTable
            caption="Orders awaiting offer→variant mapping"
            columns={COLUMNS}
            rows={query.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (order) => `${order.internalOrderId.slice(0, 16)}…`,
              subtitle: (order) => `${snapshotItemCount(order.orderSnapshot)} item(s)`,
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
