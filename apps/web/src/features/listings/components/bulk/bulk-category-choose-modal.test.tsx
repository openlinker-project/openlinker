/**
 * BulkCategoryChooseModal — whole-tree search tests (#2075)
 *
 * The regression these pin: the input was labelled "Search categories" but
 * filtered only the CURRENT level, so searching from the root reported
 * `No categories match "…"` for a category two levels down — a false statement
 * about the operator's own catalogue, not merely a missing feature.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkCategoryChooseModal } from './bulk-category-choose-modal';
import type { AllegroCategory, CategorySearchHit } from '../../../mappings';

const ROOTS: AllegroCategory[] = [
  { id: '1', name: 'Elektronika', parentId: null, leaf: false },
  { id: '2', name: 'Moda', parentId: null, leaf: false },
];

/** Two levels below the root — unreachable by a current-level filter. */
const DEEP_HIT: CategorySearchHit = {
  category: { id: '258066', name: 'Smartfony', parentId: '258060', leaf: true },
  path: [
    { id: '1', name: 'Elektronika' },
    { id: '258060', name: 'Telefony' },
    { id: '258066', name: 'Smartfony' },
  ],
};

/** A matching branch node: a real hit, but an offer cannot be listed on it. */
const NON_LEAF_HIT: CategorySearchHit = {
  category: { id: '258060', name: 'Telefony', parentId: '1', leaf: false },
  path: [
    { id: '1', name: 'Elektronika' },
    { id: '258060', name: 'Telefony' },
  ],
};

function mockApi(overrides: {
  roots?: AllegroCategory[];
  hits?: CategorySearchHit[];
} = {}) {
  return createMockApiClient({
    mappings: {
      getAllegroCategories: vi.fn().mockResolvedValue(overrides.roots ?? ROOTS),
      searchCategories: vi.fn().mockResolvedValue(overrides.hits ?? [DEEP_HIT]),
    },
  });
}

function renderModal(
  apiClient: ReturnType<typeof createMockApiClient>,
  onSelect = vi.fn(),
): { onSelect: ReturnType<typeof vi.fn> } {
  renderWithProviders(
    <BulkCategoryChooseModal
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

describe('BulkCategoryChooseModal — category search (#2075)', () => {
  it('should find a category below the loaded level', async () => {
    const apiClient = mockApi();
    renderModal(apiClient);

    expect(await screen.findByText('Elektronika')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search all categories'), 'smart');

    // The whole point: a root-level search reaches a grandchild.
    expect(await screen.findByText('Smartfony')).toBeInTheDocument();
  });

  it('should show each hit with its root-to-leaf breadcrumb', async () => {
    const apiClient = mockApi();
    renderModal(apiClient);
    await screen.findByText('Elektronika');

    await userEvent.type(screen.getByLabelText('Search all categories'), 'smart');
    await screen.findByText('Smartfony');

    // Ancestors only — the hit's own name is the row heading.
    expect(screen.getByText(/Elektronika/)).toBeInTheDocument();
    expect(screen.getByText(/Telefony/)).toBeInTheDocument();
  });

  it('should select a hit with the hit’s OWN path, not the browsed breadcrumb', async () => {
    const apiClient = mockApi();
    const { onSelect } = renderModal(apiClient);
    await screen.findByText('Elektronika');

    await userEvent.type(screen.getByLabelText('Search all categories'), 'smart');
    await userEvent.click(await screen.findByRole('button', { name: 'Select Smartfony' }));

    // Deriving this from navigation state would stamp a trail the category
    // does not have — the operator never drilled anywhere.
    expect(onSelect).toHaveBeenCalledWith('258066', ['Elektronika', 'Telefony', 'Smartfony']);
  });

  it('should show a non-leaf hit as not selectable rather than hiding it', async () => {
    const apiClient = mockApi({ hits: [NON_LEAF_HIT] });
    renderModal(apiClient);
    await screen.findByText('Elektronika');

    await userEvent.type(screen.getByLabelText('Search all categories'), 'telef');

    expect(await screen.findByText('Not selectable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select Telefony' })).not.toBeInTheDocument();
  });

  it('should not search below the minimum query length', async () => {
    const apiClient = mockApi();
    renderModal(apiClient);
    await screen.findByText('Elektronika');

    await userEvent.type(screen.getByLabelText('Search all categories'), 'a');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(apiClient.mappings.searchCategories).not.toHaveBeenCalled();
    // Still browsing, not searching.
    expect(screen.getByText('Elektronika')).toBeInTheDocument();
  });

  it('should distinguish "no matches" from "nothing synced"', async () => {
    const apiClient = mockApi({ hits: [] });
    renderModal(apiClient);
    await screen.findByText('Elektronika');

    await userEvent.type(screen.getByLabelText('Search all categories'), 'zzz');

    expect(await screen.findByText('No matching categories')).toBeInTheDocument();
    expect(screen.queryByText('No categories synced yet')).not.toBeInTheDocument();
  });

  it('should report an unsynced taxonomy distinctly from an unmatched query', async () => {
    // Root browse is empty ⇒ the scope has never synced. Conflating this with
    // "no matches" would surface the read model's staleness as a broken search.
    const apiClient = mockApi({ roots: [], hits: [] });
    renderModal(apiClient);

    await userEvent.type(screen.getByLabelText('Search all categories'), 'zzz');

    expect(await screen.findByText('No categories synced yet')).toBeInTheDocument();
    expect(screen.queryByText('No matching categories')).not.toBeInTheDocument();
  });

  it('should restore the drill-down at its previous position when the query is cleared', async () => {
    const apiClient = mockApi();
    renderModal(apiClient);
    await screen.findByText('Elektronika');

    const input = screen.getByLabelText('Search all categories');
    await userEvent.type(input, 'smart');
    await screen.findByText('Smartfony');

    await userEvent.clear(input);

    // Assert on an affordance that exists ONLY in tree mode. "Elektronika"
    // would be a false positive — it also appears inside the hit's breadcrumb.
    // The wait is the debounce settling, which is the intended behaviour.
    expect(
      await screen.findByRole('button', { name: 'Browse into Elektronika' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Smartfony')).not.toBeInTheDocument());
  });
});
