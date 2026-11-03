/**
 * Connection Exception Filter
 *
 * Maps the connection-lifecycle domain exceptions into accurate HTTP statuses
 * with a structured, operator-friendly body. Without this filter NestJS
 * defaults to 500 Internal Server Error, misrepresenting an operator/
 * configuration error as a server fault (#1087):
 *
 *  - `ConnectionNotFoundException`  → 404 Not Found
 *  - `ConnectionDisabledException`  → 409 Conflict
 *  - `ConnectionInUseException`     → 409 Conflict, plus `reason` and
 *    `referrers` so the client can name the connections to re-pair (#3657)
 *
 * Sibling of `CapabilityNotSupportedFilter`; both are registered globally in
 * `main.ts`. They catch disjoint exception types, so registration order is
 * irrelevant.
 *
 * The 404 mapping assumes the connection is the addressed/primary resource of
 * the request (true at every current throw site). A future endpoint where
 * `connectionId` is merely a body field on a different addressed resource should
 * catch `ConnectionNotFoundException` locally rather than emit a misleading 404.
 *
 * @module apps/api/src/common/filters
 * @see {@link ConnectionNotFoundException} / {@link ConnectionDisabledException}
 * @see {@link ConnectionInUseException}
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  ConnectionDisabledException,
  ConnectionInUseException,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';

type ConnectionException =
  | ConnectionNotFoundException
  | ConnectionDisabledException
  | ConnectionInUseException;

@Catch(ConnectionNotFoundException, ConnectionDisabledException, ConnectionInUseException)
export class ConnectionExceptionFilter implements ExceptionFilter {
  catch(exception: ConnectionException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ConnectionInUseException) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: exception.name,
        message: exception.message,
        reason: exception.reason,
        referrers: exception.referrers,
      });
      return;
    }
    const statusCode =
      exception instanceof ConnectionDisabledException
        ? HttpStatus.CONFLICT
        : HttpStatus.NOT_FOUND;
    response.status(statusCode).json({
      statusCode,
      error: exception.name,
      message: exception.message,
    });
  }
}
