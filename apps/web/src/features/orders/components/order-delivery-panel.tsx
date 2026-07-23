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

import { usePlatform } from '../../../shared/plugins';
import { KeyValueList, type KeyValueItem } from '../../../shared/ui/key-value-list';
import type {
  ParsedAddress,
  ParsedOrderPickupPoint,
  ParsedOrderShipping,
} from '../api/order-snapshot.schema';
import type { OrderDeliveryRider } from '../api/orders.types';
import type { DeliveryOutcome } from '../lib/delivery-outcome';
import { DeliveryOutcomeChip, DeliveryRiderBanner } from './delivery-chip';
import { DeliveryRiderAction } from './delivery-rider-action';

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
  deliveryRider,
  sourceConnectionId,
  sourceDeliveryMethodId,
  sourceDeliveryMethodName,
}: OrderDeliveryPanelProps): ReactElement {
  // Resolved unconditionally (never inside a branch) — see #893.
  const sourcePlatform = usePlatform(sourcePlatformType ?? undefined);

  const items: KeyValueItem[] = [];
  if (shippingAddress) {
    items.push({ id: 'ship-to', label: 'Ship to', value: addressLines(shippingAddress) });
  }
  // Always rendered (#1776) — the delivery-method label is a core "where it's
  // going" fact, so it must not blank out when the source order carried no
  // shipping line. Precedence: source method name → source method id →
  // caller-supplied fallback (shipment-derived carrier/method) → pickup-point
  // name (#1793) → "-".
  items.push({
    id: 'method',
    label: 'Method',
    value:
      shipping?.methodName ?? shipping?.methodId ?? methodFallback ?? pickupPoint?.name ?? '-',
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
    label: 'Carrier',
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
      ? `buyer-selected via ${sourcePlatform.displayName}`
      : 'operator-selected';

  // Point-kind label (#1433) — Paczkomat (apm) vs PaczkoPunkt (pop). Absent
  // pointType falls back to no kind label (pre-#1433 behaviour).
  const pickupKindLabel =
    pickupPoint?.pointType === 'pop'
      ? 'PaczkoPunkt'
      : pickupPoint?.pointType === 'apm'
        ? 'Paczkomat'
        : undefined;

  return (
    <section className="detail-section order-delivery" aria-label="Delivery">
      <h3 className="detail-section__title">Delivery</h3>
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
