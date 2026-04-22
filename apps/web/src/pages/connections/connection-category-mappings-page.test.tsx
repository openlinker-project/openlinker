/**
 * ConnectionCategoryMappingsPage tests
 *
 * Covers the marketplace-connection selector behavior introduced for #173:
 * - empty state when no Marketplace-capable connection exists,
 * - auto-pick when exactly one Marketplace connection is available.
 *
 * @module apps/web/src/pages/connections
 */

import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionCategoryMappingsPage } from './connection-category-mappings-page';
import type { Connection } from '../../features/connections/api/connections.types';

const PS_CATEGORIES = [{ id: '2', name: 'Men', parentId: '1', depth: 1, active: true }];

const ALLEGRO_CONNECTION: Connection = {
  ...sampleConnection,
  id: 'conn_allegro_1',
  name: 'Allegro store',
  platformType: 'allegro',
  status: 'active',
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
};

describe('ConnectionCategoryMappingsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(cleanup);

  it('shows an empty state when no Marketplace-capable connection exists', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([sampleConnection]),
      },
      mappings: {
        getCategoryMappings: vi.fn().mockResolvedValue([]),
        getPrestashopCategories: vi.fn().mockResolvedValue(PS_CATEGORIES),
      },
    });

    renderWithProviders(<ConnectionCategoryMappingsPage />, { apiClient });

    expect(await screen.findByText('No marketplace connection configured')).toBeInTheDocument();
  });

  it('auto-picks the single available Marketplace connection', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([sampleConnection, ALLEGRO_CONNECTION]),
      },
      mappings: {
        getCategoryMappings: vi.fn().mockResolvedValue([]),
        getPrestashopCategories: vi.fn().mockResolvedValue(PS_CATEGORIES),
      },
    });

    renderWithProviders(<ConnectionCategoryMappingsPage />, { apiClient });

    const select = await screen.findByLabelText<HTMLSelectElement>('Marketplace connection');
    await waitFor(() => {
      expect(select.value).toBe(ALLEGRO_CONNECTION.id);
    });
  });

  it('excludes disabled Marketplace connections from the selector', async () => {
    const disabledAllegro: Connection = { ...ALLEGRO_CONNECTION, id: 'conn_allegro_disabled', status: 'disabled' };
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([sampleConnection, disabledAllegro]),
      },
      mappings: {
        getCategoryMappings: vi.fn().mockResolvedValue([]),
        getPrestashopCategories: vi.fn().mockResolvedValue(PS_CATEGORIES),
      },
    });

    renderWithProviders(<ConnectionCategoryMappingsPage />, { apiClient });

    expect(await screen.findByText('No marketplace connection configured')).toBeInTheDocument();
  });
});
