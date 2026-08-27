/**
 * Reservation Shortfall Episode (#2349, design § 4.2 story I6)
 *
 * One EPISODE of "this order is short N of this sku" — opened once on the
 * transition into shortfall, closed by an explicit write, never reopened.
 *
 * **`id` is the occurrence id an edge-triggered automation keys on.** Its
 * stability is structural rather than a matter of discipline: a partial unique
 * index over `(orderRecordId, inventoryItemId) WHERE "closedAt" IS NULL` means
 * that while an episode is open every re-detection conflicts and writes
 * nothing, so the id cannot be re-minted or duplicated by two concurrent runs.
 * A recurrence after a close does not conflict (the closed row is outside the
 * partial index) and therefore mints a NEW id — which is what makes "re-fires
 * only if the shortfall clears and then recurs" implementable rather than
 * aspirational.
 *
 * There is deliberately no `lastObservedAt`: a re-observation column would make
 * every run write to every open episode, which is the level-triggered shape the
 * episode model exists to avoid.
 *
 * Anemic and readonly per ADR-011 — the one method is a pure derivation over
 * its own already-loaded fields.
 *
 * @module libs/core/src/inventory/domain/entities
 */
import type { ReservationShortfallCloseReason } from '../types/reservation-shortfall.types';

export class ReservationShortfallEpisode {
  constructor(
    /** The occurrence id. See the class docblock for why it is stable. */
    public readonly id: string,
    public readonly orderRecordId: string,
    /**
     * The position. It is the grain at which a shortfall is OBSERVABLE at all —
     * `olReservedQuantity > availableQuantity` is a position-level fact — and it
     * resolves to exactly one variant, hence one sku.
     */
    public readonly inventoryItemId: string,
    public readonly productVariantId: string | null,
    /** Snapshot at open time, so the row still reads after a re-map. */
    public readonly sku: string | null,
    /** This order's attributed share of the shortfall. Always > 0. */
    public readonly shortQuantity: number,
    /** The whole position's shortfall at open time. */
    public readonly positionShortfall: number,
    public readonly openedAt: Date,
    public readonly closedAt: Date | null,
    public readonly closeReason: ReservationShortfallCloseReason | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}

  isOpen(): boolean {
    return this.closedAt === null;
  }
}
