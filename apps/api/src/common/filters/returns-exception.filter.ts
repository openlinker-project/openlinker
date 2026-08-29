/**
 * Returns Exception Filter
 *
 * Maps the `returns` context's domain refusals onto distinct HTTP statuses.
 *
 * Renamed from `ReturnDeclineExceptionFilter` by #2334. Two of the three
 * exceptions it catches were never decline-specific — `ReturnNotFoundError` and
 * `ReturnNotAttributedError` are the vocabulary EVERY downstream trigger is
 * refused by (see `return-decline-unsupported.error.ts`) — and with
 * `GET /returns/:id` now raising the first, a name saying "decline" would tell
 * the next reader the mapping is specific to a write it is not specific to.
 * The mapping itself is unchanged.
 *
 * They are three DISTINCT exception types rather than one with a reason string
 * precisely so a caller can tell them apart, and the issue's acceptance criteria
 * require exactly that — an orphan return and a source with no decline support
 * must not answer identically. Collapsing them here would throw that away one
 * layer below where it was built.
 *
 * - `ReturnNotFoundError`         → **404**. No such return.
 * - `ReturnNotAttributedError`    → **409**. The return exists but is an orphan;
 *   the trigger it blocked is exposed on the error as a readonly `trigger`
 *   field, so any structured rendering reads that field rather than parsing
 *   this message — the two would otherwise drift the first time the wording
 *   changed. The request conflicts with the resource's state, and the state is fixable
 *   (attribute the order). Not 400 — the operator's request was well formed.
 * - `ReturnDeclineUnsupportedError` → **400**. The source cannot be asked at
 *   all, so no amount of retrying or state-fixing helps; the request itself was
 *   inapplicable. `detail` distinguishes "this platform has no such write" from
 *   "the connection could not be resolved", which are different things for an
 *   operator to act on.
 * - `ReturnDeclineInvalidRequestError` → **400**. OL's OWN pre-flight refused
 *   the request (a `reasonCode` outside the source's vocabulary, a
 *   conditionally-mandatory field left blank). Deliberately NOT the by-source
 *   refusal: nothing was sent, so nothing was refused by anyone but OL, and
 *   `field` names what the operator must correct.
 *
 * ## The nine #2376 additions
 *
 * The write API (#2376) can raise nine more of this context's refusals, and an
 * unmapped domain error is a **500 for a state the service raised deliberately**
 * — the failure this file exists to prevent. They follow one rule, stated here so
 * the next mapping is not a coin toss:
 *
 * - **404** — the addressed resource does not exist (`ReturnNotFoundError`,
 *   `ReturnLineNotFoundError`).
 * - **409** — it exists and its STATE refuses.
 * - **400** — the request PAYLOAD was inapplicable.
 *
 * That rule is what SPLITS `ReturnMatchRefusedError` by reason, and the split is
 * not pedantry: `already-attributed` is the return's own state refusing (409 —
 * attribution is monotonic, there is no unmatch), while `unknown-order` means the
 * return is fine and the ORDER ID the operator supplied names nothing OL has
 * minted (400 — the fix is in the request). Answering 409 for both would tell an
 * operator the return was in a bad state when their typo was the problem.
 * `ReturnRecordRefusedError` maps wholly to 400 even though it carries an
 * `unknown-order` reason too, and that is consistent rather than contradictory:
 * `POST /returns/record` addresses no return at all, so there is no resource
 * whose state could conflict — the payload is the entire request.
 *
 * `ReturnCustodyTransitionError` is the acceptance criterion's *"409 with an
 * actionable code"*: its closed `reason` is emitted as a `reason` FIELD, exactly
 * as `ReturnNotAttributedError.trigger` already is, because that error's own
 * docblock says a consumer must branch on the field and never on the message.
 * `non-positive-quantity` is deliberately 409 too, though it reads like a
 * validation fault: the DTO's `@IsInt() @Min(1)` catches every malformed request
 * first, so reaching the domain check means the value was well formed and the
 * state refused — and two statuses for one union would make a client branch on
 * status as well as code.
 *
 * A global filter rather than a controller-local catch, matching every other
 * domain exception in the tree (`CapabilityNotSupportedFilter` and siblings) —
 * so a second caller of the same service cannot answer 500 for a state the first
 * one explains. Registered in `main.ts` and mirrored in the integration
 * harness's `configureApp`, or int-specs would see 500s the running app never
 * returns. The filters catch disjoint exception types, so registration order is
 * irrelevant.
 *
 * @module apps/api/src/common/filters
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  ReturnAuthorizeRefusedError,
  ReturnCustodyContendedError,
  ReturnCustodyTransitionError,
  ReturnDeclineInvalidRequestError,
  ReturnDeclineUnsupportedError,
  ReturnLineNotFoundError,
  ReturnMatchRefusedError,
  ReturnNotAttributedError,
  ReturnNotFoundError,
  ReturnRecordRefusedError,
  ReturnRefundBlockedError,
  ReturnRefundContendedError,
  ReturnRefundObservationInvalidError,
  ReturnRestockAttestationInvalidError,
} from '@openlinker/core/returns';

type ReturnRefusal =
  | ReturnNotFoundError
  | ReturnNotAttributedError
  | ReturnDeclineUnsupportedError
  | ReturnDeclineInvalidRequestError
  | ReturnLineNotFoundError
  | ReturnCustodyTransitionError
  | ReturnCustodyContendedError
  | ReturnRestockAttestationInvalidError
  | ReturnAuthorizeRefusedError
  | ReturnMatchRefusedError
  | ReturnRecordRefusedError
  | ReturnRefundBlockedError
  | ReturnRefundContendedError
  | ReturnRefundObservationInvalidError;

@Catch(
  ReturnNotFoundError,
  ReturnNotAttributedError,
  ReturnDeclineUnsupportedError,
  ReturnDeclineInvalidRequestError,
  ReturnLineNotFoundError,
  ReturnCustodyTransitionError,
  ReturnCustodyContendedError,
  ReturnRestockAttestationInvalidError,
  ReturnAuthorizeRefusedError,
  ReturnMatchRefusedError,
  ReturnRecordRefusedError,
  ReturnRefundBlockedError,
  ReturnRefundContendedError,
  ReturnRefundObservationInvalidError
)
export class ReturnsExceptionFilter implements ExceptionFilter {
  catch(exception: ReturnRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = this.resolveStatus(exception);

    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
      // The blocked trigger, on the ONE exception that carries it (#2336).
      //
      // This docblock has always said a structured rendering must read the
      // `trigger` FIELD rather than parse the message — the two drift the first
      // time the wording changes. Until now the field never crossed the HTTP
      // boundary, so that instruction described a contract no consumer could
      // honour and left message-parsing as the only option. Additive: no status
      // changes, nothing is removed, and the other two exceptions have no such
      // field so the key is simply absent for them.
      ...(exception instanceof ReturnNotAttributedError
        ? { trigger: exception.trigger }
        : {}),
      // The actionable code (#2376). Emitted as a FIELD for every refusal that
      // carries a closed reason union, so a client branches on the vocabulary
      // rather than parsing a message that will be reworded.
      ...(this.resolveReason(exception) === null
        ? {}
        : { reason: this.resolveReason(exception) }),
    });
  }

  private resolveStatus(exception: ReturnRefusal): number {
    if (
      exception instanceof ReturnNotFoundError ||
      exception instanceof ReturnLineNotFoundError
    ) {
      return HttpStatus.NOT_FOUND;
    }

    // `unknown-order` is a PAYLOAD fault on an otherwise-fine return — the
    // operator supplied an order id OL never minted — so it is the one reason on
    // this error that is not a state conflict. See the header.
    if (exception instanceof ReturnMatchRefusedError) {
      return exception.reason === 'unknown-order'
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.CONFLICT;
    }

    if (
      exception instanceof ReturnNotAttributedError ||
      exception instanceof ReturnCustodyTransitionError ||
      exception instanceof ReturnCustodyContendedError ||
      exception instanceof ReturnRestockAttestationInvalidError ||
      exception instanceof ReturnAuthorizeRefusedError ||
      exception instanceof ReturnRefundBlockedError ||
      exception instanceof ReturnRefundContendedError
    ) {
      return HttpStatus.CONFLICT;
    }

    // `ReturnDeclineUnsupportedError`, `ReturnDeclineInvalidRequestError`,
    // `ReturnRecordRefusedError`, `ReturnRefundObservationInvalidError`.
    return HttpStatus.BAD_REQUEST;
  }

  /** The closed reason a refusal carries, or `null` where it carries none. */
  private resolveReason(exception: ReturnRefusal): string | null {
    if (
      exception instanceof ReturnCustodyTransitionError ||
      exception instanceof ReturnAuthorizeRefusedError ||
      exception instanceof ReturnMatchRefusedError ||
      exception instanceof ReturnRecordRefusedError ||
      exception instanceof ReturnRefundBlockedError
    ) {
      return exception.reason;
    }
    return null;
  }
}
