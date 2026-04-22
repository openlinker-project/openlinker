import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  afterEach(cleanup);

  it('renders nothing for fewer than 2 points', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a polyline path through all values', () => {
    const { container } = render(<Sparkline values={[0, 5, 10]} width={20} height={10} />);
    const path = container.querySelector('.sparkline__line');
    expect(path?.getAttribute('d')).toBe('M0.00,10.00 L10.00,5.00 L20.00,0.00');
  });

  it('applies the requested tone modifier', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} tone="error" />);
    expect(container.querySelector('svg')).toHaveClass('sparkline--error');
  });

  it('marks the svg as decorative when no ariaLabel is supplied', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.getAttribute('role')).toBe('presentation');
  });

  it('exposes an accessible name when ariaLabel is supplied', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} ariaLabel="Queue trend, last 24h" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg).toHaveAttribute('aria-label', 'Queue trend, last 24h');
  });

  it('includes a filled area path when filled is true', () => {
    const { container } = render(<Sparkline values={[1, 2, 3]} filled width={10} height={10} />);
    expect(container.querySelector('.sparkline__area')).toBeInTheDocument();
  });
});
