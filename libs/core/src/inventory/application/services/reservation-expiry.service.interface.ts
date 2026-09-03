/**
 * Reservation Expiry Service Interface (#2346, REVIEW § 3 C1)
 *
 * One budgeted pass over held reservations that are past `expiresAt`, deciding
 * per hold whether OpenLinker may stop promising those units.
 *
 * @module libs/core/src/inventory/application/services
 * @see {@link ReservationExpiryService} for the implementation
 */

export interface ExpireReservationsInput {
  /** Maximum candidates examined this run. Already floored and clamped. */
  readonly limit: number;
  /** Clock, injected so a run stamps one instant and specs are deterministic. */
  readonly now?: Date;
}

export interface ExpireReservationsResult {
  /** Candidates read this run. */
  readonly examined: number;
  /** Holds moved to `expired` — only ever on a positively confirmed absence. */
  readonly released: number;
  /** Holds whose `expiresAt` was pushed out because an obligation may stand. */
  readonly extended: number;
  /**
   * Extended holds older than the age bound.
   *
   * These are the stuck ones: fail-closed keeps extending them, so without this
   * counter the condition is invisible. **Reported, never released** — see
   * {@link IReservationExpiryService.expireDueReservations}.
   *
   * It is a counter on the job result rather than a persisted operator fact
   * because W2-15's needs-attention reason set does not exist on this branch;
   * wiring it to an operator surface is that issue's job. A fact emitted into
   * no sink would make an unhandled condition read as handled.
   */
  readonly escalated: number;
  /**
   * Candidates whose write failed. The row keeps its state and is retried.
   *
   * **A persistently failing row is not merely retried, it is re-read first.**
   * Candidates are ordered oldest-overdue-first and a row leaves the set only
   * by being written, so one that never writes stays at the head of the
   * ordering forever. Enough of them fill the page and the sweep stops reaching
   * anything else — the service logs `reservation_expiry_page_all_failed` when
   * a whole page fails, which is the observable for that state.
   */
  readonly failed: number;
}

export interface IReservationExpiryService {
  /**
   * Examine up to `limit` overdue holds and act on each.
   *
   * | Obligation verdict | Action |
   * |---|---|
   * | `present` / `indeterminate` | **extend** `expiresAt`; escalate if older than the age bound |
   * | `absent` | release with terminal status `expired` |
   *
   * **Fail closed.** A release is only ever taken on a positively confirmed
   * absence; anything else extends. Releasing on "I could not tell" republishes
   * stock that may still be promised, and the later dispatch oversells with
   * every counter internally consistent — the C1 failure this pass exists to
   * prevent.
   *
   * Never throws for a per-candidate failure: one bad row must not abort a run
   * that could still safely handle the rest of its page.
   */
  expireDueReservations(input: ExpireReservationsInput): Promise<ExpireReservationsResult>;
}
