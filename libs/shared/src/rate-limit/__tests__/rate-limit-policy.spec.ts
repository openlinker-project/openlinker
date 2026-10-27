/**
 * Rate Limit Policy Unit Tests
 *
 * @module libs/shared/src/rate-limit
 */
import { tightenRateLimit } from '../rate-limit-policy';

describe('tightenRateLimit', () => {
  it('should take the stricter value of each knob when both sides set it', () => {
    expect(
      tightenRateLimit(
        { requestsPerMinute: 300, maxConcurrent: 4 },
        { requestsPerMinute: 60, maxConcurrent: 10 }
      )
    ).toEqual({ requestsPerMinute: 60, maxConcurrent: 4 });
  });

  it('should keep the ceiling when the override sets nothing', () => {
    expect(tightenRateLimit({ requestsPerMinute: 300, maxConcurrent: 4 }, undefined)).toEqual({
      requestsPerMinute: 300,
      maxConcurrent: 4,
    });
  });

  it('should let the override add a limit when the ceiling leaves that knob unlimited', () => {
    expect(tightenRateLimit({ requestsPerMinute: 300 }, { maxConcurrent: 2 })).toEqual({
      requestsPerMinute: 300,
      maxConcurrent: 2,
    });
  });

  it('should be unlimited when neither side sets anything', () => {
    expect(tightenRateLimit(undefined, undefined)).toEqual({
      requestsPerMinute: undefined,
      maxConcurrent: undefined,
    });
  });
});
