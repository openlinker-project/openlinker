import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
import { mockMobileViewport } from '../../test/viewport';
import { ListingsListPage } from './listings-list-page';
import type {
  OfferMapping,
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
      internalId: 'ol_variant_abc123',
      externalId: 'allegro-offer-999',
      platformType: 'allegro',
      connectionId: 'conn_allegro_1',
      context: null,
      createdAt: '2026-01-20T09:00:00.000Z',
      updatedAt: '2026-01-20T09:00:00.000Z',
      identity: {
        productId: 'ol_product_1',
        productName: 'Doniczka ceramiczna Terra',
        variantLabel: 'Terakota 24 cm',
        sku: 'TERRA-24-TER',
        ean: '5900000000138',
        imageUrl: null,
        isStale: false,
      },
      channelStatus: {
        publicationStatus: 'active',
        lifecycle: 'Active',
        validationMessages: [],
        lastStatusSyncedAt: '2026-01-20T09:30:00.000Z',
      },
      commercial: {
        price: 100,
        currency: 'PLN',
        availableQuantity: 41,
        lastCommercialSyncedAt: '2026-01-20T09:30:00.000Z',
      },
    },
    {
      id: 'uuid-mapping-2',
      entityType: 'Offer',
      internalId: 'ol_variant_def456',
      externalId: 'allegro-offer-888',
      platformType: 'allegro',
      connectionId: 'conn_allegro_1',
      context: { parentEntityType: 'Order' },
      createdAt: '2026-02-10T11:00:00.000Z',
      updatedAt: '2026-02-10T11:00:00.000Z',
      identity: {
        productId: 'ol_product_2',
        productName: 'Osłonka Nordic',
        variantLabel: 'Biały mat 18 cm',
        sku: 'NORD-18-WHT',
        ean: '5900000000212',
        imageUrl: null,
        isStale: false,
      },
      channelStatus: {
        publicationStatus: 'active',
        lifecycle: 'Active',
        validationMessages: [],
        lastStatusSyncedAt: '2026-02-10T11:30:00.000Z',
      },
      commercial: {
        price: 59,
        currency: 'PLN',
        availableQuantity: 0,
        lastCommercialSyncedAt: '2026-02-10T11:30:00.000Z',
      },
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

function oneRow(overrides: Partial<OfferMapping>): PaginatedOfferMappings {
  return {
    ...sampleMappings,
    items: [{ ...sampleMappings.items[0], ...overrides }],
    total: 1,
  };
}

// Deliberately carries a DIFFERENT platformType than the rows it is wired to:
// the channel pill must resolve from the ROW, never from its connection.
const MISMATCHED_PLATFORM_CONNECTION = {
  id: 'conn_allegro_1',
  name: 'Erli Demo',
  platformType: 'erli',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'erli.shopapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
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

  it('should lead each row with the catalog product name, variant and identifiers', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(sampleMappings),
      },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Doniczka ceramiczna Terra')).toBeInTheDocument();
    expect(screen.getByText('Terakota 24 cm')).toBeInTheDocument();
    expect(screen.getByText('Osłonka Nordic')).toBeInTheDocument();
    // The three identifiers group on the row's second line.
    expect(screen.getByText('allegro-offer-999')).toBeInTheDocument();
    expect(screen.getByText('TERRA-24-TER')).toBeInTheDocument();
    expect(screen.getByText('5900000000138')).toBeInTheDocument();
    // The raw internal-id column is gone - it is an identifier, not an identity.
    expect(screen.queryByText('ol_variant_abc123')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.listing-cell')).toHaveLength(2);
  });

  it('should render the six redesigned column headers and drop the raw-ID ones', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'Listing',
      'Channel',
      'Connection',
      'Priceon channel',
      'Quantityon channel',
      // Not "when this listing changed" - when OL last read the channel. The
      // mobile card calls the identical value "Status read".
      'Updatedstatus read',
    ]);
  });

  it('should render a channel pill carrying the platform for its dot colour', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    expect(container.querySelectorAll('.channel-pill[data-channel="allegro"]')).toHaveLength(2);
  });

  it('should resolve the connection column from one batched read, not a per-row fetch', async () => {
    const connectionsList = vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]);
    const connectionGetById = vi.fn();
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
      connections: { list: connectionsList, getById: connectionGetById },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findAllByText('Erli Demo')).toHaveLength(2);
    expect(connectionGetById).not.toHaveBeenCalled();
    // The fixture's platformType ('erli') differs from its rows' ('allegro') -
    // the pill must follow the row.
    expect(container.querySelectorAll('.channel-pill[data-channel="allegro"]')).toHaveLength(2);
    expect(container.querySelector('.channel-pill[data-channel="erli"]')).toBeNull();
  });

  it('should date the channel price on the cell rather than repeating the Updated column', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    const price = container.querySelector('.price-cell');
    expect(price?.querySelector('.price-cell__value')?.textContent).toContain('100');
    expect(price?.getAttribute('title')).toMatch(/^Price and quantity on channel, last read /);
    // The commercial and status snapshots come from the same statusSync pass
    // (#2024), so the age is not printed a second time under the price.
    expect(container.querySelector('.price-cell__age')).toBeNull();
  });

  it('should badge a zero channel quantity as out of stock', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Out of stock')).toBeInTheDocument();
  });

  it('should render an unreported price and quantity as absent, never as zero', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(
          oneRow({
            commercial: {
              price: null,
              currency: null,
              availableQuantity: null,
              lastCommercialSyncedAt: '2026-01-20T09:30:00.000Z',
            },
          }),
        ),
      },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    expect(screen.getByLabelText('Price not reported by the channel')).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity not reported by the channel')).toBeInTheDocument();
    expect(screen.queryByText('Out of stock')).not.toBeInTheDocument();
    // The reading is still dated even when neither value came back.
    expect(container.querySelector('.price-cell')?.getAttribute('title')).toMatch(/last read/);
  });

  it('should say no reading was taken - not that the channel withheld one - when no snapshot exists', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(oneRow({ commercial: null })) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    // Both commercial cells state the same fact: nothing was ever persisted for
    // this offer. On a connection whose status-sync task is off, that is every
    // row - so neither cell may blame the marketplace for withholding a number.
    expect(screen.getAllByLabelText('No channel reading yet')).toHaveLength(2);
    expect(screen.queryByLabelText('Quantity not reported by the channel')).not.toBeInTheDocument();
  });

  it('should give a stale variant that still has channel stock a solid overselling treatment', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(
          oneRow({
            identity: {
              productId: 'ol_product_1',
              productName: 'Doniczka ceramiczna Terra',
              variantLabel: 'Terakota 24 cm',
              sku: 'TERRA-24-TER',
              ean: '5900000000138',
              imageUrl: null,
              isStale: true,
            },
          }),
        ),
      },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Selling deleted product')).toBeInTheDocument();
    expect(container.querySelector('.status-badge--solid')).toBeInTheDocument();
    expect(
      screen.getByText('Still 41 available on channel - the master product no longer exists'),
    ).toBeInTheDocument();
  });

  it('should mark an unsynced row without promising it will sync soon', async () => {
    const mockApi = createMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(
          oneRow({
            channelStatus: {
              publicationStatus: null,
              lifecycle: 'Unsynced',
              validationMessages: [],
              lastStatusSyncedAt: null,
            },
          }),
        ),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Not synced')).toBeInTheDocument();
    expect(screen.getByLabelText('Channel status never read')).toBeInTheDocument();
  });

  it('should report a mapping whose variant no longer resolves instead of blanking the cell', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(oneRow({ identity: null })) },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No linked variant')).toBeInTheDocument();
    expect(screen.getByText('allegro-offer-999')).toBeInTheDocument();
    // A listing OL can no longer key on, still selling on the channel, is the
    // same money-shaped state as a stale one - not quieter than a Draft chip.
    expect(screen.getByText('Unlinked')).toBeInTheDocument();
    expect(container.querySelector('.status-badge--solid')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Still 41 available on channel - no OpenLinker product is linked to this listing',
      ),
    ).toBeInTheDocument();
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

  it('renders a single "Publish products" entry (no separate shop CTA) with no pre-filter', async () => {
    const mockApi = createMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi, sessionAdapter: createAuthenticatedSessionAdapter() });

    const cta = await screen.findByRole('button', { name: /publish products/i });
    expect(cta).toBeInTheDocument();
    expect(cta).not.toBeDisabled();
    // The old duplicate CTAs are folded into the single unified entry (#1828).
    expect(screen.queryByRole('button', { name: /create offer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish to shop/i })).not.toBeInTheDocument();
  });

  it('keeps the single unified entry even when a ProductPublisher (shop) connection exists', async () => {
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

    expect(await screen.findByRole('button', { name: /publish products/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish to shop/i })).not.toBeInTheDocument();
  });

  describe('mobile card fold (#1965 frame 05)', () => {
    it('should fold to cards leading with the listing head and a four-fact list', async () => {
      const viewport = mockMobileViewport();
      try {
        const mockApi = createMockApiClient({
          listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
          connections: { list: vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]) },
        });

        const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

        await screen.findByText('Doniczka ceramiczna Terra');
        expect(container.querySelector('table')).not.toBeInTheDocument();
        expect(container.querySelectorAll('.data-table__card')).toHaveLength(2);
        // The head is frame 05's own reshape, not the table cell squeezed; the
        // four dropped columns become the fact list beneath it.
        expect(container.querySelectorAll('.listing-cell--card')).toHaveLength(2);
        const facts = container.querySelector('.listings-card-facts');
        expect(facts?.querySelectorAll('dt')).toHaveLength(4);
        expect([...(facts?.querySelectorAll('dt') ?? [])].map((dt) => dt.textContent)).toEqual([
          'Channel',
          'Connection',
          'Price on channel',
          'Quantity on channel',
        ]);
      } finally {
        viewport.restore();
      }
    });

    it('should keep the card head to name, variant and SKU, with the rest behind a disclosure', async () => {
      const viewport = mockMobileViewport();
      try {
        const user = userEvent.setup();
        const mockApi = createMockApiClient({
          listings: { list: vi.fn().mockResolvedValue(oneRow({})) },
        });

        renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

        await screen.findByText('Doniczka ceramiczna Terra');
        expect(screen.getByText('Terakota 24 cm')).toBeInTheDocument();
        expect(screen.getByText('TERRA-24-TER')).toBeInTheDocument();
        // At 360px the offer id and EAN would take the product name's room, so
        // frame 05 drops them from the head - they move into the disclosure.
        expect(screen.queryByText('allegro-offer-999')).not.toBeInTheDocument();
        expect(screen.queryByText('5900000000138')).not.toBeInTheDocument();
        expect(screen.queryByText('ol_variant_abc123')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /view full details/i }));

        expect(screen.getByText('allegro-offer-999')).toBeInTheDocument();
        expect(screen.getByText('5900000000138')).toBeInTheDocument();
        expect(screen.getByText('ol_variant_abc123')).toBeInTheDocument();
        expect(screen.getByText('Lifecycle')).toBeInTheDocument();
      } finally {
        viewport.restore();
      }
    });
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

    it('shows the unified "Publish products" entry enabled instead of hiding it', async () => {
      renderWithProviders(<ListingsListPage />, { apiClient: demoApiClient(), ...viewerSession });

      const publish = await screen.findByRole('button', { name: /publish products/i });
      expect(publish).not.toBeDisabled();
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
      expect(screen.queryByRole('button', { name: /publish products/i })).not.toBeInTheDocument();
    });
  });
});
