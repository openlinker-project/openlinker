/**
 * Return Dispose Form (#2380)
 *
 * The property this file exists for is § 5.3's: **where the stock goes is
 * named, not implied.** The three non-resolved arms matter as much as the
 * resolved one — an ambiguous master is a BLOCKED restock, so naming a
 * candidate there would promise a write OpenLinker has already decided to
 * refuse.
 *
 * @module apps/web/src/features/returns/components
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnDisposeForm } from './return-dispose-form';
import { RETURN_DISPOSE_COPY } from '../lib/return-custody.copy';
import type { ReturnLine, ReturnRestockTarget } from '../api/returns.types';

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
    quantityReceived: 4,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'received',
    moneyState: 'pending',
    disposition: null,
    receivedAt: '2026-08-01T00:00:00Z',
    disposedAt: null,
    note: null,
    ...overrides,
  } as ReturnLine;
}

const resolved: ReturnRestockTarget = {
  status: 'resolved',
  connectionId: 'conn-1',
  connectionName: 'Warehouse PrestaShop',
  candidateCount: null,
};

function renderForm(
  target: ReturnRestockTarget = resolved,
  overrides: {
    line?: Partial<ReturnLine>;
    isOrphan?: boolean;
    onSubmit?: (input: {
      quantity: number;
      disposition: 'restock' | 'scrap';
      note?: string;
    }) => void;
  } = {},
) {
  const onSubmit = vi.fn(overrides.onSubmit);
  render(
    <ReturnDisposeForm
      error={null}
      isOrphan={overrides.isOrphan ?? false}
      line={line(overrides.line)}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
      pending={false}
      restockTarget={target}
    />,
  );
  return onSubmit;
}

describe('ReturnDisposeForm (#2380)', () => {
  it('should name the connection the stock will land in', () => {
    renderForm();

    expect(screen.getByText('Stock will be added in Warehouse PrestaShop.')).toBeInTheDocument();
  });

  it('should NOT name a candidate when several masters claim the stock', () => {
    renderForm({
      status: 'ambiguous-inventory-master',
      connectionId: null,
      connectionName: null,
      candidateCount: 3,
    });

    // The restock will be refused, so a destination must not be promised.
    expect(screen.queryByText(/Stock will be added in/)).not.toBeInTheDocument();
    expect(screen.getByText(/3 connections claim to own your stock/)).toBeInTheDocument();
  });

  it('should say plainly when no connection owns the stock, and still allow scrapping', () => {
    renderForm({
      status: 'no-inventory-master',
      connectionId: null,
      connectionName: null,
      candidateCount: null,
    });

    expect(screen.getByRole('radio', { name: /restock/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /scrap/i })).not.toBeDisabled();
  });

  it('should not default to an option that cannot be submitted', () => {
    renderForm({
      status: 'no-inventory-master',
      connectionId: null,
      connectionName: null,
      candidateCount: null,
    });

    expect(screen.getByRole('radio', { name: /scrap/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('should state the orphan block up front rather than let it bounce off a 409', () => {
    renderForm(resolved, { isOrphan: true });

    expect(screen.getByText(RETURN_DISPOSE_COPY.orphanBlocked)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /restock/i })).toBeDisabled();
  });

  it('should default to the units received but not yet dealt with', () => {
    renderForm(resolved, { line: { quantityReceived: 4, quantityRestocked: 1, quantityScrapped: 1 } });

    expect(screen.getByLabelText(/^units$/i)).toHaveValue(2);
  });

  it('should block an over-disposition client-side', async () => {
    const onSubmit = renderForm(resolved, { line: { quantityReceived: 2 } });

    fireEvent.change(screen.getByLabelText(/^units$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: RETURN_DISPOSE_COPY.submit }));

    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
  });

  it('should show the explanation of whichever option is selected', () => {
    renderForm();

    expect(screen.getByText(RETURN_DISPOSE_COPY.restockHelp)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /scrap/i }));

    expect(screen.getByText(RETURN_DISPOSE_COPY.scrapHelp)).toBeInTheDocument();
    // The destination sentence belongs to restock only — a scrap changes no stock.
    expect(screen.queryByText(/Stock will be added in/)).not.toBeInTheDocument();
  });
});
