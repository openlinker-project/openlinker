import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createAuthenticatedSessionAdapter } from '../../../test/test-utils';
import { createNoopSessionAdapter } from '../../../shared/auth/noop-session-adapter';
import { BulkAcceptPriceChangesDialog } from './bulk-accept-price-changes-dialog';
import type { PriceChangeItem } from '../api/price-changes.types';

const ADMIN_SESSION = createAuthenticatedSessionAdapter();

function buildItem(overrides: Partial<PriceChangeItem> = {}): PriceChangeItem {
  return {
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
    ...overrides,
  };
}

describe('BulkAcceptPriceChangesDialog', () => {
  it('dedups the opt-in checkbox to one per DISTINCT (source, destination) pair', async () => {
    const items = [
      buildItem({ id: 'ep-1' }),
      // Same (source, destination) pair as ep-1 — a grouped sibling, must
      // not render a second checkbox for the same pair.
      buildItem({ id: 'ep-2', productName: 'Second Product' }),
      // A different destination — its own, third distinct pair.
      buildItem({
        id: 'ep-3',
        productName: 'Third Product',
        destinationConnectionId: 'dest-2',
        destinationLabel: 'WooCommerce — EU Store',
      }),
    ];

    renderWithProviders(
      <BulkAcceptPriceChangesDialog items={items} open isConfirming={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
      { sessionAdapter: ADMIN_SESSION },
    );

    await screen.findByText('Ergonomic Office Chair');
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('reports only the CHECKED pairs to onConfirm, not every distinct pair', async () => {
    const onConfirm = vi.fn();
    const items = [
      buildItem({ id: 'ep-1' }),
      buildItem({
        id: 'ep-2',
        productName: 'Second Product',
        destinationConnectionId: 'dest-2',
        destinationLabel: 'WooCommerce — EU Store',
      }),
    ];

    renderWithProviders(
      <BulkAcceptPriceChangesDialog items={items} open isConfirming={false} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
      { sessionAdapter: ADMIN_SESSION },
    );

    await screen.findByText('Ergonomic Office Chair');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);

    await userEvent.click(checkboxes[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Publish prices' }));

    expect(onConfirm).toHaveBeenCalledWith(new Set(['src-1:dest-1']));
  });

  it('renders no opt-in checkbox at all for a non-admin session (#3148 review, finding 2)', async () => {
    const items = [buildItem()];

    renderWithProviders(
      <BulkAcceptPriceChangesDialog items={items} open isConfirming={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
      { sessionAdapter: createNoopSessionAdapter() },
    );

    await screen.findByText('Ergonomic Office Chair');
    await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument());
  });

  it('renders per-item thumbnails from a name with irregular spacing without an empty chip (#3148 review, finding 8)', async () => {
    const items = [buildItem({ productName: ' Ergonomic  Office Chair' })];

    renderWithProviders(
      <BulkAcceptPriceChangesDialog items={items} open isConfirming={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
      { sessionAdapter: ADMIN_SESSION },
    );

    expect(await screen.findByText('EO')).toBeInTheDocument();
  });
});
