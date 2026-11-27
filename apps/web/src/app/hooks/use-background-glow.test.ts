import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBackgroundGlow } from './use-background-glow';

describe('useBackgroundGlow', () => {
  afterEach(() => {
    const { result } = renderHook(() => useBackgroundGlow());
    act(() => {
      result.current[1](true);
    });
    window.localStorage.removeItem('openlinker-background-glow');
  });

  it('should be on by default when nothing is stored', () => {
    const { result } = renderHook(() => useBackgroundGlow());
    expect(result.current[0]).toBe(true);
  });

  it('should persist the choice when switched off', () => {
    const { result } = renderHook(() => useBackgroundGlow());
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem('openlinker-background-glow')).toBe('off');
  });

  it('should update every reader when one of them switches it', () => {
    const menu = renderHook(() => useBackgroundGlow());
    const glow = renderHook(() => useBackgroundGlow());
    act(() => {
      menu.result.current[1](false);
    });
    expect(glow.result.current[0]).toBe(false);
  });
});
