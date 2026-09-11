import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
  sampleConnection,
} from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { PriceChangesQueueTable } from './price-changes-queue-table';
import type { PriceChangeItem, PriceChangeListResponse } from '../api/price-changes.types';
import type { SessionUser } from '../../../shared/auth/session.types';

// The "also set to Automatic" opt-in is admin-only (#3148 review, finding
// 2), so any test that needs to see/toggle it renders as an admin session.
const ADMIN_SESSION = createAuthenticatedSessionAdapter();

// Write-capable but NOT admin (#3164 review's write-access gating, reconciled
// here with the #3148 dialog tests during the #3147 rebase): `listings:write`
// is what makes row actions/checkboxes render at all, while the admin-only
// "also set to Automatic" checkbox is gated on role alone (`useIsAdmin`), not
// on this permission — this fixture is what lets a test exercise the former
// while asserting the absence of the latter.
const OPERATOR_SESSION = createAuthenticatedSessionAdapter({
  id: 'user_operator',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['connections:read', 'listings:read', 'listings:write'],
});

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

  it('opens the accept dialog and calls the API with the staleness token on confirm (#3148)', async () => {
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
    expect(await screen.findByText('Publish new price')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));

    await waitFor(() => {
      expect(accept).toHaveBeenCalledWith('ep-1', {
        expectedVersion: '2026-09-10T10:00:00.000Z',
        optInAutomatic: false,
      });
    });
  });

  it('shows clean, actionable copy instead of a raw backend message on a stale-version conflict (#3148 review, finding 9)', async () => {
    const accept = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          'Price change episode ep-1 changed since it was last read (expected version …, current …)',
          409,
          null,
        ),
      );
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])), accept },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient, sessionAdapter: ADMIN_SESSION });
    await screen.findByText('Ergonomic Office Chair');

    await userEvent.click(screen.getByTestId('row-accept'));
    await userEvent.click(await screen.findByRole('button', { name: 'Publish price' }));

    expect(
      await screen.findByText(/changed again while you were reviewing — refresh and take another look/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/expected version/)).not.toBeInTheDocument();
  });

  it('opts a source into automatic mode on accept and shows an Undo toast that reverts it (#3148)', async () => {
    const accept = vi.fn().mockResolvedValue(undefined);
    // A second, non-custom-override source (#3148 review, finding 1) — an
    // undo built from every `effective` value regardless of
    // `isCustomOverride` would stamp an explicit override onto this row too,
    // even though it was only ever inheriting the destination default.
    const get = vi.fn().mockResolvedValue({
      default: { mode: 'manual', rule: { type: 'passthrough', percent: 0, rounding: 'none' } },
      sources: [
        {
          sourceConnectionId: 'src-2',
          sourceLabel: 'WooCommerce — EU',
          isCustomOverride: false,
          effective: { mode: 'automatic', rule: { type: 'markup', percent: 15, rounding: 'none' } },
          openEpisodeCount: 0,
        },
      ],
    });
    const update = vi.fn().mockResolvedValue({});
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])), accept },
      pricingSync: { get, update },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient, sessionAdapter: ADMIN_SESSION });
    await screen.findByText('Ergonomic Office Chair');

    await userEvent.click(screen.getByTestId('row-accept'));
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Publish price' }));

    await waitFor(() => {
      expect(accept).toHaveBeenCalledWith('ep-1', expect.objectContaining({ optInAutomatic: true }));
    });

    const undoButton = await screen.findByText('Undo');
    await userEvent.click(undoButton);

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        'dest-1',
        expect.objectContaining({
          // ONLY `src-1` (the pair being changed) — `src-2`'s non-custom
          // entry must never be re-sent as an explicit override.
          sourceOverrides: { 'src-1': { mode: 'manual', rule: { type: 'passthrough', percent: 0, rounding: 'none' } } },
        }),
      );
    });
  });

  it('never renders the "also set to Automatic" checkbox for a non-admin session (#3148 review, finding 2)', async () => {
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])) },
    });

    // Write-capable (so the row's Accept button renders at all — #3164
    // review's write-access gating, reconciled here during the #3147
    // rebase), but deliberately NOT admin, since that is the exact
    // distinction this test asserts (`useIsAdmin()`, independent of the
    // `listings:write` permission).
    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: OPERATOR_SESSION,
    });
    await screen.findByText('Ergonomic Office Chair');

    await userEvent.click(screen.getByTestId('row-accept'));
    await screen.findByText('Publish new price');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('opens the edit dialog and publishes a manual override (#3148)', async () => {
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
    expect(await screen.findByText('Enter your own price')).toBeInTheDocument();

    const input = screen.getByLabelText('Price to publish');
    await userEvent.clear(input);
    await userEvent.type(input, '420');
    await userEvent.click(screen.getByRole('button', { name: 'Publish this price' }));

    await waitFor(() => {
      expect(edit).toHaveBeenCalledWith('ep-1', {
        manualPriceOverride: 420,
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

  it('opens the bulk accept dialog and mounts live publish progress on confirm', async () => {
    const bulkAccept = vi.fn().mockResolvedValue({ batchId: 'batch-1' });
    const items = [buildItem({ id: 'ep-1' }), buildItem({ id: 'ep-2', productName: 'Second Product' })];
    const getBulkBatch = vi.fn().mockResolvedValue({
      id: 'batch-1',
      connectionId: 'dest-1',
      status: 'completed',
      totalCount: 2,
      succeededCount: 2,
      failedCount: 0,
      createdAt: '2026-09-10T10:00:00.000Z',
      updatedAt: '2026-09-10T10:05:00.000Z',
      records: [],
    });
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items, 0, 2)), bulkAccept },
      listings: { getBulkBatch },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient, sessionAdapter: ADMIN_SESSION });
    await screen.findByText('Ergonomic Office Chair');

    const checkboxes = screen.getAllByTestId('row-select');
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Accept selected' }));

    expect(await screen.findByText(/Publish 2 price changes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish prices' }));

    await waitFor(() => {
      expect(bulkAccept).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Published 2 of 2 prices/)).toBeInTheDocument();
  });

  it('aggregates the automatic opt-in Undo into ONE toast for a bulk accept (#3148 review, finding 2)', async () => {
    const bulkAccept = vi.fn().mockResolvedValue({ batchId: 'batch-1' });
    const items = [
      buildItem({ id: 'ep-1' }),
      buildItem({
        id: 'ep-2',
        productName: 'Second Product',
        sourceConnectionId: 'src-2',
        sourceLabel: 'WooCommerce — EU',
        destinationConnectionId: 'dest-2',
        destinationLabel: 'Erli — PL',
      }),
    ];
    const getBulkBatch = vi.fn().mockResolvedValue({
      id: 'batch-1',
      connectionId: 'dest-1',
      status: 'running',
      totalCount: 2,
      succeededCount: 0,
      failedCount: 0,
      createdAt: '2026-09-10T10:00:00.000Z',
      updatedAt: '2026-09-10T10:05:00.000Z',
      records: [],
    });
    const apiClient = createMockApiClient({
      priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items, 0, 2)), bulkAccept },
      listings: { getBulkBatch },
    });

    renderWithProviders(<PriceChangesQueueTable />, { apiClient, sessionAdapter: ADMIN_SESSION });
    await screen.findByText('Ergonomic Office Chair');

    const checkboxes = screen.getAllByTestId('row-select');
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Accept selected' }));

    await screen.findByText(/Publish 2 price changes/);
    // Scoped to the opt-in label text — the underlying table's own
    // select-all/row-select checkboxes are still in the DOM behind the
    // dialog and would otherwise be picked up by an unscoped query.
    const optInBoxes = screen.getAllByRole('checkbox', { name: /Also set/ });
    await userEvent.click(optInBoxes[0]);
    await userEvent.click(optInBoxes[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Publish prices' }));

    await waitFor(() => {
      expect(bulkAccept).toHaveBeenCalled();
    });

    // ONE toast naming both sources, not two independent ones.
    expect(await screen.findByText('Turned on automatic pricing for 2 sources')).toBeInTheDocument();
    expect(screen.getAllByText('Undo')).toHaveLength(1);
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
