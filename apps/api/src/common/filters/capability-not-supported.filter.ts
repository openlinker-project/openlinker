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

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { codedErrorBody } from '../errors/coded-http.exception';
import {
  CapabilityNotEnabledException,
  CapabilityNotSupportedException,
} from '@openlinker/core/integrations';

@Catch(CapabilityNotSupportedException)
export class CapabilityNotSupportedFilter implements ExceptionFilter {
  catch(exception: CapabilityNotSupportedException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.BAD_REQUEST).json(
      exception instanceof CapabilityNotEnabledException
        ? codedErrorBody(
            HttpStatus.BAD_REQUEST,
            'CAPABILITY_NOT_ENABLED',
            exception.message,
            {
              connectionId: exception.connectionId,
              adapterKey: exception.adapterKey,
              capability: exception.capability,
            },
            { error: exception.name }
          )
        : codedErrorBody(
            HttpStatus.BAD_REQUEST,
            'CAPABILITY_NOT_SUPPORTED',
            exception.message,
            { adapterKey: exception.adapterKey, capability: exception.capability },
            { error: exception.name }
          )
    );
  }
}
