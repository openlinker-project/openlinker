import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ProductDetailPage } from './product-detail-page';
import type { Product } from '../../features/products/api/products.types';
import type { InventoryItem, PaginatedInventory } from '../../features/inventory/api/inventory.types';
import type { OfferMapping, PaginatedOfferMappings } from '../../features/listings/api/listings.types';

const sampleProduct: Product = {
  id: 'ol_product_abc123',
  name: 'Test Product',
  sku: 'SKU-001',
  price: 29.99,
  currency: null,
  description: 'A test product',
  images: null,
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
  variants: [
    {
      id: 'ol_product_var1',
      productId: 'ol_product_abc123',
      sku: 'SKU-001-M',
      attributes: { size: 'M', color: 'blue' },
      ean: '1234567890123',
      gtin: null,
      price: null,
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
      externalIds: [
        { externalId: '42', platformType: 'prestashop', connectionId: 'conn_1' },
      ],
    },
  ],
  externalIds: [
    { externalId: '10', platformType: 'prestashop', connectionId: 'conn_1' },
  ],
};

function inventoryItem(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'ol_inv_1',
    productId: 'ol_product_abc123',
    productVariantId: 'ol_product_var1',
    availableQuantity: 10,
    reservedQuantity: 0,
    locationId: null,
    updatedAt: '2026-01-15T10:00:00.000Z',
    productName: null,
    productSku: null,
    productImageUrl: null,
    ...overrides,
  };
}

function paginatedInventory(items: InventoryItem[]): PaginatedInventory {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function offerMapping(overrides: Partial<OfferMapping>): OfferMapping {
  return {
    id: 'ol_offer_1',
    entityType: 'ProductVariant',
    internalId: 'ol_product_var1',
    externalId: 'ext-1',
    platformType: 'allegro',
    connectionId: 'conn_1',
    context: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function paginatedListings(items: OfferMapping[]): PaginatedOfferMappings {
  return { items, total: items.length, limit: 50, offset: 0 };
}

async function findAvailableKpiCard(): Promise<HTMLElement> {
  const labels = await screen.findAllByText('Available');
  const kpiCard = labels
    .map((label) => label.closest('.kpi-card'))
    .find((card): card is HTMLElement => card !== null);
  if (!kpiCard) {
    throw new Error('Available KpiCard not found');
  }
  return kpiCard;
}

function renderDetailPage(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/products/:id" element={<ProductDetailPage />} />
    </Routes>,
    { apiClient, route: '/products/ol_product_abc123' },
  );
}

describe('ProductDetailPage', () => {
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderDetailPage(mockApi);

    expect(screen.getByText('Loading product')).toBeInTheDocument();
  });

  it('should show product detail with variants when data loads', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
    });

    renderDetailPage(mockApi);

    expect((await screen.findAllByText('Test Product')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ol_product_abc123').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SKU-001').length).toBeGreaterThan(0);
    expect(screen.getByText('29.99')).toBeInTheDocument();
    expect(screen.getByText('A test product')).toBeInTheDocument();

    // Variant & stock table
    expect(screen.getByText('SKU-001-M')).toBeInTheDocument();
    expect(screen.getByText('1234567890123')).toBeInTheDocument();
    expect(screen.getByText('size: M, color: blue')).toBeInTheDocument();

    // External IDs (rendered as chips)
    expect(screen.getByText('prestashop')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockRejectedValue(new Error('Not found')),
      },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('Unable to load product')).toBeInTheDocument();
  });

  it('should show the no-variants empty state when the product has no variants', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({ ...sampleProduct, variants: [] }),
      },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('No variants found for this product.')).toBeInTheDocument();
  });

  it('should render the Available KPI with error tone when total stock is zero or negative', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
      inventory: {
        list: vi.fn().mockResolvedValue(
          paginatedInventory([inventoryItem({ availableQuantity: -5, reservedQuantity: 2 })]),
        ),
      },
    });

    renderDetailPage(mockApi);

    const kpiCard = await findAvailableKpiCard();
    expect(kpiCard).toHaveClass('kpi-card--error');
    expect(within(kpiCard).getByText('-5')).toBeInTheDocument();
  });

  it('should render the variant stock cell as out-of-stock (not low-stock) when available is exactly zero', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
      inventory: {
        list: vi.fn().mockResolvedValue(
          paginatedInventory([inventoryItem({ availableQuantity: 0 })]),
        ),
      },
    });

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      { apiClient: mockApi, route: '/products/ol_product_abc123' },
    );

    await screen.findByText('SKU-001-M');
    const stockCell = container.querySelector('.stock-cell--error, .stock-cell--warning');
    expect(stockCell).not.toBeNull();
    expect(stockCell).toHaveClass('stock-cell--error');
    expect(stockCell).not.toHaveClass('stock-cell--warning');
    expect(stockCell).toHaveTextContent('0');
  });

  it('should render the Available KPI with warning tone and an oversold description when some stock is oversold but the total remains positive', async () => {
    const productWithTwoVariants: Product = {
      ...sampleProduct,
      variants: [
        sampleProduct.variants![0],
        {
          id: 'ol_product_var2',
          productId: 'ol_product_abc123',
          sku: 'SKU-001-L',
          attributes: { size: 'L' },
          ean: null,
          gtin: null,
          price: null,
          createdAt: '2026-01-15T10:00:00.000Z',
          updatedAt: '2026-01-15T10:00:00.000Z',
          externalIds: [],
        },
      ],
    };

    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(productWithTwoVariants),
      },
      inventory: {
        list: vi.fn().mockResolvedValue(
          paginatedInventory([
            inventoryItem({ productVariantId: 'ol_product_var1', availableQuantity: -2 }),
            inventoryItem({ id: 'ol_inv_2', productVariantId: 'ol_product_var2', availableQuantity: 10 }),
          ]),
        ),
      },
    });

    renderDetailPage(mockApi);

    const kpiCard = await findAvailableKpiCard();
    expect(kpiCard).toHaveClass('kpi-card--warning');
    expect(within(kpiCard).getByText('8')).toBeInTheDocument();
    expect(within(kpiCard).getByText('1 oversold')).toBeInTheDocument();
  });

  it('should toggle the "Listings using this stock" panel and render the matching listings subtable', async () => {
    const user = userEvent.setup();
    const listingsList = vi.fn().mockResolvedValue(
      paginatedListings([
        offerMapping({ id: 'ol_offer_1', platformType: 'allegro', externalId: 'ALG-1' }),
      ]),
    );
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
      listings: { list: listingsList },
    });

    renderDetailPage(mockApi);

    const toggle = await screen.findByRole('button', { name: 'Toggle listings for SKU-001-M' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('allegro')).toBeInTheDocument();
    expect(screen.getByText('ALG-1')).toBeInTheDocument();
  });

  it('should show the empty listings message when a variant has no matching listings', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
      listings: { list: vi.fn().mockResolvedValue(paginatedListings([])) },
    });

    renderDetailPage(mockApi);

    const toggle = await screen.findByRole('button', { name: 'Toggle listings for SKU-001-M' });
    await user.click(toggle);

    expect(
      await screen.findByText('No marketplace listings reference this variant yet.'),
    ).toBeInTheDocument();
  });

  it('should open the gallery lightbox, navigate with the keyboard, and close it', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({
          ...sampleProduct,
          images: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
        }),
      },
    });

    renderDetailPage(mockApi);

    const openButton = await screen.findByRole('button', { name: 'Open photo viewer' });
    await user.click(openButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(openButton).toHaveFocus());
  });

  it('should close the gallery lightbox when clicking the backdrop outside the photo frame', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({
          ...sampleProduct,
          images: ['https://cdn.example.com/1.jpg'],
        }),
      },
    });

    renderDetailPage(mockApi);

    const openButton = await screen.findByRole('button', { name: 'Open photo viewer' });
    await user.click(openButton);

    await screen.findByRole('dialog');
    const overlay = document.body.querySelector('.lightbox-dialog-overlay');
    expect(overlay).not.toBeNull();

    await user.click(overlay as Element);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
