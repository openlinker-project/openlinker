import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../test/test-utils';
import { mockMobileViewport } from '../../test/viewport';
import { ProductDetailPage } from './product-detail-page';
import type { Product } from '../../features/products/api/products.types';
import type { InventoryItem, PaginatedInventory } from '../../features/inventory/api/inventory.types';
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

const sampleProduct: Product = {
  id: 'ol_product_abc123',
  name: 'Test Product',
  sku: 'SKU-001',
  price: 29.99,
  currency: null,
  description: '<p>A test product</p>',
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
      isStale: false,
      staleAt: null,
      externalIds: [
        { externalId: '42', platformType: 'prestashop', connectionId: 'conn_1' },
      ],
    },
  ],
  externalIds: [
    { externalId: '10', platformType: 'prestashop', connectionId: 'conn_1' },
  ],
};

// A 2-variant product exercises the variants table (single-variant products
// render the "Listed on" panel instead).
const multiVariantProduct: Product = {
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
      isStale: false,
      staleAt: null,
      externalIds: [],
    },
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
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    lifecycleCounts: ZERO_LIFECYCLE_COUNTS,
  };
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

/**
 * `signedIn` renders as an admin, who holds `inventory:read` and so sees the
 * available-to-promise figures; the default anonymous session reads none, which
 * is the master-count fallback.
 */
function renderDetailPage(apiClient: ReturnType<typeof createMockApiClient>, signedIn = false): void {
  renderWithProviders(
    <Routes>
      <Route path="/products/:id" element={<ProductDetailPage />} />
    </Routes>,
    {
      apiClient,
      route: '/products/ol_product_abc123',
      sessionAdapter: signedIn ? createAuthenticatedSessionAdapter() : undefined,
    },
  );
}

function stockViewOf(
  atpByVariant: Record<string, number | null>,
  overrides: Record<string, Record<string, unknown>> = {},
): unknown {
  return {
    productId: 'ol_product_abc123',
    productName: 'Test Product',
    productSku: 'SKU-001',
    staleSyncThreshold: { hours: 6, ms: 21_600_000, source: 'default' },
    channelsStatus: 'ok',
    generatedAt: '2026-01-15T10:00:00.000Z',
    variants: Object.entries(atpByVariant).map(([id, atp]) => ({
      productVariantId: id,
      sku: id,
      attributes: {},
      masterAvailable: 40,
      masterReserved: 0,
      availableToPromise: atp,
      provenance: atp === null ? 'unknown' : 'computed',
      observedAt: '2026-01-15T10:00:00.000Z',
      stalenessMs: 0,
      olHeldNotReflected: null,
      heldCounted: atp === null ? null : 37,
      heldRecordedOnly: 0,
      livePositionCount: 1,
      isStaleSync: false,
      positions: [],
      holds: [],
      channels: [],
      ...overrides[id],
    })),
  };
}

const PS_POSITION = {
  locationId: 'loc1',
  locationName: 'Main',
  sourceConnectionId: 'conn_ps',
  sourceConnectionName: 'PrestaShop',
  isStale: false,
  availableQuantity: 8,
  reservedQuantity: 0,
  updatedAt: '2026-01-15T10:00:00.000Z',
};

const ALLEGRO_CHANNEL = {
  connectionId: 'conn_al',
  connectionName: 'Allegro',
  platformType: 'allegro',
  rule: { stockSafetyBuffer: 2, stockZeroThreshold: 0 },
  willPublish: { quantity: 1, provenance: 'computed' },
  channelShows: { quantity: 1, observedAt: '2026-01-15T10:00:00.000Z' },
};

/** Variant 1 holds 8 in PrestaShop with 5 reserved for 4 orders and 2 reserved but not counted. */
const RESERVED_VARIANT = {
  masterAvailable: 8,
  availableToPromise: 3,
  heldCounted: 5,
  heldRecordedOnly: 2,
  positions: [PS_POSITION],
  holds: [
    { orderRecordId: 'o1', orderNumber: '#10482', quantity: 2, atpEffect: 'published', expiresAt: '2026-02-01T00:00:00.000Z' },
    { orderRecordId: 'o2', orderNumber: '#10479', quantity: 1, atpEffect: 'published', expiresAt: '2026-02-01T00:00:00.000Z' },
    { orderRecordId: 'o3', orderNumber: '#10475', quantity: 1, atpEffect: 'published', expiresAt: '2026-02-01T00:00:00.000Z' },
    { orderRecordId: 'o4', orderNumber: '#10470', quantity: 1, atpEffect: 'published', expiresAt: '2026-02-01T00:00:00.000Z' },
    { orderRecordId: 'o5', orderNumber: '#10460', quantity: 2, atpEffect: 'diagnostic', expiresAt: '2026-02-01T00:00:00.000Z' },
  ],
  channels: [ALLEGRO_CHANNEL],
};

/** The second variant holds 8 in the shop with nothing reserved, unless a spec says otherwise. */
function withPlainSibling(
  overrides: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return { ol_product_var2: { masterAvailable: 8, heldCounted: 0 }, ...overrides };
}

function multiVariantApi(
  overrides: Record<string, Record<string, unknown>>,
  extra: Parameters<typeof createMockApiClient>[0] = {},
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    products: { getById: vi.fn().mockResolvedValue(multiVariantProduct) },
    inventory: {
      list: vi.fn().mockResolvedValue(paginatedInventory([])),
      stockView: vi
        .fn()
        .mockResolvedValue(stockViewOf({ ol_product_var1: 3, ol_product_var2: 8 }, withPlainSibling(overrides))),
    },
    listings: {
      list: vi.fn().mockImplementation((filters?: { internalId?: string }) =>
        Promise.resolve(
          paginatedListings(
            filters?.internalId === 'ol_product_var1'
              ? [offerMapping({ id: 'ol_offer_1', externalId: 'ALG-1', connectionId: 'conn_al' })]
              : [],
          ),
        ),
      ),
    },
    ...extra,
  });
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

    // Single variant → "Listed on" panel (no variants table). The metadata
    // grid surfaces attribute chips, the variant id, and the EAN/GTIN.
    expect(screen.getByRole('heading', { name: 'Variants & stock' })).toBeInTheDocument();
    expect(screen.getByText('Attributes')).toBeInTheDocument();
    expect(screen.getByText('ol_product_var1')).toBeInTheDocument();
    expect(screen.getByText('1234567890123')).toBeInTheDocument();

    // Source section (renamed from External IDs) — master origin with ref
    expect(screen.getByRole('heading', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByText('prestashop · 10')).toBeInTheDocument();
    expect(screen.getByText('Master')).toBeInTheDocument();
  });

  it('should render the product-level Attributes block when the product has features', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({
          ...sampleProduct,
          features: [
            { name: 'Brand', value: 'Acme' },
            { name: 'Material', value: 'Ceramic' },
          ],
        }),
      },
    });

    renderDetailPage(mockApi);

    const attributesSection = (await screen.findByRole('heading', { name: 'Attributes' })).closest(
      '.detail-section',
    ) as HTMLElement;
    expect(within(attributesSection).getByText('Brand')).toBeInTheDocument();
    expect(within(attributesSection).getByText('Acme')).toBeInTheDocument();
    expect(within(attributesSection).getByText('Material')).toBeInTheDocument();
    expect(within(attributesSection).getByText('Ceramic')).toBeInTheDocument();
  });

  it('should not render the product-level Attributes block when the product has no features', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
    });

    renderDetailPage(mockApi);

    await screen.findByRole('heading', { name: 'Source' });
    // No product-level Attributes *section* heading (the variant panel still
    // renders its own "Attributes" metadata label, which is not a heading).
    expect(screen.queryByRole('heading', { name: 'Attributes' })).not.toBeInTheDocument();
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
        stockView: vi.fn().mockResolvedValue(stockViewOf({ ol_product_var1: 0 })),
      },
    });

    renderDetailPage(mockApi, true);

    const kpiCard = await findAvailableKpiCard();
    await waitFor(() => expect(kpiCard).toHaveClass('kpi-card--error'));
    expect(within(kpiCard).getByText('0')).toBeInTheDocument();
  });

  it('should show not known, neutral, in the hero badge and the Available KPI when what can be sold is unknown', async () => {
    const mockApi = createMockApiClient({
      products: { getById: vi.fn().mockResolvedValue(sampleProduct) },
      inventory: {
        list: vi.fn().mockResolvedValue(paginatedInventory([inventoryItem({ availableQuantity: 40 })])),
        stockView: vi.fn().mockResolvedValue(stockViewOf({ ol_product_var1: null })),
      },
    });

    renderDetailPage(mockApi, true);

    expect(await screen.findByTestId('product-stock-badge-unknown')).toHaveTextContent('Stock not known');
    const kpiCard = await findAvailableKpiCard();
    expect(within(kpiCard).getByTestId('stock-summary-atp')).toHaveTextContent('—');
    expect(within(kpiCard).getByText('not known right now')).toBeInTheDocument();
    expect(kpiCard).not.toHaveClass('kpi-card--success');
    expect(within(kpiCard).queryByText('40')).not.toBeInTheDocument();
  });

  it('should drive the hero badge from available to promise, not the master count', async () => {
    const mockApi = createMockApiClient({
      products: { getById: vi.fn().mockResolvedValue(sampleProduct) },
      inventory: {
        list: vi.fn().mockResolvedValue(paginatedInventory([inventoryItem({ availableQuantity: 40 })])),
        stockView: vi.fn().mockResolvedValue(stockViewOf({ ol_product_var1: 3 })),
      },
    });

    renderDetailPage(mockApi, true);

    expect(await screen.findByText('Low stock')).toBeInTheDocument();
    expect(screen.queryByText('In stock')).not.toBeInTheDocument();
  });

  it('should fall back to the master count, without a stock view request, for a session that cannot read it', async () => {
    const stockView = vi.fn();
    const mockApi = createMockApiClient({
      products: { getById: vi.fn().mockResolvedValue(sampleProduct) },
      inventory: {
        list: vi.fn().mockResolvedValue(paginatedInventory([inventoryItem({ availableQuantity: 40 })])),
        stockView,
      },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('In stock')).toBeInTheDocument();
    expect(stockView).not.toHaveBeenCalled();
    expect(screen.getByTestId('stock-restricted-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('stock-unknown-alert')).not.toBeInTheDocument();
  });

  it('should carry the back link test id', async () => {
    const mockApi = createMockApiClient({
      products: { getById: vi.fn().mockResolvedValue(sampleProduct) },
    });
    renderDetailPage(mockApi);
    expect(await screen.findByTestId('stock-back-to-products')).toHaveAttribute('href', '/products');
  });

  it('should render the stock cell as out of stock (not low stock) when what can be sold is exactly zero', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(multiVariantProduct),
      },
      inventory: {
        list: vi.fn().mockResolvedValue(
          paginatedInventory([inventoryItem({ availableQuantity: 0 })]),
        ),
        stockView: vi.fn().mockResolvedValue({
          productId: 'ol_product_abc123',
          productName: 'Test Product',
          productSku: 'SKU-001',
          staleSyncThreshold: { hours: 6, ms: 21_600_000, source: 'default' },
          channelsStatus: 'ok',
          generatedAt: '2026-01-15T10:00:00.000Z',
          variants: ['ol_product_var1', 'ol_product_var2'].map((id, index) => ({
            productVariantId: id,
            sku: index === 0 ? 'SKU-001-M' : 'SKU-001-L',
            attributes: {},
            masterAvailable: 0,
            masterReserved: 0,
            availableToPromise: 0,
            provenance: 'computed',
            observedAt: '2026-01-15T10:00:00.000Z',
            stalenessMs: 0,
            olHeldNotReflected: null,
            heldCounted: 0,
            heldRecordedOnly: 0,
            livePositionCount: 1,
            isStaleSync: false,
            positions: [],
            holds: [],
            channels: [],
          })),
        }),
      },
    });

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      {
        apiClient: mockApi,
        route: '/products/ol_product_abc123',
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    const row = await screen.findByTestId('stock-variant-row-SKU-001-M');
    await waitFor(() => {
      expect(row).toHaveTextContent('Out of stock');
    });
    expect(row).not.toHaveTextContent('Low stock');
    expect(screen.getByTestId('stock-atp-SKU-001-M')).toHaveTextContent('0');
    expect(container.querySelector('.stock-cell--error')).not.toBeNull();
    expect(container.querySelector('.stock-cell--warning')).toBeNull();
  });

  it('should route the description through RichTextView instead of printing its tags (ADR-046)', async () => {
    const mockApi = createMockApiClient({
      products: { getById: vi.fn().mockResolvedValue(sampleProduct) },
    });

    renderDetailPage(mockApi);

    // Asserted as "the value goes through the primitive", not as rendered markup.
    // Under happy-dom - this suite's environment - DOMPurify is LOSSY rather than
    // absent: `sanitize('<p>a</p>')` returns `'a'`, stripping the block tag,
    // which matches its own README calling happy-dom unsafe. So markup fidelity
    // is asserted once, in `shared/ui/rich-text-view.test.tsx` on jsdom, instead
    // of being asserted twice and trusted once.
    expect(await screen.findByText('A test product')).toBeInTheDocument();
    expect(document.querySelector('.rich-text-view, .rich-text-view__empty')).not.toBeNull();
    // Whatever the environment does to the markup, the TAGS must never reach the
    // operator as text - that is the defect this replaced.
    expect(screen.queryByText(/<p>/)).toBeNull();
  });

  it('should render the Available KPI with warning tone and a short count when reserved units exceed what the master holds but the total remains positive', async () => {
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
          isStale: false,
          staleAt: null,
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
        stockView: vi
          .fn()
          .mockResolvedValue(
            stockViewOf(
              { ol_product_var1: 0, ol_product_var2: 8 },
              { ol_product_var1: { masterAvailable: 40, heldCounted: 42 } },
            ),
          ),
      },
    });

    renderDetailPage(mockApi, true);

    const kpiCard = await findAvailableKpiCard();
    await waitFor(() => expect(kpiCard).toHaveClass('kpi-card--warning'));
    expect(within(kpiCard).getByTestId('stock-summary-atp')).toHaveTextContent('8');
    expect(within(kpiCard).getByText(/1 short/)).toBeInTheDocument();
    expect(within(kpiCard).queryByText(/oversold/i)).not.toBeInTheDocument();
  });

  it('should toggle the variant drawer and render the matching per-listing detail', async () => {
    const user = userEvent.setup();
    // Key listings to the first variant only so the second table row (var2)
    // resolves an empty set — keeps "Listings (1)" and the ALG-1 link unique.
    const listingsList = vi
      .fn()
      .mockImplementation((filters?: { internalId?: string }) =>
        Promise.resolve(
          paginatedListings(
            filters?.internalId === 'ol_product_var1'
              ? [offerMapping({ id: 'ol_offer_1', platformType: 'allegro', externalId: 'ALG-1' })]
              : [],
          ),
        ),
      );
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(multiVariantProduct),
      },
      listings: { list: listingsList },
    });

    renderDetailPage(mockApi);

    const toggle = await screen.findByRole('button', { name: 'Toggle details for SKU-001-M' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Drawer label + per-listing detail card (offer-id link).
    expect(await screen.findByText('Listings (1)')).toBeInTheDocument();
    expect(screen.getByText(/ALG-1/)).toBeInTheDocument();
  });

  it('should render a "+ Create offer" CTA when an OfferCreator connection has no listing for the variant', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(multiVariantProduct),
      },
      connections: {
        list: vi.fn().mockResolvedValue([
          {
            id: 'conn_allegro',
            name: 'Allegro sandbox',
            platformType: 'allegro',
            status: 'active',
            adapterKey: 'allegro.publicapi.v1',
            supportedCapabilities: ['OfferManager', 'OfferCreator'],
            enabledCapabilities: ['OfferManager', 'OfferCreator'],
            config: {},
            createdAt: '2026-01-15T10:00:00.000Z',
            updatedAt: '2026-01-15T10:00:00.000Z',
          },
        ]),
      },
      listings: { list: vi.fn().mockResolvedValue(paginatedListings([])) },
    });

    renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      {
        apiClient: mockApi,
        route: '/products/ol_product_abc123',
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    await screen.findByText(/SKU-001-M/);
    // One CTA per gap row (both variants lack the Allegro listing).
    expect((await screen.findAllByRole('button', { name: '+ Create offer' })).length).toBeGreaterThan(0);
  });

  it('should show the empty listings message when a variant has no matching listings', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
      listings: { list: vi.fn().mockResolvedValue(paginatedListings([])) },
    });

    renderDetailPage(mockApi);

    // Single-variant products render the always-expanded "Listed on" panel, so
    // the empty message shows without a toggle.
    expect(
      await screen.findByText('No marketplace listings reference this variant yet.'),
    ).toBeInTheDocument();
  });

  it('should render the "Listed on" panel (no variants table) for a single-variant product', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(sampleProduct),
      },
    });

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      { apiClient: mockApi, route: '/products/ol_product_abc123' },
    );

    expect(await screen.findByRole('heading', { name: 'Variants & stock' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Variants & stock \(/ })).not.toBeInTheDocument();
    expect(container.querySelector('.variant-stock-table')).toBeNull();
  });

  it('should show the inherited product tax rate when the product has a single variant', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({ ...sampleProduct, taxRate: '23' }),
      },
    });

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      { apiClient: mockApi, route: '/products/ol_product_abc123' },
    );

    await screen.findByRole('heading', { name: 'Variants & stock' });
    const panel = container.querySelector('.variant-drawer--flush') as HTMLElement;
    expect(within(panel).getByText('Tax rate')).toBeInTheDocument();
    expect(within(panel).getByText('23%')).toBeInTheDocument();
    expect(within(panel).getByText('inherited from the product')).toBeInTheDocument();
  });

  it('should show the missing-rate badge when a single-variant product has no tax rate', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({ ...sampleProduct, taxRate: null }),
      },
    });

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      { apiClient: mockApi, route: '/products/ol_product_abc123' },
    );

    await screen.findByRole('heading', { name: 'Variants & stock' });
    const panel = container.querySelector('.variant-drawer--flush') as HTMLElement;
    expect(within(panel).getByText('No tax rate')).toBeInTheDocument();
  });

  it('should show the tax rate in the expanded mobile variant card', async () => {
    const viewport = mockMobileViewport();
    try {
      const user = userEvent.setup();
      const mockApi = createMockApiClient({
        products: {
          getById: vi.fn().mockResolvedValue({ ...multiVariantProduct, taxRate: '5' }),
        },
      });

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Routes>,
        { apiClient: mockApi, route: '/products/ol_product_abc123' },
      );

      await user.click(
        await screen.findByRole('button', { name: 'Toggle details for SKU-001-M' }),
      );

      const body = container.querySelector('.variant-card__body') as HTMLElement;
      expect(within(body).getByText('Tax rate')).toBeInTheDocument();
      expect(within(body).getByText('5%')).toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });

  it('should render the variants table for a multi-variant product', async () => {
    const mockApi = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue(multiVariantProduct),
      },
    });

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      { apiClient: mockApi, route: '/products/ol_product_abc123' },
    );

    expect(await screen.findByRole('heading', { name: 'Variants & stock (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Variants & stock' })).not.toBeInTheDocument();
    expect(container.querySelector('.variant-stock-table')).not.toBeNull();
  });

  it('should render exactly one variants table, with stock folded into it and no second table', async () => {
    renderDetailPage(multiVariantApi({ ol_product_var1: RESERVED_VARIANT }), true);

    await screen.findByTestId('stock-variant-row-SKU-001-M');
    expect(document.querySelectorAll('table.variant-stock-table')).toHaveLength(1);
    expect(screen.queryByTestId('stock-variants-table')).not.toBeInTheDocument();
    expect(screen.queryByText('Listings & prices')).not.toBeInTheDocument();
    const headers = within(document.querySelector('table.variant-stock-table') as HTMLElement)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    // The leading expand column is aria-hidden, so it is not a column header to a reader.
    expect(headers).toEqual(['Variant', 'Tax rate', 'Stock', 'Listings', 'Price']);
  });

  it('should show what can be sold with a badge and the shop count behind it only when something is reserved', async () => {
    renderDetailPage(multiVariantApi({ ol_product_var1: RESERVED_VARIANT }), true);

    const reservedRow = await screen.findByTestId('stock-variant-row-SKU-001-M');
    expect(await within(reservedRow).findByText('Low stock')).toBeInTheDocument();
    expect(screen.getByTestId('stock-atp-SKU-001-M')).toHaveTextContent('3');
    expect(reservedRow).toHaveTextContent('to sell');
    expect(screen.getByTestId('stock-master-SKU-001-M')).toHaveTextContent('8 in PrestaShop');
    expect(screen.getByTestId('stock-held-SKU-001-M')).toHaveTextContent('5 reserved');

    const plainRow = screen.getByTestId('stock-variant-row-SKU-001-L');
    expect(plainRow).toHaveTextContent('to sell');
    expect(within(plainRow).queryByText(/reserved/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stock-master-SKU-001-L')).not.toBeInTheDocument();
  });

  it('should say Short by N instead of Oversold when more is reserved than the master holds', async () => {
    renderDetailPage(
      multiVariantApi({
        ol_product_var1: { ...RESERVED_VARIANT, masterAvailable: 2, availableToPromise: 0, heldCounted: 5 },
      }),
      true,
    );

    const row = await screen.findByTestId('stock-variant-row-SKU-001-M');
    expect(await within(row).findByText('Short by 3')).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/oversold/i);
  });

  it('should show a dash and Not known for a product whose stock is not known, never a zero', async () => {
    renderDetailPage(
      multiVariantApi({
        ol_product_var1: { availableToPromise: null, provenance: 'unknown', heldCounted: null },
        ol_product_var2: { availableToPromise: null, provenance: 'unknown', heldCounted: null },
      }),
      true,
    );

    const row = await screen.findByTestId('stock-variant-row-SKU-001-M');
    expect(await within(row).findByText('Not known')).toBeInTheDocument();
    expect(screen.getByTestId('stock-atp-SKU-001-M')).toHaveTextContent('—');
    expect(screen.getByTestId('stock-unknown-alert')).toBeInTheDocument();
    expect(screen.getByTestId('stock-retry')).toHaveTextContent('Try again');
  });

  it('should label a variant the master stopped reporting as missing in the master', async () => {
    renderDetailPage(
      multiVariantApi({
        ol_product_var1: {
          masterAvailable: 0,
          availableToPromise: 0,
          heldCounted: 0,
          livePositionCount: 0,
          positions: [{ ...PS_POSITION, isStale: true }],
        },
      }),
      true,
    );

    const row = await screen.findByTestId('stock-variant-row-SKU-001-M');
    expect(await within(row).findByText('Missing in PrestaShop')).toBeInTheDocument();
  });

  it('should put every alert above the variants table', async () => {
    renderDetailPage(
      multiVariantApi({
        ol_product_var1: { availableToPromise: null, provenance: 'unknown', heldCounted: null },
      }),
      true,
    );

    const alert = await screen.findByTestId('stock-unknown-alert');
    const table = document.querySelector('table.variant-stock-table') as HTMLElement;
    expect(alert.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('should explain the sum, list the reserving orders on request and keep recorded-only holds out of it', async () => {
    const user = userEvent.setup();
    renderDetailPage(multiVariantApi({ ol_product_var1: RESERVED_VARIANT }), true);

    await user.click(await screen.findByTestId('stock-variant-toggle-SKU-001-M'));

    expect(screen.getByTestId('stock-formula-SKU-001-M')).toHaveTextContent(
      '8 in PrestaShop − 5 reserved for 4 orders = 3 to sell',
    );
    expect(screen.getByTestId('stock-provenance-SKU-001-M')).toHaveTextContent('PrestaShop');
    expect(screen.getByTestId('stock-provenance-SKU-001-M')).toHaveTextContent('worked out by OpenLinker');
    expect(screen.getByTestId('stock-recorded-SKU-001-M')).toHaveTextContent(
      "2 more are reserved for orders OpenLinker doesn't fulfil. They don't lower what you can sell.",
    );
    expect(screen.queryByTestId('stock-holds-SKU-001-M')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show the 4 orders' }));
    expect(screen.getByTestId('stock-holds-SKU-001-M')).toBeInTheDocument();
    expect(screen.getByTestId('stock-hold-#10482')).toHaveTextContent('2 reserved');
    expect(screen.getByRole('link', { name: 'Order #10482' })).toHaveAttribute('href', '/orders/o1');
  });

  it('should add Sends and Last check to the listing card and keep the live Qty', async () => {
    const user = userEvent.setup();
    const mockApi = multiVariantApi({ ol_product_var1: RESERVED_VARIANT });
    renderDetailPage(mockApi, true);

    await user.click(await screen.findByTestId('stock-variant-toggle-SKU-001-M'));

    const channels = await screen.findByTestId('stock-channels-SKU-001-M');
    const card = within(channels).getByTestId('stock-channel-SKU-001-M-allegro-ALG-1');
    expect(card).toHaveTextContent('Sends 1 (2 kept as buffer)');
    expect(card).toHaveTextContent(/Last check .*: 1/);
    expect(
      screen.getByText(/Sends = what OpenLinker publishes\. Qty = what the offer shows now/),
    ).toBeInTheDocument();
  });

  it('should disable Adjust stock with the reason for a variant kept in two locations', async () => {
    renderDetailPage(
      multiVariantApi({
        ol_product_var1: {
          ...RESERVED_VARIANT,
          livePositionCount: 2,
          positions: [PS_POSITION, { ...PS_POSITION, locationId: 'loc2', locationName: 'Back room' }],
        },
      }),
      true,
    );

    const button = await screen.findByTestId('stock-adjust-SKU-001-M');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('stock-adjust-hint-SKU-001-M')).toHaveTextContent(
      'This variant is in 2 locations. Correct it in PrestaShop.',
    );
    expect(screen.getByTestId('stock-multi-location-alert')).toBeInTheDocument();
    expect(screen.getByTestId('stock-positions-SKU-001-M')).toBeInTheDocument();
  });

  it('should show a two-shops banner and refuse corrections when two connections count one variant', async () => {
    renderDetailPage(
      multiVariantApi({
        ol_product_var1: {
          ...RESERVED_VARIANT,
          livePositionCount: 2,
          positions: [
            PS_POSITION,
            {
              ...PS_POSITION,
              locationId: null,
              locationName: null,
              sourceConnectionId: 'conn_woo',
              sourceConnectionName: 'WooCommerce',
              availableQuantity: 6,
            },
          ],
        },
      }),
      true,
    );

    const banner = await screen.findByTestId('stock-multi-source-alert');
    expect(banner).toHaveTextContent('PrestaShop and WooCommerce');
    expect(banner).toHaveTextContent("new orders don't reserve it");
    expect(screen.getByTestId('stock-adjust-SKU-001-M')).toBeDisabled();
    expect(screen.getByTestId('stock-adjust-hint-SKU-001-M')).toHaveTextContent('Two shops count this variant');
  });

  it('should point the stock history at the variant whose link was clicked', async () => {
    const user = userEvent.setup();
    const listMovements = vi.fn().mockResolvedValue({ items: [], limit: 10, offset: 0 });
    const mockApi = multiVariantApi(
      { ol_product_var1: RESERVED_VARIANT },
      { inventory: { list: vi.fn().mockResolvedValue(paginatedInventory([])), stockView: vi.fn().mockResolvedValue(stockViewOf({ ol_product_var1: 3, ol_product_var2: 8 }, withPlainSibling({ ol_product_var1: RESERVED_VARIANT }))), listMovements } },
    );
    renderDetailPage(mockApi, true);

    await user.click(await screen.findByTestId('stock-variant-toggle-SKU-001-L'));
    await user.click(screen.getByTestId('stock-movements-SKU-001-L'));

    expect(screen.getByTestId('stock-history-variant')).toHaveValue('ol_product_var2');
    await waitFor(() =>
      expect(listMovements).toHaveBeenCalledWith(
        expect.objectContaining({ productVariantId: 'ol_product_var2' }),
        expect.anything(),
      ),
    );
  });

  it('should carry the headline figures on the Available tile', async () => {
    renderDetailPage(multiVariantApi({ ol_product_var1: RESERVED_VARIANT }), true);

    const kpiCard = await findAvailableKpiCard();
    await waitFor(() => expect(within(kpiCard).getByTestId('stock-summary-atp')).toHaveTextContent('11'));
    expect(within(kpiCard).getByTestId('stock-summary-master')).toHaveTextContent('16 in PrestaShop');
    expect(within(kpiCard).getByTestId('stock-summary-held')).toHaveTextContent('5 reserved');
    expect(await screen.findByTestId('stock-summary-synced')).toHaveTextContent('Stock synced');
  });

  it('should show the number and badge on a collapsed mobile card', async () => {
    const viewport = mockMobileViewport();
    try {
      renderDetailPage(multiVariantApi({ ol_product_var1: RESERVED_VARIANT }), true);

      const card = await screen.findByTestId('stock-variant-row-SKU-001-M');
      expect(card).toHaveClass('variant-card');
      expect(await within(card).findByText('Low stock')).toBeInTheDocument();
      expect(screen.getByTestId('stock-atp-SKU-001-M')).toHaveTextContent('3');
      expect(screen.getByTestId('stock-variant-toggle-SKU-001-M')).toHaveAttribute('aria-expanded', 'false');
    } finally {
      viewport.restore();
    }
  });

  it('should disable Adjust stock for a viewer with the reason beside it', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/products/:id" element={<ProductDetailPage />} />
      </Routes>,
      {
        apiClient: multiVariantApi({ ol_product_var1: RESERVED_VARIANT }),
        route: '/products/ol_product_abc123',
        sessionAdapter: createAuthenticatedSessionAdapter({
          id: 'u',
          username: 'viewer',
          email: null,
          role: 'viewer',
          permissions: ['inventory:read'],
          analyticsConsent: true,
        }),
      },
    );

    expect(await screen.findByTestId('stock-viewer-notice')).toHaveTextContent('view-only access');
    const button = await screen.findByTestId('stock-adjust-SKU-001-M');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('stock-adjust-hint-SKU-001-M')).toHaveTextContent(
      'Only admins and operators can change stock.',
    );
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
