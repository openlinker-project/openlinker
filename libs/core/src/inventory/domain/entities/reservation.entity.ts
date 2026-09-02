/**
 * Reservation Domain Entity (#2343, ADR-061 decision 1)
 *
 * One order line's advisory claim on one inventory position. Creating one never
 * decrements `availableQuantity` — OpenLinker does not own on-hand stock — it
 * reduces what OL is willing to *promise*, and asserts nothing about what the
 * fulfiller will physically pick (a short-pick is a recorded fact, not an
 * invariant violation).
 *
 * Anemic and readonly per ADR-011: state changes go through the repository's
 * guarded UPDATEs, never through a method here.
 *
 * @module libs/core/src/inventory/domain/entities
 */
import type {
  ReservationAtpEffect,
  ReservationStatus,
} from '../types/reservation.types';

export class Reservation {
  constructor(
    public readonly id: string,
    public readonly orderRecordId: string,
    /**
     * The SOURCE-supplied order line id (`OrderItem.id`), unique only within its
     * own order — which is why the natural key carries `orderRecordId` too.
     */
    public readonly orderLineId: string,
    public readonly inventoryItemId: string,
    public readonly quantity: number,
    public readonly status: ReservationStatus,
    /**
     * Mandatory (ADR-061 decision 1). An unbounded hold on a system that may
     * never observe the close event is an oversell leak with no floor.
     */
    public readonly expiresAt: Date,
    /**
     * Stamped at creation by the ingestion caller that holds the routing
     * outcome, and **immutable thereafter** — so the ATP query is a local column
     * test and no `inventory ↔ fulfillment` read exists on the publish path.
     */
    public readonly atpEffect: ReservationAtpEffect,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    /** When the row left `held`. `null` while it is still live. */
    public readonly closedAt: Date | null = null,
  ) {}
}
