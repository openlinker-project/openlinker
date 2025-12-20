/**
 * Logger Wrapper
 *
 * Wrapper around NestJS Logger providing consistent logging interface
 * across the application. Extends NestJS Logger with additional context
 * support for structured logging.
 *
 * @module libs/shared/src/logging
 */
import { Logger as NestLogger } from '@nestjs/common';

export class Logger extends NestLogger {
  constructor(context?: string) {
    super(context);
  }
}

