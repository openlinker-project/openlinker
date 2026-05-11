/**
 * Logger
 *
 * Consumer-facing factory class that all 90+ call sites use as
 * `private readonly logger = new Logger(ClassName.name)`. The class itself
 * is framework-neutral — it delegates every call to a process-wide active
 * `LoggerPort` backend. The backend defaults to `ConsoleLoggerAdapter` and
 * is swapped by host apps at boot via `setLoggerBackend()` (typically through
 * `installNestLogger()` from `@openlinker/shared/logging/nest`).
 *
 * Plugins compiled against `@openlinker/shared` never transitively import
 * `@nestjs/common` through the logger — that dependency lives only in the
 * `./nest` subpath, loaded by host applications.
 *
 * @module libs/shared/src/logging
 * @implements {LoggerPort}
 */
import { ConsoleLoggerAdapter } from './console-logger.adapter';
import { LoggerPort } from './logger.port';

let activeBackend: LoggerPort = new ConsoleLoggerAdapter();

/**
 * Replace the active logger backend. Called by host apps at boot.
 * Also used by tests — always restore the previous backend in `afterEach`
 * to avoid polluting sibling specs in the same Jest worker.
 */
export function setLoggerBackend(backend: LoggerPort): void {
  activeBackend = backend;
}

/**
 * Read the active logger backend. Exposed for tests and for advanced
 * compositions (e.g. a wrapping backend that forwards to the previous one).
 */
export function getLoggerBackend(): LoggerPort {
  return activeBackend;
}

export class Logger implements LoggerPort {
  private readonly context: string;

  constructor(context?: string) {
    this.context = context ?? 'Application';
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    activeBackend.log(message, ...this.appendContextIfMissing(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    activeBackend.debug(message, ...this.appendContextIfMissing(optionalParams));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    activeBackend.warn(message, ...this.appendContextIfMissing(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    activeBackend.error(message, ...this.appendContextIfMissing(optionalParams));
  }

  /**
   * Append the instance context as the trailing string param IF the caller
   * didn't already supply a trailing-string context. Mirrors NestJS Logger
   * semantics so existing call sites (`logger.log(msg, structuredData)` or
   * `logger.error(msg, error.stack)`) keep working unchanged.
   */
  private appendContextIfMissing(params: unknown[]): unknown[] {
    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      return params;
    }
    return [...params, this.context];
  }
}
