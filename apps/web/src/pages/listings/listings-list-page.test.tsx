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

  it('should render the Create offer CTA enabled with no pre-filter', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    const cta = await screen.findByRole('button', { name: /create offer/i });
    expect(cta).toBeInTheDocument();
    expect(cta).not.toBeDisabled();
  });

  it('should render OfferCreationTracker when both URL params are present', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(sampleMappings),
        getOfferCreationStatus: vi.fn().mockResolvedValue({
          id: 'rec-1',
          connectionId: 'conn_allegro_1',
          internalVariantId: 'ol_variant_abc',
          externalOfferId: null,
          status: 'pending',
          errors: null,
          publishImmediately: false,
          createdAt: '2026-04-22T10:00:00Z',
          updatedAt: '2026-04-22T10:00:00Z',
        }),
      },
    });

    renderWithProviders(<ListingsListPage />, {
      apiClient: mockApi,
      route: '/listings?offerCreationRecordId=rec-1&trackedConnectionId=conn_allegro_1',
    });

    expect(await screen.findByText(/offer creation/i)).toBeInTheDocument();
    expect(await screen.findByText('Pending')).toBeInTheDocument();
  });

  it('should not render OfferCreationTracker when only one URL param is present', async () => {
    const getOfferCreationStatus = vi.fn();
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(sampleMappings),
        getOfferCreationStatus,
      },
    });

    renderWithProviders(<ListingsListPage />, {
      apiClient: mockApi,
      route: '/listings?offerCreationRecordId=rec-1',
    });

    // Wait for table to render so the page has mounted fully
    await screen.findByText('allegro-offer-999');
    expect(screen.queryByText(/offer creation/i)).not.toBeInTheDocument();
    expect(getOfferCreationStatus).not.toHaveBeenCalled();
  });
});
