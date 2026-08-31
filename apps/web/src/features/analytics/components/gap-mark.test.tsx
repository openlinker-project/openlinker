import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GapMark } from './gap-mark';

describe('GapMark (#2480)', () => {
  it('renders an inert span with the reason as its accessible name when onActivate is omitted', () => {
    render(<GapMark title="No return entity exists." />);

    const mark = screen.getByRole('img', { name: 'No return entity exists.' });
    expect(mark.tagName).toBe('SPAN');
    expect(mark).toHaveAttribute('title', 'No return entity exists.');
  });

  it('renders a clickable button carrying the same accessible name when onActivate is supplied', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();

    render(<GapMark title="23 orders counted in an outdated currency" onActivate={onActivate} />);

    const button = screen.getByRole('button', { name: '23 orders counted in an outdated currency' });
    expect(button).toHaveAttribute('title', '23 orders counted in an outdated currency');

    await user.click(button);

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
