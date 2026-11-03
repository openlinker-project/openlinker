/**
 * Fulfilment Parcel Closure Notifier — contract (#3525)
 *
 * `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf (ADR-053)
 * and may not import `@openlinker/core/orders`, so it cannot itself relay a
 * `dispatch` intent to the order's channel — see
 * `IFulfillmentProgressService.record()`'s own docblock, which names "an
 * operator action" as one of the seam's three intended callers. This is that
 * caller's shared HOST-side seam: it records the progress fact and forwards
 * whatever relay intent falls out, so a work object closed at the bench and
 * one closed from the desktop worklist go through ONE body rather than two
 * copies that could drift.
 *
 * Both call sites — `BenchParcelService.verifyUnit` (the bench's automatic
 * close, D18) and `FulfillmentWorkController.applyAction`'s `close` action
 * (the desktop worklist's manual close) — already live in `apps/api` for the
 * identical reason: joining `fulfillment` to `orders` needs a host, and this
 * is that join for the closing act specifically.
 *
 * @module apps/api/src/fulfillment/application/interfaces
 */

export const FULFILLMENT_PARCEL_CLOSURE_NOTIFIER_TOKEN = Symbol(
  'IFulfillmentParcelClosureNotifier'
);

export interface NotifyFulfillmentParcelClosedInput {
  readonly workId: string;
  /**
   * The executor connection that closed the parcel — `FulfillmentWork.assignedConnectionId`.
   *
   * Required rather than optional: a progress event without a reporting
   * connection is meaningless, so a caller holding a `null` here must not
   * call this method at all (see `FulfillmentWorkController`'s guard, the one
   * reachable state where `close` is legal with no assigned holder).
   */
  readonly connectionId: string;
  /** The instant OpenLinker itself recorded the close — never re-derived here. */
  readonly closedAt: Date;
}

export interface IFulfillmentParcelClosureNotifier {
  /**
   * Record that a fulfilment work's parcel closed, and forward the resulting
   * relay intent so the order's channel is told it shipped.
   *
   * BEST-EFFORT and NEVER THROWS: the close this call reports on has already
   * committed by the time it runs (the pack bench's `claimParcelClose`, or
   * the worklist's own `transitionStatus`), so a failure here must cost the
   * caller nothing worse than a delayed channel notification — the #2728
   * reconcile sweep is the retry path, not a synchronous re-throw.
   */
  notifyParcelClosed(input: NotifyFulfillmentParcelClosedInput): Promise<void>;
}
