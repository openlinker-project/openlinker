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
