import { useCallback, useMemo, type ReactElement } from 'react';
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
import { useToast } from '../../shared/ui/toast-provider';
import { useOrderQuery } from '../../features/orders/hooks/use-order-query';
import { useRetryOrderDestinationMutation } from '../../features/orders/hooks/use-retry-order-destination-mutation';
import type { OrderSyncStatus, OrderSyncStatusValue } from '../../features/orders/api/orders.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { CustomerEntityLabel } from '../../features/customers/components/CustomerEntityLabel';
import { OrderCustomerCard } from '../../features/orders/components/order-customer-card';
import { OrderLineItemsPanel } from '../../features/orders/components/order-line-items-panel';
import { OrderTotalsPanel } from '../../features/orders/components/order-totals-panel';
import { OrderActivityTimeline } from '../../features/orders/components/order-activity-timeline';
import { OrderShipmentPanel } from '../../features/orders/components/order-shipment-panel';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';
import type { ParsedAddress } from '../../features/orders/api/order-snapshot.schema';

const RAW_SNAPSHOT_ANCHOR_ID = 'order-raw-snapshot';

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
};

function buildSyncColumns(
  onRetry: (destinationConnectionId: string) => void,
  isRetrying: (destinationConnectionId: string) => boolean,
): DataTableColumn<OrderSyncStatus>[] {
  return [
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
    {
      id: 'actions',
      header: 'Actions',
      cell: (s) => {
        if (s.status !== 'failed') {
          return <EmptyValue />;
        }
        const pending = isRetrying(s.destinationConnectionId);
        return (
          <Button
            tone="secondary"
            onClick={() => onRetry(s.destinationConnectionId)}
            disabled={pending}
          >
            {pending ? 'Retrying…' : 'Retry'}
          </Button>
        );
      },
    },
  ];
}

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
  const retry = useRetryOrderDestinationMutation();
  const { showToast } = useToast();

  const pendingDestinationId =
    retry.isPending && retry.variables ? retry.variables.destinationConnectionId : null;

  const handleRetry = useCallback(
    (destinationConnectionId: string): void => {
      retry.mutate(
        { internalOrderId, destinationConnectionId },
        {
          onSuccess: () => {
            showToast({
              tone: 'success',
              title: 'Retry queued',
              description: 'Sync queued for the failed destination.',
            });
          },
          onError: (error) => {
            showToast({ tone: 'error', title: 'Retry failed', description: error.message });
          },
        },
      );
    },
    [retry, internalOrderId, showToast],
  );

  const syncColumns = useMemo(
    () =>
      buildSyncColumns(
        handleRetry,
        (destinationConnectionId) => pendingDestinationId === destinationConnectionId,
      ),
    [handleRetry, pendingDestinationId],
  );

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
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      </PageLayout>
    );
  }

  const order = query.data;
  const failedDestinations = order.syncStatus.filter((s) => s.status === 'failed');
  const snapshot = parseOrderSnapshot(order.orderSnapshot);
  const hasAnyAddress = Boolean(snapshot.shippingAddress ?? snapshot.billingAddress);

  const shippingLine = snapshot.shippingAddress
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
    ...(snapshot.orderNumber
      ? [{ id: 'orderNumber', label: 'Order #', value: snapshot.orderNumber, mono: true }]
      : []),
    ...(snapshot.status ? [{ id: 'status', label: 'Status', value: snapshot.status }] : []),
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
      backTo={{ to: '/orders', label: 'Orders' }}
      eyebrow="Orders"
      title={
        snapshot.orderNumber
          ? `Order #${snapshot.orderNumber}`
          : `Order — ${order.internalOrderId}`
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

      {/* Primary grid: Summary | Sync Status | Customer (three columns on wide viewports) */}
      <div className="order-detail__primary-grid order-detail__primary-grid--three">
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
              columns={syncColumns}
              rows={order.syncStatus}
              rowKey={(s) => s.destinationConnectionId}
            />
          ) : (
            <p className="text-muted">No sync destinations configured.</p>
          )}
        </section>

        <OrderCustomerCard
          customerId={order.customerId}
          sourceConnectionId={order.sourceConnectionId}
        />
      </div>

      {/* Parse-warnings breadcrumb — quiet, diagnostic, links to the raw snapshot.
          Stays page-level so it remains visible even when every enriched section
          below is empty because everything failed to parse. */}
      {snapshot.parseWarnings.length > 0 ? (
        <p className="order-detail__parse-warning-row">
          <a
            href={`#${RAW_SNAPSHOT_ANCHOR_ID}`}
            className="order-detail__parse-warning"
            title="Some fields couldn't be parsed — see raw snapshot"
          >
            <span aria-hidden="true">⚠</span> {snapshot.parseWarnings.length} field
            {snapshot.parseWarnings.length > 1 ? 's' : ''} couldn&rsquo;t be parsed · view raw
          </a>
        </p>
      ) : null}

      {/* Line items + totals — each renders independently so one failure doesn't blank both.
          When items are empty but totals exist, skip the Line Items column entirely rather
          than showing a "Line Items" heading over an explanatory paragraph. */}
      {snapshot.items.length > 0 || snapshot.totals ? (
        <div className="order-detail__items-grid">
          {snapshot.items.length > 0 ? (
            <section className="detail-section">
              <h3 className="detail-section__title">Line Items ({snapshot.items.length})</h3>
              <OrderLineItemsPanel items={snapshot.items} totals={snapshot.totals} />
            </section>
          ) : null}
          {snapshot.totals ? (
            <section className="detail-section order-detail__totals-section">
              <h3 className="detail-section__title">Totals</h3>
              <OrderTotalsPanel totals={snapshot.totals} />
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Addresses — render each independently whenever its own sub-tree parsed */}
      {hasAnyAddress ? (
        <div className="order-detail__address-grid">
          {snapshot.shippingAddress ? (
            <section className="detail-section">
              <h3 className="detail-section__title">Shipping Address</h3>
              <KeyValueList items={buildAddressItems(snapshot.shippingAddress, 'Address')} />
            </section>
          ) : null}
          {snapshot.billingAddress ? (
            <section className="detail-section">
              <h3 className="detail-section__title">Billing Address</h3>
              <KeyValueList items={buildAddressItems(snapshot.billingAddress, 'Address')} />
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Shipment panel (#769) — full-width Band-2 section, between Addresses
          (where it's going) and Activity Timeline (what's happened). Renders
          nothing when no ShippingProviderManager is configured. */}
      <OrderShipmentPanel order={order} />

      {/* Activity timeline */}
      <section className="detail-section">
        <h3 className="detail-section__title">Activity</h3>
        <OrderActivityTimeline
          createdAt={order.createdAt}
          recordStatus={order.recordStatus}
          syncAttempts={order.syncAttempts}
          sourceConnectionId={order.sourceConnectionId}
        />
      </section>

      {/* Raw snapshot — collapsed by default; warning chip above links here */}
      <section className="detail-section" id={RAW_SNAPSHOT_ANCHOR_ID}>
        <RawPayloadPanel title="Order Snapshot" payload={order.orderSnapshot} />
      </section>
    </PageLayout>
  );
}
