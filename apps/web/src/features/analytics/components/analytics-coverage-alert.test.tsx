import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsCoverageAlert } from './analytics-coverage-alert';

describe('AnalyticsCoverageAlert (#2478)', () => {
  it('should render the affected order count and call onDismiss when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(<AnalyticsCoverageAlert affectedCount={23} onDismiss={onDismiss} />);

    expect(screen.getByText('23 orders recalculated')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('should use singular copy for a single order', () => {
    render(<AnalyticsCoverageAlert affectedCount={1} onDismiss={() => {}} />);

    expect(screen.getByText('1 order recalculated')).toBeInTheDocument();
  });
});
