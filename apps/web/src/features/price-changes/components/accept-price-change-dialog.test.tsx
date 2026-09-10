import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AcceptPriceChangeDialog } from './accept-price-change-dialog';
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

describe('AcceptPriceChangeDialog', () => {
  it('confirms with optInAutomatic=false by default', async () => {
    const onConfirm = vi.fn();
    render(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('confirms with optInAutomatic=true once the opt-in checkbox is checked', async () => {
    const onConfirm = vi.fn();
    render(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('renders the rule sentence and the fixed disclaimer', () => {
    render(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByText(/22% margin/)).toBeInTheDocument();
    expect(
      screen.getByText(/orders already placed keep the price they were bought at/),
    ).toBeInTheDocument();
  });
});
