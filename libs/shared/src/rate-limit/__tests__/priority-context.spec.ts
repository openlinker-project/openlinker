/**
 * Rate Limit Priority Context Unit Tests
 *
 * @module libs/shared/src/rate-limit
 */
import {
  runWithPriority,
  getCurrentPriority,
  getCurrentRateLimitSignal,
} from '../priority-context';

describe('priority-context', () => {
  it('defaults to background when no context is active', () => {
    expect(getCurrentPriority()).toBe('background');
    expect(getCurrentRateLimitSignal()).toBeUndefined();
  });

  it('exposes the priority set by runWithPriority within its synchronous call tree', () => {
    runWithPriority({ priority: 'interactive' }, () => {
      expect(getCurrentPriority()).toBe('interactive');
    });

    // Outside the callback, the ambient context is gone again.
    expect(getCurrentPriority()).toBe('background');
  });

  it('propagates across an async call tree, not just the synchronous frame', async () => {
    const observed = await runWithPriority({ priority: 'interactive' }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getCurrentPriority();
    });

    expect(observed).toBe('interactive');
    expect(getCurrentPriority()).toBe('background');
  });

  it('exposes the cancellation signal carried by the context', () => {
    const controller = new AbortController();

    runWithPriority({ priority: 'background', signal: controller.signal }, () => {
      expect(getCurrentRateLimitSignal()).toBe(controller.signal);
    });
  });

  it('nested contexts do not leak into sibling call trees', () => {
    runWithPriority({ priority: 'interactive' }, () => {
      runWithPriority({ priority: 'background' }, () => {
        expect(getCurrentPriority()).toBe('background');
      });
      // Restored to the outer context after the nested call returns.
      expect(getCurrentPriority()).toBe('interactive');
    });
  });
});
