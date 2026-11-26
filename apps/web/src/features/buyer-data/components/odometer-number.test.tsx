import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OdometerNumber } from './odometer-number';

describe('OdometerNumber (#4289)', () => {
  it('should keep the plain number as text and tint only after a change', () => {
    const { rerender, container } = render(<OdometerNumber value={120} format={String} />);
    expect(container).toHaveTextContent('120');
    expect(container.querySelector('.odo--pulse')).toBeNull();
    rerender(<OdometerNumber value={90} format={String} />);
    expect(container).toHaveTextContent('90');
    expect(container.querySelector('.odo--pulse')).not.toBeNull();
  });

  it('should pop a signed delta chip when asked', () => {
    const { rerender } = render(<OdometerNumber value={10} format={String} delta />);
    rerender(<OdometerNumber value={130} format={String} delta />);
    expect(screen.getByTestId('odo-delta')).toHaveTextContent('+120');
  });

  it('should show a burst of changes as its last value, no more than once per 250 ms', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<OdometerNumber value={10} format={String} />);
    rerender(<OdometerNumber value={20} format={String} />);
    expect(container).toHaveTextContent('20');
    rerender(<OdometerNumber value={30} format={String} />);
    rerender(<OdometerNumber value={40} format={String} />);
    expect(container).toHaveTextContent('20');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(container).toHaveTextContent('40');
  });
});

afterEach(() => vi.useRealTimers());
