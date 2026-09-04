/**
 * Worklist view types (#2406, `W3a-19`, DESIGN §5.2)
 *
 * What an operator surface is handed for a `FulfillmentWork`, and the set of
 * actions this surface will actually execute.
 *
 * ## The view is an explicit ALLOWLIST, never a spread
 *
 * It reaches an operator's browser, and this context sits one hop from
 * `RoutingShipTo`, which carries buyer PII (ADR-062). Listing every field by
 * hand is what stops a field added to `FulfillmentWork` later from silently
 * starting to leak — the #2393 / #2398 discipline, pinned by a spec using a
 * DISTRIBUTING `KeysOf<T>` (a bare `Extract<keyof …>` over a union reads the
 * intersection, so such an assertion is `never` and green forever).
 *
 * Deliberately excluded: `dispatchRelayedAt` (internal relay hygiene, #2401)
 * and a hold's `placedByService` (internal actor).
 *
 * ## `activeHolds` is the authority on heldness, NOT `status`
 *
 * Nothing writes `status = 'on_hold'` (see the derivation's docblock), so a held
 * work reads `status: 'open'` with a non-empty `activeHolds`. A consumer
 * (#2410 / #2411) must render heldness from this array; rendering `status`
 * alone would show "Open" on a held row.
 *
 * ## The counters are DISPLAY-ONLY and the token does not protect them
 *
 * `recordLineProgress` deliberately does not bump the header's `version`
 * (#2400), so a counter can move under a client holding a valid token. Safe
 * today because no operator-invocable action reads one — a spec pins that — but
 * a consumer must not present these numbers as transactionally consistent with
 * `supportedActions`.
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority';
import type { HoldReason } from '@openlinker/core/order-lifecycle';

import type { FulfillmentRequestStatus } from '../../domain/types/fulfillment-request-status.types';
import type { FulfillmentWorkAction } from '../../domain/types/fulfillment-work-action.types';
import type { FulfillmentWorkStatus } from '../../domain/types/fulfillment-work-status.types';

/** One line's quantity counters. Counters, never a per-line status (DESIGN §5.2). */
export interface FulfillmentWorkLineView {
  readonly id: string;
  readonly orderLineId: string;
  readonly productVariantId: string;
  readonly totalQuantity: number;
  readonly fulfilledQuantity: number;
  readonly cancelledQuantity: number;
}

/** An active hold, projected. `placedByService` is withheld. */
export interface FulfillmentHoldView {
  readonly id: string;
  readonly reason: HoldReason;
  readonly note: string | null;
  readonly placedAt: Date;
}

/** A work object as an operator surface sees it. */
export interface FulfillmentWorkView {
  readonly id: string;
  readonly orderId: string;
  readonly locationId: string | null;
  readonly deliveryMethod: string | null;
  readonly assignedConnectionId: string | null;
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  readonly assignmentAttempt: number;
  readonly cancellationReason: FulfillmentCancellationReason | null;
  readonly externalWorkId: string | null;
  readonly acceptedAt: Date | null;
  readonly cancelledAt: Date | null;
  /**
   * When an operator pushed this ahead of deadline order (#2416, spec D22), or
   * `null` for ordinary deadline order.
   *
   * On the allowlist because D22 requires the surface to show *that* a parcel
   * was expedited rather than silently reordering the list under a packer — a
   * list that reorders itself is a list they stop trusting.
   */
  readonly expeditedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lines: readonly FulfillmentWorkLineView[];
  readonly activeHolds: readonly FulfillmentHoldView[];
  /**
   * What is legal next, derived SERVER-SIDE. Never recomputed by a client —
   * that is the whole point (DESIGN §5.2, "actions yes, states no").
   */
  readonly supportedActions: readonly FulfillmentWorkAction[];
  /** The optimistic token. Required on every action; a stale one answers 409. */
  readonly version: number;
}

/** A page of the worklist. */
export interface FulfillmentWorkPageView {
  readonly works: readonly FulfillmentWorkView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The actions THIS surface executes.
 *
 * Narrower than what `deriveSupportedActions` finds legal, and the gap is
 * deliberate and temporary:
 *
 * - `submit` / `request_cancellation` are legal operator intents that this
 *   service cannot yet carry out. #2409 has since landed a real
 *   `FulfillmentExecutorPort` (`OlFulfillmentExecutorAdapter`, dispatched by the
 *   `openlinker.oms.v1` plugin under the `FulfillmentExecutor` capability), so
 *   the executor half is no longer the blocker it was when this gate was
 *   written. TWO things still are, and the second is the substantive one:
 *
 *     1. The executor is still resolved by the HOST — `DispatchFulfillmentWorkInput`
 *        takes it as a field, and nothing resolves one per work object here.
 *     2. That same input requires a `shipTo: RoutingShipTo`, which carries buyer
 *        PII (ADR-062) — and this read model deliberately holds none of it (see
 *        the allowlist above, and its spec). Wiring `submit` through this service
 *        would mean giving the operator READ MODEL a reason to load a ship-to,
 *        which is exactly the coupling the projection is shaped to avoid.
 *
 *   So the honest owner of `submit` is a dispatch path that already has both,
 *   not this one. Lifting the gate is still a one-line edit here once such a
 *   caller exists, because the legality rule is written and tested now.
 * - `accept` / `reject` / `accept_cancellation` / `reject_cancellation` are the
 *   HOLDER's replies (#2399) and are never operator actions; the derivation
 *   never emits them at all.
 *
 * The view is filtered through this set, so an operator is never shown a control
 * that would 400 — omission is the safe direction, and telling a client an
 * action is legal and then refusing it would be the very drift this read model
 * exists to remove.
 */
export const OPERATOR_INVOCABLE_ACTIONS = [
  'schedule',
  'hold',
  'release_hold',
  'mark_in_progress',
  'close',
  'force_cancel',
  // #2416 / spec D22. Exactly one of the two is ever offered on a given work —
  // the derivation picks the direction, so a client never has to.
  'expedite',
  'release_expedite',
] as const satisfies readonly FulfillmentWorkAction[];

export type OperatorInvocableAction = (typeof OPERATOR_INVOCABLE_ACTIONS)[number];

/** Narrow an untrusted route parameter to an action this surface will execute. */
export function isOperatorInvocableAction(value: unknown): value is OperatorInvocableAction {
  return (
    typeof value === 'string' &&
    (OPERATOR_INVOCABLE_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * Why a guarded action was refused, as a STABLE machine-readable code.
 *
 * Both refusals answer 409 and both carry a refreshed `supportedActions`, but a
 * client must act on them differently: a stale token is retryable with the fresh
 * version, while an action that is no longer legal is not — re-sending it just
 * fails again. Before this existed the only way to tell them apart was sniffing
 * for the presence of `currentVersion` in the body, which is exactly the
 * brittle, inferred contract this read model exists to remove.
 *
 * The code is the discriminator; the message is for humans and may change.
 */
export const FulfillmentWorkConflictCodeValues = [
  /** The token was stale — somebody moved the work first. Re-read and retry. */
  'version_conflict',
  /** The token matched; the action is simply not legal in the current state. */
  'action_not_legal',
] as const;

export type FulfillmentWorkConflictCode = (typeof FulfillmentWorkConflictCodeValues)[number];

/**
 * What an operator sends with an action.
 *
 * `expectedVersion` is REQUIRED — there is no unguarded action path, because an
 * optional token is a token somebody forgets.
 */
export interface ApplyFulfillmentWorkActionInput {
  readonly workId: string;
  readonly action: OperatorInvocableAction;
  readonly expectedVersion: number;
  /** `hold`: the hold reason. Required for `hold`, ignored otherwise. */
  readonly holdReason?: HoldReason;
  /** `force_cancel`: why. Required for `force_cancel`, ignored otherwise. */
  readonly cancellationReason?: FulfillmentCancellationReason;
  /** `release_hold`: which hold. Required for `release_hold`. */
  readonly holdId?: string;
  readonly note?: string | null;
  readonly releaseNote?: string | null;
  /** Audit actor, when the caller has one. */
  readonly actorUserId?: string | null;
}
