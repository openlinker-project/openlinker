/**
 * Order sync start field tests (#4228)
 */
import { useState, type ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
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
  windowImport = true,
}: {
  windowImport?: boolean;
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
      windowImport={windowImport}
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
      'true'
    );
    expect(screen.getByText(/You can change this later/)).toBeInTheDocument();
    expect(screen.queryByText(/Orders already in the shop stay there and are not imported/)).toBeNull();
  });

  it('should show a note for the chosen card only when the mode changes', () => {
    renderWithProviders(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Every order the shop has/ }));
    expect(screen.queryByText(/You can change this later/)).toBeNull();
    expect(screen.queryByText(/are not imported/)).toBeNull();
  });

  it('should word the cards for a source system when sourceKind is system', () => {
    renderWithProviders(
      <OrderSyncStartField
        value={{ mode: 'now' }}
        supportedModes={['now', 'from', 'all']}
        sourceKind="system"
        onChange={() => undefined}
      />
    );
    expect(screen.getByRole('radio', { name: /Every order in the source system/ })).toBeInTheDocument();
    expect(screen.queryByText(/Every order the shop has/)).toBeNull();
  });

  it('should show a visible long-import warning on the every-order card', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText(/Can take a long time with many orders/)).toBeVisible();
    expect(screen.getByRole('radio', { name: /Every order the shop has/ })).toHaveAccessibleDescription(
      /Can take a long time/
    );
  });

  it('should label the radio group by its heading and mark the default card recommended', () => {
    renderWithProviders(<Harness />);
    expect(
      screen.getByRole('radiogroup', { name: 'Which orders should OpenLinker import?' })
    ).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });

  it('should set the section apart in one-page forms when separated', () => {
    const { container } = renderWithProviders(
      <OrderSyncStartField
        value={{ mode: 'now' }}
        supportedModes={['now']}
        separated
        onChange={() => undefined}
      />
    );
    expect(container.querySelector('.order-sync-start--separated')).not.toBeNull();
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
    renderWithProviders(
      <Harness initial={{ mode: 'from', from: '' }} error="Choose a day before today" />
    );
    expect(screen.getByText('Choose a day before today')).toBeInTheDocument();
  });

  it('should not label cards with a Slow badge', () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText('Slow')).not.toBeInTheDocument();
  });

  it('explains the consequences of all history in a warning popover behind the icon', async () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText('Old orders are handled like new ones')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'What happens to old orders' }));
    expect(await screen.findByText('Old orders are handled like new ones')).toBeInTheDocument();
    expect(screen.getByText(/copied again to every connected shop/)).toBeInTheDocument();
    expect(screen.getByText(/Want exact analytics over your whole history/)).toBeInTheDocument();
  });

  it('explains why new orders only is recommended, and the analytics trade-off', async () => {
    renderWithProviders(<Harness />);
    expect(screen.queryByText('Why we recommend this')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Why this is recommended' }));
    expect(await screen.findByText('Why we recommend this')).toBeInTheDocument();
    expect(screen.getByText(/You still have to import every order/)).toBeInTheDocument();
  });

  it('closes the warning on Escape and leaves the card choice alone', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Harness onValue={onValue} />);
    const icon = screen.getByRole('button', { name: 'What happens to old orders' });
    fireEvent.focus(icon);
    expect(await screen.findByText('Old orders are handled like new ones')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onValue).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('Old orders are handled like new ones')).not.toBeInTheDocument()
    );
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
    fireEvent.keyDown(screen.getByRole('radio', { name: /New orders only/ }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('radio', { name: /Every order the shop has/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  describe('import order step', () => {
    it('should not offer an order for new orders only', () => {
      renderWithProviders(<Harness />);
      expect(screen.queryByText('Which orders come first?')).not.toBeInTheDocument();
    });

    it('should let the operator pick newest first for the whole history', () => {
      const onValue = vi.fn();
      renderWithProviders(<Harness initial={{ mode: 'all' }} onValue={onValue} />);
      fireEvent.click(screen.getByRole('radio', { name: /Newest first/ }));
      expect(onValue).toHaveBeenLastCalledWith({ mode: 'all', order: 'newest-first' });
    });

    it('should keep the chosen order when the range changes between a date and all', () => {
      const onValue = vi.fn();
      renderWithProviders(
        <Harness initial={{ mode: 'all', order: 'newest-first' }} onValue={onValue} />
      );
      fireEvent.click(screen.getByRole('radio', { name: /Orders since a date/ }));
      expect(onValue).toHaveBeenLastCalledWith({ mode: 'from', from: '', order: 'newest-first' });
      fireEvent.click(screen.getByRole('radio', { name: /New orders only/ }));
      expect(onValue).toHaveBeenLastCalledWith({ mode: 'now' });
    });

    it('should keep newest first when a date is typed', () => {
      const onValue = vi.fn();
      renderWithProviders(
        <Harness initial={{ mode: 'from', from: '', order: 'newest-first' }} onValue={onValue} />
      );
      fireEvent.change(screen.getByLabelText('First day to import'), {
        target: { value: '2026-01-05' },
      });
      expect(onValue).toHaveBeenLastCalledWith({
        mode: 'from',
        from: '2026-01-05',
        order: 'newest-first',
      });
    });

    it('should move focus with the arrow keys between the two orders', () => {
      renderWithProviders(<Harness initial={{ mode: 'all' }} />);
      const oldest = screen.getByRole('radio', { name: /Oldest first/ });
      oldest.focus();
      fireEvent.keyDown(oldest, { key: 'ArrowDown' });
      const newest = screen.getByRole('radio', { name: /Newest first/ });
      expect(newest).toHaveAttribute('aria-checked', 'true');
      expect(newest).toHaveFocus();
    });

    it('should show newest first as unavailable, and refuse it, for a source that cannot', () => {
      const onValue = vi.fn();
      renderWithProviders(
        <Harness initial={{ mode: 'all' }} onValue={onValue} windowImport={false} />
      );
      const card = screen.getByRole('radio', { name: /Newest first/ });
      expect(card).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText(/Not available for this connection yet/)).toBeInTheDocument();
      fireEvent.click(card);
      expect(onValue).not.toHaveBeenCalled();
    });
  });
});
