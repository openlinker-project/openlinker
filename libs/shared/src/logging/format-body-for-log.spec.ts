/**
 * Format Body For Log — Spec
 *
 * Verifies env-driven truncation behaviour. The helper reads
 * `OL_LOG_BODY_MAX_BYTES` once at module load, so every case re-imports the
 * module via `jest.isolateModules` with the env pre-set.
 *
 * @module libs/shared/src/logging
 */

type FormatBodyForLog = (body: string) => string;

function loadHelper(envValue: string | undefined): FormatBodyForLog {
  let helper!: FormatBodyForLog;
  jest.isolateModules(() => {
    if (envValue === undefined) {
      delete process.env.OL_LOG_BODY_MAX_BYTES;
    } else {
      process.env.OL_LOG_BODY_MAX_BYTES = envValue;
    }
    // require() inside isolateModules is the only way to re-evaluate a module
    // with a fresh process.env. ES `import` is hoisted and would bind once.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- dynamic require() needed: path computed at runtime
    helper = (require('./format-body-for-log') as { formatBodyForLog: FormatBodyForLog }).formatBodyForLog;
  });
  return helper;
}

describe('formatBodyForLog', () => {
  const originalEnv = process.env.OL_LOG_BODY_MAX_BYTES;

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.OL_LOG_BODY_MAX_BYTES;
    } else {
      process.env.OL_LOG_BODY_MAX_BYTES = originalEnv;
    }
  });

  describe('when env is unset or invalid', () => {
    it('returns body unchanged when env is unset', () => {
      const formatBodyForLog = loadHelper(undefined);
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when env is empty string', () => {
      const formatBodyForLog = loadHelper('');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when env is "0"', () => {
      const formatBodyForLog = loadHelper('0');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when env is negative', () => {
      const formatBodyForLog = loadHelper('-100');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when env is non-numeric', () => {
      const formatBodyForLog = loadHelper('abc');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when env has trailing garbage (parseInt foot-gun)', () => {
      // parseInt('10abc', 10) === 10 silently. Number('10abc') === NaN.
      // The helper must reject this, not treat it as cap=10.
      const formatBodyForLog = loadHelper('10abc');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when env is a float', () => {
      const formatBodyForLog = loadHelper('5.5');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });
  });

  describe('when env is a positive integer', () => {
    it('returns body unchanged when cap exceeds body length', () => {
      const formatBodyForLog = loadHelper('100');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('returns body unchanged when cap equals body length (boundary <=)', () => {
      const formatBodyForLog = loadHelper('11');
      expect(formatBodyForLog('hello world')).toBe('hello world');
    });

    it('truncates with marker when cap is below body length', () => {
      const formatBodyForLog = loadHelper('5');
      expect(formatBodyForLog('hello world')).toBe('hello… [truncated, total length: 11]');
    });

    it('returns empty body unchanged regardless of cap', () => {
      const formatBodyForLog = loadHelper('10');
      expect(formatBodyForLog('')).toBe('');
    });

    it('preserves the original total length in the marker', () => {
      const formatBodyForLog = loadHelper('3');
      const body = 'a'.repeat(1234);
      expect(formatBodyForLog(body)).toBe(`aaa… [truncated, total length: 1234]`);
    });
  });
});
