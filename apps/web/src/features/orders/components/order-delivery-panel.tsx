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

interface OrderDeliveryPanelProps {
  shippingAddress?: ParsedAddress;
  shipping?: ParsedOrderShipping;
  pickupPoint?: ParsedOrderPickupPoint;
  /** Source platform type — drives the buyer-selected vs operator-selected caption. */
  sourcePlatformType?: string | null;
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
}: OrderDeliveryPanelProps): ReactElement | null {
  // Resolved unconditionally (never inside a branch) — see #893.
  const sourcePlatform = usePlatform(sourcePlatformType ?? undefined);

  if (!shippingAddress && !shipping && !pickupPoint) return null;

  const items: KeyValueItem[] = [];
  if (shippingAddress) {
    items.push({ id: 'ship-to', label: 'Ship to', value: addressLines(shippingAddress) });
  }
  if (shipping?.methodName ?? shipping?.methodId) {
    items.push({ id: 'method', label: 'Method', value: shipping.methodName ?? shipping.methodId });
  }

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
        {items.length > 0 ? <KeyValueList items={items} /> : null}
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
