/**
 * Availability Unknown Filter
 *
 * Maps `AvailabilityUnknownError` (#2323) to 503 Service Unavailable.
 *
 * The error means OpenLinker could not RESOLVE a variant's availability — the
 * reservation-ledger read or the destination's publish Controls failed — so
 * nothing was published rather than a guessed quantity being published. That is
 * a transient dependency outage, not a fault in the operator's request: without
 * this filter NestJS defaults to 500, which reads as an OpenLinker defect and
 * invites the operator to change a selection that was never the problem.
 *
 * 503 rather than 502/504 because the condition is about OpenLinker's own
 * ability to answer right now, and it carries the one instruction that is
 * actually true: retry. The `Retry-After` header is deliberately omitted — the
 * recovery time is not knowable here, and a fabricated number would be worse
 * than none.
 *
 * Sibling of `CapabilityNotSupportedFilter` / `ConnectionExceptionFilter` /
 * `InventoryLocationExceptionFilter`; registered globally in `main.ts` and
 * mirrored in the integration harness's `configureApp`, or int-specs would see
 * 500s the running app never returns. The filters catch disjoint exception
 * types, so registration order is irrelevant.
 *
 * @module apps/api/src/common/filters
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AvailabilityUnknownError } from '@openlinker/core/listings';

@Catch(AvailabilityUnknownError)
export class AvailabilityUnknownFilter implements ExceptionFilter {
  catch(exception: AvailabilityUnknownError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: exception.name,
      message: `${exception.message} Nothing was published; retry once the read recovers.`,
    });
  }
}
