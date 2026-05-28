/**
 * Fulfillment Status Snapshot Types
 *
 * Neutral DTO returned by `FulfillmentStatusReader.getFulfillmentStatus` —
 * the destination OMP's view of an order's fulfillment progress (#834).
 *
 * **Why a dedicated `FulfillmentStatus` union and not `ShipmentStatus`**:
 * `ShipmentStatus` is the *shipping context's* persistence vocabulary for
 * the OL-side `Shipment` row. `FulfillmentStatus` is the *OMP's view* of
 * the order — a contract-surface concept. Keeping them distinct means
 * adding a non-fulfillment value to `ShipmentStatus` (e.g. `in-transit`,
 * already there for carrier reads) doesn't ripple into the
 * `OrderProcessorManagerPort` contract. The branch-1 sync service maps
 * `FulfillmentStatus → ShipmentStatus` at projection time — that's the
 * single source of truth for the mapping.
 *
 * The `null` status case is the projection-only semantics' load-bearing
 * signal: the OMP has not yet acted on the order (awaiting payment,
 * processing, picking, …) and there is nothing to project. The branch-1
 * sync service treats `null` as "skip this record this pass" — no
 * Shipment row is written, the order will be re-checked on the next tick.
 *
 * `deliveredAt` is populated only on the `delivered` transition.
 *
 * @module libs/core/src/orders/domain/types
 * @see {@link FulfillmentStatusReader} for the port consuming this type
 */

/**
 * Fulfillment status values the OMP reports back. The values intentionally
 * overlap with the shipping-context `ShipmentStatus` literal strings for
 * the three transitions an OMP can describe today, but the contract is
 * independent — shipping is free to add states (e.g. `in-transit`,
 * `failed`) without touching this union.
 */
export const FulfillmentStatusValues = ['delivered', 'dispatched', 'cancelled'] as const;
export type FulfillmentStatus = (typeof FulfillmentStatusValues)[number];

export const FULFILLMENT_STATUS = {
  Delivered: 'delivered',
  Dispatched: 'dispatched',
  Cancelled: 'cancelled',
} as const satisfies Record<'Delivered' | 'Dispatched' | 'Cancelled', FulfillmentStatus>;

export interface FulfillmentStatusSnapshot {
  /**
   * `null` ⇒ OMP has not yet acted on the order (pre-fulfillment). The
   * sync service skips creation/update in that case — projection-only
   * semantics. Non-null ⇒ OMP has acted; the value is the OMP's report
   * of the order's current fulfillment state, mapped onto OL's persisted
   * shipment status by the sync service.
   */
  status: FulfillmentStatus | null;
  trackingNumber: string | null;
  deliveredAt: Date | null;
}
