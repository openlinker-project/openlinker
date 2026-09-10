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

  // #3148 review, finding 7: `Number(raw.replace(',', '.'))` only ever
  // rewrites the FIRST comma, so a thousands-grouped European value parsed
  // to NaN and surfaced the wrong "enter a price greater than 0" error for
  // an otherwise valid number.
  it('accepts a thousands-grouped, comma-decimal price', async () => {
    const { onConfirm } = renderDialog();

    const input = screen.getByLabelText('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '1 234,56');

    expect(screen.queryByText('Enter a price greater than 0.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /publish this price/i }));
    expect(onConfirm).toHaveBeenCalledWith(1234.56);
  });

  it('clamps a manual price to the numeric(14,4) storage precision', async () => {
    const { onConfirm } = renderDialog();

    const input = screen.getByLabelText('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '399.123456');
    await userEvent.click(screen.getByRole('button', { name: /publish this price/i }));

    expect(onConfirm).toHaveBeenCalledWith(399.1235);
  });

  it('marks the price input invalid and describes the error for assistive tech', async () => {
    renderDialog();

    const input = screen.getByLabelText('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '0');

    const error = await screen.findByText('Enter a price greater than 0.');
    expect(error).toHaveAttribute('role', 'alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('links to the connection edit page rather than the not-yet-shipped pricing-sync route (#3148 review, finding 10)', () => {
    renderDialog();

    const link = screen.getByRole('link', { name: /pricing rules/i });
    expect(link).toHaveAttribute('href', '/connections/dest-1/edit');
  });
});
