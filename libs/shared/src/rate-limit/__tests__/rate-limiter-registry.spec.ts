/**
 * Rate Limiter Registry Unit Tests
 *
 * @module libs/shared/src/rate-limit
 */
import { createRateLimiterRegistry } from '../rate-limiter-registry';

describe('createRateLimiterRegistry', () => {
  it('returns the same limiter instance for repeated get() calls on the same connection', () => {
    const registry = createRateLimiterRegistry();

    const first = registry.get('conn-1', { requestsPerMinute: 60 });
    const second = registry.get('conn-1', { requestsPerMinute: 60 });

    expect(first).toBe(second);
  });

  it('gives distinct connections distinct limiter instances', () => {
    const registry = createRateLimiterRegistry();

    const a = registry.get('conn-a', {});
    const b = registry.get('conn-b', {});

    expect(a).not.toBe(b);
  });

  it('getStatus returns null for a connection that was never resolved — unset stays unset', () => {
    const registry = createRateLimiterRegistry();

    expect(registry.getStatus('never-seen')).toBeNull();
  });

  it('getStatus reflects the live policy of an already-resolved connection', () => {
    const registry = createRateLimiterRegistry();

    registry.get('conn-1', { requestsPerMinute: 120, maxConcurrent: 4 });

    expect(registry.getStatus('conn-1')).toEqual({
      requestsPerMinute: 120,
      maxConcurrent: 4,
      inFlight: 0,
      queued: 0,
      lastAcquiredAt: null,
    });
  });

  it('clear() removes all limiters — a subsequent get() on the same id returns a fresh instance', () => {
    const registry = createRateLimiterRegistry();

    const before = registry.get('conn-1', {});
    registry.clear();
    const after = registry.get('conn-1', {});

    expect(after).not.toBe(before);
  });
});
