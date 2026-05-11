/**
 * NestJS Logger Adapter
 *
 * `LoggerPort` implementation that delegates to `@nestjs/common`'s `Logger`,
 * preserving the existing `[Nest] <pid> - <date> <level> [<context>] <msg>`
 * output shape in production. Maintains a per-context cache of `NestLogger`
 * instances to match Nest's per-context formatting and to avoid reallocating
 * loggers on every call.
 *
 * The `LoggerPort` contract mirrors Nest's variadic signature, so each
 * method forwards `optionalParams` verbatim — Nest handles the
 * trailing-string-as-context convention itself.
 *
 * Lives on the `@openlinker/shared/logging/nest` subpath so the
 * `@nestjs/common` import never leaks into plugin builds that depend only on
 * the neutral `@openlinker/shared/logging` surface.
 *
 * @module libs/shared/src/logging/nest
 */
import { Logger as NestLogger } from '@nestjs/common';

import { LoggerPort } from '../logger.port';
import { LogLevel } from '../logger.types';

const DEFAULT_CONTEXT = 'Application';

export class NestLoggerAdapter implements LoggerPort {
  // Per-context `NestLogger` cache. Context should be a bounded
  // class-name-like identifier (e.g. `ProductSyncService.name`), not a
  // per-request handle — this Map grows monotonically for the process
  // lifetime.
  private readonly instances = new Map<string, NestLogger>();

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('log', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('debug', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('warn', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.forward('error', message, optionalParams);
  }

  /**
   * Single forwarding seam — resolves the per-context NestLogger and invokes
   * the matching method. The `as never` cast localises the gap between our
   * `LoggerPort` (`message: unknown`) and Nest's overloaded `Logger` API
   * (typed as `any` upstream) to one line instead of four.
   */
  private forward(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    const { logger, payload } = this.resolve(optionalParams);
    logger[level](message as never, ...payload);
  }

  /**
   * Pick the per-context `NestLogger` instance and return the remaining
   * payload to pass through. We pop the trailing-string context (if any)
   * because Nest itself uses the `Logger` instance's context, not a
   * trailing param — passing it through twice would render `[Ctx]` in the
   * payload as well.
   */
  private resolve(params: unknown[]): { logger: NestLogger; payload: unknown[] } {
    let context = DEFAULT_CONTEXT;
    let payload = params;
    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      context = params[params.length - 1] as string;
      payload = params.slice(0, -1);
    }

    let logger = this.instances.get(context);
    if (!logger) {
      logger = new NestLogger(context);
      this.instances.set(context, logger);
    }
    return { logger, payload };
  }
}
