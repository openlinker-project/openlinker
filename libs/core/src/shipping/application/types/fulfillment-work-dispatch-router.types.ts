/**
 * Fulfillment Work Dispatch Router Types (#3506, G02-4)
 *
 * Result contract for `IFulfillmentWorkDispatchRouterService.routeDispatch`.
 * An inline discriminated union rather than an `as const` value array: this is
 * an in-process service result with no wire, DB or Swagger consumer, the same
 * convention `ShipmentDispatchNotificationResult` follows.
 *
 * The four work-grain arms mirror `FulfillmentDispatchRelayOutcome` one for one
 * (`@openlinker/core/orders`), so a caller that only ever saw the work-grain
 * relay reads them unchanged. The two shipment-grain arms are what the router
 * adds.
 *
 * @module libs/core/src/shipping/application/types
 */

export type WorkDispatchRouteOutcome =
  /**
   * The work's one linked outbound `generated` shipment was notified through
   * `IShipmentDispatchNotificationService.notifyDispatched` — the channel got
   * the waybill and carrier, and the shipment advanced to `dispatched`. The
   * work-grain slot is claimed without relaying (or a peer already held it),
   * so the work leaves the reconcile frontier.
   */
  | { readonly status: 'via-shipment'; readonly shipmentId: string }
  /**
   * The shipment-grain notify did not land. The shipment stays `generated`
   * and the work-grain slot stays UNCLAIMED, deliberately: falling back to
   * the tracking-less work-grain relay here is exactly what left G02-4's
   * buyer with "sent" and no tracking number. A later pass retries the
   * shipment-grain path. `reason` is log text only, never persisted.
   */
  | { readonly status: 'shipment-failed'; readonly shipmentId: string; readonly reason: string }
  /** Work-grain relay ran and its claim is kept (see `FulfillmentDispatchRelayOutcome`). */
  | { readonly status: 'relayed' }
  /** Work-grain relay failed transiently everywhere; its claim was released. */
  | { readonly status: 'released'; readonly reason: string }
  /** A peer holds the work-grain slot. Nothing was relayed. */
  | { readonly status: 'already-relayed' }
  /** No such work row. Nothing was relayed. */
  | { readonly status: 'unknown-work'; readonly workId: string };

export type WorkDispatchRouteStatus = WorkDispatchRouteOutcome['status'];
