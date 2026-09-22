import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
  sampleConnection,
  findToastTitle,
  findToastDescription,
} from '../../../test/test-utils';
import { mockMobileViewport } from '../../../test/viewport';
import { ApiError } from '../../../shared/api/api-error';
import { PriceChangesQueueTable } from './price-changes-queue-table';
import type { PriceChangeItem, PriceChangeListResponse } from '../api/price-changes.types';
import type { SessionUser } from '../../../shared/auth/session.types';

/** Authenticated, write-capable, NOT admin — see the non-admin checkbox case. */
const OPERATOR_SESSION_USER: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['listings:read', 'listings:write'],
};

// The "also set to Automatic" opt-in is admin-only (#3148 review, finding
// 2), so any test that needs to see/toggle it renders as an admin session.
const ADMIN_SESSION = createAuthenticatedSessionAdapter();

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

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await screen.findByText('Ergonomic Office Chair');

    await userEvent.click(screen.getByTestId('row-accept'));
    await userEvent.click(await screen.findByRole('button', { name: 'Publish price' }));

    // `findToastDescription` (see its docblock in test-utils.tsx) - #3314
    expect(
      await findToastDescription(
        /changed again while you were reviewing — refresh and take another look/,
      ),
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

    // An OPERATOR: carries `listings:write`, so the row actions render, but
    // is not admin, which is the whole subject of this case. The suite-wide
    // default user IS an admin, so passing it here would assert nothing.
    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR_SESSION_USER),
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

    // `findToastDescription` (see its docblock in test-utils.tsx) - #3314
    expect(await findToastDescription(/Kept 1, but 1 failed/)).toBeInTheDocument();
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

    renderWithProviders(<PriceChangesQueueTable />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
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
    // `findToastTitle` (see its docblock in test-utils.tsx) - #3314. The
    // `Undo` action label isn't duplicated by Radix's announcer, so it
    // stays a plain `getAllByText`/`toHaveLength(1)` assertion.
    expect(await findToastTitle('Turned on automatic pricing for 2 sources')).toBeInTheDocument();
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
  describe('chip counts never assert a number the read did not supply (#3164 re-review)', () => {
    it('renders an em dash, not 0, when the counts read fails', async () => {
      const apiClient = createMockApiClient({
        priceChanges: { list: vi.fn().mockRejectedValue(new Error('boom')) },
      });

      renderWithProviders(<PriceChangesQueueTable />, { apiClient });

      const group = await screen.findByRole('group', { name: 'Filter by connection' });
      const allChip = within(group).getByRole('button', { name: /^All/ });
      await waitFor(() => expect(allChip).toHaveTextContent('—'));
      // The point of the fix: a failed read must not read as "zero open
      // episodes", which is a different and usually false claim.
      expect(allChip).not.toHaveTextContent('0');
    });

    it('renders no count at all while the counts read is still in flight', async () => {
      const apiClient = createMockApiClient({
        priceChanges: { list: vi.fn().mockReturnValue(new Promise(() => undefined)) },
      });

      renderWithProviders(<PriceChangesQueueTable />, { apiClient });

      const group = await screen.findByRole('group', { name: 'Filter by connection' });
      const allChip = within(group).getByRole('button', { name: /^All/ });
      expect(allChip.querySelector('.chip__count')).toBeNull();
    });
  });

  describe('DataTable migration — row identity and responsive behaviour (#3237)', () => {
    it('stamps id/data-testid/data-row-id/data-state and the grouping/resolved/flagged classes on the DataTable row', async () => {
      const items = [
        // Same group key (productVariantId + sourceConnectionId + sourceOldAmount
        // + sourceNewAmount) as the third item below — a fanned-out price
        // change published to two destinations.
        buildItem({ id: 'ep-1', destinationConnectionId: 'dest-1', destinationLabel: 'Allegro — PL' }),
        buildItem({
          id: 'ep-2',
          productName: 'Second Product',
          destinationConnectionId: 'dest-2',
          destinationLabel: 'WooCommerce — EU',
        }),
        buildItem({
          id: 'ep-3',
          productName: 'Third Product',
          productVariantId: 'ol_variant_3',
          sourceConnectionId: 'src-3',
          needsRefresh: true,
        }),
      ];
      const apiClient = createMockApiClient({
        priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items, 0, 3)) },
      });

      renderWithProviders(<PriceChangesQueueTable />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
      await screen.findByText('Ergonomic Office Chair');

      const groupStart = document.getElementById('price-change-row-ep-1');
      expect(groupStart).not.toBeNull();
      expect(groupStart).toHaveAttribute('data-testid', 'price-change-row');
      expect(groupStart).toHaveAttribute('data-row-id', 'ep-1');
      expect(groupStart).toHaveAttribute('data-state', 'row-pending');
      expect(groupStart).toHaveClass('is-group-start');
      expect(groupStart).toHaveClass('is-grouped');

      const groupContinuation = document.getElementById('price-change-row-ep-2');
      expect(groupContinuation).not.toBeNull();
      expect(groupContinuation).toHaveClass('is-grouped');
      expect(groupContinuation).not.toHaveClass('is-group-start');
      // The continuation row renders the "Also changes here" content, not
      // the product identity — the one piece of content that actually
      // encodes grouping.
      expect(within(groupContinuation as HTMLElement).getByText(/Also changes here/)).toBeInTheDocument();

      const flaggedRow = document.getElementById('price-change-row-ep-3');
      expect(flaggedRow).not.toBeNull();
      expect(flaggedRow).toHaveAttribute('data-state', 'row-needs-refresh');
      expect(flaggedRow).toHaveClass('is-flagged');
      expect(flaggedRow).not.toHaveClass('is-grouped');
    });

    it('mutes a resolved row and reports its terminal data-state', async () => {
      const items = [buildItem({ id: 'ep-1', resolution: 'ignored', resolvedAt: '2026-09-10T11:00:00.000Z' })];
      const apiClient = createMockApiClient({
        priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items)) },
      });

      renderWithProviders(<PriceChangesQueueTable />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
      await screen.findByText('Ergonomic Office Chair');

      const row = document.getElementById('price-change-row-ep-1');
      expect(row).toHaveClass('is-resolved');
      expect(row).toHaveAttribute('data-state', 'row-ignored');
    });

    it('select-all toggles exactly the selectable rows, never a resolved one (#3164 select-all-visible semantics)', async () => {
      const items = [
        buildItem({ id: 'ep-1' }),
        buildItem({
          id: 'ep-2',
          productName: 'Second Product',
          resolution: 'ignored',
          resolvedAt: '2026-09-10T11:00:00.000Z',
        }),
      ];
      const apiClient = createMockApiClient({
        priceChanges: { list: vi.fn().mockResolvedValue(buildPage(items, 0, 2)) },
      });

      renderWithProviders(<PriceChangesQueueTable />, {
        apiClient,
        sessionAdapter: createAuthenticatedSessionAdapter(),
      });
      await screen.findByText('Ergonomic Office Chair');

      await userEvent.click(screen.getByLabelText('Select all'));

      const checkboxes = screen.getAllByTestId('row-select');
      expect(checkboxes[0]).toBeChecked();
      // The resolved row's checkbox is rendered (disabled) but never
      // selected by "select all" — it isn't in `selectableIds`.
      expect(checkboxes[1]).not.toBeChecked();
      expect(checkboxes[1]).toBeDisabled();
    });

    it('filters via the URL-namespaced queueConn param and requests only that connection', async () => {
      const marketplaceConnection = {
        ...sampleConnection,
        id: 'dest-1',
        name: 'Allegro — PL',
        enabledCapabilities: ['OfferManager'],
      };
      const list = vi.fn().mockResolvedValue(buildPage([buildItem()], 0, 1));
      const apiClient = createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([marketplaceConnection]) },
        priceChanges: { list },
      });

      renderWithProviders(<PriceChangesQueueTable />, { apiClient });
      await screen.findByText('Ergonomic Office Chair');

      await userEvent.click(screen.getByRole('button', { name: /Allegro — PL/ }));

      await waitFor(() => {
        expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: 'dest-1' }));
      });
    });

    describe('mobile card view', () => {
      afterEach(cleanup);

      it('renders identity, the summary facts and the same row actions from the shared cardView', async () => {
        const viewport = mockMobileViewport();
        try {
          const apiClient = createMockApiClient({
            priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])) },
          });

          renderWithProviders(<PriceChangesQueueTable />, {
            apiClient,
            sessionAdapter: createAuthenticatedSessionAdapter(),
          });
          await screen.findByText('Ergonomic Office Chair');

          // No table at all below the breakpoint — proves this content comes
          // from `cardView`, which has no `columns` fallback.
          expect(screen.queryByRole('table')).toBeNull();
          expect(screen.getByTestId('row-select')).toBeInTheDocument();
          expect(screen.getByTestId('row-accept')).toBeInTheDocument();
          expect(screen.getByTestId('row-edit')).toBeInTheDocument();
          expect(screen.getByTestId('row-ignore')).toBeInTheDocument();
          expect(screen.getByText(/Price on this connection/)).toBeInTheDocument();

          // And the actions are wired, not decorative — same dialog flow as desktop.
          await userEvent.click(screen.getByTestId('row-accept'));
          expect(await screen.findByText('Publish new price')).toBeInTheDocument();
        } finally {
          viewport.restore();
        }
      });

      it('gives a resolved episode the same at-a-glance treatment mobile lacked from rowClassName (audit follow-up)', async () => {
        const viewport = mockMobileViewport();
        try {
          const apiClient = createMockApiClient({
            priceChanges: {
              list: vi
                .fn()
                .mockResolvedValue(
                  buildPage([
                    buildItem({ id: 'ep-resolved', resolution: 'ignored', resolvedAt: '2026-09-10T11:00:00.000Z' }),
                  ]),
                ),
            },
          });

          renderWithProviders(<PriceChangesQueueTable />, {
            apiClient,
            sessionAdapter: createAuthenticatedSessionAdapter(),
          });
          await screen.findByText('Ergonomic Office Chair');

          expect(screen.getByTestId('card-status-resolved')).toHaveTextContent('Resolved');
          expect(screen.queryByTestId('card-status-flagged')).not.toBeInTheDocument();
        } finally {
          viewport.restore();
        }
      });

      it('gives a needs-refresh episode the same flagged treatment mobile lacked from rowClassName (audit follow-up)', async () => {
        const viewport = mockMobileViewport();
        try {
          const apiClient = createMockApiClient({
            priceChanges: {
              list: vi.fn().mockResolvedValue(buildPage([buildItem({ needsRefresh: true })])),
            },
          });

          renderWithProviders(<PriceChangesQueueTable />, {
            apiClient,
            sessionAdapter: createAuthenticatedSessionAdapter(),
          });
          await screen.findByText('Ergonomic Office Chair');

          expect(screen.getByTestId('card-status-flagged')).toHaveTextContent('Needs refresh');
          expect(screen.queryByTestId('card-status-resolved')).not.toBeInTheDocument();
        } finally {
          viewport.restore();
        }
      });

      it('renders no status indicator for an ordinary pending episode', async () => {
        const viewport = mockMobileViewport();
        try {
          const apiClient = createMockApiClient({
            priceChanges: { list: vi.fn().mockResolvedValue(buildPage([buildItem()])) },
          });

          renderWithProviders(<PriceChangesQueueTable />, {
            apiClient,
            sessionAdapter: createAuthenticatedSessionAdapter(),
          });
          await screen.findByText('Ergonomic Office Chair');

          expect(screen.queryByTestId('card-status-resolved')).not.toBeInTheDocument();
          expect(screen.queryByTestId('card-status-flagged')).not.toBeInTheDocument();
        } finally {
          viewport.restore();
        }
      });
    });
  });
});
