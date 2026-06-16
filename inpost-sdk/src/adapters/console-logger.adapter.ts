/**
 * Console Logger Adapter
 *
 * Zero-dependency `LoggerPort` over `console`, with a level threshold. Default
 * backend for the SDK; swap for OpenLinker's `Logger` when this graduates.
 *
 * @module adapters
 */

import type { LoggerPort, LogLevel } from '../domain/ports/logger.port.ts';

const WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class ConsoleLoggerAdapter implements LoggerPort {
  readonly #threshold: number;

  constructor(level: LogLevel = 'info') {
    this.#threshold = WEIGHT[level];
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.#emit('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.#emit('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.#emit('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.#emit('error', message, context);
  }

  #emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (WEIGHT[level] < this.#threshold) return;
    const line = `[${level}] ${message}`;
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (context && Object.keys(context).length > 0) {
      sink(line, context);
    } else {
      sink(line);
    }
  }
}

export class NoopLoggerAdapter implements LoggerPort {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
