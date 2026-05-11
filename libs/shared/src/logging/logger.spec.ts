/**
 * Logger Spec
 *
 * Covers the backend-registry contract and the `Logger` factory's context
 * forwarding. The module-level `activeBackend` is process-wide singleton
 * state, so EVERY test that calls `setLoggerBackend(...)` must restore the
 * previous backend in `afterEach` to avoid leaking into sibling specs.
 *
 * @module libs/shared/src/logging
 */
import { ConsoleLoggerAdapter } from './console-logger.adapter';
import { Logger, getLoggerBackend, setLoggerBackend } from './logger';
import { LoggerPort } from './logger.port';

function createFakeBackend(): jest.Mocked<LoggerPort> {
  return {
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe('Logger', () => {
  let previousBackend: LoggerPort;
  let backend: jest.Mocked<LoggerPort>;

  beforeEach(() => {
    previousBackend = getLoggerBackend();
    backend = createFakeBackend();
    setLoggerBackend(backend);
  });

  afterEach(() => {
    setLoggerBackend(previousBackend);
  });

  it('defaults to ConsoleLoggerAdapter when no backend is installed', () => {
    setLoggerBackend(previousBackend);
    expect(getLoggerBackend()).toBeInstanceOf(ConsoleLoggerAdapter);
  });

  it('appends the instance context when no trailing-string context is supplied', () => {
    new Logger('Ctx').log('hello');
    expect(backend.log).toHaveBeenCalledWith('hello', 'Ctx');
  });

  it('forwards a structured-data extra param and still appends the bound context', () => {
    const meta = { actor: 'alice', action: 'rotate' };
    new Logger('Ctx').log('event', meta);
    expect(backend.log).toHaveBeenCalledWith('event', meta, 'Ctx');
  });

  it('forwards an Error as the second arg to error() and appends the bound context', () => {
    const err = new Error('boom');
    new Logger('Ctx').error('failure', err);
    expect(backend.error).toHaveBeenCalledWith('failure', err, 'Ctx');
  });

  it('preserves a caller-supplied trailing-string context (no double-append)', () => {
    new Logger('DefaultCtx').log('hi', 'OverrideCtx');
    expect(backend.log).toHaveBeenCalledWith('hi', 'OverrideCtx');
  });

  it('preserves caller-supplied stack + context positional pair on error()', () => {
    new Logger('DefaultCtx').error('msg', 'stack-trace', 'OverrideCtx');
    expect(backend.error).toHaveBeenCalledWith('msg', 'stack-trace', 'OverrideCtx');
  });

  it('falls back to "Application" context when constructed without one', () => {
    new Logger().log('hi');
    expect(backend.log).toHaveBeenCalledWith('hi', 'Application');
  });

  it('allows setLoggerBackend to swap the implementation at runtime', () => {
    const next = createFakeBackend();
    setLoggerBackend(next);
    new Logger('Ctx').log('hi');
    expect(backend.log).not.toHaveBeenCalled();
    expect(next.log).toHaveBeenCalledWith('hi', 'Ctx');
  });
});
