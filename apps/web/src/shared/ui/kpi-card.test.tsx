import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { KpiCard, KpiGrid } from './kpi-card';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('KpiCard', () => {
  afterEach(cleanup);

  it('renders label and value', () => {
    render(<KpiCard label="Queued jobs" value={1234} />);
    expect(screen.getByText('Queued jobs')).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
  });

  it('applies the requested tone modifier', () => {
    const { container } = render(<KpiCard label="Failed jobs" value={42} tone="error" />);
    expect(container.firstChild).toHaveClass('kpi-card--error');
  });

  it('renders an anchor when href is provided', () => {
    render(<KpiCard label="Failed jobs" value={42} tone="error" href="/jobs-logs?status=dead" />);
    const link = screen.getByRole('link', { name: /Failed jobs/i });
    expect(link).toHaveAttribute('href', '/jobs-logs?status=dead');
  });

  it('renders a react-router Link when `to` is provided (SPA nav)', () => {
    renderWithRouter(
      <KpiCard label="Failed jobs" value={42} tone="error" to="/jobs-logs?status=dead" />,
    );
    const link = screen.getByRole('link', { name: /Failed jobs/i });
    expect(link).toHaveAttribute('href', '/jobs-logs?status=dead');
  });

  it('renders a description when provided', () => {
    render(<KpiCard label="Queued" value={5} description="5 jobs waiting" />);
    expect(screen.getByText('5 jobs waiting')).toBeInTheDocument();
  });

  it('renders a sparkline when values have ≥ 2 points', () => {
    const { container } = render(
      <KpiCard label="Trend" value={10} sparkline={[1, 2, 3]} sparklineAriaLabel="Last 3 ticks" />,
    );
    expect(container.querySelector('.sparkline')).toBeInTheDocument();
  });

  it('omits the sparkline for insufficient data', () => {
    const { container } = render(<KpiCard label="Trend" value={10} sparkline={[1]} />);
    expect(container.querySelector('.sparkline')).toBeNull();
  });

  it('should add the compact modifier when density is compact', () => {
    const { container } = render(<KpiCard label="Unassigned" value={3} density="compact" />);
    expect(container.firstChild).toHaveClass('kpi-card', 'kpi-card--compact');
  });

  it('should not add the compact modifier by default', () => {
    const { container } = render(<KpiCard label="Unassigned" value={3} />);
    expect(container.firstChild).not.toHaveClass('kpi-card--compact');
  });
});

describe('KpiGrid', () => {
  afterEach(cleanup);

  it('should render its cards inside the grid container when given children', () => {
    const { container } = render(
      <KpiGrid>
        <KpiCard label="A" value={1} />
        <KpiCard label="B" value={2} />
      </KpiGrid>
    );
    const grid = container.firstChild as HTMLElement;
    expect(grid).toHaveClass('kpi-grid');
    expect(grid.querySelectorAll('.kpi-card')).toHaveLength(2);
  });

  it('should expose a named group when an aria-label is given', () => {
    render(
      <KpiGrid aria-label="Board summary">
        <KpiCard label="A" value={1} />
      </KpiGrid>
    );
    expect(screen.getByRole('group', { name: 'Board summary' })).toBeInTheDocument();
  });
});
