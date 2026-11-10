/**
 * API error code filter (#3860)
 *
 * The catch-all exception filter: every error that no domain filter claims
 * leaves the API with a stable `code` (see `resolveApiErrorCode`).
 *
 * - An `HttpException` keeps the body it was thrown with; a string body
 *   becomes `{ statusCode, message }`, the shape Nest itself sends. Only a
 *   missing `code` is added.
 * - A plain error that carries its own 4xx status (`statusCode` / `status`) is
 *   a client error raised outside Nest, e.g. by the Express body parser: 413
 *   for a body over the limit, 415 for an unsupported charset or encoding, 400
 *   for an aborted request. It keeps that status and message, as Nest's own
 *   `BaseExceptionFilter.isHttpError` did, and is not logged as a failure.
 *   (Malformed JSON never reaches this branch: Nest turns the parser's
 *   `SyntaxError` into a `BadRequestException` first.)
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
import {
  httpStatusErrorCode,
  withApiErrorCode,
  type KnownApiErrorCode,
} from '@openlinker/shared/errors';

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

    const clientError = readClientError(exception);
    if (clientError) {
      if (response.headersSent) return;
      response.status(clientError.statusCode).json({
        ...clientError,
        code: httpStatusErrorCode(clientError.statusCode),
      });
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
  return isRecord(raw) ? { ...raw } : { statusCode: status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A client error raised outside Nest: an `Error` with a 4xx `statusCode` (or
 * `status`) and a message. A 5xx status is not trusted here - its message may
 * be internal - so it falls through to the generic 500. `expose: false` (the
 * http-errors flag for "do not show this message") is honoured the same way.
 */
function readClientError(exception: unknown): { statusCode: number; message: string } | null {
  if (!(exception instanceof Error) || !isRecord(exception)) return null;
  const raw = exception.statusCode ?? exception.status;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 400 || raw > 499) return null;
  if (exception.expose === false || exception.message === '') return null;
  return { statusCode: raw, message: exception.message };
}
