/**
 * Order Hold Service Interface (#2339, DESIGN §6.3 / §6.4 / §6.6)
 *
 * The ONE seam through which anything reaches an order hold. #2338's
 * `OrderHoldRepositoryPort` is intra-context and deliberately absent from
 * `@openlinker/core/orders`; a sibling context (shipping's dispatch gate today)
 * comes through here instead, per
 * `docs/architecture-overview.md § Cross-context dependencies in core`.
 *
 * ## What the service adds over the repository
 *
 * The repository owns concurrency (two conditional statements the database
 * adjudicates). This service owns the three things a statement cannot express:
 *
 * 1. **The clock.** `placedAt` / `releasedAt` are stamped here. Holds are
 *    OL-internal operator acts, so OL's clock IS the authority — unlike a fact
 *    about the outside world, which must take the channel's instant.
 * 2. **§6.4's release policy** — who may release a service-placed hold, and at
 *    what price. See {@link IOrderHoldService.release}.
 * 3. **The lifecycle fact.** `held` / `released` are `OmsLifecycleFact`s, the
 *    internal-only union (§6.6). They are returned to the caller and logged;
 *    they cross NO adapter boundary, and neither is a member of the relay
 *    `OrderLifecycleEvent` union, so no `OrderStatusWriteback` adapter can ever
 *    be asked to express them.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderHoldService} for the implementation
 */
import type { HoldReason, OmsLifecycleFact } from '@openlinker/core/order-lifecycle';
import type { OrderHold } from '../../domain/entities/order-hold.entity';
import type { OrderHoldPlacedBy } from '../../domain/types/order-hold.types';

export interface PlaceHoldRequest {
  internalOrderId: string;
  reason: HoldReason;
  /** Operator free text. Never buyer data. Empty is normalised to `null`. */
  note?: string | null;
  placedBy: OrderHoldPlacedBy;
}

export interface ReleaseHoldRequest {
  holdId: string;
  /**
   * Mandatory when a USER releases a SERVICE-placed hold (§6.4); optional
   * otherwise. Empty/whitespace is normalised to `null` and therefore does NOT
   * satisfy the mandatory case.
   */
  note?: string | null;
  /** Symmetric with `PlaceHoldRequest.placedBy` — a release has an actor too. */
  releasedBy: OrderHoldPlacedBy;
}

/**
 * The hold plus the internal fact its transition produced.
 *
 * The fact is RETURNED rather than published. There is no event-bus edge here
 * on purpose: an `OmsLifecycleFact` has no out-of-context consumer in this wave,
 * and a stream would need a retention declaration (#2163) and a consumer group
 * to carry a payload nothing reads. Returning it keeps the fact a first-class,
 * testable product of the transition — and makes it trivially assertable that
 * it never reaches a writeback adapter.
 */
export interface OrderHoldTransition {
  hold: OrderHold;
  fact: OmsLifecycleFact;
  /**
   * A dispatch of this order was in flight when the hold was placed (#2338
   * review).
   *
   * **A hold cannot recall a carrier call.** The dispatch gate reads
   * `order_holds` once and then spends seconds inside `generateLabel`; a hold
   * placed in that window is accepted, the label is minted anyway, and the
   * operator is left looking at a hold badge over a shipped parcel. The
   * carrier round-trip is unrecallable — the SILENCE was the defect, so the
   * hold reports the overlap instead of pretending it prevented anything.
   *
   * Detected by a NON-BLOCKING probe of the per-order dispatch lock. Placing
   * the hold never waits on it and never fails on it: refusing to stop an
   * order because it is busy shipping is precisely backwards.
   *
   * `false` also covers "could not tell" (no lock port wired, or the probe
   * threw) — the field asserts an overlap, never the absence of one.
   */
  dispatchInFlight: boolean;
}

/**
 * **Known gap this seam does not close, stated so #2341 does not inherit it
 * silently:** releasing a hold makes the next provisioning run succeed, but
 * nothing here ENQUEUES that run. The gates are re-entrant, not self-driving,
 * and for a cursor-based source journal the original order event will not be
 * re-delivered. #2341's release route sits beside the job-enqueue seam and
 * should enqueue `marketplace.order.sync` for the order it just freed.
 */
export interface IOrderHoldService {
  /**
   * Place a hold, stamping `placedAt` from OL's clock, and emit `held`.
   *
   * @throws {OrderAlreadyOnHoldError} the order already has an open hold. The
   *   partial unique index decides this, not a read-then-act.
   */
  place(request: PlaceHoldRequest): Promise<OrderHoldTransition>;

  /**
   * Release an open hold, stamping `releasedAt`, and emit `released`.
   *
   * §6.4's policy, enforced here and nowhere else:
   * - a USER-placed hold may be released by anyone, with or without a note;
   * - a SERVICE-placed hold may be released by THAT service (no note needed),
   *   or by a USER **with a note**;
   * - a SERVICE may release ONLY its own hold — not a peer service's, and not
   *   a user's (`order_holds` has no `releasedByService`, so a service release
   *   of a human's hold would persist as released by nobody).
   *
   * @throws {OrderHoldNotFoundError} no such hold.
   * @throws {HoldAlreadyReleasedError} the hold exists and is already released.
   * @throws {HoldReleaseNoteRequiredError} a user released a service-placed hold
   *   with no note.
   * @throws {HoldReleaseNotPermittedError} a service released another service's
   *   hold.
   */
  release(request: ReleaseHoldRequest): Promise<OrderHoldTransition>;

  /**
   * The open hold on one order, or `null`.
   *
   * **This is the read every gate must use.** It hits `order_holds` — the
   * authority — never #2340's denormalised `order_records.activeHoldReason`,
   * which is a cache that loses on drift. That is the epic's L4 exit criterion,
   * not a preference.
   */
  getOpenHold(internalOrderId: string): Promise<OrderHold | null>;

  /**
   * Every hold on one order, newest first — the operator-facing audit trail.
   */
  listHolds(internalOrderId: string): Promise<OrderHold[]>;
}
