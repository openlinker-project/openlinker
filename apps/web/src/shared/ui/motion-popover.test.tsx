/**
 * MotionPopover / useAnchoredPopover tests (#4029)
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { anchoredPosition, MotionPopover, useAnchoredPopover } from './motion-popover';

afterEach(cleanup);

function Harness(): ReactElement {
  const popover = useAnchoredPopover({ width: 200, placement: 'down' });
  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        aria-expanded={popover.open}
        onClick={popover.toggle}
      >
        Open
      </button>
      <MotionPopover
        ref={popover.popoverRef}
        open={popover.open}
        position={popover.position}
        host={popover.host}
        placement="down"
        width={200}
        title="Panel"
      >
        <button type="button" onClick={popover.close}>
          Close
        </button>
      </MotionPopover>
      <p>Outside</p>
    </>
  );
}

describe('useAnchoredPopover + MotionPopover', () => {
  it('should open with its title and close from inside, focusing the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(trigger);
    expect(screen.getByText('Panel')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('should close on a press outside the trigger and the panel', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('Panel'));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('anchoredPosition', () => {
  it('should centre on the trigger and keep the panel on screen', () => {
    const rect = (left: number): DOMRect => ({ left, width: 40, top: 10, bottom: 50 }) as DOMRect;
    expect(anchoredPosition(rect(500), 200, 'down')).toEqual({ left: 520, top: 58 });
    // Near the left edge: moved in so half the width plus the gap fits.
    expect(anchoredPosition(rect(0), 200, 'down')).toEqual({ left: 108, top: 58 });
    expect(anchoredPosition(rect(500), 200, 'up')).toEqual({
      left: 520,
      bottom: window.innerHeight - 10 + 8,
    });
  });
});
