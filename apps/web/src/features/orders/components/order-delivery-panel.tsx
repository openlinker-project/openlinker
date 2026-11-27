/**
 * Order Delivery Panel
 *
 * Snapshot-driven "where it's going" panel for the order-detail page (#924):
 * ship-to address, delivery method, and buyer-selected pickup point. Always
 * available (not capability-gated) — the dispatch lifecycle (label / tracking)
 * stays in the capability-gated `OrderShipmentPanel`.
 *
 * The pickup caption keys on the SOURCE platform's `pickupPointResolvesAsync`
 * trait (#893): the buyer selects the locker on the source marketplace, so the
 * source connection — not the destination — owns the "buyer-selected" wording.
 *
 * Carrier precedence (#1617): the panel never resolves the carrier itself — it
 * renders whatever `carrier` string the caller passes in. `OrderDetailPage`
 * computes that value as `shipment.carrier` (the actual carrier of record on
 * a booked shipment, via `getCarrierDisplayName`) when a shipment exists,
 * falling back to the snapshot's `shipping.methodName` (the source's stated
 * delivery-method preference) otherwise. Same precedence the orders-list row
 * detail would use if a shipment were loaded there (it isn't — see
 * `OrderRowDetail`, which uses `shipping.methodName` directly). Unlike the
 * other fields below, Carrier always renders ("-" fallback) — including when
 * every other delivery field is absent — so the panel doubles as the one
 * guaranteed place to check "who's shipping this."
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { interpolate, useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import type {
  ParsedAddress,
  ParsedOrderPickupPoint,
  ParsedOrderShipping,
} from '../api/order-snapshot.schema';
import { useShippingRouteCopy } from '../../mappings';
import type { OrderDeliveryResolution, OrderDeliveryRider } from '../api/orders.types';
import type { OrderEditsView } from '../api/order-edit.types';
import type { DeliveryOutcome } from '../lib/delivery-outcome';
import type { DeliveryOwner } from '../lib/delivery-owner';
import { ConnectionDot } from './connection-dot';
import { DeliveryOutcomeChip, DeliveryRiderBanner } from './delivery-chip';
import { DeliveryRiderAction } from './delivery-rider-action';
import { ShippingRouteAction } from './shipping-route-action';

interface OrderDeliveryPanelProps {
  shippingAddress?: ParsedAddress;
  shipping?: ParsedOrderShipping;
  pickupPoint?: ParsedOrderPickupPoint;
  /** Source platform type — drives the buyer-selected vs operator-selected caption. */
  sourcePlatformType?: string | null;
  /**
   * Resolved carrier display name (#1617) — see precedence note above.
   * Always rendered as a "Carrier" field, "-" when the caller resolved
   * nothing (no shipment carrier and no snapshot method name).
   */
  carrier?: string | null;
  /**
   * Fallback delivery-method label (#1776) rendered on the always-present
   * Method row when the snapshot carried no `shipping.methodName`/`methodId`.
   * Callers derive it from the booked shipment (carrier / mapped method) so a
   * source order with no delivery line still shows a method. The Method row
   * chain is `shipping.methodName ?? shipping.methodId ?? methodFallback ??
   * pickupPoint.name ?? '-'`.
   */
  methodFallback?: string | null;
  /**
   * Physical delivery outcome (#1793) rendered as a chip in the Carrier row.
   * Derived by the caller from `deliveryResolution` + shipment state via
   * `deriveDeliveryOutcome`. Absent → no chip (older/degraded payloads).
   */
  deliveryOutcome?: DeliveryOutcome;
  /**
   * Resolved delivery owner (#1776) — the carrier or destination shop that owns
   * fulfilment, resolved by the caller via `resolveDeliveryOwner`. Renders a
   * "Shipped by" row (connection mini-badge + the route in plain words) as
   * the panel's first field. Absent → no Shipped-by row (older payloads).
   */
  deliveryOwner?: DeliveryOwner;
  /**
   * How routing resolved for the delivery method (#3958). Words the "Shipped
   * by" row as a route ("OpenLinker buys the label from InPost") and says
   * whether an operator set it or it is the default. Absent (older payloads)
   * -> the route is inferred from `deliveryOwner` and no origin is stated.
   */
  deliveryResolution?: OrderDeliveryResolution | null;
  /**
   * Actionable delivery rider (#1793/#1792). When actionable
   * (`unmapped` / `not-connected`) an inline banner + fix-it deep-link button
   * (#1794) renders beneath the delivery fields.
   */
  deliveryRider?: OrderDeliveryRider | null;
  /**
   * Source connection id (#1794) — the Add-mapping deep-link target. When
   * absent the rider banner falls back to its disabled placeholder button.
   */
  sourceConnectionId?: string | null;
  /** Unmapped source delivery-method id (#1791) — Add-mapping pre-focus target. */
  sourceDeliveryMethodId?: string | null;
  /** Source delivery-method label (#1791) — Add-mapping pre-focus copy. */
  sourceDeliveryMethodName?: string | null;
  /**
   * The order beside the channel's record (#3544). Present only on an edited
   * order; the panel then says what the channel still shows next to the edited
   * address and method. `shippingAddress` / `shipping` are already the edited ones.
   */
  edits?: OrderEditsView | null;
  /** Display name of the source connection, for "<channel> shows ...". */
  channelName?: string | null;
}

function addressLines(address: ParsedAddress): ReactElement {
  const name = [address.firstName, address.lastName].filter(Boolean).join(' ').trim();
  return (
    <span className="order-delivery__addr">
      {name ? (
        <>
          {name}
          <br />
        </>
      ) : null}
      {address.company ? (
        <>
          {address.company}
          <br />
        </>
      ) : null}
      {address.address1}
      <br />
      {address.address2 ? (
        <>
          {address.address2}
          <br />
        </>
      ) : null}
      {address.postalCode} {address.city}
      <br />
      {address.country}
    </span>
  );
}

export function OrderDeliveryPanel({
  shippingAddress,
  shipping,
  pickupPoint,
  sourcePlatformType,
  carrier,
  methodFallback,
  deliveryOutcome,
  deliveryOwner,
  deliveryResolution,
  deliveryRider,
  sourceConnectionId,
  sourceDeliveryMethodId,
  sourceDeliveryMethodName,
  edits,
  channelName,
}: OrderDeliveryPanelProps): ReactElement {
  // Resolved unconditionally (never inside a branch) — see #893.
  const sourcePlatform = usePlatform(sourcePlatformType ?? undefined);
  const routeCopy = useShippingRouteCopy();
  const routeOrigin = useMessages('orders').shippingRouteOrigin;
  const copy = useMessages('orders').orderDeliveryPanel;
  const channel = channelName ?? copy.edited.theChannel;

  const items: KeyValueItem[] = [];
  const methodLabel =
    shipping?.methodName ?? sourceDeliveryMethodName ?? shipping?.methodId ?? sourceDeliveryMethodId ?? null;
  // "Shipped by" (#1776) - the first field: who owns fulfilment, worded as a
  // route with the shared mappings vocabulary (#3958), plus where that route
  // comes from and the action that changes it. The kind comes from the backend
  // resolution; only an older payload without one falls back to the owner.
  if (deliveryOwner) {
    const routeKind =
      deliveryResolution?.processorKind ??
      (deliveryOwner.variant === 'carrier' ? 'ol_managed_carrier' : 'omp_fulfilled');
    const ownerName =
      deliveryOwner.name ??
      (deliveryOwner.variant === 'carrier'
        ? routeOrigin.aCarrier
        : routeOrigin.yourShop);
    const route = routeCopy.describe(routeKind, ownerName);
    // A rule to a switched-off connection still matches (#1799); say so rather
    // than present a dead route as the one that will ship the order.
    const routeText =
      deliveryResolution?.processorAvailable === false ? routeCopy.unavailable(route) : route;
    const fromRule = deliveryResolution?.source === 'rule';
    items.push({
      id: 'shipped-by',
      label: copy.shippedBy.label,
      value: (
        <>
          <span className="order-delivery__shipped-by">
            <ConnectionDot
              name={deliveryOwner.name}
              platformType={deliveryOwner.platformType}
              variant={deliveryOwner.variant}
            />
            <span>{routeText}</span>
          </span>
          {deliveryResolution ? (
            <span className="order-delivery__route-origin" data-testid="order-delivery-route-origin">
              <span className="text-muted">
                {fromRule
                  ? channelName
                    ? interpolate(routeOrigin.rule, { source: channelName })
                    : routeOrigin.ruleNoSource
                  : routeOrigin.default}
              </span>
              {/* An unmapped rider below already offers this same dialog; one button per action. */}
              {sourceConnectionId && deliveryRider?.rider !== 'unmapped' ? (
                <ShippingRouteAction
                  sourceConnectionId={sourceConnectionId}
                  sourceName={channelName}
                  methodLabel={methodLabel}
                  methodId={shipping?.methodId ?? sourceDeliveryMethodId ?? null}
                  label={fromRule ? routeOrigin.changeAction : routeOrigin.chooseAction}
                />
              ) : null}
            </span>
          ) : null}
        </>
      ),
    });
  }
  if (shippingAddress) {
    const originalAddress = edits?.address?.original ?? null;
    items.push({
      id: 'ship-to',
      label: copy.shipTo,
      value: (
        <>
          {addressLines(shippingAddress)}
          {edits?.address ? (
            <span className="order-edit-edited" data-testid="order-edit-address-original">
              {interpolate(copy.edited.address, {
                channel,
                address: originalAddress
                  ? [originalAddress.address1, originalAddress.address2].filter(Boolean).join(', ')
                  : copy.edited.differentAddress,
              })}
            </span>
          ) : null}
        </>
      ),
    });
  }
  // Always rendered (#1776) — the delivery-method label is a core "where it's
  // going" fact, so it must not blank out when the source order carried no
  // shipping line. Precedence: source method name → source method id →
  // caller-supplied fallback (shipment-derived carrier/method) → pickup-point
  // name (#1793) → "-".
  items.push({
    id: 'method',
    label: copy.method,
    value: (
      <>
        {shipping?.methodName ?? shipping?.methodId ?? methodFallback ?? pickupPoint?.name ?? '-'}
        {edits?.deliveryMethod ? (
          <span className="order-edit-edited" data-testid="order-edit-method-original">
            {interpolate(copy.edited.method, {
              channel,
              method:
                edits.deliveryMethod.original.name ??
                edits.deliveryMethod.original.id ??
                copy.edited.noMethod,
            })}
          </span>
        ) : null}
      </>
    ),
  });
  // Always rendered (unlike the fields above) — "-" fallback per #1617 so the
  // operator can tell "no carrier resolved" apart from "field doesn't exist".
  // This row is also the documented delivery-method fallback (#1776): when the
  // source order carried no delivery method (so the Method row above is absent —
  // e.g. Erli/WooCommerce orders with no shipping line), the booked shipment's
  // carrier still surfaces here, so the panel always answers "how is this
  // shipping?" without duplicating a Method row. The mapping-aware outcome chip
  // (#1793) sits alongside the carrier name when the caller derived one.
  items.push({
    id: 'carrier',
    label: copy.carrier,
    value: deliveryOutcome ? (
      <span className="order-delivery__carrier">
        <span>{carrier ?? '-'}</span>
        <DeliveryOutcomeChip outcome={deliveryOutcome} />
      </span>
    ) : (
      (carrier ?? '-')
    ),
  });

  const pickupCaption =
    sourcePlatform?.pickupPointResolvesAsync === true
      ? interpolate(copy.pickup.buyerSelectedVia, { provider: sourcePlatform.displayName })
      : copy.pickup.operatorSelected;

  // Point-kind label (#1433) — Paczkomat (apm) vs PaczkoPunkt (pop). Absent
  // pointType falls back to no kind label (pre-#1433 behaviour).
  const pickupKindLabel =
    pickupPoint?.pointType === 'pop'
      ? 'PaczkoPunkt'
      : pickupPoint?.pointType === 'apm'
        ? 'Paczkomat'
        : undefined;

  return (
    <section className="detail-section order-delivery" aria-label={copy.title}>
      <h3 className="detail-section__title">{copy.title}</h3>
      <div className="order-delivery__card">
        <KeyValueList items={items} />
        {deliveryRider ? (
          <DeliveryRiderBanner
            rider={deliveryRider}
            actionSlot={
              sourceConnectionId ? (
                <DeliveryRiderAction
                  rider={deliveryRider}
                  sourceConnectionId={sourceConnectionId}
                  sourceDeliveryMethodId={sourceDeliveryMethodId}
                  sourceDeliveryMethodName={sourceDeliveryMethodName}
                />
              ) : undefined
            }
          />
        ) : null}
        {pickupPoint ? (
          <div className="order-delivery__pickup">
            <div className="order-delivery__pickup-code mono-text">
              {pickupKindLabel ? `${pickupKindLabel} ` : ''}
              {pickupPoint.id}
            </div>
            <div className="order-delivery__pickup-caption text-muted">
              {pickupPoint.description ? `${pickupPoint.description} · ` : ''}
              {pickupCaption}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
