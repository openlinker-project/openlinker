import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricCard, MetricCardLink, MetricCardToneValues } from './metric-card';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MetricCard', () => {
  afterEach(cleanup);

  it('renders a label and value', () => {
    render(<MetricCard label="Failed jobs" value={468} />);
    expect(screen.getByText('Failed jobs')).toBeInTheDocument();
    expect(screen.getByText('468')).toBeInTheDocument();
  });

  it('applies the requested tone modifier', () => {
    const { container } = render(<MetricCard label="Failed jobs" value={468} tone="error" />);
    expect(container.querySelector('.metric-card--error')).not.toBeNull();
  });

  it('renders trend content when provided', () => {
    render(<MetricCard label="Orders" value={42} trend="+12 today" />);
    expect(screen.getByText('+12 today')).toBeInTheDocument();
  });

  it('renders a description when provided', () => {
    render(<MetricCard label="Queued" value={1140} description="across 3 workers" />);
    expect(screen.getByText('across 3 workers')).toBeInTheDocument();
  });

  it('defaults to the neutral tone', () => {
    const { container } = render(<MetricCard label="Orders" value={42} />);
    expect(container.querySelector('.metric-card--neutral')).not.toBeNull();
    expect(container.querySelector('.metric-card--interactive')).toBeNull();
  });

  it('renders a warning icon for tone="warning" with aria-hidden on the wrapping span', () => {
    const { container } = render(<MetricCard label="Integration health" value="3 / 4" tone="warning" />);
    const icon = container.querySelector('.metric-card__icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
  });

  it('renders an error icon for tone="error" with aria-hidden on the wrapping span', () => {
    const { container } = render(<MetricCard label="Failed jobs" value={42} tone="error" />);
    const icon = container.querySelector('.metric-card__icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('svg')).not.toBeNull();
  });

  it.each(['neutral', 'success', 'info'] as const)(
    'does not render a tone icon for tone="%s"',
    (tone) => {
      const { container } = render(<MetricCard label="Orders" value={42} tone={tone} />);
      expect(container.querySelector('.metric-card__icon')).toBeNull();
    },
  );

  it('MetricCardToneValues exposes all five supported tones', () => {
    expect([...MetricCardToneValues]).toEqual(['neutral', 'success', 'warning', 'error', 'info']);
  });
});

describe('MetricCardLink', () => {
  afterEach(cleanup);

  it('renders as an anchor pointing at the target route', () => {
    renderWithRouter(
      <MetricCardLink label="Failed jobs" value={468} tone="error" to="/jobs-logs?status=failed" />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/jobs-logs?status=failed');
    expect(link).toHaveClass('metric-card--interactive');
    expect(link).toHaveClass('metric-card--error');
  });

  it('forwards the ref to the anchor element', () => {
    const ref = { current: null as HTMLAnchorElement | null };
    renderWithRouter(<MetricCardLink ref={ref} label="Orders" value={42} to="/orders" />);
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });
});
