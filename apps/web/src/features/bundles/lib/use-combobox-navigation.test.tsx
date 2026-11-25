import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it } from 'vitest';

import { useComboboxNavigation } from './use-combobox-navigation';

const key = (k: string): KeyboardEvent<HTMLInputElement> =>
  ({ key: k, preventDefault: () => undefined }) as unknown as KeyboardEvent<HTMLInputElement>;

const options = [
  { id: 'a', disabled: true },
  { id: 'b', disabled: false },
  { id: 'c', disabled: true },
  { id: 'd', disabled: false },
];

describe('useComboboxNavigation', () => {
  it('should highlight the first enabled option when results exist', () => {
    const { result } = renderHook(() => useComboboxNavigation(options));
    expect(result.current.activeId).toBe('b');
    expect(result.current.activeOption?.id).toBe('b');
  });

  it('should skip disabled options when arrowing and wrap around', () => {
    const { result } = renderHook(() => useComboboxNavigation(options));
    act(() => {
      result.current.onNavigationKey(key('ArrowDown'));
    });
    expect(result.current.activeId).toBe('d');
    act(() => {
      result.current.onNavigationKey(key('ArrowDown'));
    });
    expect(result.current.activeId).toBe('b');
    act(() => {
      result.current.onNavigationKey(key('ArrowUp'));
    });
    expect(result.current.activeId).toBe('d');
  });

  it('should have no active option when every option is disabled', () => {
    const { result } = renderHook(() =>
      useComboboxNavigation([{ id: 'a', disabled: true }]),
    );
    expect(result.current.activeOption).toBeNull();
  });

  it('should not move the highlight onto a hovered disabled option', () => {
    const { result } = renderHook(() => useComboboxNavigation(options));
    act(() => {
      result.current.hover(options[0]);
    });
    expect(result.current.activeId).toBe('b');
  });
});
