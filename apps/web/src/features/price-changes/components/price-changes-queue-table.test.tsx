import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
  sampleConnection,
} from '../../../test/test-utils';
import { PriceChangesQueueTable } from './price-changes-queue-table';
import type { PriceChangeItem, PriceChangeListResponse } from '../api/price-changes.types';
import type { SessionUser } from '../../../shared/auth/session.types';

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

function buildPage(items: PriceChangeItem[], hiddenStaleCount = 0, total?: number): PriceChangeListResponse {
  return { items, hiddenStaleCount, total: total ?? items.length };
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

    // Every action here is a write, gated on `listings:write` behind
    // `useWriteAccess`/`ReadOnlyLock` (#3164 review) — an admin session so
    // this asserts the enabled shape, not the hidden one.
    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('Ergonomic Office Chair')).toBeInTheDocument();
    expect(screen.getByTestId('row-accept')).toBeInTheDocument();
    expect(screen.getByTestId('row-edit')).toBeInTheDocument();
    expect(screen.getByTestId('row-ignore')).toBeInTheDocument();
  });

  it('accepts a row via the confirm dialog and calls the API with the staleness token', async () => {
    const accept = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])), accept },
    });

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await screen.findByText('Ergonomic Office Chair');

    // Accept no longer fires the API directly (#3164 review) — it opens a
    // confirm dialog first, since it publishes to a live marketplace.
    await userEvent.click(screen.getByTestId('row-accept'));
    expect(accept).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole('button', { name: 'Publish price' }));

    await waitFor(() => {
      expect(accept).toHaveBeenCalledWith('ep-1', { expectedVersion: '2026-09-10T10:00:00.000Z' });
    });
  });

  it('edits a row through the dialog, validating the entered price', async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])), edit },
    });

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await screen.findByText('Ergonomic Office Chair');

    await userEvent.click(screen.getByTestId('row-edit'));
    const input = await screen.findByLabelText(/New price/);

    // An invalid value is refused inline and never reaches the API.
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));
    expect(await screen.findByText('Enter a price greater than 0.')).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, '349.5');
    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));

    await waitFor(() => {
      expect(edit).toHaveBeenCalledWith('ep-1', {
        manualPriceOverride: 349.5,
        expectedVersion: '2026-09-10T10:00:00.000Z',
      });
    });
  });

  it('renders the needs-refresh state with a working Refresh action', async () => {
    const refresh = vi.fn().mockResolvedValue(buildItem({ needsRefresh: false }));
    const apiClient = createMockApiClient({
      priceChanges: {
        list: vi.fn().mockResolvedValue(buildPage([buildItem({ needsRefresh: true })])),
        refresh,
      },
    });

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText(/changed again while you were deciding/);
    expect(screen.queryByTestId('row-accept')).not.toBeInTheDocument();

    // #3162 gives this row a real remedy — Refresh must not be copy with
    // nothing behind it (#3164 review).
    await userEvent.click(screen.getByTestId('row-refresh'));
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledWith('ep-1');
    });
  });

  it('renders an ignored row with an Undo affordance', async () => {
    const apiClient = createMockApiClient({
      priceChanges: {
        list: vi
          .fn()
          .mockResolvedValue(buildPage([buildItem({ resolution: 'ignored', resolvedAt: '2026-09-10T11:00:00.000Z' })])),
      },
    });

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

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
    await userEvent.hover(chip);
    // Radix renders the tooltip content twice (the visible popper content plus
    // a visually-hidden accessible copy) - `findByText` throws on multiple
    // matches, so assert via `findAllByText` instead (the primitive's own
    // `tooltip.test.tsx` does the same).
    const matches = await screen.findAllByText('Big price change - worth a second look');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('treats a rounded-to-zero delta as flat, never "down"', async () => {
    const apiClient = createMockApiClient({
      priceChanges: {
        list: vi.fn().mockResolvedValue(buildPage([buildItem({ deltaPct: -0.4, isSteep: false })])),
      },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });
    const chip = await screen.findByText('0%');
    expect(chip).toHaveClass('delta-chip--flat');
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

  it('reports a partially-failed bulk ignore instead of swallowing it', async () => {
    const ignore = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('nope'));
    const items = [buildItem({ id: 'ep-1' }), buildItem({ id: 'ep-2', productName: 'Second Product' })];
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items, 0, 2)), ignore },
    });

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await screen.findByText('Ergonomic Office Chair');

    const checkboxes = screen.getAllByTestId('row-select');
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);

    await userEvent.click(screen.getByRole('button', { name: 'Keep prices' }));

    expect(await screen.findByText(/Kept 1, but 1 failed/)).toBeInTheDocument();
  });

  it('shows connection chips for both marketplace and shop-write-back destinations, counted from the unfiltered set', async () => {
    const marketplaceConnection = {
      ...sampleConnection,
      id: 'dest-1',
      name: 'Allegro — PL',
      enabledCapabilities: ['OfferManager'],
    };
    const shopConnection = {
      ...sampleConnection,
      id: 'dest-2',
      name: 'WooCommerce — EU Store',
      enabledCapabilities: ['ProductPublisher'],
    };
    const items = [
      buildItem({ id: 'ep-1', destinationConnectionId: 'dest-1', destinationLabel: 'Allegro — PL' }),
      buildItem({ id: 'ep-2', destinationConnectionId: 'dest-2', destinationLabel: 'WooCommerce — EU Store' }),
    ];
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([marketplaceConnection, shopConnection]) },
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items, 0, 2)) },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient });
    await screen.findByText('Ergonomic Office Chair');

    expect(screen.getByRole('button', { name: /Allegro — PL/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /WooCommerce — EU Store/ })).toBeInTheDocument();
  });

  describe('write-access gating (listings:write, useWriteAccess + ReadOnlyLock, #3164 review)', () => {
    const viewerUser: SessionUser = {
      id: 'user_viewer',
      username: 'viewer',
      email: 'viewer@example.com',
      role: 'viewer',
      permissions: ['connections:read', 'listings:read'],
    };

    it('hides every write affordance for a genuinely unauthorized non-demo session (viewer)', async () => {
      const apiClient = createMockApiClient({
        priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])) },
      });

      renderWithProviders(<PriceChangesQueueTable />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(viewerUser),
      });

      await screen.findByText('Ergonomic Office Chair');
      expect(screen.queryByTestId('row-accept')).not.toBeInTheDocument();
      expect(screen.queryByTestId('row-edit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('row-ignore')).not.toBeInTheDocument();
      expect(screen.queryByTestId('row-select')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Select all')).not.toBeInTheDocument();
    });

    it('renders write affordances visible-but-disabled with a demo read-only tooltip', async () => {
      const apiClient = createMockApiClient({
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
        priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])) },
      });

      renderWithProviders(<PriceChangesQueueTable />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(viewerUser),
      });

      await screen.findByText('Ergonomic Office Chair');
      const accept = await screen.findByTestId('row-accept');
      expect(accept).toBeInTheDocument();
      expect(accept).toBeDisabled();
    });
  });
});
