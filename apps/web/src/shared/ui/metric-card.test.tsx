import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MetricCard } from './metric-card';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MetricCard', () => {
  afterEach(cleanup);

  it('renders a label and value', () => {
    renderWithRouter(<MetricCard label="Failed jobs" value={468} />);
    expect(screen.getByText('Failed jobs')).toBeInTheDocument();
    expect(screen.getByText('468')).toBeInTheDocument();
  });

  it('applies the requested tone modifier', () => {
    const { container } = renderWithRouter(
      <MetricCard label="Failed jobs" value={468} tone="error" />,
    );
    expect(container.querySelector('.metric-card--error')).not.toBeNull();
  });

  it('renders trend content when provided', () => {
    renderWithRouter(<MetricCard label="Orders" value={42} trend="+12 today" />);
    expect(screen.getByText('+12 today')).toBeInTheDocument();
  });

  it('renders a description when provided', () => {
    renderWithRouter(
      <MetricCard label="Queued" value={1140} description="across 3 workers" />,
    );
    expect(screen.getByText('across 3 workers')).toBeInTheDocument();
  });

  it('renders a link when to is provided', () => {
    renderWithRouter(
      <MetricCard label="Failed jobs" value={468} tone="error" to="/jobs-logs?status=failed" />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/jobs-logs?status=failed');
    expect(link).toHaveClass('metric-card--interactive');
  });
});
