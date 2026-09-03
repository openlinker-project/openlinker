/**
 * Refund Confirmation Form (#2382, returns spec § 5.7)
 *
 * Three properties, each because its opposite states something false: the label
 * confirms rather than claims, the amount is never proposed, and the currency
 * cannot be typed.
 *
 * @module apps/web/src/features/orders/components
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RefundConfirmationForm } from './refund-confirmation-form';
import { REFUND_CONFIRMATION_COPY } from '../lib/refund-confirmation.copy';

function renderForm(props: Partial<Parameters<typeof RefundConfirmationForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <RefundConfirmationForm
      currency="PLN"
      error={null}
      onSubmit={onSubmit}
      pending={false}
      {...props}
    />,
  );
  return onSubmit;
}

describe('RefundConfirmationForm (#2382)', () => {
  it('should say Confirm refund, never Refund — OpenLinker does not move money', () => {
    renderForm();

    expect(screen.getByRole('button', { name: 'Confirm refund' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Refund$/ })).not.toBeInTheDocument();
    // The preamble carries the reason the label is what it is.
    expect(screen.getByText(/OpenLinker does not move money/)).toBeInTheDocument();
  });

  it('should start the amount EMPTY and never propose one', () => {
    renderForm({ orderTotal: '120.00' });

    // `ReturnLine` carries no price, `resolvedOrderLineId` is populated by
    // nothing, and a sku match is a coincidence — so a proposed figure would be
    // a guess on the one surface where being wrong moves real money.
    expect(screen.getByLabelText(/Amount refunded/)).toHaveValue('');
  });

  it('should render the order total as labelled CONTEXT, not as a value', () => {
    renderForm({ orderTotal: '120.00' });

    const context = screen.getByText(/Order total:/);
    expect(context).toBeInTheDocument();
    expect(context.textContent).toContain('120.00');
    // It must not have leaked into the input.
    expect(screen.getByLabelText(/Amount refunded/)).toHaveValue('');
  });

  it('should show the currency but offer no way to change it', () => {
    renderForm({ currency: 'EUR' });

    expect(screen.getByLabelText(/Amount refunded \(EUR\)/)).toBeInTheDocument();
    // No currency input of any kind: the lock is the only protection, because
    // no refund-side mismatch guard exists anywhere in the tree.
    expect(screen.queryByLabelText(/currency/i)).not.toBeInTheDocument();
  });

  it('should REFUSE entirely when no order currency resolved', () => {
    renderForm({ currency: null });

    // Refused rather than degraded to a typed input: nothing downstream would
    // catch a wrong currency.
    expect(screen.getByText(REFUND_CONFIRMATION_COPY.noCurrency)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm refund' })).not.toBeInTheDocument();
  });

  it('should refuse an amount that is not money-shaped', async () => {
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText(/Amount refunded/), { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('should submit the amount as a STRING, so cents survive', async () => {
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText(/Amount refunded/), { target: { value: '12.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // `numeric(12,2)` on the other end — a float round-trip is how cents vanish.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: '12.50' }));
    expect(typeof onSubmit.mock.calls[0][0].amount).toBe('string');
  });

  it('should disable every control while the write is in flight', () => {
    renderForm({ pending: true });

    expect(screen.getByLabelText(/Amount refunded/)).toBeDisabled();
  });
});
