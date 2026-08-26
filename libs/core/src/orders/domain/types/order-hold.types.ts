/**
 * Order Hold Types (#2338, DESIGN §6.3 / REVIEW §3 H9)
 *
 * Input shapes for the two `OrderHoldRepositoryPort` mutators.
 *
 * The reason vocabulary is NOT declared here — it is `HoldReason` from the
 * `order-lifecycle` leaf (#2305), imported rather than restated because the same
 * union serves the future fulfilment-work grain (`fulfillment_holds`). Note the
 * shipped identifier is `HoldReason`, not the design prose's `OrderHoldReason`
 * (REVIEW H14): a later reader should not "correct" it.
 *
 * This file carries no runtime functions. The coercion the types need
 * (`isHoldReason`) already exists upstream and belongs with the union it guards.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';

/**
 * Who placed a hold — exactly one of a human or a service.
 *
 * A discriminated union rather than two optional fields, so the invariant the
 * `CHK_order_holds_actor` constraint enforces at the row is also a compile-time
 * fact at the call site. An actor is one thing: a row claiming both a human and
 * a service placed it is not a richer record, it is an unanswerable audit
 * question — and §6.4's release rule ("released by the placing service, or by an
 * admin with a mandatory release note") is only decidable if the placer is
 * unambiguous.
 */
export type OrderHoldPlacedBy =
  | { kind: 'user'; userId: string }
  | { kind: 'service'; service: string };

export interface PlaceOrderHoldInput {
  internalOrderId: string;
  reason: HoldReason;
  /** Operator free text. Never buyer data. */
  note: string | null;
  placedBy: OrderHoldPlacedBy;
  /**
   * Caller-supplied rather than a DB default, so the service owns the clock and
   * a test can pin it. This is the backing fact for automation trigger T3
   * ("on hold for N days") — there is deliberately no `phaseEnteredAt` column
   * anywhere (adjudicated: a phase fed by `now` is uninvalidatable).
   */
  placedAt: Date;
}

export interface ReleaseOrderHoldInput {
  holdId: string;
  releasedAt: Date;
  /**
   * Nullable here by design. §6.4 makes a release note MANDATORY when releasing
   * a service-placed hold as an admin — but that is a policy about *who is
   * releasing*, which the schema cannot know. #2339's service enforces it.
   */
  releaseNote: string | null;
  releasedByUserId: string | null;
}
