/**
 * Logger Port
 *
 * Minimal structured-logging seam. The client emits request/response and
 * polling traces through this port; the host injects whatever backend it likes
 * (the bundled `ConsoleLoggerAdapter`, or OpenLinker's `@openlinker/shared`
 * `Logger` when this graduates into the real adapter).
 *
 * @module domain/ports
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerPort {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
