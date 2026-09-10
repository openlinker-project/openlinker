import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { PriceChangesQueueTable } from './price-changes-queue-table';
import type { PriceChangeItem, PriceChangeListResponse } from '../api/price-changes.types';

function buildItem(overrides: Partial<PriceChangeItem> = {}): PriceChangeItem {
  return {
    id: 'ep-1',
    productVariantId: 'ol_variant_1',
    productName: 'Ergonomic Office Chair',
    variantLabel: 'Graphite / L',
    sku: 'OFC-GRA-L',
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

function buildPage(items: PriceChangeItem[], hiddenStaleCount = 0): PriceChangeListResponse {
  return { items, hiddenStaleCount };
}

describe('PriceChangesQueueTable', () => {
  it('shows the empty state when there are no open episodes', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([])) },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });

    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('renders a pending row with accept/edit/ignore actions', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])) },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });

    expect(await screen.findByText('Ergonomic Office Chair')).toBeInTheDocument();
    expect(screen.getByTestId('row-accept')).toBeInTheDocument();
    expect(screen.getByTestId('row-edit')).toBeInTheDocument();
    expect(screen.getByTestId('row-ignore')).toBeInTheDocument();
  });

  it('accepts a row and calls the API with the staleness token', async () => {
    const accept = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])), accept },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });
    await screen.findByText('Ergonomic Office Chair');

    await userEvent.click(screen.getByTestId('row-accept'));

    await waitFor(() => {
      expect(accept).toHaveBeenCalledWith('ep-1', { expectedVersion: '2026-09-10T10:00:00.000Z' });
    });
  });

  it('renders the needs-refresh state with no action buttons', async () => {
    const apiClient = createMockApiClient({
      priceChanges: {
        list: vi.fn().mockResolvedValue(buildPage([buildItem({ needsRefresh: true })])),
      },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });

    await screen.findByText(/changed again while you were deciding/);
    expect(screen.queryByTestId('row-accept')).not.toBeInTheDocument();
  });

  it('renders an ignored row with an Undo affordance', async () => {
    const apiClient = createMockApiClient({
      priceChanges: {
        list: vi
          .fn()
          .mockResolvedValue(buildPage([buildItem({ resolution: 'ignored', resolvedAt: '2026-09-10T11:00:00.000Z' })])),
      },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });

    expect(await screen.findByTestId('row-ignored')).toBeInTheDocument();
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('marks the steep tooltip copy verbatim, with no margin/profit language', async () => {
    const apiClient = createMockApiClient({
      priceChanges: {
        list: vi.fn().mockResolvedValue(buildPage([buildItem({ deltaPct: -15, isSteep: true })])),
      },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });
    await screen.findByText('Ergonomic Office Chair');

    const chip = screen.getByText('-15%');
    expect(chip).toHaveAttribute('title', 'Big price change - worth a second look');
  });

  it('shows the stale-hidden note when hiddenStaleCount is positive', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()], 1)) },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });

    expect(await screen.findByText(/isn't shown here because that listing is paused/)).toBeInTheDocument();
  });

  it('shows an error state with a retry action on a failed fetch', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });

    expect(await screen.findByText("Couldn't load price changes")).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});
