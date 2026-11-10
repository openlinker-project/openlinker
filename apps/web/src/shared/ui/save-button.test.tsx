/**
 * SaveButton tests (#3935)
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveButton } from './save-button';

const props = { label: 'Save', busyLabel: 'Saving', doneLabel: 'Saved', onClick: vi.fn() };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SaveButton', () => {
  it('should show the saving state while the request runs and disable itself', () => {
    render(<SaveButton {...props} pending savedCount={0} />);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('is-saving');
    expect(button).toBeDisabled();
  });

  it('should show the saved check after a save succeeds and go back after a moment', () => {
    vi.useFakeTimers();
    const { rerender } = render(<SaveButton {...props} pending={false} savedCount={0} />);

    rerender(<SaveButton {...props} pending={false} savedCount={1} />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('is-saved');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveClass('is-saved');
  });

  it('should call back on click', () => {
    render(<SaveButton {...props} pending={false} savedCount={0} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(props.onClick).toHaveBeenCalledTimes(1);
  });
});
