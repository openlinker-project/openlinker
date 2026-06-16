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
 */

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  ConnectionDisabledException,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';

@Catch(ConnectionNotFoundException, ConnectionDisabledException)
export class ConnectionExceptionFilter implements ExceptionFilter {
  catch(
    exception: ConnectionNotFoundException | ConnectionDisabledException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
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
