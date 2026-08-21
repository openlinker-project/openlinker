import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { renderWithProviders, createMockApiClient, createAuthenticatedSessionAdapter } from '../../test/test-utils';
import { mockMobileViewport } from '../../test/viewport';
import { ListingsListPage } from './listings-list-page';
import type {
  OfferLifecycleCounts,
  OfferMapping,
  PaginatedOfferMappings,
} from '../../features/listings/api/listings.types';

const ZERO_LIFECYCLE_COUNTS: OfferLifecycleCounts = {
  Active: 0,
  Invalid: 0,
  Draft: 0,
  Ended: 0,
  Unsynced: 0,
};

function emptyPage(counts: OfferLifecycleCounts = ZERO_LIFECYCLE_COUNTS): PaginatedOfferMappings {
  return { items: [], total: 0, limit: 20, offset: 0, lifecycleCounts: counts };
}

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
        price: '100.00',
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
        price: '59.00',
        currency: 'PLN',
        availableQuantity: 0,
        lastCommercialSyncedAt: '2026-02-10T11:30:00.000Z',
      },
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
  lifecycleCounts: { ...ZERO_LIFECYCLE_COUNTS, Active: 2 },
};

// `createMockApiClient`'s own default connection (`sampleConnection`, shared
// across the whole FE test suite) models a shop - ProductMaster /
// InventoryMaster / OrderProcessorManager / OrderSource, deliberately no
// OfferManager (mirrors a real PrestaShop-only install). `/listings` is
// backed exclusively by OfferManager-capable connections (#2032 review round
// 2, finding 1), so relying on that shared default here would make every
// test in this file exercise the "no channels connected" empty state instead
// of the page's real behaviour - exactly the failure this fixture fixes.
// Mirrors the established per-feature-capability pattern already used for
// invoicing tests (see test-utils.tsx's own note on Invoicing connections).
const OFFER_MANAGER_CONNECTION = {
  id: 'conn_allegro_1',
  name: 'Allegro Store',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  adapterKey: 'allegro.publicapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/**
 * Thin wrapper over `createMockApiClient` that defaults `connections.list`
 * to an `OfferManager`-capable connection instead of the shared
 * shop-shaped default, so every test in this file exercises the page's real
 * behaviour unless it explicitly overrides `connections` itself (in which
 * case the override wins, same as `createMockApiClient`'s own merge order).
 */
function createListingsMockApiClient(
  overrides: Parameters<typeof createMockApiClient>[0] = {},
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([OFFER_MANAGER_CONNECTION]) },
    ...overrides,
  });
}

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
  describe('shop-level channel problems (#2231)', () => {
    const shopBlockedPage = (): PaginatedOfferMappings =>
      oneRow({
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Invalid',
          validationMessages: [
            'Finish verification in the Erli seller panel; the next status read clears it.',
            'Set the tax rate on the product and publish again.',
          ],
          validationProblems: [
            {
              code: 'shopKyc',
              summary: 'Shop verification incomplete',
              message:
                'Finish verification in the Erli seller panel; the next status read clears it.',
              scope: 'account',
            },
            {
              code: 'missingTaxRate',
              summary: 'No VAT rate set on Erli',
              message: 'Set the tax rate on the product and publish again.',
              scope: 'offer',
            },
          ],
          lastStatusSyncedAt: '2026-01-20T09:30:00.000Z',
        },
      });

    it('should carry a shop-level problem once, above the table, naming the connection', async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(shopBlockedPage()) },
        connections: { list: vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]) },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      expect(
        await screen.findByText('Erli Demo reports a shop-level block'),
      ).toBeInTheDocument();
      expect(screen.getByText('1 of the listings shown here is affected.')).toBeInTheDocument();
      // The raw channel code stays reachable for a support ticket.
      expect(screen.getByText('shopKyc')).toBeInTheDocument();
    });

    it('should keep the row on its own problem rather than repeating the shop one', async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(shopBlockedPage()) },
        connections: { list: vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]) },
      });

      const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Erli Demo reports a shop-level block');
      const reason = container.querySelector('.listing-cell__reason');
      expect(reason?.textContent).toBe('No VAT rate set on Erli');
      expect(reason?.className).not.toContain('listing-cell__reason--muted');
    });

    it('should mute the row of a listing whose only problem is the shop', async () => {
      const mockApi = createListingsMockApiClient({
        listings: {
          list: vi.fn().mockResolvedValue(
            oneRow({
              channelStatus: {
                publicationStatus: 'inactive',
                lifecycle: 'Invalid',
                validationMessages: ['Finish verification in the Erli seller panel.'],
                validationProblems: [
                  {
                    code: 'shopKyc',
                    summary: 'Shop verification incomplete',
                    message: 'Finish verification in the Erli seller panel.',
                    scope: 'account',
                  },
                ],
                lastStatusSyncedAt: '2026-01-20T09:30:00.000Z',
              },
            }),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]) },
      });

      const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Erli Demo reports a shop-level block');
      const reason = container.querySelector('.listing-cell__reason');
      expect(reason?.textContent).toBe('Blocked by a problem with the shop, not this listing');
      expect(reason?.className).toContain('listing-cell__reason--muted');
    });

    it('should raise no notice when every problem belongs to the offer', async () => {
      const mockApi = createListingsMockApiClient({
        listings: {
          list: vi.fn().mockResolvedValue(
            oneRow({
              channelStatus: {
                publicationStatus: 'inactive',
                lifecycle: 'Invalid',
                validationMessages: ['Set the tax rate on the product and publish again.'],
                validationProblems: [
                  {
                    code: 'missingTaxRate',
                    summary: 'No VAT rate set on Erli',
                    message: 'Set the tax rate on the product and publish again.',
                    scope: 'offer',
                  },
                ],
                lastStatusSyncedAt: '2026-01-20T09:30:00.000Z',
              },
            }),
          ),
        },
        connections: { list: vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]) },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      expect(await screen.findByText('No VAT rate set on Erli')).toBeInTheDocument();
      expect(screen.queryByText('Erli Demo reports a shop-level block')).not.toBeInTheDocument();
    });
  });

  it('should show loading state initially', () => {
    const mockApi = createListingsMockApiClient({
      listings: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    // Two independent `role="status"` regions legitimately coexist during the
    // very first load: the tab-count announcer and DataTableSkeleton's own
    // status region for the row table - a singular query is ambiguous here.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('should lead each row with the catalog product name, variant and identifiers', async () => {
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    expect(container.querySelectorAll('.channel-pill[data-channel="allegro"]')).toHaveLength(2);
  });

  it('should resolve the connection column from one batched read, not a per-row fetch', async () => {
    const connectionsList = vi.fn().mockResolvedValue([MISMATCHED_PLATFORM_CONNECTION]);
    const connectionGetById = vi.fn();
    const mockApi = createListingsMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
      connections: { list: connectionsList, getById: connectionGetById },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    // Scoped to the table, not the whole document: the fixture connection is
    // `OfferManager`-capable, so it also renders as the sole channel-select
    // option (#2030) - a whole-document query would ambiguously count that
    // option's own text alongside the two row cells it is meant to check.
    const table = container.querySelector('.listings-table');
    if (!table) throw new Error('listings table did not render');
    expect(within(table as HTMLElement).getAllByText('Erli Demo')).toHaveLength(2);
    expect(connectionGetById).not.toHaveBeenCalled();
    // The fixture's platformType ('erli') differs from its rows' ('allegro') -
    // the pill must follow the row.
    expect(container.querySelectorAll('.channel-pill[data-channel="allegro"]')).toHaveLength(2);
    expect(container.querySelector('.channel-pill[data-channel="erli"]')).toBeNull();
  });

  it('should date the channel price on the cell rather than repeating the Updated column', async () => {
    const mockApi = createListingsMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    const price = container.querySelector('.price-cell');
    expect(price?.querySelector('.price-cell__value')?.textContent).toContain('100');
    expect(price?.getAttribute('title')).toMatch(/^Price and quantity on channel, last read /);
    // The commercial and status snapshots in this fixture share one instant
    // (#2024's common case), so no separate age line renders under the
    // price - the tooltip carries it, mirrored for a11y via sr-only text
    // rather than a second visible element (#2032 review thread 7).
    expect(container.querySelector('.price-cell__age')).toBeNull();
    expect(price?.textContent).toContain('Price and quantity on channel, last read');
    // No divergence in this fixture, so no stale flag.
    expect(price?.querySelector('.price-cell__stale')).toBeNull();
  });

  it('should flag the price as stale when its own reading is older than the visible status clock', async () => {
    const mockApi = createListingsMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(
          oneRow({
            channelStatus: {
              publicationStatus: 'active',
              lifecycle: 'Active',
              validationMessages: [],
              lastStatusSyncedAt: '2026-01-20T12:00:00.000Z',
            },
            commercial: {
              price: '100.00',
              currency: 'PLN',
              availableQuantity: 41,
              // Over two hours behind the status read (#2032 review thread 7)
              // - the commercial write can fail while the status write it
              // rode in on succeeds, so the two clocks are not interchangeable.
              lastCommercialSyncedAt: '2026-01-20T09:30:00.000Z',
            },
          }),
        ),
      },
    });

    const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    await screen.findByText('Doniczka ceramiczna Terra');
    expect(container.querySelector('.price-cell .price-cell__stale')).not.toBeNull();
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('should badge a zero channel quantity as out of stock', async () => {
    const mockApi = createListingsMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Out of stock')).toBeInTheDocument();
  });

  it('should render an unreported price and quantity as absent, never as zero', async () => {
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
      listings: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load listings')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it("should show the Active tab's own empty state when a connection exists but nothing is synced", async () => {
    const mockApi = createListingsMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(emptyPage()),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No active listings')).toBeInTheDocument();
    expect(screen.getByText('Nothing here is currently live on a channel.')).toBeInTheDocument();
    // No connections CTA - a connection already exists (test-utils default).
    expect(screen.queryByRole('link', { name: 'Connect a channel' })).not.toBeInTheDocument();
  });

  it('should show a channel-connect empty state when no connections are configured', async () => {
    const mockApi = createListingsMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(emptyPage()) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No channels connected yet')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Connect a channel' });
    expect(cta).toHaveAttribute('href', '/connections');
  });

  it('should show the channel-connect empty state when connections exist but none support OfferManager (#2032 review round 2, finding 1)', async () => {
    const mockApi = createListingsMockApiClient({
      listings: { list: vi.fn().mockResolvedValue(emptyPage()) },
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn_prestashop_1',
            name: 'PrestaShop Store',
            platformType: 'prestashop',
            status: 'active',
            config: {},
            credentialsBacked: true,
            adapterKey: 'prestashop.webservice.v1',
            // ProductMaster only - the /listings page can never render a row
            // for this connection, so the generic "not synced yet" empty
            // state must not be shown for it.
            enabledCapabilities: ['ProductMaster'],
            supportedCapabilities: ['ProductMaster'],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ]),
      },
    });

    renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No channels connected yet')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Connect a channel' });
    expect(cta).toHaveAttribute('href', '/connections');
    // The channel select must not offer a connection that can never produce a row.
    expect(screen.queryByRole('option', { name: 'PrestaShop Store' })).not.toBeInTheDocument();
  });

  it('should show a Clear filters button that clears filters when filters are active', async () => {
    const user = userEvent.setup();
    const mockApi = createListingsMockApiClient({
      listings: {
        list: vi.fn().mockResolvedValue(emptyPage()),
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

    expect(await screen.findByText('No active listings')).toBeInTheDocument();
  });

  it('renders a single "Publish products" entry (no separate shop CTA) with no pre-filter', async () => {
    const mockApi = createListingsMockApiClient({
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
    const mockApi = createListingsMockApiClient({
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
        const mockApi = createListingsMockApiClient({
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
        const mockApi = createListingsMockApiClient({
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
      return createListingsMockApiClient({
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
      const mockApi = createListingsMockApiClient({
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

  describe('lifecycle tabs (#2029)', () => {
    it('defaults to the Active tab and filters the request by lifecycle=Active', async () => {
      const list = vi.fn().mockResolvedValue(sampleMappings);
      const mockApi = createListingsMockApiClient({ listings: { list } });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
      const calledWithActive = list.mock.calls.some(
        ([filters]) => (filters as { lifecycle?: string } | undefined)?.lifecycle === 'Active'
      );
      expect(calledWithActive).toBe(true);
    });

    it('reads a valid ?tab param, marks it active and filters the request by its lifecycle', async () => {
      const list = vi.fn().mockResolvedValue(emptyPage());
      const mockApi = createListingsMockApiClient({ listings: { list } });

      renderWithProviders(<ListingsListPage />, {
        apiClient: mockApi,
        route: '/listings?tab=ended',
      });

      expect(await screen.findByText('No ended listings')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Ended/ })).toHaveAttribute('aria-selected', 'true');
      const calledWithEnded = list.mock.calls.some(
        ([filters]) => (filters as { lifecycle?: string } | undefined)?.lifecycle === 'Ended'
      );
      expect(calledWithEnded).toBe(true);
    });

    it('shows a refetch indicator while a tab switch is in flight, and clears it once it resolves (#2032 review round 2, finding 2)', async () => {
      const user = userEvent.setup();
      let resolveSecondFetch: (value: PaginatedOfferMappings) => void = () => {};
      const list = vi
        .fn()
        .mockResolvedValueOnce(sampleMappings)
        .mockImplementationOnce(
          () =>
            new Promise<PaginatedOfferMappings>((resolve) => {
              resolveSecondFetch = resolve;
            }),
        );
      const mockApi = createListingsMockApiClient({ listings: { list } });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(document.querySelector('.listings-refetch-indicator')).toBeNull();

      await user.click(screen.getByRole('tab', { name: /^Draft/ }));

      // `keepPreviousData` keeps the Active tab's rows on screen while the
      // Draft tab's fetch is in flight - the indicator is the only signal
      // that a new request is running.
      await waitFor(() => {
        expect(document.querySelector('.listings-refetch-indicator')).not.toBeNull();
      });
      expect(screen.getByText('Doniczka ceramiczna Terra')).toBeInTheDocument();

      resolveSecondFetch(emptyPage());

      await waitFor(() => {
        expect(document.querySelector('.listings-refetch-indicator')).toBeNull();
      });
    });

    it('falls back to the Active tab for an unrecognized ?tab param', async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(emptyPage()) },
      });

      renderWithProviders(<ListingsListPage />, {
        apiClient: mockApi,
        route: '/listings?tab=bogus',
      });

      expect(await screen.findByText('No active listings')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('updates the ?tab URL param and resets pagination to page 1 when a tab is clicked', async () => {
      const user = userEvent.setup();
      const list = vi.fn().mockResolvedValue(emptyPage());
      const mockApi = createListingsMockApiClient({ listings: { list } });

      renderWithProviders(<ListingsListPage />, {
        apiClient: mockApi,
        route: '/listings?offset=40',
      });

      await screen.findByText('No active listings');
      await user.click(screen.getByRole('tab', { name: /^Draft/ }));

      expect(await screen.findByText('No draft listings')).toBeInTheDocument();
      await vi.waitFor(() => {
        const [filters, pagination] = list.mock.calls.at(-1) ?? [];
        expect((filters as { lifecycle?: string } | undefined)?.lifecycle).toBe('Draft');
        expect((pagination as { offset?: number } | undefined)?.offset).toBe(0);
      });
    });

    it("renders each tab's own count from lifecycleCounts, not the active bucket's row count", async () => {
      const mockApi = createListingsMockApiClient({
        listings: {
          list: vi.fn().mockResolvedValue({
            ...sampleMappings,
            lifecycleCounts: { Active: 7, Invalid: 3, Draft: 2, Ended: 1, Unsynced: 0 },
          }),
        },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(screen.getByRole('tab', { name: /^Active/ })).toHaveTextContent('7');
      expect(screen.getByRole('tab', { name: /^Invalid/ })).toHaveTextContent('3');
      expect(screen.getByRole('tab', { name: /^Draft/ })).toHaveTextContent('2');
      expect(screen.getByRole('tab', { name: /^Ended/ })).toHaveTextContent('1');
      expect(screen.getByRole('tab', { name: /^Unsynced/ })).toHaveTextContent('0');
    });

    it('renders tab counts as skeleton placeholders while loading, never as a placeholder zero', () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
      });

      const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      expect(screen.getAllByRole('tab')).toHaveLength(5);
      expect(container.querySelectorAll('.tabs__count-skeleton')).toHaveLength(5);
    });

    it("keeps every tab's already-known count visible - no skeleton reappears - while a switched-to tab is still loading its own rows", async () => {
      const user = userEvent.setup();
      const list = vi
        .fn()
        .mockResolvedValueOnce({
          ...sampleMappings,
          lifecycleCounts: { Active: 7, Invalid: 3, Draft: 2, Ended: 1, Unsynced: 0 },
        })
        // The Draft tab's own fetch never resolves in this test - it is the
        // "still loading" window the skeleton must not reappear during.
        .mockReturnValueOnce(new Promise(() => {}));
      const mockApi = createListingsMockApiClient({ listings: { list } });

      const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(screen.getByRole('tab', { name: 'Active 7' })).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /^Draft/ }));

      // The Draft tab's own request is now pending (a fresh query key with no
      // cached data), which used to blank every badge - including the four
      // that did not just change - back to skeleton.
      expect(container.querySelectorAll('.tabs__count-skeleton')).toHaveLength(0);
      expect(screen.getByRole('tab', { name: 'Active 7' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Invalid 3' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Draft 2' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Ended 1' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Unsynced 0' })).toBeInTheDocument();
    });

    it("falls back to skeletons - not the pre-search counts - once the search term changes and the new query has not resolved (#2029 round 2 review)", async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce({
          ...sampleMappings,
          lifecycleCounts: { Active: 7, Invalid: 3, Draft: 2, Ended: 1, Unsynced: 0 },
        })
        // The new search term's query key has never been fetched before - it
        // hangs, which is the window during which a state+Effect pair used to
        // keep showing the now-wrong "Active 7" (it only ever cleared on the
        // NEXT successful fetch, so an error here would have left it stuck
        // forever). The fingerprint-gated ref must drop it immediately.
        .mockReturnValueOnce(new Promise(() => {}));
      const mockApi = createListingsMockApiClient({ listings: { list } });

      const { container } = renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(screen.getByRole('tab', { name: 'Active 7' })).toBeInTheDocument();

      fireEvent.change(
        screen.getByLabelText('Search listings by product name, SKU, EAN or external ID'),
        { target: { value: 'brand new search term' } },
      );

      // Wait past the debounce window for the new (still-pending) request.
      await vi.waitFor(() => {
        expect(list).toHaveBeenCalledTimes(2);
      });

      // The stale count must not survive the filter change - it falls
      // through to the skeleton, the honest state while the real count for
      // the new search term is unknown.
      expect(screen.queryByRole('tab', { name: 'Active 7' })).not.toBeInTheDocument();
      expect(container.querySelectorAll('.tabs__count-skeleton')).toHaveLength(5);
    });

    it("separates a tab's label from its count badge in the accessible name", async () => {
      const mockApi = createListingsMockApiClient({
        listings: {
          list: vi.fn().mockResolvedValue({
            ...sampleMappings,
            lifecycleCounts: { Active: 7, Invalid: 3, Draft: 2, Ended: 1, Unsynced: 0 },
          }),
        },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      // A missing separator collapses the JSX whitespace entirely, so the
      // accessible name would read the run-on "Active7" instead of "Active 7".
      expect(screen.getByRole('tab', { name: 'Active 7' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Invalid 3' })).toBeInTheDocument();
    });

    it('announces via a live region once the tab counts resolve from skeleton to real numbers', async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      expect(screen.getByText('Loading listing counts…')).toBeInTheDocument();
      await screen.findByText('Doniczka ceramiczna Terra');
      expect(screen.getByText('Listing counts loaded.')).toBeInTheDocument();
      expect(screen.queryByText('Loading listing counts…')).not.toBeInTheDocument();
    });
  });

  describe('lifecycle tab empty-state copy (#2042 review)', () => {
    it("does not overclaim the Draft bucket will go live, and avoids a double negative", async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(emptyPage()) },
      });

      renderWithProviders(<ListingsListPage />, {
        apiClient: mockApi,
        route: '/listings?tab=draft',
      });

      expect(await screen.findByText('No draft listings')).toBeInTheDocument();
      expect(
        screen.getByText('Nothing here is currently live, and none of it has been rejected.'),
      ).toBeInTheDocument();
      // Draft carries offers an operator deliberately deactivated and will
      // never relist - the copy must not promise a future "will go live".
      expect(screen.queryByText(/without being live yet/)).not.toBeInTheDocument();
    });

    it("does not borrow Draft's definition into the Invalid tab's empty state", async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(emptyPage()) },
      });

      renderWithProviders(<ListingsListPage />, {
        apiClient: mockApi,
        route: '/listings?tab=invalid',
      });

      expect(await screen.findByText('No invalid listings')).toBeInTheDocument();
      expect(
        screen.getByText('Nothing here has been rejected by a channel validator.'),
      ).toBeInTheDocument();
      // "taken offline" is Draft's defining case (a deliberately deactivated
      // offer), not Invalid's (validator-rejected) - it must not appear here.
      expect(screen.queryByText(/taken offline/)).not.toBeInTheDocument();
    });
  });

  describe('toolbar rework (#2030)', () => {
    const SECOND_CONNECTION = {
      id: 'conn_1',
      name: 'Main PrestaShop Store',
      platformType: 'prestashop',
      status: 'active',
      config: {},
      credentialsBacked: true,
      adapterKey: 'prestashop.webservice.v1',
      enabledCapabilities: ['ProductMaster'],
      supportedCapabilities: ['ProductMaster'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const TWO_CONNECTIONS = [SECOND_CONNECTION, MISMATCHED_PLATFORM_CONNECTION];

    it('renders the channel select with connection names for OfferManager-capable connections only, from one shared connections read', async () => {
      const connectionsList = vi.fn().mockResolvedValue(TWO_CONNECTIONS);
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
        connections: { list: connectionsList },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      const select = screen.getByRole('combobox', { name: 'Filter by channel' });
      const optionLabels = [...select.querySelectorAll('option')].map((o) => o.textContent);
      // SECOND_CONNECTION only has ProductMaster - /listings is backed
      // exclusively by offer mappings, so a ProductMaster-only connection can
      // never produce a row here and must not be offered as a filter option
      // (it would deterministically empty the table forever if selected).
      // Only the OfferManager-capable MISMATCHED_PLATFORM_CONNECTION appears.
      // This exact-equality check IS the "names only, never the raw id or
      // platformType" assertion - a separate whole-document `queryByText`
      // for those strings would be ambiguous by construction, since both
      // `sampleMappings` rows resolve to this same connection and each
      // legitimately shows its own id in the Connection column's `EntityLabel`
      // (that display is correct there, just not inside this select).
      expect(optionLabels).toEqual(['All channels', 'Erli Demo']);
      expect(screen.queryByText('Main PrestaShop Store')).not.toBeInTheDocument();
      // The Connection column already reads `useConnectionsQuery()` once for the
      // whole page (#1996) - the toolbar select must reuse that same result
      // rather than firing a second connections request.
      expect(connectionsList).toHaveBeenCalledTimes(1);
    });

    it('excludes a connection that lacks OfferManager even when it is otherwise active and named', async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
        connections: { list: vi.fn().mockResolvedValue([SECOND_CONNECTION]) },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      const select = screen.getByRole('combobox', { name: 'Filter by channel' });
      const optionLabels = [...select.querySelectorAll('option')].map((o) => o.textContent);
      expect(optionLabels).toEqual(['All channels']);
    });

    it('filters the request by the selected channel connection id', async () => {
      const user = userEvent.setup();
      const list = vi.fn().mockResolvedValue(sampleMappings);
      const mockApi = createListingsMockApiClient({
        listings: { list },
        connections: { list: vi.fn().mockResolvedValue(TWO_CONNECTIONS) },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      const select = screen.getByRole('combobox', { name: 'Filter by channel' });
      await user.selectOptions(select, 'conn_allegro_1');

      await vi.waitFor(() => {
        const [filters] = list.mock.calls.at(-1) ?? [];
        expect((filters as { connectionId?: string } | undefined)?.connectionId).toBe(
          'conn_allegro_1',
        );
      });
      expect(select).toHaveValue('conn_allegro_1');
    });

    it('no longer renders the pre-#2030 raw connection-id text input', async () => {
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
      });

      renderWithProviders(<ListingsListPage />, { apiClient: mockApi });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(screen.queryByLabelText('Filter by connection ID')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Connection ID…')).not.toBeInTheDocument();
    });

    it('resets search, the channel filter and the lifecycle tab together when Clear is clicked, without a full reload', async () => {
      const user = userEvent.setup();
      const mockApi = createListingsMockApiClient({
        listings: { list: vi.fn().mockResolvedValue(sampleMappings) },
        connections: { list: vi.fn().mockResolvedValue(TWO_CONNECTIONS) },
      });

      renderWithProviders(<ListingsListPage />, {
        apiClient: mockApi,
        route: '/listings?search=terra&connectionId=conn_allegro_1&tab=draft',
      });

      await screen.findByText('Doniczka ceramiczna Terra');
      expect(
        screen.getByLabelText('Search listings by product name, SKU, EAN or external ID'),
      ).toHaveValue('terra');
      expect(screen.getByRole('combobox', { name: 'Filter by channel' })).toHaveValue(
        'conn_allegro_1',
      );
      expect(screen.getByRole('tab', { name: /^Draft/ })).toHaveAttribute('aria-selected', 'true');

      // A plain URL-state reset (react-router `setSearchParams`), never a full
      // page reload - the table re-renders in place from the cleared params.
      await user.click(screen.getByRole('button', { name: 'Clear' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('tab', { name: /^Active/ })).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });
      expect(
        screen.getByLabelText('Search listings by product name, SKU, EAN or external ID'),
      ).toHaveValue('');
      expect(screen.getByRole('combobox', { name: 'Filter by channel' })).toHaveValue('');
    });
  });
});
