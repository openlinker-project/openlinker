import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createAuthenticatedSessionAdapter } from '../../../test/test-utils';
import { createNoopSessionAdapter } from '../../../shared/auth/noop-session-adapter';
import { AcceptPriceChangeDialog } from './accept-price-change-dialog';
import type { PriceChangeItem } from '../api/price-changes.types';

// The opt-in checkbox is admin-only (#3148 review, finding 2), so every test
// below that expects to interact with it renders as an admin session; the
// role-gating itself is asserted separately at the bottom of this file.
const ADMIN_SESSION = createAuthenticatedSessionAdapter();

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
    renderWithProviders(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={onConfirm} />, {
      sessionAdapter: ADMIN_SESSION,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Publish price' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('confirms with optInAutomatic=true once the opt-in checkbox is checked', async () => {
    const onConfirm = vi.fn();
    renderWithProviders(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={onConfirm} />, {
      sessionAdapter: ADMIN_SESSION,
    });

    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('renders the rule sentence, the computed price, and the fixed disclaimer', async () => {
    renderWithProviders(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={vi.fn()} />, {
      sessionAdapter: ADMIN_SESSION,
    });

    expect(await screen.findByText(/22% margin/)).toBeInTheDocument();
    expect(screen.getByText(/That comes to/)).toBeInTheDocument();
    expect(
      screen.getByText(/orders already placed keep the price they were bought at/),
    ).toBeInTheDocument();
  });

  it('never renders the opt-in checkbox for a non-admin session (#3148 review, finding 2)', async () => {
    renderWithProviders(<AcceptPriceChangeDialog item={ITEM} onOpenChange={vi.fn()} onConfirm={vi.fn()} />, {
      sessionAdapter: createNoopSessionAdapter(),
    });

    // Wait on something that only renders once the item is present, so a
    // false negative (checkbox absent merely because nothing rendered yet)
    // can't pass this assertion for the wrong reason.
    await screen.findByText(/22% margin/);
    await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument());
  });
});
