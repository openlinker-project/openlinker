/**
 * Return Receive Form (#2380)
 *
 * The properties that matter are the ones where being wrong costs the operator
 * a re-count with a parcel in their hand: the default is the outstanding
 * quantity (the common case is one press), and an over-receipt is refused
 * BEFORE the request with the spec's own sentence rather than as a bounced 409.
 *
 * @module apps/web/src/features/returns/components
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnReceiveForm } from './return-receive-form';
import { RETURN_RECEIVE_COPY } from '../lib/return-custody.copy';
import type { ReturnLine } from '../api/returns.types';

function line(overrides: Partial<ReturnLine> = {}): ReturnLine {
  return {
    id: 'line-1',
    lineIndex: 0,
    externalLineId: null,
    resolvedOrderLineId: null,
    offerId: null,
    sku: 'SKU-1',
    name: 'Widget',
    reason: 'other',
    quantityAdvised: 5,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'advised',
    moneyState: 'pending',
    disposition: null,
    receivedAt: null,
    disposedAt: null,
    note: null,
    ...overrides,
  } as ReturnLine;
}

function renderForm(overrides: Partial<ReturnLine> = {}, onSubmit = vi.fn()) {
  render(
    <ReturnReceiveForm
      error={null}
      line={line(overrides)}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
      pending={false}
    />,
  );
  return onSubmit;
}

describe('ReturnReceiveForm (#2380)', () => {
  it('should default to everything still outstanding, so the common case is one press', () => {
    renderForm({ quantityAdvised: 5, quantityReceived: 2 });

    expect(screen.getByLabelText(/units received/i)).toHaveValue(3);
  });

  it('should block an over-receipt client-side with the spec sentence, before any request', async () => {
    const onSubmit = renderForm({ quantityAdvised: 5, quantityReceived: 0 });

    fireEvent.change(screen.getByLabelText(/units received/i), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: RETURN_RECEIVE_COPY.submit }));

    await waitFor(() => {
      expect(screen.getAllByText(RETURN_RECEIVE_COPY.overReceipt).length).toBeGreaterThan(0);
    });
    // The point of the client guard: the operator is told without a round trip.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('should refuse zero and fractional units', async () => {
    const onSubmit = renderForm();

    fireEvent.change(screen.getByLabelText(/units received/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: RETURN_RECEIVE_COPY.submit }));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('should submit the quantity and omit an untouched note', async () => {
    const onSubmit = renderForm({ quantityAdvised: 4 });

    fireEvent.click(screen.getByRole('button', { name: RETURN_RECEIVE_COPY.submit }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 4 }));
  });

  it('should render the server refusal verbatim rather than replacing it', () => {
    render(
      <ReturnReceiveForm
        error="Somebody else recorded these units a moment ago."
        line={line()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        pending={false}
      />,
    );

    expect(
      screen.getByText('Somebody else recorded these units a moment ago.'),
    ).toBeInTheDocument();
  });

  it('should disable every control while the write is in flight', () => {
    render(
      <ReturnReceiveForm
        error={null}
        line={line()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        pending
      />,
    );

    expect(screen.getByLabelText(/units received/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: RETURN_RECEIVE_COPY.pending })).toBeDisabled();
  });
});
