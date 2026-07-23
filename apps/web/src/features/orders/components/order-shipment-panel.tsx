/**
 * Order Shipment Panel (#769)
 *
 * Order-detail panel for the dispatch lifecycle: status badge + carrier +
 * tracking link + paczkomat-id + dispatched-at + status-gated action row.
 * Capability-gated globally (renders only when at least one connection
 * declares `ShippingProviderManager`); copy-flavor (paczkomat caption) keyed
 * on the shipping (processor) connection's `platformType` per plan §3.5.
 *
 * @module apps/web/src/features/orders/components
 */
import { useMemo, useState, type ReactElement } from 'react';

import { useConnectionsQuery } from '../../connections';
import {
  getCarrierDisplayName,
  pickActiveShipment,
  ShipmentStatusBadge,
  useOrderShipmentsQuery,
  type Shipment,
} from '../../shipments';
import { usePlatform, type Platform } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { LoadingState, ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { Button } from '../../../shared/ui/button';

import type { OrderRecord } from '../api/orders.types';
import { parseOrderSnapshot, type PaymentStatus } from '../api/order-snapshot.schema';
import { GenerateLabelForm } from './generate-label-form';
import { ShipmentActionButtons } from './shipment-action-buttons';
import { ShipmentLifecycleRail } from './shipment-lifecycle-rail';
import { ShipmentTrackingLink } from './shipment-tracking-link';

const SHIPPING_CAPABILITY = 'ShippingProviderManager';

interface OrderShipmentPanelProps {
  order: OrderRecord;
}

export function OrderShipmentPanel({ order }: OrderShipmentPanelProps): ReactElement | null {
  const connectionsQuery = useConnectionsQuery();
  const shipmentsQuery = useOrderShipmentsQuery(order.internalOrderId);
  const [formOpen, setFormOpen] = useState(false);

  // #928 — source-reported payment status drives the dispatch gate on the
  // action row below. Parsed from the order snapshot here (server state stays in
  // the page-level query); the presentational button receives it as a prop.
  const paymentStatus = useMemo(
    () => parseOrderSnapshot(order.orderSnapshot).paymentStatus,
    [order.orderSnapshot],
  );

  // Disabled-carrier route (#1799): a rule maps this order's delivery method to
  // a carrier connection that is currently disabled. Dispatching is a dead end
  // until it's re-enabled, so the Generate-label CTAs below are blocked (the
  // Delivery panel shows the "Enable {carrier}" rider).
  const routeUnavailable =
    order.deliveryResolution?.source === 'rule' &&
    order.deliveryResolution?.processorAvailable === false;

  // AC-8 — global capability gate. If no connection declares
  // ShippingProviderManager, render nothing (the operator has no way to
  // dispatch anything). Wait for the connections query to settle so we
  // don't briefly hide-then-show the panel.
  const hasShippingCapability = useMemo(() => {
    if (!connectionsQuery.data) return null;
    return connectionsQuery.data.some((c) =>
      c.supportedCapabilities.includes(SHIPPING_CAPABILITY),
    );
  }, [connectionsQuery.data]);

  if (connectionsQuery.isLoading) {
    // Connections are loaded once per session — usually warm. On the cold
    // first paint we render a single-row skeleton instead of `null` so the
    // page doesn't reflow when the panel appears (tech-review SUGGESTION
    // fix — avoids a CLS event on first order-detail navigation).
    return (
      <section className="detail-section order-shipment-panel order-shipment-panel--loading">
        <header className="order-shipment-panel__header">
          <h3 className="detail-section__title">Shipment</h3>
        </header>
        <div className="order-shipment-panel__skeleton" aria-hidden="true" />
      </section>
    );
  }

  if (hasShippingCapability === false) {
    return null;
  }

  // Active-shipment resolution: in v1 there's at most one shipment per order.
  // Show the most recent non-terminal one when present, otherwise the most
  // recent terminal row (so operators can see the history).
  const activeShipment = pickActiveShipment(shipmentsQuery.data?.items ?? null);
  const shippingConnection = activeShipment
    ? (connectionsQuery.data ?? []).find((c) => c.id === activeShipment.connectionId)
    : undefined;

  return (
    <section className="detail-section order-shipment-panel">
      <header className="order-shipment-panel__header">
        <h3 className="detail-section__title">Shipment</h3>
        {activeShipment ? <ShipmentStatusBadge status={activeShipment.status} /> : null}
      </header>

      {shipmentsQuery.isLoading ? (
        <LoadingState title="Loading shipment" message="Fetching the latest dispatch state." />
      ) : shipmentsQuery.isError ? (
        <ErrorState
          title="Could not load shipment"
          message={shipmentsQuery.error.message}
          action={
            <Button onClick={() => void shipmentsQuery.refetch()} tone="secondary">
              Retry
            </Button>
          }
        />
      ) : activeShipment ? (
        <>
          {/* Lifecycle rail (#1425) — between the header and the facts. Skipped
              for destination-fulfilled (OMP) shipments, which carry no OL
              dispatch lifecycle. */}
          {activeShipment.shippingMethod !== 'omp' ? (
            <ShipmentLifecycleRail status={activeShipment.status} />
          ) : null}
          <OrderShipmentPanelBody
            shipment={activeShipment}
            shippingPlatformType={shippingConnection?.platformType ?? null}
            paymentStatus={paymentStatus}
            mutationError={null /* surfaced via the action-buttons own state */}
          />
        </>
      ) : formOpen ? null : routeUnavailable ? (
        <EmptyState
          title="No shipment yet"
          message="This order's delivery method routes to a disabled carrier connection. Enable it (see Delivery) before generating a label."
        />
      ) : (
        <EmptyState
          title="No shipment yet"
          message="Generate a label to dispatch this order."
          action={
            <Button tone="primary" onClick={() => setFormOpen(true)}>
              Generate label
            </Button>
          }
        />
      )}

      {/* Active-state action row (omitted in the empty state — the EmptyState
          owns its own CTA). */}
      {activeShipment ? (
        <ShipmentActionButtons
          shipment={activeShipment}
          paymentStatus={paymentStatus}
          onGenerateLabelClick={() => setFormOpen(true)}
          routeUnavailable={routeUnavailable}
        />
      ) : null}

      {/* Inline expansion (NOT a modal) — see plan §3.3 "Modal vs inline". */}
      {formOpen ? (
        <GenerateLabelForm
          order={order}
          onSuccess={() => setFormOpen(false)}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </section>
  );
}

function OrderShipmentPanelBody({
  shipment,
  shippingPlatformType,
  paymentStatus,
  mutationError,
}: {
  shipment: Shipment;
  shippingPlatformType: string | null;
  paymentStatus: PaymentStatus | undefined;
  mutationError: string | null;
}): ReactElement {
  // Resolve the shipping platform's contribution here (a component) rather than
  // in the parent, which has early returns above its `shippingConnection`
  // computation — a `usePlatform` call there would be conditional (#893).
  const shippingPlatform = usePlatform(shippingPlatformType ?? undefined);
  const items = buildShipmentFieldItems(shipment, shippingPlatform, paymentStatus);
  return (
    <div className="order-shipment-panel__body">
      <KeyValueList items={items} />
      {mutationError ? (
        <Alert tone="error" className="order-shipment-panel__error">
          {mutationError}
        </Alert>
      ) : null}
    </div>
  );
}

function buildShipmentFieldItems(
  shipment: Shipment,
  shippingPlatform: Platform | undefined,
  paymentStatus: PaymentStatus | undefined,
): KeyValueItem[] {
  const items: KeyValueItem[] = [];

  // Tracking number — formatted as a link when carrier resolves, copy-text
  // when not.
  items.push({
    id: 'tracking',
    label: 'Tracking',
    value: shipment.trackingNumber ? (
      <ShipmentTrackingLink shipment={shipment} />
    ) : (
      <span className="text-muted">—</span>
    ),
  });

  // Carrier-of-record — the actual courier moving the parcel (#769). Null
  // until the status-sync poll backfills it.
  const carrierName = getCarrierDisplayName(shipment.carrier);
  items.push({
    id: 'carrier',
    label: 'Carrier',
    value: carrierName ?? <span className="text-muted">— (awaiting)</span>,
  });

  // Paczkomat row — caption keyed on the shipping platform's
  // `pickupPointResolvesAsync` trait (#893), NOT the shipment's
  // `paczkomatId === null` (a null is "kurier shipment", a value is "paczkomat
  // shipment"; caption tells operator who selected it). Platforms whose locker
  // is buyer-selected on-platform set the trait; everything else is operator-set.
  if (shipment.paczkomatId !== null) {
    const caption =
      shippingPlatform?.pickupPointResolvesAsync === true
        ? `(buyer-selected via ${shippingPlatform.displayName})`
        : '(operator-selected)';
    // Row label follows the method: parcel-shop / PUDO methods ('pickup', e.g.
    // DPD Pickup) read "Pickup point"; locker methods ('paczkomat') keep their
    // name. Both carry their point id on `paczkomatId`.
    const pointLabel = shipment.shippingMethod === 'pickup' ? 'Pickup point' : 'Paczkomat';
    items.push({
      id: 'paczkomat',
      label: pointLabel,
      value: (
        <>
          <span className="mono-text">{shipment.paczkomatId}</span>{' '}
          <span className="text-muted">{caption}</span>
        </>
      ),
    });
  }

  // COD indicator (#966, decision A) — surfaces that the order is cash-on-delivery
  // from the source-reported payment status. The amount is NOT persisted on the
  // shipment (operator-entered at dispatch), so this is a status row, not a figure.
  if (paymentStatus === 'cod') {
    items.push({
      id: 'cod',
      label: 'Payment',
      value: (
        <>
          <StatusBadge tone="warning" withDot>
            Cash on delivery
          </StatusBadge>{' '}
          <span className="text-muted">collect on delivery</span>
        </>
      ),
    });
  }

  items.push({
    id: 'dispatchedAt',
    label: 'Dispatched at',
    value: shipment.dispatchedAt ? new Date(shipment.dispatchedAt).toLocaleString() : (
      <span className="text-muted">—</span>
    ),
  });

  return items;
}
