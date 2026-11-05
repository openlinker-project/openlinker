/**
 * Delivery Copy Constants
 *
 * Shared reassurance copy for shop-fulfilled orders (#1776). Centralised so the
 * order-detail Shipment panel's affirmative empty state and any other surface
 * that reassures the operator "there's nothing to do here" stay in lock-step
 * (single source of truth for the wording).
 *
 * @module apps/web/src/features/orders/lib
 */

/**
 * The unified "OpenLinker won't duplicate the shop's label" reassurance. Follows
 * the shop sentence in the Shipped-by-the-shop empty state (E2) so the operator
 * understands the shop owns fulfilment and OpenLinker only mirrors its status.
 */
export const SHOP_FULFILLED_NO_DUP_LABEL =
  "OpenLinker won't create a second label here, and updates the dispatch and delivery status as the shop reports it.";

/**
 * Where the order's shipping route comes from (#3958). The route itself is
 * worded by `describeShippingRoute` in the mappings feature; this says whether
 * an operator chose it (a routing rule for the delivery method) or nobody did
 * (the default, which leaves the order with the shop). Naming the origin is
 * what tells the operator a change here would apply to more than this order.
 */
export const SHIPPING_ROUTE_ORIGIN_COPY = {
  rule: (sourceName: string | null): string =>
    sourceName
      ? `Set for every ${sourceName} order on this delivery method.`
      : 'Set for every order on this delivery method.',
  default: 'No carrier is set for this delivery method, so your shop ships it.',
  changeAction: 'Change who ships it',
  chooseAction: 'Choose a carrier',
  /** Generic owner names when the route names no connection. */
  yourShop: 'Your shop',
  aCarrier: 'a carrier',
} as const;
