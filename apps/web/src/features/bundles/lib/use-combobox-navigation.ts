/**
 * Combobox navigation core (#3935)
 *
 * The keyboard half of the bundle pickers, shared so the component picker and
 * the product picker behave the same: arrows jump OVER rows that cannot be
 * chosen (they stay visible with their reason), the first enabled row is
 * highlighted as soon as results exist so Enter's target is always visible, and
 * Enter never falls back to an unseen row.
 *
 * @module apps/web/src/features/bundles/lib
 */
import { useEffect, useState, type KeyboardEvent } from 'react';

export interface ComboboxOption {
  id: string;
  /** Shown but not choosable: navigation skips it. */
  disabled: boolean;
}

export interface ComboboxNavigation<T extends ComboboxOption> {
  /** The highlighted row id: the user's, else the first enabled row. */
  activeId: string | null;
  /** The highlighted row, only when it can be chosen. */
  activeOption: T | null;
  /** Pointer hover moves the highlight, but never onto a disabled row. */
  hover: (option: T) => void;
  reset: () => void;
  /** Handles arrows (and Home/End once navigating); true when the key was consumed. */
  onNavigationKey: (event: KeyboardEvent<HTMLInputElement>) => boolean;
}

export function useComboboxNavigation<T extends ComboboxOption>(
  options: readonly T[],
): ComboboxNavigation<T> {
  const [picked, setPicked] = useState<string | null>(null);
  const enabled = options.filter((option) => !option.disabled);
  const pickedStillThere = picked !== null && enabled.some((option) => option.id === picked);
  const activeId = pickedStillThere ? picked : (enabled[0]?.id ?? null);
  const activeOption = enabled.find((option) => option.id === activeId) ?? null;

  useEffect(() => {
    if (activeId !== null) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const step = (direction: 1 | -1): void => {
    if (enabled.length === 0) return;
    const current = enabled.findIndex((option) => option.id === activeId);
    const next =
      current === -1
        ? direction === 1
          ? 0
          : enabled.length - 1
        : (current + direction + enabled.length) % enabled.length;
    setPicked(enabled[next]?.id ?? null);
  };

  const onNavigationKey = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      step(1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      step(-1);
      return true;
    }
    // Home/End belong to the text caret until the user has started navigating.
    if ((event.key === 'Home' || event.key === 'End') && picked !== null && enabled.length > 0) {
      event.preventDefault();
      setPicked((event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1])?.id ?? null);
      return true;
    }
    return false;
  };

  return {
    activeId,
    activeOption,
    hover: (option): void => {
      if (!option.disabled) setPicked(option.id);
    },
    reset: (): void => {
      setPicked(null);
    },
    onNavigationKey,
  };
}
