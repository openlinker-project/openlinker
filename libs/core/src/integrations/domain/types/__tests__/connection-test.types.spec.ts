import { resolveConnectionTestOutcome } from '../connection-test.types';

describe('resolveConnectionTestOutcome', () => {
  const base = { message: 'x', latencyMs: 1 };

  it('should keep the outcome the tester reported', () => {
    expect(
      resolveConnectionTestOutcome({ ...base, success: false, status: 401, outcome: 'misconfigured' }),
    ).toBe('misconfigured');
  });

  it.each([
    [{ success: true, status: 200 }, 'ok'],
    [{ success: false, status: 401 }, 'unauthorized'],
    [{ success: false, status: 403 }, 'unauthorized'],
    [{ success: false, status: 404 }, 'not-found'],
    [{ success: false, status: 504 }, 'timeout'],
    [{ success: false, status: 500 }, 'unexpected-status'],
    [{ success: false }, 'failed'],
  ] as const)('should derive %o as %s', (result, outcome) => {
    expect(resolveConnectionTestOutcome({ ...base, ...result })).toBe(outcome);
  });
});
