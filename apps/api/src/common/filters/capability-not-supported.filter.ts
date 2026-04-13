/**
 * Capability Not Supported Filter
 *
 * Maps CapabilityNotSupportedException (and its subclass CapabilityNotEnabledException)
 * into a 400 Bad Request with a structured, operator-friendly message.
 *
 * Without this filter NestJS would default to 500 Internal Server Error, which
 * misrepresents a user/configuration error as a server fault.
 *
 * @module apps/api/src/common/filters
 * @see {@link CapabilityNotSupportedException} for the domain exception shape
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { CapabilityNotSupportedException } from '@openlinker/core/integrations';

@Catch(CapabilityNotSupportedException)
export class CapabilityNotSupportedFilter implements ExceptionFilter {
  catch(exception: CapabilityNotSupportedException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: exception.name,
      message: exception.message,
    });
  }
}
