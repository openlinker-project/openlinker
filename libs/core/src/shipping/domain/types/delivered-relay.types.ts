/**
 * Delivered-Relay Bookkeeping Types (#3506, G02-7)
 *
 * Whether a delivered shipment's `delivered` lifecycle event has reached the
 * order's participants, and how often it has failed to. Before this the relay
 * was one-shot: it fired only on the poll that discovered the transition, a
 * rejection was logged and never retried, and the `delivered` row then left the
 * status scan for good — so a shop that rejected the write (e.g. a PrestaShop
 * with no resolvable "delivered" state) stayed "Shipped" forever.
 *
 * @module libs/core/src/shipping/domain/types
 */

/**
 * The three `shipments` columns that make the delivered relay retryable,
 * projected as one value object (the `WaybillRelayFailure` precedent: one
 * trailing constructor slot rather than three same-typed positional ones).
 *
 * A DISPLAY and forensics fact on the entity: the re-drive pass selects its
 * candidates by query, never by reading this off a loaded row.
 */
export interface DeliveredRelayState {
  /**
   * When the `delivered` event was relayed to every participant that could
   * take it (a structural decline counts — there is nothing to retry). `null`
   * on a delivered shipment means the relay is still owed.
   */
  readonly relayedAt: Date | null;
  /** Failed attempts so far; never reset (the relay is done once stamped). */
  readonly failureCount: number;
  /** The most recent failed attempt, or `null` when there has been none. */
  readonly lastFailureAt: Date | null;
}

/** The state of every shipment that has not been delivered, or never failed. */
export const NO_DELIVERED_RELAY_STATE: DeliveredRelayState = Object.freeze({
  relayedAt: null,
  failureCount: 0,
  lastFailureAt: null,
});

/**
 * Bounds for `ShipmentRepositoryPort.findDeliveredRelayPending`. Absolute
 * instants rather than durations, so the repository holds no clock and no
 * policy — the service decides what "too old" and "too soon" mean.
 */
export interface FindDeliveredRelayPendingOptions {
  /** Page size. */
  readonly limit: number;
  /** Skip a shipment that already failed this many times — it has been given up on. */
  readonly maxFailures: number;
  /** Only shipments delivered (or, lacking a carrier instant, created) at or after this. */
  readonly deliveredSince: Date;
  /** Only shipments whose last failure (if any) is older than this — the retry back-off. */
  readonly lastFailureBefore: Date;
}
