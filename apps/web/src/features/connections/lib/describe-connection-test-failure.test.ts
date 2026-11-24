/**
 * Describe a failed connection test - tests (#3866)
 */
import { describe, expect, it } from 'vitest';
import { describeConnectionTestFailure } from './describe-connection-test-failure';

describe('describeConnectionTestFailure', () => {
  it('should say what the test found, then the tester\'s detail under the not-translated label', () => {
    expect(
      describeConnectionTestFailure({
        success: false,
        status: 401,
        message: '401 Unauthorized',
        latencyMs: 12,
        outcome: 'unauthorized',
      }),
    ).toBe(
      'The platform refused the credentials. Check the key or password. Technical details (not translated): 401 Unauthorized',
    );
  });

  it('should say the test failed when an older API sends no outcome', () => {
    expect(
      describeConnectionTestFailure({ success: false, message: 'probe failed', latencyMs: 3 }),
    ).toBe('The test failed. Technical details (not translated): probe failed');
  });

  it('should leave out an empty detail', () => {
    expect(
      describeConnectionTestFailure({ success: false, message: ' ', latencyMs: 3, outcome: 'timeout' }),
    ).toBe('The platform did not answer in time.');
  });
});
