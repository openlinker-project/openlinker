/**
 * ConnectionCategoryMappingsPage tests
 *
 * Covers the marketplace selector (#173), the demo analytics events (#1789)
 * and the mapping key (#3993): a mapping is read and written under the
 * MARKETPLACE connection, scoped to the master the page is opened on, because
 * that is the pair offer creation resolves by.
 *
 * @module apps/web/src/pages/connections
 */

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionCategoryMappingsPage } from './connection-category-mappings-page';
import type { Connection } from '../../features/connections/api/connections.types';
import type { CategoryMapping } from '../../features/mappings/api/mappings.types';
import type * as DemoModule from '../../features/demo';

type ApiClient = ReturnType<typeof createMockApiClient>;

const captureDemoEvent = vi.fn();
vi.mock('../../features/demo', async (importOriginal): Promise<typeof DemoModule> => {
  const actual = await importOriginal<typeof DemoModule>();
  return { ...actual, captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args) };
});

const PS_CATEGORIES = [{ id: '2', name: 'Men', parentId: '1', depth: 1, active: true }];

const ALLEGRO_CONNECTION: Connection = {
  ...sampleConnection,
  id: 'conn_allegro_1',
  name: 'Allegro store',
  platformType: 'allegro',
  status: 'active',
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager', 'CategoryBrowser'],
};

const LEGACY_MAPPING: CategoryMapping = {
  id: 'map_legacy',
  connectionId: sampleConnection.id,
  sourceConnectionId: null,
  prestashopCategoryId: '2',
  allegroCategoryId: 'a9',
  allegroCategoryName: 'Old pick',
  allegroCategoryPath: null,
};

function renderPage(apiClient: ApiClient, connectionId = sampleConnection.id): void {
  renderWithProviders(
    <Routes>
      <Route path="/connections/:connectionId/mappings/categories" element={<ConnectionCategoryMappingsPage />} />
    </Routes>,
    { apiClient, route: `/connections/${connectionId}/mappings/categories` },
  );
}

function apiWith(
  connections: Connection[],
  mappings: Partial<ApiClient['mappings']> = {},
): ApiClient {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue(connections) },
    mappings: {
      getCategoryMappings: vi.fn().mockResolvedValue([]),
      getPrestashopCategories: vi.fn().mockResolvedValue(PS_CATEGORIES),
      ...mappings,
    },
  });
}

describe('ConnectionCategoryMappingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captureDemoEvent.mockClear();
  });

  afterEach(cleanup);

  it('captures demo_category_mapping_opened once with a mapped-count bucket on load (#1789)', async () => {
    renderPage(apiWith([sampleConnection, ALLEGRO_CONNECTION]));

    await screen.findByText('Men');

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_category_mapping_opened', {
      mappedCountBucket: '0',
    });
    expect(captureDemoEvent).toHaveBeenCalledTimes(1);
  });

  it('captures demo_category_source_selected when the marketplace select changes (#1789)', async () => {
    const secondAllegro: Connection = { ...ALLEGRO_CONNECTION, id: 'conn_allegro_2', name: 'Allegro store 2' };
    renderPage(apiWith([sampleConnection, ALLEGRO_CONNECTION, secondAllegro]));

    const select = await screen.findByLabelText<HTMLSelectElement>('Map for');
    fireEvent.change(select, { target: { value: secondAllegro.id } });

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_category_source_selected', {});
  });

  it('should save a mapping under the marketplace, scoped to the master, when a category is picked (#3993)', async () => {
    const upsertCategoryMapping = vi.fn().mockResolvedValue(undefined);
    renderPage(
      apiWith([sampleConnection, ALLEGRO_CONNECTION], {
        getAllegroCategories: vi.fn().mockResolvedValue([
          { id: 'a1', name: 'Category A', parentId: null, leaf: true },
        ]),
        upsertCategoryMapping,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Choose a category for Men' }));
    expect(await screen.findByRole('dialog', { name: 'Men' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /^select$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /save mapping/i }));

    await waitFor(() => {
      expect(upsertCategoryMapping).toHaveBeenCalledWith(ALLEGRO_CONNECTION.id, '2', {
        sourceConnectionId: sampleConnection.id,
        allegroCategoryId: 'a1',
        allegroCategoryName: 'Category A',
        allegroCategoryPath: 'Category A',
      });
    });
    expect(captureDemoEvent).toHaveBeenCalledWith('demo_category_map_attempted', {});
  });

  it('should read mappings by the marketplace and the master when the page loads (#3993)', async () => {
    const getCategoryMappings = vi.fn().mockResolvedValue([]);
    renderPage(apiWith([sampleConnection, ALLEGRO_CONNECTION], { getCategoryMappings }));

    await screen.findByText('Men');

    await waitFor(() => {
      expect(getCategoryMappings).toHaveBeenCalledWith(ALLEGRO_CONNECTION.id, sampleConnection.id);
    });
  });

  it('should name the master platform in the category column and show progress for the marketplace', async () => {
    renderPage(apiWith([sampleConnection, ALLEGRO_CONNECTION]));

    expect(await screen.findByRole('columnheader', { name: 'PrestaShop categories' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Allegro store category' })).toBeInTheDocument();
    expect(await screen.findByText('0 of 1 mapped')).toBeInTheDocument();
  });

  it('should show only the categories still missing a mapping when "Not mapped" is chosen', async () => {
    const twoCategories = [
      ...PS_CATEGORIES,
      { id: '3', name: 'Women', parentId: '1', depth: 1, active: true },
    ];
    const mapped: CategoryMapping = { ...LEGACY_MAPPING, connectionId: ALLEGRO_CONNECTION.id, sourceConnectionId: sampleConnection.id };
    renderPage(
      apiWith([sampleConnection, ALLEGRO_CONNECTION], {
        getPrestashopCategories: vi.fn().mockResolvedValue(twoCategories),
        getCategoryMappings: vi.fn((connectionId: string) =>
          Promise.resolve(connectionId === ALLEGRO_CONNECTION.id ? [mapped] : []),
        ),
      }),
    );

    await screen.findByRole('button', { name: 'Choose a category for Women' });
    expect(await screen.findByRole('button', { name: 'Change the category for Men' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Not mapped/ }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Change the category for Men' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Choose a category for Women' })).toBeInTheDocument();
  });

  it('shows an empty state when no marketplace connection exists', async () => {
    renderPage(apiWith([sampleConnection]));

    expect(await screen.findByText('No marketplace to map to')).toBeInTheDocument();
  });

  it('auto-picks the single available marketplace connection', async () => {
    renderPage(apiWith([sampleConnection, ALLEGRO_CONNECTION]));

    const select = await screen.findByLabelText<HTMLSelectElement>('Map for');
    await waitFor(() => {
      expect(select.value).toBe(ALLEGRO_CONNECTION.id);
    });
  });

  it('excludes disabled marketplace connections from the selector', async () => {
    const disabledAllegro: Connection = { ...ALLEGRO_CONNECTION, id: 'conn_allegro_disabled', status: 'disabled' };
    renderPage(apiWith([sampleConnection, disabledAllegro]));

    expect(await screen.findByText('No marketplace to map to')).toBeInTheDocument();
  });

  it('should leave out a connection with no category tree of its own when listing marketplaces', async () => {
    const shopWithStockWriteBack: Connection = {
      ...ALLEGRO_CONNECTION,
      id: 'conn_woo',
      name: 'Woo shop',
      platformType: 'woocommerce',
      supportedCapabilities: ['OfferManager'],
    };
    renderPage(apiWith([sampleConnection, shopWithStockWriteBack]));

    expect(await screen.findByText('No marketplace to map to')).toBeInTheDocument();
  });

  it('should point to the catalogue connections when opened on a marketplace', async () => {
    const getPrestashopCategories = vi.fn().mockResolvedValue(PS_CATEGORIES);
    renderPage(
      apiWith([sampleConnection, ALLEGRO_CONNECTION], { getPrestashopCategories }),
      ALLEGRO_CONNECTION.id,
    );

    expect(await screen.findByText('Map categories from your catalogue')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: `Map from ${sampleConnection.name}` });
    expect(link).toHaveAttribute(
      'href',
      `/connections/${sampleConnection.id}/mappings/categories?marketplaceConnectionId=${ALLEGRO_CONNECTION.id}`,
    );
    expect(getPrestashopCategories).not.toHaveBeenCalled();
  });

  it('should move mappings saved under the master when the operator confirms (#3993)', async () => {
    const reassignCategoryMappings = vi.fn().mockResolvedValue({ moved: 1, keptSourceCategoryIds: [] });
    const getCategoryMappings = vi.fn((connectionId: string, sourceConnectionId?: string) =>
      Promise.resolve(connectionId === sampleConnection.id && sourceConnectionId === undefined ? [LEGACY_MAPPING] : []),
    );
    renderPage(
      apiWith([sampleConnection, ALLEGRO_CONNECTION], { getCategoryMappings, reassignCategoryMappings }),
    );

    expect(await screen.findByText('1 mapping is not used when you list offers')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use them for Allegro store' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use for Allegro store' }));

    await waitFor(() => {
      expect(reassignCategoryMappings).toHaveBeenCalledWith(ALLEGRO_CONNECTION.id, sampleConnection.id);
    });
    expect(await screen.findByText('1 mapping moved to Allegro store')).toBeInTheDocument();
  });
});
