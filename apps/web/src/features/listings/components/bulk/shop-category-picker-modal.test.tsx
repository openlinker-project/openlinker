/**
 * ShopCategoryPickerModal tests (#1834)
 *
 * Covers the drill-down browse, node selection (any node is selectable), and
 * the empty-level state.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { ShopCategoryPickerModal } from './shop-category-picker-modal';
import type { ShopCategory } from '../../api/listings.types';

const ROOTS: ShopCategory[] = [
  { id: '10', name: 'Clothing', parentId: null },
  { id: '11', name: 'Footwear', parentId: null },
];
const FOOTWEAR_CHILDREN: ShopCategory[] = [{ id: '20', name: 'Sneakers', parentId: '11' }];

function mockApi() {
  return createMockApiClient({
    listings: {
      browseShopCategories: vi.fn((_connectionId: string, parentId?: string) =>
        Promise.resolve(parentId === '11' ? FOOTWEAR_CHILDREN : ROOTS),
      ),
    },
  });
}

describe('ShopCategoryPickerModal', () => {
  it('lists root categories and selects a node with its breadcrumb path', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <ShopCategoryPickerModal
        open
        onOpenChange={() => {}}
        connectionId="conn-1"
        productName="Widget"
        selectedId={null}
        onSelect={onSelect}
      />,
      { apiClient: mockApi() },
    );

    expect(await screen.findByText('Clothing')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Select' })[0]);

    expect(onSelect).toHaveBeenCalledWith('10', ['Clothing']);
  });

  it('drills into a category and selects a child with the full path', async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <ShopCategoryPickerModal
        open
        onOpenChange={() => {}}
        connectionId="conn-1"
        productName="Widget"
        selectedId={null}
        onSelect={onSelect}
      />,
      { apiClient: mockApi() },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Browse into Footwear' }));

    expect(await screen.findByText('Sneakers')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(onSelect).toHaveBeenCalledWith('20', ['Footwear', 'Sneakers']);
  });

  it('shows an empty-level message when a branch has no subcategories', async () => {
    const api = createMockApiClient({
      listings: {
        browseShopCategories: vi.fn((_connectionId: string, parentId?: string) =>
          Promise.resolve(parentId === '11' ? [] : ROOTS),
        ),
      },
    });
    renderWithProviders(
      <ShopCategoryPickerModal
        open
        onOpenChange={() => {}}
        connectionId="conn-1"
        productName="Widget"
        selectedId={null}
        onSelect={vi.fn()}
      />,
      { apiClient: api },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Browse into Footwear' }));

    await waitFor(() =>
      expect(screen.getByText(/no subcategories/i)).toBeInTheDocument(),
    );
  });
});
