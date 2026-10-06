/**
 * `OrderColumnVisibilityControl` unit tests (#3530, D32, #3507 PR 7).
 *
 * Pins: the "Columns" trigger opens the `.columns-panel` popover holding the
 * preset manager scoped to `ORDER_LIST_COLUMN_IDS`; on first mount it
 * resolves the initial arrangement from the workspace default (when nothing
 * is remembered locally); a change made through the manager is reported to
 * the caller immediately (not merely saved); and below the table breakpoint —
 * where the list renders cards that ignore columns — there is no control.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderColumnVisibilityControl } from './order-column-visibility-control';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { mockMobileViewport } from '../../../test/viewport';
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

describe('OrderColumnVisibilityControl (#3530, D32, #3507 PR 7)', () => {
  it('opens the columns panel with the column manager when the trigger is clicked', async () => {
    renderControl();
    const user = userEvent.setup();

    expect(screen.queryByTestId('orders-columns-popover')).toBeNull();
    await user.click(screen.getByTestId('orders-columns-trigger'));

    const panel = await screen.findByTestId('orders-columns-popover');
    expect(panel).toHaveClass('columns-panel');
    expect(panel).not.toHaveClass('tag-picker');
    expect(within(panel).getByRole('combobox', { name: 'Preset' })).toBeInTheDocument();
    // Scoped to the LIST vocabulary, e.g. "Customer" — never an export-only id.
    expect(within(panel).getByRole('checkbox', { name: 'Customer' })).toBeInTheDocument();
    expect(within(panel).queryByRole('checkbox', { name: 'Order #' })).toBeNull();
  });

  it('renders no Columns control in the card-view band, where columns change nothing', async () => {
    const viewport = mockMobileViewport();
    try {
      const { onVisibleColumnIdsChange } = renderControl(makePreset(['status']));

      expect(screen.queryByTestId('orders-columns-trigger')).toBeNull();
      // The initial arrangement still resolves, so the table is right on widening.
      await waitFor(() => {
        expect(onVisibleColumnIdsChange).toHaveBeenCalledWith(['status']);
      });
    } finally {
      viewport.restore();
    }
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
    const panel = await screen.findByTestId('orders-columns-popover');
    await user.click(within(panel).getByRole('checkbox', { name: 'Customer' }));

    await waitFor(() => {
      expect(onVisibleColumnIdsChange).toHaveBeenCalledWith(
        expect.not.arrayContaining(['customer']),
      );
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).not.toContain('customer');
  });
});
