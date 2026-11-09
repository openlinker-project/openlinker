/**
 * Failed Orders Page
 *
 * Displays order records with awaiting_mapping status — orders where one or more
 * offer→variant mappings were missing at ingestion time. The job runner retries
 * these automatically once the mapping is created via marketplace.offers.sync.
 *
 * @module apps/web/src/pages/orders
 */
import { useMemo, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  interpolate,
  useFormat,
  useMessages,
  usePlural,
  type Messages,
  type ResolvedCopy,
} from '../../shared/i18n';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { useTableSort } from '../../shared/ui/use-table-sort';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { Select } from '../../shared/ui/select';
import { StatusBadge } from '../../shared/ui/status-badge';
import { useOrdersQuery } from '../../features/orders/hooks/use-orders-query';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { TimeDisplay } from '../../shared/ui/time-display';
import type { OrderRecord } from '../../features/orders/api/orders.types';
import { serverErrorText } from '../../features/orders/lib/server-error-text';

const PAGE_SIZE = 25;

function snapshotItemCount(snapshot: Record<string, unknown>): number {
  const items = snapshot['items'];
  if (Array.isArray(items)) return items.length;
  return 0;
}

type FailedOrdersCopy = ResolvedCopy<Messages['orders']>['failedOrdersPage'];

function buildColumns(copy: FailedOrdersCopy): DataTableColumn<OrderRecord>[] {
  return [
    {
      id: 'internalOrderId',
      header: copy.columns.orderId,
      cell: (order) => (
        <span className="mono-text" title={order.internalOrderId}>
          {order.internalOrderId}
        </span>
      ),
    },
    {
      id: 'sourceConnectionId',
      header: copy.columns.connection,
      cell: (order) => (
        <ConnectionEntityLabel
          connectionId={order.sourceConnectionId}
          linkToDetail={false}
          showId
        />
      ),
      hideBelow: 1024,
    },
    {
      id: 'items',
      header: copy.columns.items,
      cell: (order) => snapshotItemCount(order.orderSnapshot),
      align: 'right',
      hideBelow: 480,
    },
    {
      id: 'createdAt',
      header: copy.columns.firstSeen,
      cell: (order) => <TimeDisplay iso={order.createdAt} />,
      accessor: (order) => order.createdAt,
      sortable: true,
    },
  ];
}

export function FailedOrdersPage(): ReactElement {
  const copy = useMessages('orders').failedOrdersPage;
  const serverSaid = useMessages('orders').common.serverSaid;
  const plural = usePlural();
  const format = useFormat();
  const columns = useMemo(() => buildColumns(copy), [copy]);
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
      backTo={{ to: '/orders', label: copy.backToOrders }}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    >
      <div className="toolbar">
        <Select
          aria-label={copy.filterByConnection}
          value={connectionId ?? ''}
          onChange={(e) => { handleConnectionFilterChange(e.target.value); }}
        >
          <option value="">{copy.allConnections}</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>

        <StatusBadge tone="warning" compact>
          {interpolate(copy.awaitingCount, { n: format.number(total) })}
        </StatusBadge>
      </div>

      {query.isLoading ? (
        <LoadingState
          liveRegion="off"
          title={copy.loading.title}
          message={copy.loading.message}
        />
      ) : query.error ? (
        <ErrorState
          title={copy.error.title}
          message={serverErrorText(serverSaid, query.error.message, '')}
          action={
            <Button onClick={() => { void query.refetch(); }}>{copy.error.retry}</Button>
          }
        />
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          liveRegion="off"
          title={copy.empty.title}
          message={connectionId ? copy.empty.forConnection : copy.empty.all}
        />
      ) : (
        <>
          <DataTable
            caption={copy.caption}
            columns={columns}
            rows={query.data?.items ?? []}
            rowKey={(order) => order.internalOrderId}
            rowHref={(order) => `/orders/${order.internalOrderId}`}
            sort={sort}
            onSortChange={setSort}
            cardView={{
              title: (order) => (
                <span className="mono-text" title={order.internalOrderId}>
                  {order.internalOrderId}
                </span>
              ),
              subtitle: (order) => (
                <>
                  <ConnectionEntityLabel
                    connectionId={order.sourceConnectionId}
                    linkToDetail={false}
                    showId={false}
                  />
                  {' · '}
                  {plural(snapshotItemCount(order.orderSnapshot), copy.itemCount)}
                </>
              ),
            }}
          />

          <div className="pagination">
            <span className="text-muted">
              {interpolate(copy.pagination.showing, {
                from: format.number(offset + 1),
                to: format.number(Math.min(offset + PAGE_SIZE, total)),
                total: format.number(total),
              })}
            </span>
            <div className="pagination__actions">
              <Button
                disabled={!hasPrev}
                onClick={() => { setOffset(offset - PAGE_SIZE); }}
              >
                {copy.pagination.previous}
              </Button>
              <Button
                disabled={!hasNext}
                onClick={() => { setOffset(offset + PAGE_SIZE); }}
              >
                {copy.pagination.next}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
