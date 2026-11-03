import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import { createAuthenticatedSessionAdapter, createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { InventoryMovementsPage } from './inventory-movements-page';
import type { InventoryMovementRow } from '../../features/inventory/api/inventory-movements.types';

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

const page = (items: InventoryMovementRow[]) => ({ items, limit: 20, offset: 0 });

describe('InventoryMovementsPage', () => {
  afterEach(cleanup);

  it('should render rows and the exact count inferred from a short page', async () => {
    const countMovements = vi.fn();
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row(), row({ id: 'm2' })])), countMovements },
    });
    renderMovements({ apiClient });

    expect(await screen.findAllByTestId('stock-movement-row')).toHaveLength(2);
    expect(screen.getByTestId('stock-movements-count')).toHaveTextContent('2 results');
    expect(countMovements).not.toHaveBeenCalled();
  });

  it('should never render a missing total as 0 while the count is pending', async () => {
    const items = Array.from({ length: 20 }, (_, i) => row({ id: `m${i}` }));
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
    expect(screen.getByTestId('stock-movements-filter-from')).toHaveValue('2026-09-19');
    await userEvent.selectOptions(screen.getByTestId('stock-movements-filter-type'), 'return_restock');
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(
        expect.objectContaining({ reasons: ['return_restock'], from: new Date(2026, 8, 19, 0, 0, 0, 0).toISOString() }),
        expect.anything(),
      ),
    );
  });

  it('should count refused and in-doubt rows in the attention alert', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        listMovements: vi
          .fn()
          .mockResolvedValue(
            page([row({ id: 'a', status: 'refused', quantityAfter: null }), row({ id: 'b', status: 'in_doubt', quantityAfter: null })]),
          ),
      },
    });
    renderMovements({ apiClient, route: '/inventory/movements?chip=attention' });

    const alert = await screen.findByTestId('stock-movements-attention-alert');
    expect(alert).toHaveTextContent('2 movements need a look');
    expect(alert).toHaveTextContent('1 refused');
    expect(alert).toHaveTextContent('1 unconfirmed');
  });

  it('should request only reservation rows for the Reserved only chip and offer no export', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderMovements({ apiClient });

    const chip = await screen.findByTestId('stock-movements-chip-promised');
    expect(chip).toHaveTextContent('Reserved only');
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
