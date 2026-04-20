import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { DataTable, type DataTableColumn } from '../../shared/ui/data-table';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { EmptyValue } from '../../shared/ui/empty-value';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useOrderQuery } from '../../features/orders/hooks/use-order-query';
import type { OrderSyncStatus, OrderSyncStatusValue } from '../../features/orders/api/orders.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';

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
    cell: (s) => <ConnectionEntityLabel connectionId={s.destinationConnectionId} showId={false} />,
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
        <TimeDisplay iso={s.syncedAt} />
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
  const failedDestinations = order.syncStatus.filter((s) => s.status === 'failed');

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
      {failedDestinations.length > 0 ? (
        <Alert
          tone="error"
          title={`${failedDestinations.length} destination${
            failedDestinations.length > 1 ? 's' : ''
          } failed`}
          action={
            <Link to="/orders/failed" className="button button--primary button--compact">
              View failed orders
            </Link>
          }
        >
          <ul className="order-detail__failed-list">
            {failedDestinations.map((status) => (
              <li key={status.destinationConnectionId}>
                <ConnectionEntityLabel
                  connectionId={status.destinationConnectionId}
                  showId={false}
                />
                {status.error ? (
                  <span className="order-detail__failed-error">
                    {status.error.length > 120
                      ? `${status.error.slice(0, 120)}…`
                      : status.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* Order metadata */}
      <section className="detail-section">
        <h3 className="detail-section__title">Details</h3>
        <KeyValueList items={buildOrderItems(order)} />
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
        <RawPayloadPanel title="Order Snapshot" payload={order.orderSnapshot} />
      </section>
    </PageLayout>
  );
}

function buildOrderItems(order: {
  internalOrderId: string;
  sourceConnectionId: string;
  customerId: string | null;
  sourceEventId: string | null;
  createdAt: string;
  updatedAt: string;
}): KeyValueItem[] {
  return [
    { id: 'orderId', label: 'Order ID', value: order.internalOrderId, mono: true },
    {
      id: 'sourceConnection',
      label: 'Source Connection',
      value: <ConnectionEntityLabel connectionId={order.sourceConnectionId} />,
    },
    {
      id: 'customer',
      label: 'Customer ID',
      value: order.customerId ?? <EmptyValue />,
      mono: Boolean(order.customerId),
    },
    {
      id: 'sourceEvent',
      label: 'Source Event ID',
      value: order.sourceEventId ?? <EmptyValue />,
      mono: Boolean(order.sourceEventId),
    },
    { id: 'createdAt', label: 'Created', value: <TimeDisplay iso={order.createdAt} /> },
    { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={order.updatedAt} /> },
  ];
}
