/**
 * Order Detail Page
 *
 * Operator cockpit for a single order (#924): derived health header + strip,
 * plain-language failure banner with a scoped Retry, pricing/tax breakdown,
 * delivery + shipment + customer rail, and an audit-trail activity timeline.
 * Display-only — every value comes from the `OrderRecord` / parsed snapshot /
 * shipments query that already exist; the page composes features and performs
 * no raw API calls.
 *
 * @module apps/web/src/pages/orders
 */
import { useCallback, useEffect, type ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { Alert } from '../../shared/ui/alert';
import { LoadingState, ErrorState } from '../../shared/ui/feedback-state';
import { Button } from '../../shared/ui/button';
import { KeyValueList, type KeyValueItem } from '../../shared/ui/key-value-list';
import { RawPayloadPanel } from '../../shared/ui/raw-payload-panel';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/status-badge';
import { TimeDisplay } from '../../shared/ui/time-display';
import { useToast } from '../../shared/ui/toast-provider';
import { formatShipBy, type ShipByLevel } from '../../shared/format/format-ship-by';
import { useOrderQuery } from '../../features/orders/hooks/use-order-query';
import { useRetryOrderDestinationMutation } from '../../features/orders/hooks/use-retry-order-destination-mutation';
import type { OrderSyncStatusValue } from '../../features/orders/api/orders.types';
import { ConnectionEntityLabel } from '../../features/connections/components/ConnectionEntityLabel';
import { useConnectionsQuery } from '../../features/connections';
import {
  useOrderShipmentsQuery,
  pickActiveShipment,
  getCarrierDisplayName,
  SHIPPING_METHOD_LABEL,
} from '../../features/shipments';
import { OrderCustomerCard } from '../../features/orders/components/order-customer-card';
import { OrderActivityTimeline } from '../../features/orders/components/order-activity-timeline';
import { OrderShipmentPanel } from '../../features/orders/components/order-shipment-panel';
import { OrderInvoicePanel } from '../../features/invoicing';
import { OrderDetailHeader } from '../../features/orders/components/order-detail-header';
import { OrderHealthSummary } from '../../features/orders/components/order-health-summary';
import { OrderPricingPanel } from '../../features/orders/components/order-pricing-panel';
import { OrderDeliveryPanel } from '../../features/orders/components/order-delivery-panel';
import { deriveFulfillment } from '../../features/orders/lib/order-health';
import { deriveDeliveryOutcome } from '../../features/orders/lib/delivery-outcome';
import { parseOrderSnapshot } from '../../features/orders/api/order-snapshot.schema';

const RAW_SNAPSHOT_ANCHOR_ID = 'order-raw-snapshot';
const SHIPPING_CAPABILITY = 'ShippingProviderManager';

const SYNC_STATUS_TONES: Record<OrderSyncStatusValue, StatusBadgeTone> = {
  pending: 'info',
  syncing: 'warning',
  synced: 'success',
  failed: 'error',
};

/** Ship-by urgency level (#927) → StatusBadge tone. */
const SHIP_BY_TONE: Record<ShipByLevel, StatusBadgeTone> = {
  ok: 'info',
  soon: 'warning',
  overdue: 'error',
};

export function OrderDetailPage(): ReactElement {
  const { internalOrderId = '' } = useParams<{ internalOrderId: string }>();
  const query = useOrderQuery(internalOrderId);
  const connectionsQuery = useConnectionsQuery();
  const shipmentsQuery = useOrderShipmentsQuery(internalOrderId);
  const retry = useRetryOrderDestinationMutation();
  const { showToast } = useToast();
  const location = useLocation();

  // Scroll to the section a deep-link CTA targets (#1713): the orders-list
  // "Generate label" / "Issue invoice" actions land here on `#shipment` /
  // `#invoicing`. Runs once the order data is present (the anchor wrapper divs
  // render with it) — the app has no other hash-scroll, and the panels mount
  // asynchronously, so a native browser jump on first paint would miss.
  const hasOrder = query.data !== undefined;
  useEffect(() => {
    if (!hasOrder) return;
    const targetId = location.hash.replace(/^#/, '');
    if (!targetId) return;
    const raf = requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
      // Move focus to the section so keyboard/AT users follow the visual jump;
      // `preventScroll` lets scrollIntoView own the (possibly smooth) scroll.
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior, block: 'start' });
    });
    return () => { cancelAnimationFrame(raf); };
  }, [hasOrder, location.hash]);

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
  const snapshot = parseOrderSnapshot(order.orderSnapshot);
  const failedDestinations = order.syncStatus.filter((s) => s.status === 'failed');

  const connections = connectionsQuery.data ?? [];
  const hasShippingCapability = connections.some((c) =>
    c.supportedCapabilities.includes(SHIPPING_CAPABILITY),
  );
  const shipmentStatuses = shipmentsQuery.data?.items.map((s) => s.status) ?? null;
  const fulfillment = deriveFulfillment(shipmentStatuses, hasShippingCapability);
  // Carrier precedence (#1617): the shipment record's `carrier` is the actual
  // carrier of record on a booked shipment — prefer it over the snapshot's
  // `shipping.methodName`, which is only the source's stated delivery-method
  // preference and may not match what was actually booked. Falls back to the
  // method name when no shipment exists yet (or its carrier hasn't resolved),
  // and to `null` (rendered "-") when neither is available.
  const activeShipment = pickActiveShipment(shipmentsQuery.data?.items ?? null);
  const carrier =
    getCarrierDisplayName(activeShipment?.carrier ?? null) ??
    snapshot.shipping?.methodName ??
    // Pickup-only orders (#1776) carry no method name but do name the point;
    // surface it so the Carrier row isn't a bare "-".
    snapshot.pickupPoint?.name ??
    null;
  // Shipment-derived delivery-method fallback (#1776) for the always-present
  // Method row: when the snapshot carried no shipping line, fall back to the
  // booked shipment's carrier, then its mapped `shippingMethod` label.
  const methodFallback =
    getCarrierDisplayName(activeShipment?.carrier ?? null) ??
    (activeShipment ? SHIPPING_METHOD_LABEL[activeShipment.shippingMethod] : null);
  // Mapping-aware delivery outcome (#1793): map the BE-computed routing kind +
  // whether a shipment (label/tracking) is booked onto a physical outcome. A
  // booked `activeShipment` means the carrier-driven path has a label
  // (resolved); its absence reads as awaiting-label. `hasMethod` gates the
  // shop-fulfilled vs no-method distinction on the default path.
  const deliveryHasMethod = Boolean(
    snapshot.shipping?.methodName ??
      snapshot.shipping?.methodId ??
      methodFallback ??
      snapshot.pickupPoint?.name,
  );
  const deliveryOutcome = deriveDeliveryOutcome({
    processorKind: order.deliveryResolution?.processorKind,
    hasMethod: deliveryHasMethod,
    isFulfilled: Boolean(activeShipment),
    processorAvailable: order.deliveryResolution?.processorAvailable,
    cancelled: snapshot.status === 'cancelled',
  });
  const sourcePlatformType =
    connections.find((c) => c.id === order.sourceConnectionId)?.platformType ?? null;

  // Internal ID is the header copy-chip; not duplicated here.
  const shipByView = formatShipBy(order.dispatchByAt ?? null);
  const summaryItems: KeyValueItem[] = [
    ...(snapshot.orderNumber
      ? [{ id: 'orderNumber', label: 'Order #', value: snapshot.orderNumber, mono: true }]
      : []),
    ...(snapshot.status ? [{ id: 'status', label: 'Status', value: snapshot.status }] : []),
    {
      id: 'sourceConnection',
      label: 'Source',
      value: <ConnectionEntityLabel connectionId={order.sourceConnectionId} />,
    },
    ...(order.sourceEventId
      ? [{ id: 'sourceEvent', label: 'Source Event ID', value: order.sourceEventId, mono: true }]
      : []),
    // Buyer-placed-on-marketplace time leads (#926); the OL ingestion clocks
    // (Received / Updated) are demoted to "OpenLinker processing" below it.
    ...(snapshot.placedAt
      ? [{ id: 'placedAt', label: 'Placed', value: <TimeDisplay iso={snapshot.placedAt} format="datetime" /> }]
      : []),
    { id: 'createdAt', label: 'Received (OL)', value: <TimeDisplay iso={order.createdAt} format="datetime" /> },
    { id: 'updatedAt', label: 'Updated (OL)', value: <TimeDisplay iso={order.updatedAt} format="datetime" /> },
    // Dispatch SLA countdown (#927) — the ship-by deadline + urgency badge.
    ...(order.dispatchByAt && shipByView
      ? [
          {
            id: 'shipBy',
            label: 'Ship by',
            value: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <TimeDisplay iso={order.dispatchByAt} format="datetime" />
                <StatusBadge tone={SHIP_BY_TONE[shipByView.level]} withDot compact>
                  {shipByView.remaining}
                </StatusBadge>
                {order.dispatchByEstimated ? (
                  <span
                    className="text-muted"
                    aria-label="Estimated"
                    title="OpenLinker estimate - not a marketplace-confirmed deadline"
                  >
                    est.
                  </span>
                ) : null}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <PageLayout backTo={{ to: '/orders', label: 'Orders' }} eyebrow="Orders" title="Order detail">
      <OrderDetailHeader order={order} snapshot={snapshot} />

      <OrderHealthSummary
        syncStatus={order.syncStatus}
        fulfillment={fulfillment}
        totals={snapshot.totals}
        itemCount={snapshot.items.length}
        failedDestinationId={failedDestinations[0]?.destinationConnectionId ?? null}
        fulfillmentPending={connectionsQuery.isLoading || shipmentsQuery.isLoading}
      />

      {failedDestinations.length > 0 ? (
        <Alert
          tone="error"
          title={`${failedDestinations.length} destination${
            failedDestinations.length > 1 ? 's' : ''
          } failed`}
          action={
            <Link
              to={`/orders/failed?connectionId=${encodeURIComponent(order.sourceConnectionId)}`}
              className="button button--secondary button--sm"
            >
              View failed orders
            </Link>
          }
        >
          <ul className="order-detail__failed-list">
            {failedDestinations.map((status) => (
              <li key={status.destinationConnectionId} className="order-detail__failed-row">
                <div className="order-detail__failed-main">
                  <ConnectionEntityLabel connectionId={status.destinationConnectionId} showId={false} />
                  {status.error ? (
                    <span className="order-detail__failed-error mono-text">
                      {status.error.length > 160 ? `${status.error.slice(0, 160)}…` : status.error}
                    </span>
                  ) : null}
                  <a className="order-detail__failed-raw" href={`#${RAW_SNAPSHOT_ANCHOR_ID}`}>
                    view raw ▸
                  </a>
                </div>
                <Button
                  tone="primary"
                  className="button--sm"
                  onClick={() => handleRetry(status.destinationConnectionId)}
                  disabled={pendingDestinationId === status.destinationConnectionId}
                >
                  {pendingDestinationId === status.destinationConnectionId ? 'Retrying…' : 'Retry'}
                </Button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {snapshot.items.length > 0 || snapshot.totals ? (
        <section className="detail-section">
          <h3 className="detail-section__title">Pricing &amp; tax</h3>
          <OrderPricingPanel items={snapshot.items} totals={snapshot.totals} />
        </section>
      ) : null}

      {/* Detail grid: left = summary + sync status, right = delivery + shipment + customer */}
      <div className="order-detail__primary-grid order-detail__primary-grid--split">
        <div className="order-detail__stack">
          <section className="detail-section">
            <h3 className="detail-section__title">Summary</h3>
            <KeyValueList items={summaryItems} />
          </section>

          <section className="detail-section">
            <h3 className="detail-section__title">
              Sync status{order.syncStatus.length > 0 ? ` (${order.syncStatus.length})` : ''}
            </h3>
            {order.syncStatus.length > 0 ? (
              <ul className="order-sync-list">
                {order.syncStatus.map((status) => (
                  <li key={status.destinationConnectionId} className="order-sync-row">
                    <ConnectionEntityLabel connectionId={status.destinationConnectionId} showId={false} />
                    <StatusBadge tone={SYNC_STATUS_TONES[status.status]} compact>
                      {status.status}
                    </StatusBadge>
                    <span className="order-sync-row__ext">
                      {status.externalOrderId ? (
                        <span className="mono-text">#{status.externalOrderId}</span>
                      ) : (
                        <span className="text-muted">no destination order id yet</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No sync destinations configured.</p>
            )}
            <p className="order-sync-list__note text-muted">
              Idempotent create (#909) — a retry won&rsquo;t double-create; a synced row shows its destination
              order id.
            </p>
          </section>
        </div>

        <div className="order-detail__stack">
          <OrderDeliveryPanel
            shippingAddress={snapshot.shippingAddress}
            shipping={snapshot.shipping}
            pickupPoint={snapshot.pickupPoint}
            sourcePlatformType={sourcePlatformType}
            carrier={carrier}
            methodFallback={methodFallback}
            deliveryOutcome={deliveryOutcome}
            deliveryRider={order.deliveryRider}
            sourceConnectionId={order.sourceConnectionId}
            sourceDeliveryMethodId={order.sourceDeliveryMethodId}
            sourceDeliveryMethodName={order.sourceDeliveryMethodName}
          />
          {/* Anchor wrappers (#1713) for the orders-list deep-link CTAs
              (`/orders/{id}#shipment`, `/orders/{id}#invoicing`). Page-level
              divs so the target exists even while a panel is capability-gated
              (renders null) or still loading. */}
          <div id="shipment" tabIndex={-1}>
            <OrderShipmentPanel order={order} />
          </div>
          <div id="invoicing" tabIndex={-1}>
            <OrderInvoicePanel order={order} />
          </div>
          <OrderCustomerCard customerId={order.customerId} sourceConnectionId={order.sourceConnectionId} />
        </div>
      </div>

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

      <section className="detail-section">
        <h3 className="detail-section__title">Activity</h3>
        <OrderActivityTimeline
          createdAt={order.createdAt}
          recordStatus={order.recordStatus}
          syncAttempts={order.syncAttempts}
          sourceConnectionId={order.sourceConnectionId}
        />
      </section>

      <section className="detail-section" id={RAW_SNAPSHOT_ANCHOR_ID}>
        <RawPayloadPanel title="Order Snapshot" payload={order.orderSnapshot} />
      </section>
    </PageLayout>
  );
}
