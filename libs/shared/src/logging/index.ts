/**
 * Logging Module Exports
 *
 * Public surface for `@openlinker/shared/logging`. Exposes the
 * framework-neutral `LoggerPort` contract, the consumer-facing `Logger`
 * factory, the default `ConsoleLoggerAdapter`, the backend registry
 * (`setLoggerBackend` / `getLoggerBackend`), and the `LogLevel` enumeration.
 *
 * The NestJS-backed adapter is intentionally NOT re-exported here — it lives
 * at `@openlinker/shared/logging/nest` so plugins compiled against this
 * package don't transitively pull `@nestjs/common` through the logger.
 *
 * @module libs/shared/src/logging
 */
export type { LoggerPort } from './logger.port';
export type { LogLevel } from './logger.types';
export { LogLevelValues } from './logger.types';
export { Logger, setLoggerBackend, getLoggerBackend } from './logger';
export { ConsoleLoggerAdapter } from './console-logger.adapter';
export * from './format-body-for-log';
