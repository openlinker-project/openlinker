import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalyticsCurrencyPicker } from './analytics-currency-picker';

describe('AnalyticsCurrencyPicker', () => {
  it('should show the reporting currency as the selected option when no override is set', () => {
    render(
      <AnalyticsCurrencyPicker reportingCurrency="PLN" displayCurrency={null} onChange={vi.fn()} />
    );

    expect(screen.getByRole('combobox', { name: 'Display currency' })).toHaveValue('');
    expect(screen.getByText('Current rate · PLN')).toBeInTheDocument();
  });

  it('should call onChange with the picked currency', async () => {
    const onChange = vi.fn();
    render(<AnalyticsCurrencyPicker reportingCurrency="PLN" displayCurrency={null} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Display currency' }), 'EUR');

    expect(onChange).toHaveBeenCalledWith('EUR');
  });

  it('should call onChange with null when switching back to the reporting currency', async () => {
    const onChange = vi.fn();
    render(<AnalyticsCurrencyPicker reportingCurrency="PLN" displayCurrency="EUR" onChange={onChange} />);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Display currency' }), '');

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('should not offer the reporting currency as a convert-to option', () => {
    render(<AnalyticsCurrencyPicker reportingCurrency="EUR" displayCurrency={null} onChange={vi.fn()} />);

    expect(screen.queryByRole('option', { name: 'Convert to EUR' })).not.toBeInTheDocument();
  });
});
