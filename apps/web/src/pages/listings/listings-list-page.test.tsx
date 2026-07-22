import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
import { ListingsListPage } from './listings-list-page';
import type {
  CreateOfferRequest,
  PaginatedOfferMappings,
} from '../../features/listings/api/listings.types';

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

  it('navigates into the bulk wizard pre-seeded with the failed variant when Retry is clicked', async () => {
    const user = userEvent.setup();
    const sampleRequest: CreateOfferRequest = {
      internalVariantId: 'ol_variant_abc',
      stock: 7,
      publishImmediately: false,
      price: { amount: 120.5, currency: 'PLN' },
      overrides: {
        title: 'Prior Title',
        categoryId: '98765',
        description: null,
        platformParams: { deliveryPolicyId: 'del-1' },
      },
    };
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(sampleMappings),
        getOfferCreationStatus: vi.fn().mockResolvedValue({
          id: 'rec-1',
          connectionId: 'conn_allegro_1',
          internalVariantId: 'ol_variant_abc',
          externalOfferId: null,
          status: 'failed',
          errors: [{ code: 'X', message: 'boom' }],
          publishImmediately: false,
          createdAt: '2026-04-22T10:00:00Z',
          updatedAt: '2026-04-22T10:00:00Z',
          request: sampleRequest,
        }),
      },
      products: {
        getVariant: vi.fn().mockResolvedValue({
          id: 'ol_variant_abc',
          productId: 'ol_product_xyz',
          sku: 'SK-1',
          ean: null,
        }),
      },
    });

    renderWithProviders(<ListingsListPage />, {
      apiClient: mockApi,
      route: '/listings?offerCreationRecordId=rec-1&trackedConnectionId=conn_allegro_1',
    });

    const retry = await screen.findByRole('button', { name: /retry/i });
    await user.click(retry);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledTimes(1));
    const url = String(navigateMock.mock.calls.at(0)?.[0] ?? '');
    const qs = new URLSearchParams(url.split('?')[1] ?? '');
    expect(qs.get('productIds')).toBe('ol_product_xyz');
    expect(qs.get('variantIds')).toBe('ol_variant_abc');
    expect(qs.get('connectionId')).toBe('conn_allegro_1');

    // The tracker URL params are dropped before navigating away.
    expect(screen.queryByText(/offer creation/i)).not.toBeInTheDocument();
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
