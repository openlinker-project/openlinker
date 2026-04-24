import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { InventoryDetailPage } from './inventory-detail-page';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';
import type {
  OfferMapping,
  PaginatedOfferMappings,
} from '../../features/listings/api/listings.types';

const baseItem: InventoryItem = {
  id: 'ol_inventory_item_12345678-90ab-cdef-1234-567890abcdef',
  productId: 'ol_product_4d2d57a59b44400d83cb8ccd720aa723',
  productVariantId: null,
  availableQuantity: 100,
  reservedQuantity: 0,
  locationId: null,
  updatedAt: '2026-04-24T16:30:00.000Z',
  productName: 'Aparat cyfrowy CANON PowerShot SX740 Lite Edition — srebrny',
  productSku: 'Aparat_cyfrowy',
  productImageUrl: null,
};

const sampleListing: OfferMapping = {
  id: 'map_1',
  entityType: 'ProductVariant',
  internalId: 'ol_variant_abc',
  externalId: '1111',
  platformType: 'allegro',
  connectionId: 'conn_allegro_1',
  context: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
};

const emptyListingsPage: PaginatedOfferMappings = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
};

function renderDetail(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/inventory/:id" element={<InventoryDetailPage />} />
    </Routes>,
    { apiClient, route: `/inventory/${baseItem.id}` },
  );
}

describe('InventoryDetailPage', () => {
  afterEach(cleanup);

  it('shows the loading state while the inventory item is fetching', () => {
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderDetail(apiClient);

    expect(screen.getByText('Loading inventory item')).toBeInTheDocument();
  });

  it('shows the error state with a Retry action when fetch fails', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockRejectedValue(new Error('Not found')),
      },
    });

    renderDetail(apiClient);

    expect(await screen.findByText('Unable to load inventory item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders hero with product name, status badge, meta, UUID chip and View product action', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(baseItem),
      },
      listings: {
        list: vi.fn().mockResolvedValue(emptyListingsPage),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    // Product name appears as both PageLayout title (h2) and hero heading (h3)
    const heroTitles = await screen.findAllByText(baseItem.productName as string);
    expect(heroTitles.length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('In stock')).toBeInTheDocument();
    // SKU appears in the hero meta and again in the Item Details row
    expect(screen.getAllByText(baseItem.productSku as string).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Simple product')).toBeInTheDocument();
    expect(screen.getByText(baseItem.id)).toBeInTheDocument();

    const viewProduct = screen.getByRole('link', { name: 'View product' });
    expect(viewProduct).toHaveAttribute('href', `/products/${baseItem.productId}`);
  });

  it('shows compound Available KPI with reserved / on-hand description', async () => {
    const item: InventoryItem = { ...baseItem, availableQuantity: 100, reservedQuantity: 7 };
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(item),
      },
      listings: {
        list: vi.fn().mockResolvedValue(emptyListingsPage),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    const kpi = await screen.findByLabelText('Stock levels');
    expect(within(kpi).getByText('Available')).toBeInTheDocument();
    expect(within(kpi).getByText('100')).toBeInTheDocument();
    expect(within(kpi).getByText(/7 reserved/)).toBeInTheDocument();
    expect(within(kpi).getByText(/107 on hand/)).toBeInTheDocument();
  });

  it('reflects the out-of-stock tone when availableQuantity is zero', async () => {
    const item: InventoryItem = { ...baseItem, availableQuantity: 0 };
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(item),
      },
      listings: {
        list: vi.fn().mockResolvedValue(emptyListingsPage),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    expect(await screen.findByText('Out of stock')).toBeInTheDocument();
  });

  it('reflects the low-stock tone when availableQuantity is within the threshold', async () => {
    const item: InventoryItem = { ...baseItem, availableQuantity: 3 };
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(item),
      },
      listings: {
        list: vi.fn().mockResolvedValue(emptyListingsPage),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    expect(await screen.findByText('Low stock')).toBeInTheDocument();
  });

  it('falls back to "Simple product — no variants" and "Default location" in item details', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(baseItem),
      },
      listings: {
        list: vi.fn().mockResolvedValue(emptyListingsPage),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    expect(await screen.findByText('Simple product — no variants')).toBeInTheDocument();
    expect(screen.getByText('Default location')).toBeInTheDocument();
  });

  it('queries listings by variant id when available, else by product id', async () => {
    const listItem: InventoryItem = {
      ...baseItem,
      productVariantId: 'ol_variant_xyz',
    };
    const listMock = vi.fn().mockResolvedValue(emptyListingsPage);
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(listItem),
      },
      listings: {
        list: listMock,
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    await screen.findAllByText(listItem.productName as string);
    expect(listMock).toHaveBeenCalledWith(
      { internalId: 'ol_variant_xyz' },
      { limit: 50, offset: 0 },
    );
  });

  it('renders the listings table when offer mappings reference this stock', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(baseItem),
      },
      listings: {
        list: vi.fn().mockResolvedValue({
          items: [sampleListing],
          total: 1,
          limit: 50,
          offset: 0,
        }),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    expect(await screen.findByText('allegro')).toBeInTheDocument();
    expect(screen.getByText(sampleListing.externalId)).toBeInTheDocument();
  });

  it('shows the "no listings" empty copy when no offers reference the stock', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(baseItem),
      },
      listings: {
        list: vi.fn().mockResolvedValue(emptyListingsPage),
        getById: vi.fn().mockResolvedValue(null),
        updateOfferFields: vi.fn(),
        createOffer: vi.fn(),
        getOfferCreationStatus: vi.fn(),
        getSellerPolicies: vi.fn(),
      },
    });

    renderDetail(apiClient);

    expect(await screen.findByText('No listings reference this stock yet.')).toBeInTheDocument();
  });

  it('refetches the inventory item when Retry is clicked on the error state', async () => {
    const user = userEvent.setup();
    const getById = vi.fn().mockRejectedValue(new Error('Network error'));
    const apiClient = createMockApiClient({
      inventory: {
        list: vi.fn(),
        getById,
      },
    });

    renderDetail(apiClient);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(retry);

    expect(getById).toHaveBeenCalledTimes(2);
  });
});
