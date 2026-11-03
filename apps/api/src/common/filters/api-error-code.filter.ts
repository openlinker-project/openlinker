/**
 * API error code filter (#3860)
 *
 * The catch-all exception filter: every error that no domain filter claims
 * leaves the API with a stable `code` (see `resolveApiErrorCode`).
 *
 * - An `HttpException` keeps the body it was thrown with; a string body
 *   becomes `{ statusCode, message }`, the shape Nest itself sends. Only a
 *   missing `code` is added.
 * - Anything else is a bug. It is logged with its stack (this filter replaces
 *   Nest's default handler, which logged it) and answered with Nest's own
 *   generic 500 body plus `code: 'INTERNAL_ERROR'`, so an internal message
 *   never reaches a client.
 *
 * It must be registered FIRST in `buildGlobalExceptionFilters`: Nest reverses
 * the global filter list and runs the first one whose `@Catch` matches, and an
 * empty `@Catch()` matches everything.
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from '@openlinker/shared/logging';
import { withApiErrorCode, type KnownApiErrorCode } from '@openlinker/shared/errors';

const INTERNAL_ERROR: KnownApiErrorCode = 'INTERNAL_ERROR';

@Catch()
export class ApiErrorCodeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorCodeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (response.headersSent) return;
      response
        .status(status)
        .json(withApiErrorCode(toBody(exception.getResponse(), status), status));
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Non-error value thrown',
      exception instanceof Error ? exception.stack : String(exception)
    );
    if (response.headersSent) return;
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      code: INTERNAL_ERROR,
    });
  }
}

function toBody(raw: string | object, status: number): Record<string, unknown> {
  if (typeof raw === 'string') return { statusCode: status, message: raw };
  return { ...(raw as Record<string, unknown>) };
}
