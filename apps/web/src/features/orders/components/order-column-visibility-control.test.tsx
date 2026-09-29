/**
 * `OrderColumnVisibilityControl` unit tests (#3530, D32).
 *
 * Pins: the "Columns" trigger opens a popover holding the preset manager
 * scoped to `ORDER_LIST_COLUMN_IDS`; on first mount it resolves the initial
 * arrangement from the workspace default (when nothing is remembered
 * locally); and a change made through the manager is reported to the
 * caller immediately (via `onVisibleColumnIdsChange`), not merely saved.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderColumnVisibilityControl } from './order-column-visibility-control';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ORDER_LIST_COLUMN_IDS } from '../api/orders.types';
import type { OrderColumnPreset } from '../api/orders.types';

const STORAGE_KEY = 'ol.orders-list.visible-columns.v1';

function makePreset(columns: string[]): OrderColumnPreset {
  return {
    id: 'wsdefault',
    userId: null,
    name: 'Workspace default',
    columns,
    createdAt: '',
    updatedAt: '',
  };
}

function renderControl(
  workspaceDefault: OrderColumnPreset | null = null,
  onVisibleColumnIdsChange = vi.fn(),
) {
  const orders = {
    listColumnPresets: vi.fn().mockResolvedValue([]),
    getWorkspaceDefaultColumnPreset: vi.fn().mockResolvedValue(workspaceDefault),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(
    <OrderColumnVisibilityControl
      visibleColumnIds={[...ORDER_LIST_COLUMN_IDS]}
      onVisibleColumnIdsChange={onVisibleColumnIdsChange}
    />,
    { apiClient: api },
  );
  return { orders, onVisibleColumnIdsChange };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe('OrderColumnVisibilityControl (#3530, D32)', () => {
  it('opens a popover with the column manager when the trigger is clicked', async () => {
    renderControl();
    const user = userEvent.setup();

    expect(screen.queryByTestId('orders-columns-popover')).toBeNull();
    await user.click(screen.getByTestId('orders-columns-trigger'));

    expect(await screen.findByTestId('orders-columns-popover')).toBeInTheDocument();
    expect(screen.getByText('Visible columns (in order)')).toBeInTheDocument();
    // Scoped to the LIST vocabulary, e.g. "Customer" — never an export-only id.
    expect(screen.getByText('Customer')).toBeInTheDocument();
  });

  it('resolves the initial arrangement from the workspace default when nothing is remembered locally', async () => {
    const { onVisibleColumnIdsChange } = renderControl(makePreset(['status', 'money']));

    await waitFor(() => {
      expect(onVisibleColumnIdsChange).toHaveBeenCalledWith(['status', 'money']);
    });
  });

  it('falls back to every list column when there is no workspace default and nothing remembered', async () => {
    const { onVisibleColumnIdsChange } = renderControl(null);

    await waitFor(() => {
      expect(onVisibleColumnIdsChange).toHaveBeenCalledWith([...ORDER_LIST_COLUMN_IDS]);
    });
  });

  it('prefers a remembered local arrangement over the workspace default', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['money', 'status']));
    const { onVisibleColumnIdsChange } = renderControl(makePreset(['customer']));

    await waitFor(() => {
      expect(onVisibleColumnIdsChange).toHaveBeenCalledWith(['money', 'status']);
    });
  });

  it('reports a change made in the manager immediately and persists it locally', async () => {
    const { onVisibleColumnIdsChange } = renderControl(makePreset([...ORDER_LIST_COLUMN_IDS]));
    const user = userEvent.setup();

    await waitFor(() => { expect(onVisibleColumnIdsChange).toHaveBeenCalled(); });
    onVisibleColumnIdsChange.mockClear();

    await user.click(screen.getByTestId('orders-columns-trigger'));
    await screen.findByText('Visible columns (in order)');
    const customerRow = screen.getByText('Customer').closest('li')!;
    await user.click(customerRow.querySelectorAll('button')[2]); // "Hide"

    await waitFor(() => {
      expect(onVisibleColumnIdsChange).toHaveBeenCalledWith(
        expect.not.arrayContaining(['customer']),
      );
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).not.toContain('customer');
  });
});
