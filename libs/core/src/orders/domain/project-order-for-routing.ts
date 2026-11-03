/**
 * projectOrderForRouting - order -> the router's ADR-062 allowlist input (#2954)
 *
 * The one place an `Order` is reduced to what a fulfilment router may be told:
 * line ids and quantities, the OPAQUE delivery-method key, and a ship-to that
 * names no buyer. It existed twice as a private copy (ingestion, and the
 * `fulfillment.work.route` handler) and the operator-facing dry run would have
 * been a third; three copies of an allowlist is how one of them starts leaking.
 *
 * Pure: the PII flag and the stored address hash arrive as ARGUMENTS. The
 * snapshot's address has already been through redaction, so hashing it here
 * would collapse to one value per country across the whole install -
 * `shippingAddressHash` is stamped at ingestion from the UN-redacted address
 * for exactly that reason.
 *
 * Returns `null` for an order with no shipping address: nothing routes without
 * one, and no retry can supply it.
 *
 * @module libs/core/src/orders/domain
 */
import {
  buildRoutingShipTo,
  type RoutingInputLine,
  type RoutingShipTo,
} from '@openlinker/core/fulfillment';

import type { Order } from './types/order.types';

/** The ADR-062 allowlist projection handed to a router. */
export interface OrderRoutingProjection {
  readonly lines: RoutingInputLine[];
  readonly shipTo: RoutingShipTo;
  readonly requestedDeliveryMethod: string | null;
}

export function projectOrderForRouting(
  order: Order,
  shippingAddressHash: string | null,
  storePii: boolean
): OrderRoutingProjection | null {
  const shippingAddress = order.shippingAddress;
  if (shippingAddress === undefined) {
    return null;
  }

  return {
    lines: order.items.map((item) => ({
      orderLineId: item.id,
      // A work line needs a variant. `variantId` is optional on `OrderItem`, so
      // fall back to the product id rather than emitting a blank - a work
      // object pointing at no variant is unpickable stock nothing would report.
      productVariantId: item.variantId ?? item.productId,
      quantity: item.quantity,
    })),
    // The OPAQUE key `RoutingInput.requestedDeliveryMethod` documents - the
    // source's own method id, never a neutral vocabulary.
    requestedDeliveryMethod: order.shipping?.methodId ?? null,
    shipTo: buildRoutingShipTo(
      {
        countryIso2: shippingAddress.country,
        postalCode: shippingAddress.postalCode,
        city: shippingAddress.city,
        addressHash: shippingAddressHash,
      },
      { storePii }
    ),
  };
}
