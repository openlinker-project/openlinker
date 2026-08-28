/**
 * Reservation Shortfall Service Interface (#2349, design § 4.2 story I6)
 *
 * The honesty commitment: when the master drops below what OpenLinker already
 * promised, the operator sees **a shortfall on a named order**, never a
 * silently clamped number.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link ReservationShortfallService} for the implementation
 */
import type { ReservationShortfallEpisode } from '../../domain/entities/reservation-shortfall-episode.entity';
import type { DetectShortfallsResult } from '../../domain/types/reservation-shortfall.types';

export interface DetectShortfallsInput {
  /** Positions examined by the detection half this run. Already clamped. */
  readonly detectLimit: number;
  /** Open episodes examined by the close half this run. Already clamped. */
  readonly closeLimit: number;
  /** Where the detection scan resumes. */
  readonly detectOffset: number;
  /** Where the close scan resumes. */
  readonly closeOffset: number;
  /** Clock, injected so one run stamps one instant and specs are deterministic. */
  readonly now?: Date;
}

export interface IReservationShortfallService {
  /**
   * One budgeted, resumable pass: open episodes for newly-short positions, and
   * close the ones that no longer stand.
   *
   * ## The episode lifecycle
   *
   * | | |
   * |---|---|
   * | Open | first time `(order, position)` is observed short — `INSERT … ON CONFLICT DO UPDATE` against the partial unique index, so a still-open episode is re-observed and its quantities **refreshed in place, its id untouched** |
   * | Close `recovered` | the position is no longer short |
   * | Close `reservation-closed` | the order holds no `held` reservation there any more — cancellation, dispatch or expiry |
   * | Close `no-longer-attributed` | still short and still held, but youngest-first attribution lands none of it here |
   * | Close `position-stale` | the master staled the position, so it left the shortfall set for a reason that is not a recovery |
   * | Recur | a NEW episode with a NEW occurrence id, because the closed row left the partial index |
   *
   * ## Attribution is a STATED POLICY
   *
   * A position's shortfall is attributed to its `held` reservations
   * **youngest-first** — "the last promise made is the one at risk". That is a
   * rule OpenLinker chose, not an inference about which buyer will actually go
   * unserved; nothing in the ledger says which order the missing units were
   * going to.
   *
   * ## Nothing is clamped
   *
   * This pass repairs no number. `availableQuantity`, `olReservedQuantity` and
   * every reservation quantity are read-only to it. Correcting the counter
   * would erase the evidence and restore the silence design § 4.2 declined the
   * `CHECK` to prevent.
   *
   * Never throws for a per-candidate failure: one bad row must not abort a run
   * that could still handle the rest of its page.
   */
  detectShortfalls(input: DetectShortfallsInput): Promise<DetectShortfallsResult>;

  /**
   * Every still-open shortfall episode for one order.
   *
   * The order-detail projection's read (#2350 renders it). A closed episode
   * stays readable through the repository, but an order detail asks "what is
   * wrong NOW", so this read is deliberately open-only.
   */
  listOpenForOrder(orderRecordId: string): Promise<readonly ReservationShortfallEpisode[]>;

  /**
   * Still-open episodes for MANY orders, grouped by order id.
   *
   * The `/orders` list page's read (#2350). Batched on purpose — one query
   * across the page, never one per row, which is the N+1 the invoice
   * projection's own batch read (#1713) exists to avoid on this same endpoint.
   *
   * An order with no open episode is simply ABSENT from the map. A caller must
   * read that as "nothing reported", never as a positive "this order is fine":
   * the same read can fail, and a failure must not be rendered as reassurance.
   */
  listOpenForOrders(
    orderRecordIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly ReservationShortfallEpisode[]>>;
}
