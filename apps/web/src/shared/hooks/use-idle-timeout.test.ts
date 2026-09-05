import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIdleTimeout } from './use-idle-timeout';

describe('useIdleTimeout (#2413, A3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onIdle after the timeout elapses with no activity', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle }));

    expect(onIdle).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('restarts the clock on activity', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle }));

    act(() => {
      vi.advanceTimersByTime(900);
      window.dispatchEvent(new Event('keydown'));
      vi.advanceTimersByTime(900);
    });
    expect(onIdle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('fires only ONCE per idle period, even under continued activity', () => {
    // The bench clears the session in `onIdle`. Firing repeatedly would clear
    // an already-cleared session on a loop, and a stray pointermove from
    // somebody walking past a locked terminal must not silently re-arm it.
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle }));

    act(() => {
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new Event('pointermove'));
      vi.advanceTimersByTime(5000);
    });

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('re-arms after reset()', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle }));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.reset();
      vi.advanceTimersByTime(1000);
    });
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('does not fire while disabled', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle, enabled: false }));

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does not re-arm on every render when onIdle is an inline arrow', () => {
    // Without the ref, a caller passing an inline callback would re-run the
    // effect on every render and restart the timer — a surface that re-renders
    // faster than the timeout would then never lock.
    const spy = vi.fn();
    const { rerender } = renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle: () => spy() }));

    act(() => {
      vi.advanceTimersByTime(600);
    });
    rerender();
    rerender();
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('persists nothing to browser storage', () => {
    // A shared terminal: an idle deadline in shared storage is one more thing
    // the incoming packer inherits.
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderHook(() => useIdleTimeout({ timeoutMs: 1000, onIdle: vi.fn() }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
