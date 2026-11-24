/**
 * SaveButton tests (#3935)
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveButton, useSaveButtonState } from './save-button';

const labels = { idle: 'Save', saving: 'Saving', saved: 'Saved' };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SaveButton', () => {
  it('should call onClick while idle', async () => {
    const onClick = vi.fn();
    render(<SaveButton state="idle" labels={labels} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should refuse a second click while saving and mark itself busy', () => {
    render(<SaveButton state="saving" labels={labels} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('is-saving');
  });

  it('should show the saved state', () => {
    render(<SaveButton state="saved" labels={labels} />);
    expect(screen.getByRole('button')).toHaveClass('is-saved');
  });
});

describe('useSaveButtonState', () => {
  it('should be saving while the request runs', () => {
    const { result } = renderHook(() => useSaveButtonState(true, 0));
    expect(result.current).toBe('saving');
  });

  it('should show saved after a save succeeds and go back after a moment', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ count }) => useSaveButtonState(false, count), {
      initialProps: { count: 0 },
    });
    expect(result.current).toBe('idle');

    rerender({ count: 1 });
    expect(result.current).toBe('saved');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe('idle');
  });
});
