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
  ReturnDeclineUnsupportedError,
  ReturnNotAttributedError,
  ReturnNotFoundError,
} from '@openlinker/core/returns';

type ReturnDeclineRefusal =
  | ReturnNotFoundError
  | ReturnNotAttributedError
  | ReturnDeclineUnsupportedError;

@Catch(ReturnNotFoundError, ReturnNotAttributedError, ReturnDeclineUnsupportedError)
export class ReturnsExceptionFilter implements ExceptionFilter {
  catch(exception: ReturnDeclineRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = this.resolveStatus(exception);

    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
    });
  }

  private resolveStatus(exception: ReturnDeclineRefusal): number {
    if (exception instanceof ReturnNotFoundError) {
      return HttpStatus.NOT_FOUND;
    }
    if (exception instanceof ReturnNotAttributedError) {
      return HttpStatus.CONFLICT;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
