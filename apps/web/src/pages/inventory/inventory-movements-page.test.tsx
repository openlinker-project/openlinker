import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import { createAuthenticatedSessionAdapter, createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { InventoryMovementsPage } from './inventory-movements-page';
import type { InventoryMovementRow } from '../../features/inventory/api/inventory-movements.types';
import { stockVariantFixture, stockViewFixture } from '../../features/inventory/testing/stock-view-fixtures';

function row(overrides: Partial<InventoryMovementRow> = {}): InventoryMovementRow {
  return {
    kind: 'movement',
    id: 'm1',
    productId: 'ol_product_1',
    productVariantId: 'ol_variant_1',
    sku: 'KUB-350-BIA',
    productName: 'Kubek',
    locationId: null,
    sourceConnectionId: null,
    reason: 'sale',
    status: 'applied',
    quantityDelta: -1,
    quantityBefore: 10,
    quantityAfter: 9,
    sourceKind: 'order',
    sourceRef: 'ol_order_1',
    operatorReason: null,
    note: null,
    actorUserId: null,
    actorName: null,
    refusalReason: null,
    refusalDetail: null,
    occurredAt: '2026-09-26T08:41:00.000Z',
    ...overrides,
  };
}

function renderMovements(options: {
  apiClient: ReturnType<typeof createMockApiClient>;
  route?: string;
  sessionAdapter?: SessionAdapter;
}): void {
  renderWithProviders(<InventoryMovementsPage />, {
    ...options,
    sessionAdapter: options.sessionAdapter ?? createAuthenticatedSessionAdapter(),
  });
}

const PACKER = createAuthenticatedSessionAdapter({
  id: 'user_p',
  username: 'packer',
  email: 'packer@example.com',
  role: 'packer',
  permissions: ['bench:write'],
});

const page = (items: InventoryMovementRow[]): { items: InventoryMovementRow[]; limit: number; offset: number } => ({ items, limit: 20, offset: 0 });

describe('InventoryMovementsPage', () => {
  afterEach(cleanup);

  it('should render rows and the exact count inferred from a short page', async () => {
    const countMovements = vi.fn();
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi.fn().mockResolvedValue(page([row(), row({ id: 'm2', sourceRef: 'ol_order_2' })])),
        countMovements,
      },
    });
    renderMovements({ apiClient });

    expect(await screen.findAllByTestId('stock-movement-row')).toHaveLength(2);
    expect(screen.getByTestId('stock-movements-count')).toHaveTextContent('2 results');
    // Only the problem line's own count may be asked for; the page total is inferred.
    for (const [filters] of countMovements.mock.calls) {
      expect(filters).toEqual(expect.objectContaining({ needsAttention: true }));
    }
  });

  it('should never render a missing total as 0 while the count is pending', async () => {
    const items = Array.from({ length: 20 }, (_, i) => row({ id: `m${i}`, sourceRef: `ol_order_${i}` }));
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi.fn().mockResolvedValue(page(items)),
        countMovements: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });
    renderMovements({ apiClient });

    await screen.findAllByTestId('stock-movement-row');
    expect(screen.getByTestId('stock-movements-count')).toHaveTextContent('20+ results');
    expect(screen.getByTestId('stock-movements-count')).not.toHaveTextContent(/\b0 results/);
  });

  it('should show the empty state and clear filters', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderMovements({ apiClient, route: '/inventory/movements?type=manual_correction' });

    expect(await screen.findByTestId('stock-movements-empty')).toBeInTheDocument();
    expect(listMovements).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: ['manual_correction'], kind: 'movements' }),
      { limit: 20, offset: 0 },
    );
    await userEvent.click(screen.getByTestId('stock-movements-clear-filters'));
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'all', reasons: undefined }), {
        limit: 20,
        offset: 0,
      }),
    );
  });

  it('should read filters from the URL and write the type filter back to it', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([row()]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderMovements({ apiClient, route: '/inventory/movements?from=2026-09-19' });

    await screen.findAllByTestId('stock-movement-row');
    expect(screen.getByTestId('stock-movements-filters-button')).toHaveTextContent('Filters (1)');
    await userEvent.click(screen.getByTestId('stock-movements-filters-button'));
    expect(await screen.findByTestId('stock-movements-filter-from')).toHaveValue('2026-09-19');
    await userEvent.selectOptions(screen.getByTestId('stock-movements-filter-type'), 'return_restock');
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(
        expect.objectContaining({ reasons: ['return_restock'], from: new Date(2026, 8, 19, 0, 0, 0, 0).toISOString() }),
        expect.anything(),
      ),
    );
  });

  it('should show how many changes need a look and open that view from the problem line', async () => {
    const countMovements = vi.fn().mockResolvedValue({ total: 2 });
    const listMovements = vi.fn().mockResolvedValue(page([row()]));
    const apiClient = createMockApiClient({ inventory: { listMovements, countMovements } });
    renderMovements({ apiClient });

    const line = await screen.findByTestId('stock-movements-problems');
    expect(line).toHaveTextContent('2 changes need a look');
    expect(countMovements).toHaveBeenCalledWith(expect.objectContaining({ needsAttention: true }), expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(
        expect.objectContaining({ needsAttention: true }),
        expect.anything(),
      ),
    );
    expect(screen.queryByTestId('stock-movements-problems')).not.toBeInTheDocument();
  });

  it('should not show a problem line when the count fails', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi.fn().mockResolvedValue(page([row()])),
        countMovements: vi.fn().mockRejectedValue(new Error('boom')),
      },
    });
    renderMovements({ apiClient });

    await screen.findAllByTestId('stock-movement-row');
    expect(screen.queryByTestId('stock-movements-problems')).not.toBeInTheDocument();
  });

  it('should read a refused change as not applied, with its badge', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi
          .fn()
          .mockResolvedValue(page([row({ id: 'a', status: 'refused', quantityAfter: null })])),
      },
    });
    renderMovements({ apiClient, route: '/inventory/movements?chip=attention' });

    const refused = await screen.findByTestId('stock-movement-row');
    expect(refused).toHaveAttribute('data-movement-status', 'refused');
    expect(refused).toHaveTextContent('Refused');
    expect(screen.getByTestId('stock-movement-result')).toHaveTextContent('not applied');
  });

  it('should collapse one order on several products into one line and expand it', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi
          .fn()
          .mockResolvedValue(page([row(), row({ id: 'm2', productName: 'Talerz', sku: 'TAL-1' })])),
      },
    });
    renderMovements({ apiClient });

    const group = await screen.findByTestId('stock-movement-group');
    expect(group).toHaveTextContent('Order ol_order_1 sold 2 products');
    expect(screen.queryByTestId('stock-movement-row')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Order ol_order_1 sold 2 products/ }));
    expect(await screen.findAllByTestId('stock-movement-row')).toHaveLength(2);
  });

  it('should explain a row in the detail panel when it is opened', async () => {
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row({ sourceLabel: '#11' })])) },
    });
    renderMovements({ apiClient });

    const sale = await screen.findByTestId('stock-movement-row');
    expect(sale).toHaveTextContent('Sold in order #11');
    await userEvent.click(sale);
    const detail = await screen.findByTestId('stock-movement-detail');
    expect(detail).toHaveTextContent('On hand before');
    expect(detail).toHaveTextContent('10');
    expect(detail).toHaveTextContent('On hand now');
    expect(screen.getByText('Order #11 took 1 unit')).toBeInTheDocument();
  });

  it('should list what was sent to each channel for an opened change (#4063)', async () => {
    const listMovementPushes = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'p1',
          connectionId: 'ol_conn_1',
          externalOfferId: 'offer-1',
          quantity: 9,
          outcome: 'sent',
          errorCode: null,
          message: null,
          pushedAt: '2026-09-26T08:41:05.000Z',
        },
        {
          id: 'p2',
          connectionId: 'ol_conn_1',
          externalOfferId: 'offer-2',
          quantity: 9,
          outcome: 'failed',
          errorCode: 'unknown',
          message: 'Offer is closed',
          pushedAt: '2026-09-26T08:41:06.000Z',
        },
      ],
    });
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row()])), listMovementPushes },
    });
    renderMovements({ apiClient });

    await userEvent.click(await screen.findByTestId('stock-movement-row'));
    const pushes = await screen.findByTestId('stock-movement-pushes');
    expect(listMovementPushes).toHaveBeenCalledWith('m1');
    expect(pushes).toHaveTextContent('Sent');
    expect(pushes).toHaveTextContent('Not sent');
    expect(pushes).toHaveTextContent('Offer is closed');
  });

  it('should say nothing was sent, and not that the read failed, for an empty push list', async () => {
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row()])) },
    });
    renderMovements({ apiClient });

    await userEvent.click(await screen.findByTestId('stock-movement-row'));
    expect(await screen.findByText('Nothing was sent to a channel for this change.')).toBeInTheDocument();
  });

  it('should say the read failed rather than that nothing was sent', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi.fn().mockResolvedValue(page([row()])),
        listMovementPushes: vi.fn().mockRejectedValue(new Error('boom')),
      },
    });
    renderMovements({ apiClient });

    await userEvent.click(await screen.findByTestId('stock-movement-row'));
    expect(await screen.findByText('Could not load what was sent to channels.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing was sent to a channel for this change.')).not.toBeInTheDocument();
  });

  it('should flag a channel that shows a different number than was last sent (#4063)', async () => {
    const variant = stockVariantFixture({
      productVariantId: 'ol_variant_1',
      sku: 'KUB-350-BIA',
      channels: [
        {
          connectionId: 'conn_al',
          connectionName: 'Allegro',
          platformType: 'allegro',
          rule: null,
          willPublish: { quantity: 7, provenance: 'computed' },
          channelShows: { quantity: 9, observedAt: '2026-09-26T08:00:00.000Z' },
          lastSent: { quantity: 7, outcome: 'sent', pushedAt: '2026-09-26T07:00:00.000Z' },
        },
      ],
    });
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi.fn().mockResolvedValue(page([row()])),
        stockView: vi.fn().mockResolvedValue(stockViewFixture([variant])),
      },
    });
    renderMovements({ apiClient, route: '/inventory/movements?productVariantId=ol_variant_1' });

    const summary = await screen.findByTestId('stock-variant-summary');
    expect(summary).toHaveTextContent('Sent 7');
    expect(summary).toHaveTextContent('Shows 9');
    expect(summary).toHaveTextContent('Different');
  });

  it('should open the guide from the page header and narrow it by search', async () => {
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row()])) },
    });
    renderMovements({ apiClient });

    await screen.findAllByTestId('stock-movement-row');
    await userEvent.click(screen.getByTestId('stock-movements-help'));
    const guide = await screen.findByTestId('stock-movement-guide');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the guide' }), 'zzzz');
    expect(guide).toHaveTextContent('Nothing in the guide matches "zzzz".');
  });

  it('should request only reservation rows for the Holds view and offer no export', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderMovements({ apiClient });

    const chip = await screen.findByTestId('stock-movements-chip-promised');
    expect(chip).toHaveTextContent('Holds');
    await userEvent.click(chip);
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'promised' }), expect.anything()),
    );
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('should say a packer has no access, and send no read', async () => {
    const listMovements = vi.fn();
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderMovements({ apiClient, sessionAdapter: PACKER });

    expect(await screen.findByText('Stock history is not available for your role')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(listMovements).not.toHaveBeenCalled();
  });

  it('should pass productId to the API and offer a Show all products escape', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([row()]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderMovements({ apiClient, route: '/inventory/movements?productId=ol_product_1' });

    await screen.findAllByTestId('stock-movement-row');
    expect(listMovements).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'ol_product_1' }),
      expect.anything(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show all products' }));
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(
        expect.objectContaining({ productId: undefined }),
        expect.anything(),
      ),
    );
    expect(screen.queryByTestId('stock-movements-scope-product')).not.toBeInTheDocument();
  });

  it('should say nothing is recorded yet, not that filters match nothing, for a fresh variant', async () => {
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([])) },
    });
    renderMovements({ apiClient, route: '/inventory/movements?productVariantId=ol_variant_9' });

    expect(await screen.findByTestId('stock-movements-empty')).toHaveTextContent(
      'No stock movements recorded for this variant yet',
    );
    expect(screen.queryByTestId('stock-movements-clear-filters')).not.toBeInTheDocument();
  });

  it('should push a history entry when a filter changes so Back undoes it', async () => {
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row()])) },
    });
    // The harness mounts a MemoryRouter, so window.history is never touched; the
    // router's own history is what Back walks, which this probe drives.
    function BackProbe(): ReactElement {
      const navigate = useNavigate();
      const location = useLocation();
      return (
        <>
          <span data-testid="probe-search">{location.search}</span>
          <button type="button" data-testid="probe-back" onClick={() => void navigate(-1)}>
            Back
          </button>
        </>
      );
    }
    renderWithProviders(
      <>
        <InventoryMovementsPage />
        <BackProbe />
      </>,
      { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() }
    );
    await screen.findAllByTestId('stock-movement-row');
    expect(screen.getByTestId('probe-search')).toHaveTextContent('');

    await userEvent.click(screen.getByTestId('stock-movements-chip-attention'));
    await waitFor(() =>
      expect(screen.getByTestId('probe-search').textContent).toContain('chip=attention')
    );

    await userEvent.click(screen.getByTestId('probe-back'));
    await waitFor(() => expect(screen.getByTestId('probe-search').textContent).toBe(''));
  });
});
