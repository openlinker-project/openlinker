/**
 * Fulfillment Work Dispatch Router Service Interface (#3506, G02-4)
 *
 * The ONE place that decides how a fulfilment work's `dispatch` intent reaches
 * the order's channel: through the work's linked shipment (waybill + carrier,
 * and the shipment advances) when there is exactly one outbound `generated`
 * shipment, otherwise through the tracking-less work-grain relay.
 *
 * Shared by the two callers that must agree on that decision — the parcel
 * closure notifier (the first attempt) and the `fulfillment.work.relaySweep`
 * reconcile pass (every retry). Before this seam existed only the first
 * caller knew the shipment-grain path, so a recovery always went work-grain
 * and the buyer saw "sent" with no tracking number.
 *
 * Lives in `shipping` because that is the context that may legally compose all
 * three collaborators: `ShippingModule` already imports both `OrdersModule`
 * (the work-grain relay) and `FulfillmentModule` (the relay gate), and
 * `fulfillment` itself is a zero-sibling-edge leaf (ADR-053).
 *
 * @module libs/core/src/shipping/application/interfaces
 */
import type { WorkDispatchRouteOutcome } from '../types/fulfillment-work-dispatch-router.types';

export interface IFulfillmentWorkDispatchRouterService {
  /**
   * Tell the work's order channel that the work shipped, by the most specific
   * path available. Never falls back from a failed shipment-grain notify to the
   * work-grain relay in the same call — see `WorkDispatchRouteOutcome`.
   *
   * Throws only when the work-grain relay's own claim read throws (an
   * infrastructure fault); a failed shipment lookup degrades to the work-grain
   * relay and a failed shipment-grain notify is reported, not thrown.
   */
  routeDispatch(workId: string): Promise<WorkDispatchRouteOutcome>;
}
