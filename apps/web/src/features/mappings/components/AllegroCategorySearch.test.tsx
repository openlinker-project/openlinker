/**
 * AllegroCategorySearch — regression guard
 *
 * 5-case smoke suite pinning the component's current behavior before the
 * #304 CategoryTreeBrowser refactor. These assertions should stay green
 * after swapping the internals to use the shared primitive — otherwise the
 * refactor changed user-visible behavior that it shouldn't have.
 *
 * @module apps/web/src/features/mappings/components
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllegroCategorySearch } from './AllegroCategorySearch';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { AllegroCategory, CategorySearchHit } from '../api/mappings.types';

function mockCategoriesEndpoint(
  byParent: Record<string, AllegroCategory[]>,
): (connectionId: string, parentId?: string) => Promise<AllegroCategory[]> {
  return async (_connectionId, parentId) => {
    const key = parentId ?? 'root';
    return byParent[key] ?? [];
  };
}

const connectionId = 'conn-allegro-1';

describe('AllegroCategorySearch', () => {
  afterEach(cleanup);

  it('renders the root list from the mocked query', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [
              { id: 'cat-1', name: 'Electronics', parentId: null, leaf: false },
              { id: 'cat-2', name: 'Books', parentId: null, leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <AllegroCategorySearch
        marketplaceConnectionId={connectionId}
        currentMapping={undefined}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        isSaving={false}
      />,
      { apiClient },
    );

    expect(await screen.findByText('Electronics')).toBeInTheDocument();
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('drills into a non-leaf and loads the drilled level', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-electronics', name: 'Electronics', parentId: null, leaf: false }],
            'cat-electronics': [
              { id: 'cat-phones', name: 'Phones', parentId: 'cat-electronics', leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <AllegroCategorySearch
        marketplaceConnectionId={connectionId}
        currentMapping={undefined}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        isSaving={false}
      />,
      { apiClient },
    );

    await screen.findByText('Electronics');
    fireEvent.click(screen.getByRole('button', { name: /browse into electronics/i }));
    await screen.findByText('Phones');
  });

  it('stages a pick when Select is clicked and shows the built path', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-electronics', name: 'Electronics', parentId: null, leaf: false }],
            'cat-electronics': [
              { id: 'cat-phones', name: 'Phones', parentId: 'cat-electronics', leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <AllegroCategorySearch
        marketplaceConnectionId={connectionId}
        currentMapping={undefined}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        isSaving={false}
      />,
      { apiClient },
    );

    await screen.findByText('Electronics');
    fireEvent.click(screen.getByRole('button', { name: /browse into electronics/i }));
    await screen.findByText('Phones');

    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));

    // Staged row renders with "Selected:" label and the full path
    expect(screen.getByText('Selected:')).toBeInTheDocument();
    expect(screen.getByText('Electronics > Phones')).toBeInTheDocument();
    // Save + Cancel actions are available
    expect(screen.getByRole('button', { name: /save mapping/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('fires onSelect with the built path when Save is clicked', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-electronics', name: 'Electronics', parentId: null, leaf: false }],
            'cat-electronics': [
              { id: 'cat-phones', name: 'Phones', parentId: 'cat-electronics', leaf: true },
            ],
          }),
        ),
      },
    });
    const onSelect = vi.fn();

    renderWithProviders(
      <AllegroCategorySearch
        marketplaceConnectionId={connectionId}
        currentMapping={undefined}
        onSelect={onSelect}
        onClear={vi.fn()}
        isSaving={false}
      />,
      { apiClient },
    );

    await screen.findByText('Electronics');
    fireEvent.click(screen.getByRole('button', { name: /browse into electronics/i }));
    await screen.findByText('Phones');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('button', { name: /save mapping/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cat-phones', name: 'Phones', leaf: true }),
      'Electronics > Phones',
    );
  });

  it('dismisses the staged pick without firing onSelect when Cancel is clicked', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-books', name: 'Books', parentId: null, leaf: true }],
          }),
        ),
      },
    });
    const onSelect = vi.fn();

    renderWithProviders(
      <AllegroCategorySearch
        marketplaceConnectionId={connectionId}
        currentMapping={undefined}
        onSelect={onSelect}
        onClear={vi.fn()}
        isSaving={false}
      />,
      { apiClient },
    );

    await screen.findByText('Books');
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    expect(screen.getByText('Selected:')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Staged row is gone; onSelect was never called
    expect(screen.queryByText('Selected:')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
  describe('whole-tree search (#2075)', () => {
    // Until #2075 this component was named "Search" and offered only
    // drill-down — the mapping-authoring flow, where the operator already
    // knows the category name, was the worst possible fit for that.
    const DEEP_HIT: CategorySearchHit = {
      category: { id: 'cat-9', name: 'Smartfony', parentId: 'cat-5', leaf: true },
      path: [
        { id: 'cat-1', name: 'Electronics' },
        { id: 'cat-5', name: 'Phones' },
        { id: 'cat-9', name: 'Smartfony' },
      ],
    };

    function mockApi(hits: CategorySearchHit[] = [DEEP_HIT]) {
      return createMockApiClient({
        mappings: {
          getAllegroCategories: vi.fn(
            mockCategoriesEndpoint({
              root: [{ id: 'cat-1', name: 'Electronics', parentId: null, leaf: false }],
            }),
          ),
          searchCategories: vi.fn().mockResolvedValue(hits),
        },
      });
    }

    function renderSearch(
      apiClient: ReturnType<typeof createMockApiClient>,
      onSelect = vi.fn(),
    ): { onSelect: ReturnType<typeof vi.fn> } {
      renderWithProviders(
        <AllegroCategorySearch
          marketplaceConnectionId={connectionId}
          currentMapping={undefined}
          onSelect={onSelect}
          onClear={vi.fn()}
          isSaving={false}
        />,
        { apiClient },
      );
      return { onSelect };
    }

    it('finds a category below the loaded level', async () => {
      renderSearch(mockApi());
      expect(await screen.findByText('Electronics')).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText('Search all categories'), 'smart');

      expect(await screen.findByText('Smartfony')).toBeInTheDocument();
    });

    it('stages a search hit with the hit own path, not the browsed breadcrumb', async () => {
      const { onSelect } = renderSearch(mockApi());
      await screen.findByText('Electronics');

      await userEvent.type(screen.getByLabelText('Search all categories'), 'smart');
      await userEvent.click(await screen.findByRole('button', { name: 'Select Smartfony' }));

      // Staged, not saved — the confirm step is unchanged by #2075.
      expect(onSelect).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: /save mapping/i }));

      // The path string must come from the hit. Deriving it from tree
      // navigation would persist a wrong allegroCategoryPath on the mapping.
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cat-9', name: 'Smartfony' }),
        'Electronics > Phones > Smartfony',
      );
    });

    it('does not search below the minimum query length', async () => {
      const apiClient = mockApi();
      renderSearch(apiClient);
      await screen.findByText('Electronics');

      await userEvent.type(screen.getByLabelText('Search all categories'), 'a');

      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(apiClient.mappings.searchCategories).not.toHaveBeenCalled();
    });

    it('distinguishes no-matches from a never-synced taxonomy', async () => {
      renderSearch(mockApi([]));
      await screen.findByText('Electronics');

      await userEvent.type(screen.getByLabelText('Search all categories'), 'zzz');

      expect(await screen.findByText('No matching categories')).toBeInTheDocument();
      expect(screen.queryByText('No categories synced yet')).not.toBeInTheDocument();
    });

    it('restores the tree when the query is cleared', async () => {
      renderSearch(mockApi());
      await screen.findByText('Electronics');

      const input = screen.getByLabelText('Search all categories');
      await userEvent.type(input, 'smart');
      await screen.findByText('Smartfony');

      await userEvent.clear(input);

      // A tree-only affordance — "Electronics" alone also appears in the
      // hit breadcrumb, so it would be a false positive.
      expect(
        await screen.findByRole('button', { name: /browse into electronics/i }),
      ).toBeInTheDocument();
    });
  });
});
