import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyticsMoneyBasisToggle } from './analytics-money-basis-toggle';

describe('AnalyticsMoneyBasisToggle', () => {
  it('should render Net and Gross options with the current basis checked', () => {
    render(<AnalyticsMoneyBasisToggle basis="net" onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'Money basis' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Net' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Gross' })).toHaveAttribute('aria-checked', 'false');
  });

  it('should call onChange with gross when the Gross option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AnalyticsMoneyBasisToggle basis="net" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Gross' }));

    expect(onChange).toHaveBeenCalledWith('gross');
  });

  it('should call onChange with net when the Net option is clicked from gross', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AnalyticsMoneyBasisToggle basis="gross" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Net' }));

    expect(onChange).toHaveBeenCalledWith('net');
  });
});
