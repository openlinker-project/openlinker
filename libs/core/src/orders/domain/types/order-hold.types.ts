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
 * The coercion the types need (`isHoldReason`) already exists upstream and
 * belongs with the union it guards, so it is not restated here. What this file
 * DOES carry is one pure builder — {@link withheldOnHoldError} — under
 * `engineering-standards.md § The pure-rule exception to "types only"`: it is
 * the rule for the withheld sync-status message, it has two writers that must
 * agree on the string, and the union it derives from (`HoldReason`) is right
 * here.
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

/**
 * The `error` string a destination's sync-status row carries while its
 * provisioning is withheld by an open hold (#2339).
 *
 * **This exists because two writers must agree on it, not for reuse's sake.**
 * `OrderIngestionService` writes it when the dispatch gate withholds a
 * destination; `OrderProvisioningResumeService` reads it back to find exactly
 * the rows a failed post-release re-enqueue has stranded (#2588 review I-2).
 * If the two drifted, the resume would silently strand the rows it exists to
 * rescue — so the prefix is one constant with one builder over it, and the
 * match is on {@link WITHHELD_ON_HOLD_ERROR_PREFIX} rather than on the whole
 * string, which carries the reason and therefore varies per hold.
 */
export const WITHHELD_ON_HOLD_ERROR_PREFIX = 'Withheld: order is on hold';

/** The full withheld-row message for one hold reason. Pure. */
export function withheldOnHoldError(reason: HoldReason): string {
  return `${WITHHELD_ON_HOLD_ERROR_PREFIX} (${reason})`;
}

/** Whether a sync-status row's `error` was written by the withholding path. */
export function isWithheldOnHoldError(error: string | undefined | null): boolean {
  return typeof error === 'string' && error.startsWith(WITHHELD_ON_HOLD_ERROR_PREFIX);
}
