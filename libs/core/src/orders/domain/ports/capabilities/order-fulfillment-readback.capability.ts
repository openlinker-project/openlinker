/**
 * Order Fulfillment Readback Capability
 *
 * Optional sub-capability of `OrderSourcePort` (#3365) — an order SOURCE that
 * can report its own view of an order's fulfilment back to OpenLinker declares
 * `implements OrderFulfillmentReadback`.
 *
 * ## Why it exists
 *
 * `OrderStatusWriteback` (ADR-027) relays a dispatch mark, and where one is
 * known a waybill, from OpenLinker INTO the marketplace. It is deliberately
 * fire-and-forget: nothing reads the result. The consequence is that every
 * "the marketplace was told" check in this repository asserts an OpenLinker row
 * or a mock, never the marketplace — both specs that come closest say so in
 * their own headers. An operator whose parcel "did not reach Allegro" has no
 * way to find out inside the product.
 *
 * This is the read half. The status costs nothing extra where the adapter
 * already fetches the order — Allegro's `GET /order/checkout-forms/{id}`
 * returns the very `fulfillment.status` field `PUT .../fulfillment` writes, and
 * the adapter already read it, only to detect a cancellation. Waybills live on
 * a separate resource and therefore do cost a second call, which is why the
 * shape lets an implementation answer the status alone.
 *
 * ## The method name is NOT `getFulfillmentStatus`, on purpose
 *
 * `FulfillmentStatusReader` (#834) already claims that name on
 * `OrderProcessorManagerPort`, and its guard is a bare
 * `typeof adapter.getFulfillmentStatus === 'function'`. An adapter declaring
 * this capability under that name would be narrowed by THAT guard and called
 * with a different contract — one-directional, needing no class that implements
 * both ports. It is the same collision `getWorkFulfillmentStatus` was renamed
 * to avoid in the fulfillment context, and a comment cannot prevent it where a
 * distinct name makes it inexpressible.
 *
 * ## Guard-only, and never in `CoreCapabilityValues`
 *
 * Advertised nowhere and dispatched never: call sites resolve the source with
 * `getCapabilityAdapter<OrderSourcePort>(connectionId, 'OrderSource')` and
 * narrow with `isOrderFulfillmentReadback`. Gating on a capability NAME would
 * be silently inert, because `enabledCapabilities` is stamped at connection
 * create and never retro-filled (#2085) — every connection that already exists
 * would report the capability missing forever. The same reasoning
 * `ReturnSourceReader` records one file over.
 *
 * A source that declares nothing degrades to `unsupported`, which the caller
 * reports as a state rather than as an error.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderSourcePort} for the base port
 * @see {@link SourceFulfillmentReadback} for the returned shape
 * @see {@link OrderStatusWriteback} for the write half this reads back
 */

import type { SourceFulfillmentReadback } from '../../types/source-fulfillment-readback.types';
import type { OrderSourcePort } from '../order-source.port';

export interface OrderFulfillmentReadback {
  /**
   * Ask the source marketplace what it currently says about this order's
   * fulfilment.
   *
   * Implementations MUST NOT throw for a marketplace-side condition: a source
   * that is unreachable, that refuses, or that answers something unrecognised
   * is reported through the returned outcome. A throw here is reserved for a
   * programming error, since the caller is a read surface and a 500 for a
   * momentarily unreachable marketplace tells an operator nothing they can act
   * on.
   *
   * `externalOrderId` is the source-native order id (Allegro: the checkout-form
   * id).
   */
  readFulfillment(input: { externalOrderId: string }): Promise<SourceFulfillmentReadback>;
}

export function isOrderFulfillmentReadback(
  adapter: OrderSourcePort,
): adapter is OrderSourcePort & OrderFulfillmentReadback {
  return typeof (adapter as Partial<OrderFulfillmentReadback>).readFulfillment === 'function';
}
