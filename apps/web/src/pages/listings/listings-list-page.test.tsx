import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
import { ListingsListPage } from './listings-list-page';
import type { PaginatedOfferMappings } from '../../features/listings/api/listings.types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (): Promise<typeof ReactRouterDom> => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: (): typeof navigateMock => navigateMock };
});

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
  afterEach(() => navigateMock.mockClear());
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
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

  it('should show empty state with a Manage connections CTA when no mappings exist', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No offer mappings found')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Manage connections' });
    expect(cta).toHaveAttribute('href', '/connections');
  });

  it('should show a Clear filters button that clears filters when filters are active', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<ListingsListPage />, {
      apiClient: mockApi,
      route: '/listings?search=unknown-offer',
    });

    expect(
      await screen.findByText('No offer mappings match the current filters.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('link', { name: 'Manage connections' })).toBeInTheDocument();
  });

  it('should render the Create offer CTA enabled with no pre-filter', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() });

    const cta = await screen.findByRole('button', { name: /create offer/i });
    expect(cta).toBeInTheDocument();
    expect(cta).not.toBeDisabled();
  });

  it('hides the "Publish to shop" CTA when no ProductPublisher connection exists', async () => {
    // Default connections mock returns a single PrestaShop connection with
    // no ProductPublisher capability — the CTA must stay hidden.
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('allegro-offer-999');
    expect(screen.queryByRole('button', { name: /publish to shop/i })).not.toBeInTheDocument();
  });

  it('shows the "Publish to shop" CTA when a ProductPublisher connection exists', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn_woo_1',
            name: 'Main WooCommerce store',
            platformType: 'woocommerce',
            status: 'active',
            config: {},
            credentialsBacked: true,
            adapterKey: 'woocommerce.restapi.v3',
            enabledCapabilities: ['ProductPublisher'],
            supportedCapabilities: ['ProductPublisher'],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ]),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() });

    expect(await screen.findByRole('button', { name: /publish to shop/i })).toBeInTheDocument();
  });

  describe('demo read-only viewer (#1663)', () => {
    const viewerSession = {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['listings:read'],
      }),
    };

    function demoApiClient(): ReturnType<typeof createMockApiClient> {
      return createMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              id: 'conn_woo_1',
              name: 'Main WooCommerce store',
              platformType: 'woocommerce',
              status: 'active',
              config: {},
              credentialsBacked: true,
              adapterKey: 'woocommerce.restapi.v3',
              enabledCapabilities: ['ProductPublisher'],
              supportedCapabilities: ['ProductPublisher'],
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ]),
        },
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });
    }

    it('shows both Create offer and Publish to shop enabled instead of hiding them', async () => {
      renderWithProviders(<ListingsListPage />, { apiClient: demoApiClient(), ...viewerSession });

      const createOffer = await screen.findByRole('button', { name: /create offer/i });
      expect(createOffer).not.toBeDisabled();
      const publishToShop = screen.getByRole('button', { name: /publish to shop/i });
      expect(publishToShop).not.toBeDisabled();
    });

    it('keeps the existing hide-when-missing behaviour for an unauthorized non-demo viewer', async () => {
      const mockApi = createMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
        connections: {
          list: vi.fn().mockResolvedValue([
            {
              id: 'conn_woo_1',
              name: 'Main WooCommerce store',
              platformType: 'woocommerce',
              status: 'active',
              config: {},
              credentialsBacked: true,
              adapterKey: 'woocommerce.restapi.v3',
              enabledCapabilities: ['ProductPublisher'],
              supportedCapabilities: ['ProductPublisher'],
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ]),
        },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi, ...viewerSession });

      await screen.findByText('allegro-offer-999');
      expect(screen.queryByRole('button', { name: /create offer/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /publish to shop/i })).not.toBeInTheDocument();
    });
  });
});
