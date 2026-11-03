/**
 * Rate Limit Busy Filter
 *
 * Maps `RateLimitTimeoutError` and `RateLimitAbortedError` to 503 Service
 * Unavailable with a `Retry-After` header.
 *
 * Both mean an outbound call never left OpenLinker: it waited for a slot in
 * the connection's shared request budget (ADR-038) and gave up - the wait hit
 * its bound, or the request's own timeout fired while it was still queued.
 * Nothing reached the platform, nothing was changed there, and the condition
 * clears by itself as the queue drains. Without this filter NestJS answers
 * 500, which reads as an OpenLinker defect for what is plain congestion.
 *
 * `Retry-After` is a hint, not a computed drain time - the limiter does not
 * expose one. It is short on purpose: an interactive caller retrying after a
 * few seconds lands behind a queue that has moved on, and the worker's own
 * penalty-free requeue for the same condition is unaffected (it never reaches
 * an HTTP filter).
 *
 * The abort case also covers a client that disconnected while queued; the
 * response then goes to a closed socket, which is harmless.
 *
 * Sibling of `AvailabilityUnknownFilter`; registered through
 * `buildGlobalExceptionFilters`, so production and the integration harness
 * share it. The filters catch disjoint exception types.
 *
 * @module apps/api/src/common/filters
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

/** Seconds; see the module doc for why this is a fixed hint. */
export const RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS = 5;

@Catch(RateLimitTimeoutError, RateLimitAbortedError)
export class RateLimitBusyFilter implements ExceptionFilter {
  catch(exception: RateLimitTimeoutError | RateLimitAbortedError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      return;
    }
    response.setHeader('Retry-After', String(RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS));
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: exception.name,
      message:
        'The platform connection is busy right now, so this request was not sent. ' +
        'Nothing was changed. Try again in a few seconds.',
    });
  }
}
