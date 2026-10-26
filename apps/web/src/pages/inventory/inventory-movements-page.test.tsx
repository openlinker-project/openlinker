import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
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

const page = (items: InventoryMovementRow[]) => ({ items, limit: 20, offset: 0 });

describe('InventoryMovementsPage', () => {
  afterEach(cleanup);

  it('should render rows and the exact count inferred from a short page', async () => {
    const countMovements = vi.fn();
    const apiClient = createMockApiClient({
      inventory: { listMovements: vi.fn().mockResolvedValue(page([row(), row({ id: 'm2' })])), countMovements },
    });
    renderWithProviders(<InventoryMovementsPage />, { apiClient });

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
    renderWithProviders(<InventoryMovementsPage />, { apiClient });

    await screen.findAllByTestId('stock-movement-row');
    expect(screen.getByTestId('stock-movements-count')).toHaveTextContent('20+ results');
    expect(screen.getByTestId('stock-movements-count')).not.toHaveTextContent(/\b0 results/);
  });

  it('should show the empty state and clear filters', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderWithProviders(<InventoryMovementsPage />, { apiClient, route: '/inventory/movements?type=manual_correction' });

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
    renderWithProviders(<InventoryMovementsPage />, { apiClient, route: '/inventory/movements?from=2026-09-19' });

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
    renderWithProviders(<InventoryMovementsPage />, { apiClient, route: '/inventory/movements?chip=attention' });

    const alert = await screen.findByTestId('stock-movements-attention-alert');
    expect(alert).toHaveTextContent('2 movements need a look');
    expect(alert).toHaveTextContent('1 refused');
    expect(alert).toHaveTextContent('1 unconfirmed');
  });

  it('should request only promised rows for the Promised only chip and offer no export', async () => {
    const listMovements = vi.fn().mockResolvedValue(page([]));
    const apiClient = createMockApiClient({ inventory: { listMovements } });
    renderWithProviders(<InventoryMovementsPage />, { apiClient });

    await userEvent.click(await screen.findByTestId('stock-movements-chip-promised'));
    await waitFor(() =>
      expect(listMovements).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'promised' }), expect.anything()),
    );
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });
});
