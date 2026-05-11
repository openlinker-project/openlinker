/**
 * Console Logger Adapter
 *
 * Zero-dependency default `LoggerPort` implementation that writes to the
 * standard `console.*` channels. Used automatically when no host wires a
 * richer backend (e.g. `installNestLogger()`), so plugins importing
 * `@openlinker/shared/logging` always have working logs without setup.
 *
 * Output shape: `[OL] <ISO timestamp> <LEVEL> [<context>] <message>` plus
 * one trailing line per extra positional param (Error objects render their
 * `.stack`, plain objects are JSON-stringified). Deliberately different
 * from Nest's `[Nest]` prefix so "running on default backend" is visible
 * at a glance during dev.
 *
 * @module libs/shared/src/logging
 */
/* eslint-disable no-console -- This adapter is the one legitimate caller of console.* in the codebase. */
import { LoggerPort } from './logger.port';
import { LogLevel } from './logger.types';

export class ConsoleLoggerAdapter implements LoggerPort {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  private emit(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    const { context, extras } = this.splitParams(optionalParams);
    const prefix = `[OL] ${new Date().toISOString()} ${level.toUpperCase()}${
      context ? ` [${context}]` : ''
    }`;
    const sink = this.sinkFor(level);
    sink(`${prefix} ${this.stringify(message)}`);
    for (const extra of extras) {
      sink(this.stringify(extra));
    }
  }

  /**
   * Mirror Nest's convention: trailing string param = context; everything
   * before it = extra payload (Error, structured object, raw stack).
   */
  private splitParams(params: unknown[]): { context?: string; extras: unknown[] } {
    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      return { context: params[params.length - 1] as string, extras: params.slice(0, -1) };
    }
    return { extras: params };
  }

  private sinkFor(level: LogLevel): (line: string) => void {
    switch (level) {
      case 'error':
        return console.error;
      case 'warn':
        return console.warn;
      case 'debug':
        return console.debug;
      case 'log':
        return console.log;
    }
  }

  private stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? value.message;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
