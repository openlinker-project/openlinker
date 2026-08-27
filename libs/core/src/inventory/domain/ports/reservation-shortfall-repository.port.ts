/**
 * Reservation Shortfall Repository Port (#2349)
 *
 * The persistence contract for shortfall episodes.
 *
 * **This port reads `inventory_items` and `reservations` and writes NEITHER.**
 * The reconciler above it repairs nothing: it does not clamp
 * `availableQuantity`, does not move `olReservedQuantity`, and does not touch a
 * reservation row. The shortfall is a fact to be named, not a number to be
 * quietly corrected — repairing the counter would erase the evidence and
 * re-open the very silence design § 4.2 declined the `CHECK` to prevent.
 *
 * @module libs/core/src/inventory/domain/ports
 */
import type { ReservationShortfallEpisode } from '../entities/reservation-shortfall-episode.entity';
import type {
  OpenShortfallEpisodeInput,
  ReservationShortfallCloseReason,
  ShortfallPositionRow,
} from '../types/reservation-shortfall.types';
import type { Reservation } from '../entities/reservation.entity';

export interface ReservationShortfallRepositoryPort {
  /**
   * One page of live positions where OL has promised more than the master has.
   *
   * Ordered by `id ASC` — a stable total order. Not by a recency column: rows
   * leave this set from arbitrary positions, and under a recency ordering the
   * scan offset would over-advance systematically rather than randomly.
   *
   * The predicate `olReservedQuantity > availableQuantity` is a cross-column
   * comparison, so no index serves it directly; the partial index
   * `IDX_inventory_items_ol_reserved` narrows the scan to positions carrying
   * any hold at all, which bounds the cost by the size of the LEDGER rather
   * than of the catalogue.
   */
  listShortfallPositions(limit: number, offset: number): Promise<readonly ShortfallPositionRow[]>;

  /**
   * Which of the given positions are STILL short.
   *
   * The close sweep's read. Deliberately id-scoped rather than "list every
   * short position": the close page is budgeted, and an unbounded read of the
   * whole shortfall set here would defeat that budget entirely — on an install
   * with a wide shortfall it would be the single most expensive query in the
   * pass, growing without limit while the page it serves stays capped.
   */
  listShortPositionIds(
    inventoryItemIds: readonly string[]
  ): Promise<ReadonlySet<string>>;

  /**
   * Every `held` reservation on the given positions, youngest first.
   *
   * Batched across the whole page on purpose — one query per position would be
   * an N+1 over the hottest table in the system.
   */
  listHeldForPositions(
    inventoryItemIds: readonly string[]
  ): Promise<readonly Reservation[]>;

  /**
   * Open an episode, or report that one is already open.
   *
   * `INSERT ... ON CONFLICT DO NOTHING` against the partial unique index.
   * **Returns `null` when an episode for this `(orderRecordId,
   * inventoryItemId)` is already open** — the statement still executes on every
   * run, so a row count is the only honest measure of "wrote nothing", and this
   * return value is where a caller reads it.
   */
  openEpisode(input: OpenShortfallEpisodeInput): Promise<ReservationShortfallEpisode | null>;

  /**
   * One page of still-open episodes, ordered `id ASC` for the same reason
   * `listShortfallPositions` is.
   */
  listOpenEpisodes(limit: number, offset: number): Promise<readonly ReservationShortfallEpisode[]>;

  /**
   * Close an episode by an explicit write, guarded `WHERE "closedAt" IS NULL`.
   *
   * Guarded rather than unconditional so a concurrent close cannot overwrite
   * the first closer's reason and timestamp; `false` means somebody else closed
   * it, which is a success for the caller.
   */
  closeEpisode(
    id: string,
    reason: ReservationShortfallCloseReason,
    closedAt: Date
  ): Promise<boolean>;

  /** Every still-open episode for one order, for the order-detail projection. */
  listOpenByOrderRecordId(
    orderRecordId: string
  ): Promise<readonly ReservationShortfallEpisode[]>;

  /**
   * Every still-open episode across MANY orders, for the `/orders` list page.
   *
   * Batched deliberately: one read across the page's order ids, never one per
   * row — the N+1 the `getLatestInvoicesForOrders` (#1713) invoice projection
   * already established the shape for, on this same list endpoint.
   *
   * An empty input returns an empty array without querying.
   */
  listOpenByOrderRecordIds(
    orderRecordIds: readonly string[]
  ): Promise<readonly ReservationShortfallEpisode[]>;
}
