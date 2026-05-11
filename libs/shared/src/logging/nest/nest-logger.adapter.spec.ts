/**
 * NestJS Logger Adapter Spec
 *
 * Covers the host-only Nest-backed backend: per-context instance reuse,
 * trailing-string-as-context consumption (not double-passed as payload),
 * and stack-as-second-arg forwarding to `NestLogger.error`.
 *
 * @module libs/shared/src/logging/nest
 */
import { Logger as NestLogger } from '@nestjs/common';

import { NestLoggerAdapter } from './nest-logger.adapter';

const argsOf = (spy: jest.SpyInstance, callIndex = 0): unknown[] =>
  (spy.mock.calls[callIndex] as unknown[] | undefined) ?? [];

describe('NestLoggerAdapter', () => {
  let adapter: NestLoggerAdapter;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new NestLoggerAdapter();
    logSpy = jest.spyOn(NestLogger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(NestLogger.prototype, 'warn').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(NestLogger.prototype, 'debug').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(NestLogger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes log() through the NestLogger instance bound to the trailing context', () => {
    adapter.log('hello', 'Ctx');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(argsOf(logSpy)[0]).toBe('hello');
  });

  it('routes warn() through NestLogger.prototype.warn', () => {
    adapter.warn('careful', 'Ctx');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(argsOf(warnSpy)[0]).toBe('careful');
  });

  it('routes debug() through NestLogger.prototype.debug', () => {
    adapter.debug('trace', 'Ctx');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(argsOf(debugSpy)[0]).toBe('trace');
  });

  it('forwards the stack argument to NestLogger.error and consumes the trailing context', () => {
    adapter.error('failure', 'stack-trace', 'Ctx');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const args = argsOf(errorSpy);
    expect(args[0]).toBe('failure');
    expect(args[1]).toBe('stack-trace');
    // Trailing context must NOT be passed through as a third positional arg —
    // Nest derives the context from the per-instance NestLogger itself.
    expect(args).toHaveLength(2);
  });

  it('reuses the same NestLogger instance across calls with the same context', () => {
    adapter.log('one', 'CachedCtx');
    adapter.log('two', 'CachedCtx');
    expect(logSpy).toHaveBeenCalledTimes(2);
    const cache = (adapter as unknown as { instances: Map<string, NestLogger> }).instances;
    expect(cache.size).toBe(1);
    expect(cache.has('CachedCtx')).toBe(true);
  });

  it('falls back to the "Application" context when no trailing string is supplied', () => {
    adapter.log('hi');
    const cache = (adapter as unknown as { instances: Map<string, NestLogger> }).instances;
    expect(cache.has('Application')).toBe(true);
  });

  it('does not pass the trailing context through as an extra payload arg on log()', () => {
    adapter.log('msg', { extra: 1 }, 'Ctx');
    const args = argsOf(logSpy);
    expect(args[0]).toBe('msg');
    expect(args[1]).toEqual({ extra: 1 });
    expect(args).toHaveLength(2); // context stripped before forwarding
  });
});
