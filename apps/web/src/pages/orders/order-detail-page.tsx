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
import { CustomerEntityLabel } from '../../features/customers/components/CustomerEntityLabel';
import { OrderLineItemsPanel } from '../../features/orders/components/order-line-items-panel';
import { OrderActivityTimeline } from '../../features/orders/components/order-activity-timeline';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';
import type { ParsedAddress } from '../../features/orders/api/order-snapshot.schema';

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
        <EmptyValue />
      ),
    hideBelow: 768,
  },
  {
    id: 'externalOrderNumber',
    header: 'External Order #',
    cell: (s) =>
      s.externalOrderNumber ? (
        <span className="mono-text">{s.externalOrderNumber}</span>
      ) : (
        <EmptyValue />
      ),
  },
  {
    id: 'syncedAt',
    header: 'Synced At',
    cell: (s) => (s.syncedAt ? <TimeDisplay iso={s.syncedAt} /> : <EmptyValue />),
    hideBelow: 768,
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
        <EmptyValue />
      ),
    hideBelow: 1024,
  },
];

function buildAddressItems(address: ParsedAddress, label: string): KeyValueItem[] {
  const fullName = [address.firstName, address.lastName].filter(Boolean).join(' ');
  return [
    ...(fullName ? [{ id: 'name', label: 'Name', value: fullName }] : []),
    ...(address.company ? [{ id: 'company', label: 'Company', value: address.company }] : []),
    { id: 'address1', label: label, value: address.address1 },
    ...(address.address2 ? [{ id: 'address2', label: '', value: address.address2 }] : []),
    { id: 'city', label: 'City', value: `${address.city}, ${address.postalCode}` },
    { id: 'country', label: 'Country', value: address.country },
    ...(address.phone ? [{ id: 'phone', label: 'Phone', value: address.phone }] : []),
  ];
}

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
  const snapshot = parseOrderSnapshot(order.orderSnapshot);

  const shippingLine = snapshot?.shippingAddress
    ? [
        snapshot.shippingAddress.address1,
        snapshot.shippingAddress.city,
        snapshot.shippingAddress.country,
      ]
        .filter(Boolean)
        .join(', ')
    : null;

  const summaryItems: KeyValueItem[] = [
    {
      id: 'orderId',
      label: 'Internal ID',
      value: order.internalOrderId,
      mono: true,
    },
    ...(snapshot?.orderNumber
      ? [{ id: 'orderNumber', label: 'Order #', value: snapshot.orderNumber, mono: true }]
      : []),
    ...(snapshot?.status
      ? [{ id: 'status', label: 'Status', value: snapshot.status }]
      : []),
    {
      id: 'sourceConnection',
      label: 'Source',
      value: <ConnectionEntityLabel connectionId={order.sourceConnectionId} />,
    },
    {
      id: 'customer',
      label: 'Customer',
      value: order.customerId ? (
        <CustomerEntityLabel customerId={order.customerId} />
      ) : (
        <EmptyValue />
      ),
    },
    ...(shippingLine
      ? [{ id: 'shippingTo', label: 'Shipping to', value: shippingLine }]
      : []),
    { id: 'createdAt', label: 'Received', value: <TimeDisplay iso={order.createdAt} format="datetime" /> },
    { id: 'updatedAt', label: 'Updated', value: <TimeDisplay iso={order.updatedAt} format="datetime" /> },
    ...(order.sourceEventId
      ? [{ id: 'sourceEvent', label: 'Source Event ID', value: order.sourceEventId, mono: true }]
      : []),
  ];

  return (
    <PageLayout
      eyebrow="Orders"
      title={
        snapshot?.orderNumber
          ? `Order #${snapshot.orderNumber}`
          : `Order — ${order.internalOrderId}`
      }
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
            <Link
              to={`/orders/failed?connectionId=${encodeURIComponent(order.sourceConnectionId)}`}
              className="button button--primary button--compact"
            >
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

      {/* Summary + Sync Status — two-column on desktop */}
      <div className="order-detail__primary-grid">
        <section className="detail-section">
          <h3 className="detail-section__title">Summary</h3>
          <KeyValueList items={summaryItems} />
        </section>

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
      </div>

      {/* Line items */}
      {snapshot ? (
        <section className="detail-section">
          <h3 className="detail-section__title">
            Line Items{snapshot.items.length > 0 ? ` (${snapshot.items.length})` : ''}
          </h3>
          <OrderLineItemsPanel items={snapshot.items} totals={snapshot.totals} />
        </section>
      ) : null}

      {/* Addresses */}
      {(snapshot?.shippingAddress ?? snapshot?.billingAddress) ? (
        <div className="order-detail__address-grid">
          {snapshot?.shippingAddress ? (
            <section className="detail-section">
              <h3 className="detail-section__title">Shipping Address</h3>
              <KeyValueList items={buildAddressItems(snapshot.shippingAddress, 'Address')} />
            </section>
          ) : null}
          {snapshot?.billingAddress ? (
            <section className="detail-section">
              <h3 className="detail-section__title">Billing Address</h3>
              <KeyValueList items={buildAddressItems(snapshot.billingAddress, 'Address')} />
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Activity timeline */}
      <section className="detail-section">
        <h3 className="detail-section__title">Activity</h3>
        <OrderActivityTimeline
          createdAt={order.createdAt}
          recordStatus={order.recordStatus}
          syncStatus={order.syncStatus}
        />
      </section>

      {/* Raw snapshot — collapsed by default */}
      <section className="detail-section">
        <RawPayloadPanel title="Order Snapshot" payload={order.orderSnapshot} />
      </section>
    </PageLayout>
  );
}
