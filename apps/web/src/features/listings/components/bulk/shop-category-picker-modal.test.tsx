/**
 * ShopCategoryPickerModal tests (#1834)
 *
 * Covers the drill-down browse, node selection (any node is selectable), the
 * empty-level state, and the whole-tree search added by #2075 (which replaced
 * a filter that only ever saw the currently-loaded level).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { ShopCategoryPickerModal } from './shop-category-picker-modal';
import type { ShopCategory } from '../../api/listings.types';
import type { CategorySearchHit } from '../../../mappings';

const ROOTS: ShopCategory[] = [
  { id: '10', name: 'Clothing', parentId: null },
  { id: '11', name: 'Footwear', parentId: null },
];
const FOOTWEAR_CHILDREN: ShopCategory[] = [{ id: '20', name: 'Sneakers', parentId: '11' }];

/** Two levels below the root — unreachable by a current-level filter. */
const DEEP_HIT: CategorySearchHit = {
  category: { id: '20', name: 'Sneakers', parentId: '11', leaf: false },
  path: [
    { id: '11', name: 'Footwear' },
    { id: '20', name: 'Sneakers' },
  ],
};

function mockApi(overrides: { roots?: ShopCategory[]; hits?: CategorySearchHit[] } = {}) {
  const roots = overrides.roots ?? ROOTS;
  return createMockApiClient({
    listings: {
      browseShopCategories: vi.fn((_connectionId: string, parentId?: string) =>
        Promise.resolve(parentId === '11' ? FOOTWEAR_CHILDREN : roots),
      ),
    },
    mappings: {
      searchCategories: vi.fn().mockResolvedValue(overrides.hits ?? [DEEP_HIT]),
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

    await userEvent.click(screen.getByRole('button', { name: 'Select Clothing' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Select Sneakers' }));

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
  describe('whole-tree search (#2075)', () => {
    function renderModal(
      apiClient: ReturnType<typeof createMockApiClient>,
      onSelect = vi.fn(),
    ): { onSelect: ReturnType<typeof vi.fn> } {
      renderWithProviders(
        <ShopCategoryPickerModal
          open
          onOpenChange={() => {}}
          connectionId="conn-1"
          productName="Widget"
          selectedId={null}
          onSelect={onSelect}
        />,
        { apiClient },
      );
      return { onSelect };
    }

    it('finds a category below the loaded level', async () => {
      renderModal(mockApi());
      expect(await screen.findByText('Clothing')).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText('Search all categories'), 'sneak');

      expect(await screen.findByText('Sneakers')).toBeInTheDocument();
    });

    it('selects any hit - a shop product may sit in a non-leaf node (ADR-024)', async () => {
      const { onSelect } = renderModal(mockApi());
      await screen.findByText('Clothing');

      await userEvent.type(screen.getByLabelText('Search all categories'), 'sneak');
      // DEEP_HIT is deliberately leaf:false - the marketplace picker would
      // refuse it, the shop picker must not.
      await userEvent.click(await screen.findByRole('button', { name: 'Select Sneakers' }));

      // The hit's OWN path, not the browsed breadcrumb (which is still root).
      expect(onSelect).toHaveBeenCalledWith('20', ['Footwear', 'Sneakers']);
    });

    it('does not search below the minimum query length', async () => {
      const api = mockApi();
      renderModal(api);
      await screen.findByText('Clothing');

      await userEvent.type(screen.getByLabelText('Search all categories'), 'a');

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(api.mappings.searchCategories).not.toHaveBeenCalled();
    });

    it('does NOT claim "nothing matched" — browse and search read different stores', async () => {
      // The tree is read LIVE from the shop while search reads the projection
      // (#2085 deferral), so an empty result is equally consistent with "the
      // index has not caught up". Asserting a match failure would be the same
      // false claim #2075 exists to remove.
      renderModal(mockApi({ hits: [] }));
      await screen.findByText('Clothing');

      await userEvent.type(screen.getByLabelText('Search all categories'), 'zzz');

      expect(await screen.findByText('No search results')).toBeInTheDocument();
      expect(screen.getByText(/index is built separately/i)).toBeInTheDocument();
      expect(screen.queryByText('No matching categories')).not.toBeInTheDocument();
    });

    it('keeps the indeterminate copy even when the live tree is empty', async () => {
      // An empty live tree still says nothing about the projection, so the
      // marketplace "never synced" claim stays unavailable on this surface.
      renderModal(mockApi({ roots: [], hits: [] }));

      await userEvent.type(screen.getByLabelText('Search all categories'), 'zzz');

      expect(await screen.findByText('No search results')).toBeInTheDocument();
      expect(screen.queryByText('No categories synced yet')).not.toBeInTheDocument();
    });

    it('restores the drill-down when the query is cleared', async () => {
      renderModal(mockApi());
      await screen.findByText('Clothing');

      const input = screen.getByLabelText('Search all categories');
      await userEvent.type(input, 'sneak');
      await screen.findByText('Sneakers');

      await userEvent.clear(input);

      // Assert on a tree-only affordance; a bare name could match a breadcrumb.
      expect(
        await screen.findByRole('button', { name: 'Browse into Clothing' }),
      ).toBeInTheDocument();
    });
  });
});
