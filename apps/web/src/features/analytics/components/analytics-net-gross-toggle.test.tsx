import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsNetGrossToggle } from './analytics-net-gross-toggle';

describe('AnalyticsNetGrossToggle', () => {
  it('renders both options and highlights the current value', () => {
    render(<AnalyticsNetGrossToggle value="gross" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Gross' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Net' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the selected basis', async () => {
    const onChange = vi.fn();
    render(<AnalyticsNetGrossToggle value="gross" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Net' }));

    expect(onChange).toHaveBeenCalledWith('net');
  });
});
