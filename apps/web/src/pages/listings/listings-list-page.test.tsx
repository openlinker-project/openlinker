import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ListingsListPage } from './listings-list-page';
import type { PaginatedOfferMappings } from '../../features/listings/api/listings.types';

const sampleMappings: PaginatedOfferMappings = {
  items: [
    {
      id: 'uuid-mapping-1',
      entityType: 'Offer',
      internalId: 'ol_offer_abc123',
      externalId: 'allegro-offer-999',
      platformType: 'allegro',
      connectionId: 'conn_allegro_1',
      context: null,
      createdAt: '2026-01-20T09:00:00.000Z',
      updatedAt: '2026-01-20T09:00:00.000Z',
    },
    {
      id: 'uuid-mapping-2',
      entityType: 'Offer',
      internalId: 'ol_offer_def456',
      externalId: 'allegro-offer-888',
      platformType: 'allegro',
      connectionId: 'conn_allegro_1',
      context: { parentEntityType: 'Order' },
      createdAt: '2026-02-10T11:00:00.000Z',
      updatedAt: '2026-02-10T11:00:00.000Z',
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

describe('ListingsListPage', () => {
  afterEach(cleanup);
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(screen.getByText('Loading listings')).toBeInTheDocument();
  });

  it('should show mappings table when data loads', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(sampleMappings),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('allegro-offer-999')).toBeInTheDocument();
    expect(screen.getByText('ol_offer_abc123')).toBeInTheDocument();
    expect(screen.getByText('allegro-offer-888')).toBeInTheDocument();
    expect(screen.getAllByText('allegro')).toHaveLength(2);
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load listings')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should show empty state when no mappings exist', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No offer mappings found')).toBeInTheDocument();
  });

  it('should show empty state with filter message when filters are active', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<ListingsListPage />, {
      apiClient: mockApi,
      route: '/listings?search=unknown-offer',
    });

    expect(await screen.findByText('No offer mappings match the current filters.')).toBeInTheDocument();
  });
});
