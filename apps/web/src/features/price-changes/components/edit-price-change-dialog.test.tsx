import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EditPriceChangeDialog } from './edit-price-change-dialog';
import type { PriceChangeItem } from '../api/price-changes.types';

const ITEM: PriceChangeItem = {
  id: 'ep-1',
  productVariantId: 'ol_variant_1',
  productName: 'Ergonomic Office Chair',
  variantLabel: null,
  sku: null,
  sourceConnectionId: 'src-1',
  sourceLabel: 'PrestaShop — Main Store',
  sourceOldAmount: 350,
  sourceNewAmount: 327,
  sourceCurrency: 'PLN',
  destinationConnectionId: 'dest-1',
  destinationLabel: 'Allegro — PL',
  destinationCurrency: 'PLN',
  computedOldAmount: 427,
  computedNewAmount: 399,
  deltaPct: -6.5,
  isSteep: false,
  ruleSummary: { type: 'margin', percent: 22, rounding: 'endingIn99' },
  blockReason: null,
  needsRefresh: false,
  version: '2026-09-10T10:00:00.000Z',
  manualPriceOverride: null,
  resolution: null,
  resolvedAt: null,
  resolvedByUserId: null,
  detectedAt: '2026-09-10T10:00:00.000Z',
};

function renderDialog(onConfirm = vi.fn()): { onConfirm: typeof onConfirm } {
  render(
    <MemoryRouter>
      <EditPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={onConfirm} />
    </MemoryRouter>,
  );
  return { onConfirm };
}

describe('EditPriceChangeDialog', () => {
  it('pre-fills the rule-computed price and confirms it', async () => {
    const { onConfirm } = renderDialog();

    const confirmButton = screen.getByRole('button', { name: /publish this price/i });
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith(399);
  });

  it('shows a blocking error and disables confirm for a non-positive price', async () => {
    renderDialog();

    const input = screen.getByLabelText('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '0');

    expect(await screen.findByText('Enter a price greater than 0.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish this price/i })).toBeDisabled();
  });

  it('shows a non-blocking warning for a >30% deviation but keeps confirm enabled', async () => {
    renderDialog();

    const input = screen.getByLabelText('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '600');

    expect(await screen.findByText(/vs\. the rule price/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /publish this price/i })).not.toBeDisabled();
  });

  it('resets to the rule price via "Use that price"', async () => {
    renderDialog();

    const input = screen.getByLabelText<HTMLInputElement>('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.click(screen.getByText('Use that price'));

    expect(input.value).toBe('399');
  });
});
