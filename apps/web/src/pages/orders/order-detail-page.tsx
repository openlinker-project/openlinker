import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { useOrderQuery } from '../../features/orders/hooks/use-order-query';
import type { OrderSyncStatus, OrderSyncStatusValue } from '../../features/orders/api/orders.types';

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
};

const SYNC_COLUMNS: DataTableColumn<OrderSyncStatus>[] = [
  {
    id: 'destinationConnectionId',
    header: 'Destination',
    cell: (s) => <span className="mono-text">{s.destinationConnectionId}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (s) => (
      <StatusBadge tone={SYNC_STATUS_TONES[s.status]} compact>
        {s.status}
      </StatusBadge>
    ),
  },
  {
    id: 'externalOrderId',
    header: 'External Order ID',
    cell: (s) =>
      s.externalOrderId ? (
        <span className="mono-text">{s.externalOrderId}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'externalOrderNumber',
    header: 'External Order #',
    cell: (s) =>
      s.externalOrderNumber ? (
        <span className="mono-text">{s.externalOrderNumber}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'syncedAt',
    header: 'Synced At',
    cell: (s) =>
      s.syncedAt ? (
        new Date(s.syncedAt).toLocaleString()
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    id: 'error',
    header: 'Error',
    cell: (s) =>
      s.error ? (
        <span className="text-muted" title={s.error}>
          {s.error.length > 80 ? `${s.error.slice(0, 80)}…` : s.error}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
];

export function OrderDetailPage(): ReactElement {
  const { internalOrderId = '' } = useParams<{ internalOrderId: string }>();
  const query = useOrderQuery(internalOrderId);

  if (query.isLoading) {
    return (
      <PageLayout eyebrow="Orders" title="Order detail">
        <LoadingState liveRegion="off" title="Loading order" message="Fetching order details…" />
      </PageLayout>
    );
  }

  if (query.error || !query.data) {
    return (
      <PageLayout eyebrow="Orders" title="Order detail">
        <ErrorState
          title="Unable to load order"
          message={query.error?.message ?? 'Order not found'}
          action={
            <Button onClick={() => { void query.refetch(); }}>Retry</Button>
          }
        />
      </PageLayout>
    );
  }

  const order = query.data;

  return (
    <PageLayout
      eyebrow="Orders"
      title={`Order — ${order.internalOrderId}`}
      actions={
        <Link to=".." relative="path" className="button button--ghost">
          ← Back to orders
        </Link>
      }
    >
      {/* Order metadata */}
      <section className="detail-section">
        <h3 className="detail-section__title">Details</h3>
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt>Order ID</dt>
            <dd><span className="mono-text">{order.internalOrderId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Source Connection</dt>
            <dd><span className="mono-text">{order.sourceConnectionId}</span></dd>
          </div>
          <div className="detail-list__row">
            <dt>Customer ID</dt>
            <dd>
              {order.customerId ? (
                <span className="mono-text">{order.customerId}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Source Event ID</dt>
            <dd>
              {order.sourceEventId ? (
                <span className="mono-text">{order.sourceEventId}</span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
          <div className="detail-list__row">
            <dt>Created</dt>
            <dd>{new Date(order.createdAt).toLocaleString()}</dd>
          </div>
          <div className="detail-list__row">
            <dt>Updated</dt>
            <dd>{new Date(order.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      {/* Sync status */}
      <section className="detail-section">
        <h3 className="detail-section__title">
          Sync Status{order.syncStatus.length > 0 ? ` (${order.syncStatus.length})` : ''}
        </h3>
        {order.syncStatus.length > 0 ? (
          <DataTable
            caption="Order sync status"
            columns={SYNC_COLUMNS}
            rows={order.syncStatus}
            rowKey={(s) => s.destinationConnectionId}
          />
        ) : (
          <p className="text-muted">No sync destinations configured.</p>
        )}
      </section>

      {/* Order snapshot */}
      <section className="detail-section">
        <h3 className="detail-section__title">Order Snapshot</h3>
        <pre className="mono-text raw-payload">
          {JSON.stringify(order.orderSnapshot, null, 2)}
        </pre>
      </section>
    </PageLayout>
  );
}
