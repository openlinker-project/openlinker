import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsDateRangeToolbar } from './analytics-date-range-toolbar';

describe('AnalyticsDateRangeToolbar', () => {
  it('should call onApply immediately with the correct dates when a preset is clicked', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={onApply} />);

    await user.click(screen.getByRole('radio', { name: '7d' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    const [calledFrom, calledTo] = onApply.mock.calls[0] as [string, string];
    expect(calledTo <= calledFrom).toBe(false);
  });

  it('should not call onApply when Custom is clicked', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={onApply} />);

    await user.click(screen.getByRole('radio', { name: 'Custom' }));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('should enable Apply only after a date field is edited to a different, complete, valid range', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={onApply} />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    const fromInput = screen.getByLabelText('Order date from');
    await user.clear(fromInput);
    await user.type(fromInput, '2026-03-01');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith('2026-03-01', '2026-08-14');
  });

  it('should keep Apply disabled when the draft range is invalid (From after To)', async () => {
    const user = userEvent.setup();
    render(<AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={vi.fn()} />);

    const toInput = screen.getByLabelText('Order date to');
    await user.clear(toInput);
    await user.type(toInput, '2026-01-01');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('should reset the draft when the committed from/to props change', () => {
    const { rerender } = render(
      <AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={vi.fn()} />
    );

    rerender(<AnalyticsDateRangeToolbar from="2026-01-01" to="2026-01-07" onApply={vi.fn()} />);

    expect(screen.getByLabelText('Order date from')).toHaveValue('2026-01-01');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('should render the "Order date" disclaimer chip', () => {
    render(<AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={vi.fn()} />);

    expect(
      screen.getByText((_content, element) => element?.textContent === 'Order date †')
    ).toBeInTheDocument();
  });

  it('should open the "Order date" caveat on click, via a real button rather than hover-only', async () => {
    const user = userEvent.setup();
    render(<AnalyticsDateRangeToolbar from="2026-07-16" to="2026-08-14" onApply={vi.fn()} />);

    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Order date\. /i }));

    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
