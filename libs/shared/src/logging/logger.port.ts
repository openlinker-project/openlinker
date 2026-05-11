/**
 * Logger Port
 *
 * Framework-neutral logging contract consumed across the codebase via the
 * `Logger` factory class. Adapters (Console default, NestJS opt-in under
 * `./nest`) implement this port; the host swaps the active implementation
 * via `setLoggerBackend()` at boot. Plugins compiled against
 * `@openlinker/shared` depend only on this interface — no @nestjs/common
 * is pulled in via the logger.
 *
 * Method signatures mirror NestJS' `Logger` variadic contract: the first
 * argument is the message, and any number of optional positional params
 * may follow. By convention (inherited from Nest), if the LAST optional
 * param is a string, the backend treats it as the per-call context;
 * everything else is extra payload (e.g. an Error object, a structured
 * metadata bag, or a stack trace).
 *
 * @module libs/shared/src/logging
 * @see {@link Logger} for the consumer-facing factory class.
 */
export interface LoggerPort {
  log(message: unknown, ...optionalParams: unknown[]): void;
  debug(message: unknown, ...optionalParams: unknown[]): void;
  warn(message: unknown, ...optionalParams: unknown[]): void;
  error(message: unknown, ...optionalParams: unknown[]): void;
}
