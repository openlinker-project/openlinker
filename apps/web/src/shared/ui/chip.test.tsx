import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chip } from './chip';

describe('Chip', () => {
  afterEach(cleanup);

  it('renders with neutral tone by default', () => {
    render(<Chip>All</Chip>);
    const btn = screen.getByRole('button', { name: 'All' });
    expect(btn).toHaveClass('chip', 'chip--neutral');
  });

  it('applies the requested tone modifier', () => {
    render(<Chip tone="error">Failed</Chip>);
    expect(screen.getByRole('button', { name: 'Failed' })).toHaveClass('chip--error');
  });

  it('exposes active state via aria-pressed and a modifier class', () => {
    render(
      <Chip active tone="info">
        Active
      </Chip>,
    );
    const btn = screen.getByRole('button', { name: 'Active' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveClass('chip--active');
  });

  it('forwards ref and merges className', () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Chip ref={ref} className="extra">
        Hi
      </Chip>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByRole('button', { name: 'Hi' })).toHaveClass('chip', 'extra');
  });

  it('fires onClick when pressed', () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Tap</Chip>);
    screen.getByRole('button', { name: 'Tap' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
