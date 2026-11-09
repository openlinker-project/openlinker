/**
 * Content entrance tests (#4029)
 *
 * @module shared/lib
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markEntrancePlayed, resetEntrance, shouldPlayEntrance } from './entrance';

describe('content entrance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('should play once per tab and stop after it has played', () => {
    expect(shouldPlayEntrance()).toBe(true);
    markEntrancePlayed();
    expect(shouldPlayEntrance()).toBe(false);
  });

  it('should play again after a fresh sign-in', () => {
    markEntrancePlayed();
    resetEntrance();
    expect(shouldPlayEntrance()).toBe(true);
  });

  it('should not play when storage is unavailable', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(shouldPlayEntrance()).toBe(false);
  });
});
