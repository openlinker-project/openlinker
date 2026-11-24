import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Switch } from './switch';

afterEach(cleanup);

describe('Switch (#4289)', () => {
  it('should expose role switch with its checked state and label', () => {
    render(<Switch checked label="Turn on" onCheckedChange={vi.fn()} />);
    const sw = screen.getByRole('switch', { name: 'Turn on' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('should keep the label outside the accent track so only the track is coloured', () => {
    render(<Switch checked label="Turn on" onCheckedChange={vi.fn()} />);
    const sw = screen.getByRole('switch');
    const track = sw.querySelector('.ol-switch__track');
    expect(sw).toHaveClass('ol-switch--on');
    expect(track).not.toBeNull();
    expect(track).not.toHaveTextContent('Turn on');
    expect(screen.getByText('Turn on')).toHaveClass('ol-switch__label');
    expect(track?.contains(screen.getByText('Turn on'))).toBe(false);
  });

  it('should flip on click and on Space', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} label="Rules" onCheckedChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    screen.getByRole('switch').focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('should not flip while disabled', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} disabled label="Rules" onCheckedChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
