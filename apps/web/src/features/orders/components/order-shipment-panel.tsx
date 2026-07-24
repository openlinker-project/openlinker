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

import type { OrderDeliveryRider, OrderRecord } from '../api/orders.types';
import { parseOrderSnapshot, type PaymentStatus } from '../api/order-snapshot.schema';
import { hasLiveOlCarrierRoute } from '../lib/delivery-outcome';
import { SHOP_FULFILLED_NO_DUP_LABEL } from '../lib/delivery-copy';
import { DeliveryRiderAction } from './delivery-rider-action';
import { GenerateLabelForm } from './generate-label-form';
import { ShipmentActionButtons } from './shipment-action-buttons';
import { ShipmentLifecycleRail } from './shipment-lifecycle-rail';
import { ShipmentTrackingLink } from './shipment-tracking-link';

const SHIPPING_CAPABILITY = 'ShippingProviderManager';

/** Whether a rider is one OpenLinker could take over (#1776). */
function isTakeoverRider(rider: OrderDeliveryRider | undefined): boolean {
  return (
    rider?.rider === 'unmapped' || rider?.rider === 'not-connected' || rider?.rider === 'disabled'
  );
}

/**
 * Takeover empty-state message (#1776 E3) — drops "(see Delivery)"; the fix-it
 * action is the EmptyState's own button. `carrier` is the rider's candidate
 * carrier display name (or "a carrier"). Copy always says "this and future
 * orders", never "re-ship this order".
 */
function takeoverMessage(rider: OrderDeliveryRider | undefined, carrier: string): string {
  switch (rider?.rider) {
    case 'not-connected':
      return `OpenLinker supports ${carrier} but isn't connected to it yet. Connect it to ship this and future orders on this method through OpenLinker.`;
    case 'disabled':
      return `This delivery method routes to ${carrier}, but that connection is disabled. Enable it so OpenLinker can generate the label.`;
    case 'unmapped':
    default:
      return `This delivery method isn't mapped to a carrier yet. Map it to ${carrier} and OpenLinker will generate the label for this and future orders on this method.`;
  }
}

/**
 * Affirmative shop-fulfilled message (#1776 E2) — the shop owns fulfilment and
 * OpenLinker only mirrors its status. Substitutes the shop connection name for
 * "The destination shop" when it's resolvable.
 */
function shopFulfilledMessage(shopName: string | null): string {
  const subject = shopName ?? 'The destination shop';
  return `${subject} ships this order with its own carrier. ${SHOP_FULFILLED_NO_DUP_LABEL}`;
}

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

  // OpenLinker only generates a label when routing resolves to a LIVE own-carrier
  // route (#1799). A shop-fulfilled / no-method / unmapped / not-connected /
  // disabled-carrier order has no OL label to generate, so the Generate-label
  // CTAs are suppressed and the operator is pointed at delivery routing instead
  // (the Delivery panel's rider, or a "fulfilled by the shop" note here).
  const olCarrierRoute = hasLiveOlCarrierRoute(order.deliveryResolution);
  const rider = order.deliveryRider;
  const takeover = isTakeoverRider(rider);
  const candidateCarrier = rider?.candidateCarrier?.displayName ?? 'a carrier';
  // Shop connection name for the affirmative empty state — the explicit OMP
  // processor when the routing named one (id → name lookup only).
  const shopConnectionName =
    order.deliveryResolution?.processorConnectionId != null
      ? ((connectionsQuery.data ?? []).find(
          (c) => c.id === order.deliveryResolution?.processorConnectionId,
        )?.name ?? null)
      : null;
  // Inline note shown alongside an already-booked shipment on a dead route:
  // the takeover reason, or the affirmative shop-fulfilled sentence.
  const noRouteMessage = olCarrierRoute
    ? null
    : takeover
      ? takeoverMessage(rider, candidateCarrier)
      : shopFulfilledMessage(shopConnectionName);

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

  // No OL shipment row but the rollup already reads dispatched/delivered → the
  // order was fulfilled outside OpenLinker; there is no label to generate here.
  const dispatchedOutsideOl =
    !activeShipment &&
    (order.fulfillmentState === 'dispatched' || order.fulfillmentState === 'delivered');

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
      ) : formOpen ? null : dispatchedOutsideOl ? (
        // No OL shipment row, yet the rollup says the order is already
        // dispatched/delivered → it was fulfilled outside OpenLinker. Show a
        // passive note instead of an active "Generate a label" CTA (this takes
        // precedence over the normal live-route empty state).
        <EmptyState
          title="Dispatched outside OpenLinker"
          message="Dispatched outside OpenLinker - no label to generate here."
        />
      ) : !olCarrierRoute ? (
        takeover ? (
          // Takeover nudge (#1776 E3) — OpenLinker could ship this once the
          // operator maps / connects / enables the carrier. The fix-it deep link
          // is the EmptyState's action (needs the source connection + method).
          <EmptyState
            title="OpenLinker can ship this"
            message={takeoverMessage(rider, candidateCarrier)}
            action={
              rider && order.sourceConnectionId ? (
                <DeliveryRiderAction
                  rider={rider}
                  sourceConnectionId={order.sourceConnectionId}
                  sourceDeliveryMethodId={order.sourceDeliveryMethodId}
                  sourceDeliveryMethodName={order.sourceDeliveryMethodName}
                />
              ) : undefined
            }
          />
        ) : (
          // Affirmative shop-fulfilled empty state (#1776 E2) — the shop owns
          // fulfilment; no CTA, no dead-end label action.
          <EmptyState
            title="Shipped by the shop"
            message={shopFulfilledMessage(shopConnectionName)}
          />
        )
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

      {/* When a shipment already exists but routing has no live OL carrier route
          (#1799), surface the reason inline so it's visible without hovering the
          disabled Generate-label button. The EmptyState already carries this copy
          on the no-shipment path, so this only fires alongside an active shipment. */}
      {activeShipment && noRouteMessage ? (
        <Alert tone="info" className="order-shipment-panel__route-note">
          {noRouteMessage}
        </Alert>
      ) : null}

      {/* Active-state action row (omitted in the empty state — the EmptyState
          owns its own CTA). Generate/re-generate is blocked when there's no live
          OL carrier route (#1799); Cancel / Download / Mark-dispatched stay. */}
      {activeShipment ? (
        <ShipmentActionButtons
          shipment={activeShipment}
          paymentStatus={paymentStatus}
          onGenerateLabelClick={() => setFormOpen(true)}
          routeUnavailable={!olCarrierRoute}
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
