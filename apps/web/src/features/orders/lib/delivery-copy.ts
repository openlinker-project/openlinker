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
