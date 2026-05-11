/**
 * Console Logger Adapter Spec
 *
 * Covers the default zero-dependency backend: prefix shape, per-level sink
 * dispatch, trailing-string-as-context convention, Error.stack rendering,
 * and the JSON-stringify fallback for circular or unstringifiable values.
 *
 * @module libs/shared/src/logging
 */
import { ConsoleLoggerAdapter } from './console-logger.adapter';

const firstLine = (spy: jest.SpyInstance): string =>
  String((spy.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');

const lineAt = (spy: jest.SpyInstance, index: number): string =>
  String((spy.mock.calls[index] as unknown[] | undefined)?.[0] ?? '');

describe('ConsoleLoggerAdapter', () => {
  let adapter: ConsoleLoggerAdapter;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new ConsoleLoggerAdapter();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes log() via console.log with [OL] prefix, LEVEL, and context', () => {
    adapter.log('hello', 'Ctx');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(firstLine(logSpy)).toMatch(/^\[OL\] \S+ LOG \[Ctx\] hello$/);
  });

  it('writes warn() via console.warn', () => {
    adapter.warn('careful', 'Ctx');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(firstLine(warnSpy)).toMatch(/WARN \[Ctx\] careful/);
  });

  it('writes debug() via console.debug', () => {
    adapter.debug('trace', 'Ctx');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(firstLine(debugSpy)).toMatch(/DEBUG \[Ctx\] trace/);
  });

  it('writes error() via console.error when called with message and context only', () => {
    adapter.error('boom', 'Ctx');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(firstLine(errorSpy)).toMatch(/ERROR \[Ctx\] boom/);
  });

  it('emits a second console.error line carrying the stack when error has one', () => {
    const err = new Error('boom');
    adapter.error('failure', err, 'Ctx');
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(lineAt(errorSpy, 0)).toMatch(/ERROR \[Ctx\] failure/);
    expect(lineAt(errorSpy, 1)).toContain('Error: boom');
  });

  it('treats a trailing string param as context, not as extra payload', () => {
    adapter.log('hi', 'CallerCtx');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(firstLine(logSpy)).toMatch(/LOG \[CallerCtx\] hi/);
  });

  it('renders extra payload params on additional lines after the message', () => {
    adapter.log('event', { actor: 'alice' }, 'Ctx');
    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(lineAt(logSpy, 0)).toMatch(/LOG \[Ctx\] event/);
    expect(lineAt(logSpy, 1)).toContain('"actor":"alice"');
  });

  it('falls back to String() when JSON.stringify throws on a circular value', () => {
    const circular: Record<string, unknown> = { self: undefined };
    circular.self = circular;
    adapter.log(circular, 'Ctx');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(firstLine(logSpy)).toMatch(/LOG \[Ctx\] \[object Object\]/);
  });

  it('omits the context segment when no context is provided', () => {
    adapter.log('hi');
    expect(firstLine(logSpy)).toMatch(/^\[OL\] \S+ LOG hi$/);
  });
});
