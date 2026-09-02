/**
 * Unrecognised fulfilment request result — the fail-closed narrowing (#2398, DESIGN §5.4)
 *
 * A `FulfillmentRequestResult` crosses this boundary from a plugin (ADR-055) and core
 * validates nothing a plugin returns. This refuses a result whose `status` is neither
 * `accepted` nor `rejected`.
 *
 * ## Why the unknown status must fail closed, specifically
 *
 * A caller acts on `rejected` by re-sourcing, and reads `blocking` to decide whether the
 * refuser stays a candidate. A third status — a future arm, a typo, another vendor's
 * vocabulary — falls through to that arm's reads and yields `blocking: undefined`, which is
 * **falsy**: the rejecter is NOT excluded, the router re-picks it, and it refuses again. That
 * is precisely the infinite loop `blocking` exists to prevent, arrived at by a silent
 * misread. It tests POSITIVELY for the two known values rather than against one known-bad
 * value, which is the `assertRoutingPlanResolved` rule (#2393) and the only form that fails
 * closed on a value nobody anticipated.
 *
 * ## Why `…RequestResult…` and not `…RequestStatus…`
 *
 * The same barrel exports `FulfillmentRequestStatus` — the seven-member NEGOTIATION axis
 * (#2391), of which `accepted` and `rejected` are two members. A helper named
 * `assertFulfillmentRequestStatusRecognised` sitting beside it would read unambiguously as an
 * assertion over that union, which it is not: it narrows the port's RESULT.
 *
 * The result's discriminant nonetheless spells those two values identically, and that is
 * deliberate — #2399 stamps `FulfillmentWork.requestStatus` straight from this result, so the
 * shared spelling is a correspondence the handshake depends on rather than a collision to be
 * tidied away. A spec beside this file pins it, so an edit to either side breaks loudly.
 *
 * ## Not an assertion that the request was ACCEPTED
 *
 * `assertRoutingPlanResolved` throws on `pending` because a pending plan is *unconsumable*.
 * Here `rejected` is a perfectly consumable, expected outcome — the caller re-sources — so
 * throwing on it would make the normal path exceptional. Only the unrecognised value throws;
 * the caller then switches over two arms it can trust.
 *
 * Lives in `domain/exceptions/` rather than beside the type it narrows because the
 * `engineering-standards.md` pure-rule exception is scoped to `*.types.ts`, and this rule is
 * not a fact about `FulfillmentRequestResult` — it is this build's REFUSAL of everything
 * outside it. Co-locating the assertion with the error it raises keeps the refusal and its
 * reason in one file (the `pending-routing-plan-not-supported.error.ts` shape).
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4
 */
import type { FulfillmentRequestResult } from '../types/fulfillment-execution.types';

/**
 * Raised when an executor answers with a status this build has no reading for.
 *
 * Carries the offending value because it is the only handle an operator has on which
 * vendor vocabulary leaked across the port.
 */
export class UnrecognisedFulfillmentRequestResultError extends Error {
  constructor(public readonly status: string) {
    super(
      `Executor returned an unrecognised fulfilment request status: ${JSON.stringify(status)}. ` +
        'Only "accepted" and "rejected" can be acted on in this build.',
    );
    this.name = 'UnrecognisedFulfillmentRequestResultError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Refuse a result whose status this build cannot act on.
 *
 * Pure. An assertion signature rather than a boolean so a caller cannot read the answer and
 * carry on regardless.
 *
 * **It narrows nothing at the type level today, and that is stated rather than implied**:
 * `FulfillmentRequestResult` is already exactly the two arms, so `asserts result is
 * FulfillmentRequestResult` is a no-op to the compiler. The signature is that shape because
 * the value here is the RUNTIME refusal — a plugin's answer is not bound by the declared type
 * — and because it keeps the call site reading like `assertRoutingPlanResolved`'s. Should a
 * third arm ever be declared (the `pending` shape #2393 carries), the same signature starts
 * narrowing for real with no call-site change.
 */
export function assertFulfillmentRequestResultRecognised(
  result: FulfillmentRequestResult,
): asserts result is FulfillmentRequestResult {
  if (result.status === 'accepted' || result.status === 'rejected') {
    return;
  }

  throw new UnrecognisedFulfillmentRequestResultError((result as { status: string }).status);
}
