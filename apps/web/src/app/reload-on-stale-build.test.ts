import { describe, expect, it, vi } from 'vitest';
import {
  reloadOnceForStaleBuild,
  STALE_BUILD_RELOAD_KEY,
  STALE_BUILD_RELOAD_WINDOW_MS,
} from './reload-on-stale-build';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('reloadOnceForStaleBuild', () => {
  it('should reload and record when no reload happened recently', () => {
    const storage = memoryStorage();
    const reload = vi.fn();

    expect(reloadOnceForStaleBuild({ storage, now: () => 100_000, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STALE_BUILD_RELOAD_KEY)).toBe('100000');
  });

  it('should not reload again inside the window, so a real outage cannot loop', () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: '100000' });
    const reload = vi.fn();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(reloadOnceForStaleBuild({ storage, now: () => 100_000 + STALE_BUILD_RELOAD_WINDOW_MS - 1, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Stale-build reload suppressed'));
    warn.mockRestore();
  });

  it('should reload again once the window has passed (the next deploy)', () => {
    const storage = memoryStorage({ [STALE_BUILD_RELOAD_KEY]: '100000' });
    const reload = vi.fn();

    expect(reloadOnceForStaleBuild({ storage, now: () => 100_000 + STALE_BUILD_RELOAD_WINDOW_MS, reload })).toBe(true);
  });

  it('should still reload when storage throws', () => {
    const storage = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    const reload = vi.fn();

    expect(reloadOnceForStaleBuild({ storage, now: () => 1, reload })).toBe(false);
    expect(reloadOnceForStaleBuild({ storage, now: () => STALE_BUILD_RELOAD_WINDOW_MS + 1, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
