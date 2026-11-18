/**
 * Order sync start field tests (#4228)
 */
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { OrderSyncStartField } from './order-sync-start-field';
import { latestOrderSyncStartDate, type OrderSyncStartValue } from '../lib/order-sync-start';
import type { OrderSyncStartMode } from '../api/connections.types';

function Harness({
  supportedModes = ['now', 'from', 'all'],
  initial = { mode: 'now' },
  onValue,
  error,
}: {
  supportedModes?: OrderSyncStartMode[];
  initial?: OrderSyncStartValue;
  onValue?: (value: OrderSyncStartValue) => void;
  error?: string;
}): ReactElement {
  const [value, setValue] = useState<OrderSyncStartValue>(initial);
  return (
    <OrderSyncStartField
      value={value}
      supportedModes={supportedModes}
      error={error}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

describe('OrderSyncStartField', () => {
  afterEach(cleanup);

  it('preselects only new orders and states what it means', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('radio', { name: /New orders only/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/Orders already in the shop stay there/)).toBeInTheDocument();
  });

  it('reveals a date input capped at yesterday for "from a date"', () => {
    const onValue = vi.fn();
    renderWithProviders(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole('radio', { name: /Orders since a date/ }));
    const input = screen.getByLabelText('First day to import');
    expect(input).toHaveAttribute('max', latestOrderSyncStartDate());
    fireEvent.change(input, { target: { value: '2026-01-05' } });
    expect(onValue).toHaveBeenLastCalledWith({ mode: 'from', from: '2026-01-05' });
    expect(screen.getByText(/are not imported/)).toBeInTheDocument();
  });

  it('shows the field error for a bad date', () => {
    renderWithProviders(<Harness initial={{ mode: 'from', from: '' }} error="Choose a day before today" />);
    expect(screen.getByText('Choose a day before today')).toBeInTheDocument();
  });

  it('warns about the consequences when all history is chosen', () => {
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Every order the shop has/ }));
    expect(screen.getByText('Old orders are handled like new ones')).toBeInTheDocument();
    expect(screen.getByText(/copied again to every connected shop/)).toBeInTheDocument();
  });

  it('keeps an unsupported card visible, disabled, with the reason, and refuses it', () => {
    const onValue = vi.fn();
    renderWithProviders(<Harness supportedModes={['now', 'all']} onValue={onValue} />);
    const card = screen.getByRole('radio', { name: /Orders since a date/ });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/not available for this connection yet/)).toBeInTheDocument();
    fireEvent.click(card);
    expect(onValue).not.toHaveBeenCalled();
  });

  it('moves between enabled cards with the arrow keys, skipping a disabled one', () => {
    renderWithProviders(<Harness supportedModes={['now', 'all']} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /New orders only/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: /Every order the shop has/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
