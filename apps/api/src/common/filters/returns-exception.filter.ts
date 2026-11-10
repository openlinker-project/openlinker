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
import type { ApiErrorParams, KnownApiErrorCode } from '@openlinker/shared/errors';
import { codedErrorBody } from '../errors/coded-http.exception';
import {
  ReturnAuthorizeRefusedError,
  ReturnCustodyContendedError,
  ReturnCustodyTransitionError,
  ReturnDeclineInvalidRequestError,
  ReturnBundleRefusedError,
  ReturnDeclineUnsupportedError,
  ReturnLineNotFoundError,
  ReturnMatchRefusedError,
  ReturnNotAttributedError,
  ReturnNotFoundError,
  ReturnRecordRefusedError,
  ReturnRefundBlockedError,
  ReturnRefundContendedError,
  ReturnRefundObservationInvalidError,
  ReturnRestockAlreadyBlockedError,
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
  | ReturnRestockAlreadyBlockedError
  | ReturnRestockAttestationInvalidError
  | ReturnAuthorizeRefusedError
  | ReturnMatchRefusedError
  | ReturnRecordRefusedError
  | ReturnRefundBlockedError
  | ReturnRefundContendedError
  | ReturnRefundObservationInvalidError
  | ReturnBundleRefusedError;

@Catch(
  ReturnNotFoundError,
  ReturnNotAttributedError,
  ReturnDeclineUnsupportedError,
  ReturnDeclineInvalidRequestError,
  ReturnLineNotFoundError,
  ReturnCustodyTransitionError,
  ReturnCustodyContendedError,
  ReturnRestockAlreadyBlockedError,
  ReturnRestockAttestationInvalidError,
  ReturnAuthorizeRefusedError,
  ReturnMatchRefusedError,
  ReturnRecordRefusedError,
  ReturnRefundBlockedError,
  ReturnRefundContendedError,
  ReturnRefundObservationInvalidError,
  ReturnBundleRefusedError
)
export class ReturnsExceptionFilter implements ExceptionFilter {
  catch(exception: ReturnRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = this.resolveStatus(exception);

    const reason = this.resolveReason(exception);
    const trigger = exception instanceof ReturnNotAttributedError ? exception.trigger : null;

    response.status(statusCode).json(
      codedErrorBody(
        statusCode,
        this.resolveCode(exception),
        exception.message,
        {
          ...this.resolveParams(exception),
          ...(trigger === null ? {} : { trigger }),
          ...(reason === null ? {} : { reason }),
        },
        {
          error: exception.name,
          // The blocked trigger, on the ONE exception that carries it (#2336).
          // Kept top-level for the clients that read it there; also in `params`.
          ...(trigger === null ? {} : { trigger }),
          // The actionable reason (#2376), kept top-level for the same clients.
          ...(reason === null ? {} : { reason }),
        }
      )
    );
  }

  /**
   * One explicit code per refusal (#3863). The exception class name used to be
   * the only identifier and still travels in `error`, but it is no longer the
   * contract: renaming a class cannot change the code.
   */
  private resolveCode(exception: ReturnRefusal): KnownApiErrorCode {
    if (exception instanceof ReturnNotFoundError) return 'RETURN_NOT_FOUND';
    if (exception instanceof ReturnNotAttributedError) return 'RETURN_NOT_ATTRIBUTED';
    if (exception instanceof ReturnDeclineUnsupportedError) return 'RETURN_DECLINE_UNSUPPORTED';
    if (exception instanceof ReturnDeclineInvalidRequestError) return 'RETURN_DECLINE_INVALID';
    if (exception instanceof ReturnLineNotFoundError) return 'RETURN_LINE_NOT_FOUND';
    if (exception instanceof ReturnCustodyTransitionError) return 'RETURN_CUSTODY_TRANSITION_REFUSED';
    if (exception instanceof ReturnCustodyContendedError) return 'RETURN_CUSTODY_CONTENDED';
    if (exception instanceof ReturnRestockAlreadyBlockedError) {
      return 'RETURN_RESTOCK_ALREADY_BLOCKED';
    }
    if (exception instanceof ReturnRestockAttestationInvalidError) {
      return 'RETURN_RESTOCK_ATTESTATION_INVALID';
    }
    if (exception instanceof ReturnAuthorizeRefusedError) return 'RETURN_AUTHORIZE_REFUSED';
    if (exception instanceof ReturnMatchRefusedError) return 'RETURN_MATCH_REFUSED';
    if (exception instanceof ReturnRecordRefusedError) return 'RETURN_RECORD_REFUSED';
    if (exception instanceof ReturnRefundBlockedError) return 'RETURN_REFUND_BLOCKED';
    if (exception instanceof ReturnRefundContendedError) return 'RETURN_REFUND_CONTENDED';
    return 'RETURN_REFUND_OBSERVATION_INVALID';
  }

  /** The ids a refusal names, as params. Never a detail sentence. */
  private resolveParams(exception: ReturnRefusal): ApiErrorParams {
    if (
      exception instanceof ReturnNotFoundError ||
      exception instanceof ReturnRefundContendedError ||
      exception instanceof ReturnRefundObservationInvalidError
    ) {
      return { returnId: exception.returnId };
    }
    if (exception instanceof ReturnDeclineUnsupportedError) {
      return { returnId: exception.returnId, sourceConnectionId: exception.sourceConnectionId };
    }
    if (exception instanceof ReturnDeclineInvalidRequestError) {
      return { field: exception.field };
    }
    if (
      exception instanceof ReturnLineNotFoundError ||
      exception instanceof ReturnCustodyContendedError ||
      exception instanceof ReturnRestockAttestationInvalidError
    ) {
      return { lineId: exception.lineId };
    }
    return {};
  }

  private resolveStatus(exception: ReturnRefusal): number {
    if (exception instanceof ReturnNotFoundError || exception instanceof ReturnLineNotFoundError) {
      return HttpStatus.NOT_FOUND;
    }

    // `unknown-order` is a PAYLOAD fault on an otherwise-fine return — the
    // operator supplied an order id OL never minted — so it is the one reason on
    // this error that is not a state conflict. See the header.
    if (exception instanceof ReturnMatchRefusedError) {
      return exception.reason === 'unknown-order' ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT;
    }

    // #3933: a missing price is the catalogue's state (409); a bad selection is
    // the operator's payload (400).
    if (exception instanceof ReturnBundleRefusedError) {
      return exception.reason === 'bad-selection' ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT;
    }

    // E-14: the payload is well formed, but the ORDER's state (an OpenLinker edit
    // removed the line) refuses it - the one record-refusal reason that is a
    // state conflict rather than a payload fault.
    if (
      exception instanceof ReturnRecordRefusedError &&
      exception.reason === 'line-removed-by-edit'
    ) {
      return HttpStatus.CONFLICT;
    }

    if (
      exception instanceof ReturnNotAttributedError ||
      exception instanceof ReturnCustodyTransitionError ||
      exception instanceof ReturnCustodyContendedError ||
      exception instanceof ReturnRestockAlreadyBlockedError ||
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
      exception instanceof ReturnRefundBlockedError ||
      exception instanceof ReturnBundleRefusedError ||
      exception instanceof ReturnRestockAlreadyBlockedError
    ) {
      return exception.reason;
    }
    return null;
  }
}
