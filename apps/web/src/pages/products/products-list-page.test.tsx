import { cleanup, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../test/test-utils';
import { ProductsListPage } from './products-list-page';
import type { PaginatedProducts } from '../../features/products/api/products.types';
import type * as DemoModule from '../../features/demo';

const captureDemoEvent = vi.fn();
vi.mock('../../features/demo', async (importOriginal): Promise<typeof DemoModule> => {
  const actual = await importOriginal<typeof DemoModule>();
  return { ...actual, captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args) };
});

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (): Promise<typeof ReactRouterDom> => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return {
    ...actual,
    useNavigate: (): typeof navigateMock => navigateMock,
  };
});

// A single active OfferCreator (Allegro) connection so the capability-gated
// "Create offers" CTA renders with the marketplace-named label (#1096).
const allegroConnection = {
  id: 'conn_allegro',
  name: 'My Allegro',
  status: 'active',
  platformType: 'allegro',
  supportedCapabilities: ['OfferManager', 'OfferCreator'],
} as const;

const sampleProducts: PaginatedProducts = {
  items: [
    {
      id: 'ol_product_abc123',
      name: 'Test Product',
      sku: 'SKU-001',
      price: 29.99,
      currency: 'PLN',
      description: null,
      images: ['https://cdn.example.com/test-product.jpg'],
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
      // Cockpit list-enrichment fields (#1720).
      totalAvailable: 12,
      totalReserved: 2,
      stockUpdatedAt: '2026-01-15T10:00:00.000Z',
      variantCount: 2,
      externalIds: [
        { externalId: '55', platformType: 'prestashop', connectionId: 'conn_presta' },
      ],
      listingsCoverage: [
        { connectionId: 'conn_allegro', platformType: 'allegro', listedVariants: 1 },
        // Stray coverage row for a connection the operator does not have -
        // must never produce a pill (connection-driven rendering).
        { connectionId: 'conn_ghost', platformType: 'erli', listedVariants: 2 },
      ],
    },
    {
      id: 'ol_product_def456',
      name: 'Another Product',
      sku: null,
      price: null,
      currency: null,
      description: null,
      images: null,
      createdAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
      totalAvailable: 3,
      totalReserved: 0,
      variantCount: 1,
      listingsCoverage: [
        { connectionId: 'conn_allegro', platformType: 'allegro', listedVariants: 1 },
      ],
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

/** Main table-query pagination - distinguishes it from limit:1 KPI probes. */
const PAGE = { limit: 20, offset: 0 };

/**
 * Forces the narrow (<1024px) filter-collapse breakpoint WITHOUT tripping the
 * DataTable card breakpoint (767.98px), so the table layout stays intact and
 * only the filter rail collapses behind the "Filters" toggle.
 */
function mockNarrowViewport(): { restore: () => void } {
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: query.includes('1023.98'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { restore: () => spy.mockRestore() };
}

/** Trips every media query - both the filter-collapse and DataTable's own card breakpoint. */
function mockMobileViewport(): { restore: () => void } {
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { restore: () => spy.mockRestore() };
}

describe('ProductsListPage', () => {
  beforeEach(() => {
    // shouldAdvanceTime allows waitFor/findBy to work while still controlling
    // timers so we can flush pending debounce timers in afterEach.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    navigateMock.mockReset();
    captureDemoEvent.mockClear();
  });

  afterEach(() => {
    // Flush pending debounce timers before environment teardown to prevent
    // "window is not defined" unhandled errors from useDebouncedValue.
    vi.runAllTimers();
    vi.useRealTimers();
  });
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show products table when data loads', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue(sampleProducts),
      },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    // Intl.NumberFormat glyphs vary between runtimes — match amount + ISO code.
    expect(screen.getByText(/29[.,]99/)).toBeInTheDocument();
    expect(screen.getByText(/PLN/)).toBeInTheDocument();
    expect(screen.getByText('Another Product')).toBeInTheDocument();
  });

  it('captures demo_products_viewed once with a result-count bucket on load (#1788)', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_products_viewed', {
      resultCountBucket: '1-10',
    });
    expect(captureDemoEvent).toHaveBeenCalledTimes(1);
  });

  it('passes default server params (sort createdAt desc, page size 20) to the list call', async () => {
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({ products: { list } });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ search: undefined, stock: undefined }),
      PAGE,
      { field: 'createdAt', dir: 'desc' },
    );
  });

  it('renders the aggregated stock badge and reserved sub-line from totalAvailable', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const table = screen.getByRole('table');
    // 12 available → In stock; 3 available → Low stock (threshold 5).
    expect(within(table).getByText('In stock')).toBeInTheDocument();
    expect(within(table).getByText('Low stock')).toBeInTheDocument();
    expect(within(table).getByText('reserved 2')).toBeInTheDocument();
  });

  it('renders coverage pills only for connections the operator has (Allegro-only install)', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    const { container } = renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await waitFor(() => {
      expect(container.querySelectorAll('.coverage-pill').length).toBeGreaterThan(0);
    });
    const pills = Array.from(container.querySelectorAll('.coverage-pill'));
    // One pill per row, both for the sole Allegro connection - the stray
    // erli coverage row on the first product produces no pill.
    expect(pills).toHaveLength(2);
    expect(pills.every((p) => p.getAttribute('data-channel') === 'allegro')).toBe(true);
    // First product: 1 of 2 variants listed → partial.
    expect(pills[0]).toHaveClass('coverage-pill--partial');
    // Second product: 1 of 1 listed → full.
    expect(pills[1]).toHaveClass('coverage-pill--full');
  });

  it('renders a coverage pill for a ShopProduct (WooCommerce) connection too (#1838 follow-up fix)', async () => {
    // Coverage pills previously stayed keyed to the marketplace OfferCreator
    // subset, so a product published to a shop connection (ShopProduct
    // mapping, ProductPublisher capability) showed no coverage indication at
    // all - this is the regression test for that fix.
    const wooConnection = {
      id: 'conn_woo',
      name: 'My WooCommerce',
      status: 'active',
      platformType: 'woocommerce',
      supportedCapabilities: ['OfferManager', 'ProductPublisher'],
      enabledCapabilities: ['ProductPublisher'],
    } as const;
    const products: PaginatedProducts = {
      items: [
        {
          ...sampleProducts.items[0]!,
          listingsCoverage: [
            { connectionId: 'conn_woo', platformType: 'woocommerce', listedVariants: 2 },
          ],
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    };
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(products) },
      connections: { list: vi.fn().mockResolvedValue([wooConnection]) },
    });

    const { container } = renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await waitFor(() => {
      expect(container.querySelectorAll('.coverage-pill').length).toBeGreaterThan(0);
    });
    const pills = Array.from(container.querySelectorAll('.coverage-pill'));
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveAttribute('data-channel', 'woocommerce');
    // 2 of 2 variants listed → full.
    expect(pills[0]).toHaveClass('coverage-pill--full');
  });

  it('should show muted price with hover explanation when currency is absent', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue({
          items: [
            {
              ...sampleProducts.items[0],
              id: 'ol_product_nocur',
              name: 'Currencyless Product',
              price: 19.99,
              currency: null,
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      },
    });

    const { container } = renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await within(container).findByText('Currencyless Product');
    const amount = container.querySelector<HTMLElement>('span[title="Currency unknown"]');
    expect(amount).not.toBeNull();
    expect(amount?.textContent).toBe('19.99');
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load products')).toBeInTheDocument();
    expect(screen.getAllByText('Network error').length).toBeGreaterThan(0);
  });

  it('should render a thumbnail image for products with an image URL', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue(sampleProducts),
      },
    });

    const { container } = renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await within(container).findByText('Test Product');
    const image = container.querySelector<HTMLImageElement>(
      'img[src="https://cdn.example.com/test-product.jpg"]',
    );
    expect(image).not.toBeNull();
  });

  it('should render a placeholder thumbnail for products without an image', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue(sampleProducts),
      },
    });

    const { container } = renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await within(container).findByText('Another Product');
    const thumbnails = container.querySelectorAll('.product-thumbnail');
    expect(thumbnails.length).toBeGreaterThanOrEqual(2);
    const placeholderRow = Array.from(thumbnails).find(
      (el) => el.querySelector('img') === null,
    );
    expect(placeholderRow).not.toBeUndefined();
    expect(placeholderRow?.textContent).toBe('A');
  });

  it('should show empty state with a Manage connections CTA when no products exist', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No products found')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Manage connections' });
    expect(cta).toHaveAttribute('href', '/connections');
  });

  it('should show a Clear filters CTA in the empty state when a search is active', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      route: '/products?search=nope',
    });

    expect(await screen.findByText('No products match the current filters.')).toBeInTheDocument();
    // Two "Clear filters" affordances exist (toolbar + empty-state CTA);
    // either clears everything - click the empty-state one.
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' });
    await user.click(buttons[buttons.length - 1]);

    expect(await screen.findByRole('link', { name: 'Manage connections' })).toBeInTheDocument();
  });

  // ── KPI tiles as filters (#1720) ────────────────────────────────────

  it('KPI tile click writes stock=out to the URL and refetches with the filter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({ products: { list } });

    const { container } = renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    // Segment buttons: [0] Products, [1] Out of stock, [2] Low stock.
    const segments = container.querySelectorAll<HTMLButtonElement>('.products-segment');
    expect(segments.length).toBeGreaterThanOrEqual(3);
    await user.click(segments[1]);

    // URL state is asserted through its observable effect: the refetch with
    // the stock filter (MemoryRouter keeps window.location untouched).
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ stock: 'out' }),
        PAGE,
        expect.anything(),
      );
    });
    expect(segments[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the Listing gaps tile only when an OfferCreator connection exists', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    expect(screen.queryByText('Listing gaps')).not.toBeInTheDocument();
  });

  it('Listing gaps tile toggles unlistedOn with all OfferCreator connection ids', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({
      products: { list },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const gapsTile = await screen.findByText('Listing gaps');
    await user.click(gapsTile);

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ unlistedOn: ['conn_allegro'] }),
        PAGE,
        expect.anything(),
      );
    });
  });

  // ── Filter chips (#1720) ────────────────────────────────────────────

  it('stock chip toggles the filter on and off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({ products: { list } });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const chip = screen.getByRole('button', { name: 'Oversold' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ stock: 'oversold' }),
        PAGE,
        expect.anything(),
      );
    });

    await user.click(screen.getByRole('button', { name: 'Oversold' }));
    expect(screen.getByRole('button', { name: 'Oversold' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  // ── Deleted-at-source badge + filter (#2447) ──────────────────────

  it('renders a "some deleted" warning badge for a partially-stale product and none for a live one', async () => {
    const products: PaginatedProducts = {
      ...sampleProducts,
      items: [
        { ...sampleProducts.items[0], variantCount: 3, staleVariantCount: 1 },
        sampleProducts.items[1],
      ],
    };
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(products) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    expect(screen.getByText('1 of 3 variants deleted at source')).toBeInTheDocument();
    expect(screen.queryByText('Deleted at source')).toBeNull();
  });

  it('renders an "all deleted" error badge for a fully-stale product', async () => {
    const products: PaginatedProducts = {
      ...sampleProducts,
      items: [
        { ...sampleProducts.items[0], variantCount: 2, staleVariantCount: 2 },
        sampleProducts.items[1],
      ],
    };
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(products) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    expect(screen.getByText('Deleted at source')).toBeInTheDocument();
  });

  it('"Hide deleted at source" chip toggles the hideFullyStale filter on and off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({ products: { list } });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const chip = screen.getByRole('button', { name: 'Hide deleted at source' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ hideFullyStale: true }),
        PAGE,
        expect.anything(),
      );
    });

    await user.click(screen.getByRole('button', { name: 'Hide deleted at source' }));
    expect(screen.getByRole('button', { name: 'Hide deleted at source' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('per-connection Unlisted-on chip writes that single connection id', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({
      products: { list },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const chip = await screen.findByRole('button', { name: 'Unlisted on My Allegro' });
    await user.click(chip);

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ unlistedOn: ['conn_allegro'] }),
        PAGE,
        expect.anything(),
      );
    });
  });

  // ── Narrow-viewport filter collapse (#1720 scope addition) ─────────

  it('collapses the filter rail behind a Filters toggle below 1024px', async () => {
    const viewport = mockNarrowViewport();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const mockApi = createMockApiClient({
        products: { list: vi.fn().mockResolvedValue(sampleProducts) },
        connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
      });

      renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

      await screen.findByText('Test Product');
      // Collapsed by default: chips and source select are hidden, toggle shows.
      expect(screen.queryByRole('button', { name: 'Oversold' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('combobox', { name: 'Filter by source connection' }),
      ).not.toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: /^Filters/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      // Panel groups: Stock chips, Listings chips, Source select, Sort control.
      expect(screen.getByRole('button', { name: 'Oversold' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unlisted on My Allegro' })).toBeInTheDocument();
      expect(
        screen.getByRole('combobox', { name: 'Filter by source connection' }),
      ).toBeInTheDocument();

      // Sort group drives the same sort/dir server params as the wide headers.
      const list = mockApi.products.list as ReturnType<typeof vi.fn>;
      await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'price');
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(expect.anything(), PAGE, {
          field: 'price',
          dir: 'desc',
        });
      });
      await user.click(screen.getByRole('button', { name: 'Asc' }));
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(expect.anything(), PAGE, {
          field: 'price',
          dir: 'asc',
        });
      });

      // Chip inside the panel writes the same URL state as the wide rail.
      await user.click(screen.getByRole('button', { name: 'Oversold' }));
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(
          expect.objectContaining({ stock: 'oversold' }),
          PAGE,
          expect.anything(),
        );
      });
      // Toggle badge reflects the active-filter count.
      expect(screen.getByRole('button', { name: /^Filters/ })).toHaveTextContent('1');
    } finally {
      viewport.restore();
    }
  });

  // ── Server-side sorting (#1720) ─────────────────────────────────────

  it('clicking a sortable header writes sort/dir URL params and refetches', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const list = vi.fn().mockResolvedValue(sampleProducts);
    const mockApi = createMockApiClient({ products: { list } });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    // Header buttons carry the sort indicator glyph - match by prefix.
    await user.click(screen.getByRole('button', { name: /^Stock/ }));

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.anything(), PAGE, { field: 'stock', dir: 'asc' });
    });

    // Re-clicking the active column flips the direction.
    await user.click(screen.getByRole('button', { name: /^Stock/ }));
    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.anything(), PAGE, { field: 'stock', dir: 'desc' });
    });
  });

  // ── Mobile card disclosure (#1720) ──────────────────────────────────

  it('keeps the mobile card detail collapsed until the disclosure is toggled', async () => {
    const { restore } = mockMobileViewport();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const getById = vi.fn().mockResolvedValue(null);
      const inventoryList = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
      const mockApi = createMockApiClient({
        products: { list: vi.fn().mockResolvedValue(sampleProducts), getById },
        inventory: { list: inventoryList },
      });

      renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

      await screen.findByText('Test Product');
      const disclosure = screen.getByRole('button', { name: '2 variants' });
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      // Collapsed: the detail's own queries never fire.
      expect(getById).not.toHaveBeenCalled();

      await user.click(disclosure);

      expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => { expect(getById).toHaveBeenCalledWith('ol_product_abc123'); });

      await user.click(disclosure);
      expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    } finally {
      restore();
    }
  });

  // ── Multi-select + BulkActionBar (#739) ────────────────────────────

  it('should not show the bulk action bar when no rows are selected', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const bar = document.querySelector('.bulk-action-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('should show the bulk action bar with count when a row is selected', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));

    expect(
      screen.getByRole('button', { name: 'Publish to Allegro (1)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1 product selected' })).toBeInTheDocument();
  });

  it('header checkbox selects all visible rows; clicking again unselects them', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Test Product');
    const headerCheckbox = screen.getByRole('checkbox', {
      name: 'Select all visible products',
    });
    await user.click(headerCheckbox);

    expect(
      screen.getByRole('button', { name: 'Publish to Allegro (2)' }),
    ).toBeInTheDocument();

    // After selecting all, header checkbox should be "Unselect all visible"
    await user.click(
      screen.getByRole('checkbox', { name: 'Unselect all visible products' }),
    );
    const bar = document.querySelector('.bulk-action-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('Clear button empties the selection', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));
    expect(
      screen.getByRole('button', { name: 'Publish to Allegro (1)' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    const bar = document.querySelector('.bulk-action-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('CTA navigates to the wizard with selected ids in the URL', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Another Product' }));

    const cta = screen.getByRole('button', { name: 'Publish to Allegro (2)' });
    await user.click(cta);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const navArg = navigateMock.mock.calls[0]?.[0];
    expect(typeof navArg).toBe('string');
    if (typeof navArg !== 'string') return;
    expect(navArg.startsWith('/listings/bulk-create/wizard?productIds=')).toBe(true);
    expect(decodeURIComponent(navArg)).toContain('ol_product_abc123');
    expect(decodeURIComponent(navArg)).toContain('ol_product_def456');
    // Exactly one OfferManager connection ⇒ it is preselected in the URL (#1096).
    expect(decodeURIComponent(navArg)).toContain('connectionId=conn_allegro');
  });

  // ── Per-row "+ Create offers" CTA (#1720) ───────────────────────────

  it('row CTA deep-links the single product to the wizard when a listing gap exists', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Test Product');
    // Only the first product has a gap (1 of 2 variants listed on Allegro);
    // the second is fully covered (1/1), so exactly one row CTA renders.
    const ctas = await screen.findAllByRole('button', { name: '+ Publish' });
    expect(ctas).toHaveLength(1);
    await user.click(ctas[0]);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const navArg = navigateMock.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(navArg)).toContain('productIds=ol_product_abc123');
    expect(decodeURIComponent(navArg)).not.toContain('ol_product_def456');
    expect(decodeURIComponent(navArg)).toContain('connectionId=conn_allegro');
  });

  it('hides the row CTA for a genuinely-unauthorized non-demo session', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    // Default noop session (no permissions), demoMode false ⇒ CTA hidden.
    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    expect(
      screen.queryByRole('button', { name: '+ Publish' }),
    ).not.toBeInTheDocument();
  });

  // ── Capability-gated entry point (#1096) ───────────────────────────

  it('hides the create-offers action when no OfferManager connection exists', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));

    // The bar still shows (Clear) but the create CTA is absent.
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  });

  it('opens the marketplace picker with 2+ OfferManager connections', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const erli = {
      id: 'conn_erli',
      name: 'My Erli',
      status: 'active',
      platformType: 'erli',
      supportedCapabilities: ['OfferManager', 'OfferCreator'],
    };
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection, erli]) },
    });

    renderWithProviders(<ProductsListPage />, {
      apiClient: mockApi,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));

    // Generic label (no single marketplace name) with 2+ connections.
    const cta = await screen.findByRole('button', { name: 'Publish products (1)' });
    await user.click(cta);

    // The unified picker modal appears (#1838); no navigation yet.
    expect(await screen.findByText('Publish products')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // ── Write-access gate on the bulk CTA (#1704) ──────────────────────

  it('hides the create-offers CTA for a genuinely-unauthorized non-demo session', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
    });

    // Default noop session (no permissions), demoMode false ⇒ CTA hidden.
    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));

    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  });

  it('renders the create-offers CTA (enabled) for a demo read-only viewer', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
      connections: { list: vi.fn().mockResolvedValue([allegroConnection]) },
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
    });

    // No permissions but demoMode ⇒ visible-but-usable entry (the gated
    // confirm step blocks the actual write later).
    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));

    expect(
      await screen.findByRole('button', { name: 'Publish to Allegro (1)' }),
    ).toBeEnabled();
  });

  // ── Row identity: labelled SKU + shared ConnectionCell (#2092) ──────

  describe('row identity cells (#2092)', () => {
    /** The connection `sampleProducts`' first row names as its origin. */
    const prestaConnection = {
      id: 'conn_presta',
      name: 'PrestaShop Terra Store',
      status: 'active',
      platformType: 'prestashop',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
    } as const;

    /** The `<tr>` whose Product cell carries `name`. */
    function rowOf(name: string): HTMLElement {
      const row = screen.getByText(name).closest('tr');
      if (!row) throw new Error(`no row for ${name}`);
      return row;
    }

    function identityApi(
      overrides: Parameters<typeof createMockApiClient>[0] = {},
    ): ReturnType<typeof createMockApiClient> {
      return createMockApiClient({
        products: { list: vi.fn().mockResolvedValue(sampleProducts) },
        connections: { list: vi.fn().mockResolvedValue([allegroConnection, prestaConnection]) },
        ...overrides,
      });
    }

    it('labels the identifier sub-line "SKU:" with the value in mono', async () => {
      renderWithProviders(<ProductsListPage />, { apiClient: identityApi() });

      await screen.findByText('Test Product');
      const sku = screen.getByText('SKU-001');
      // The value carries the mono treatment (and, inside a table cell, its
      // 20ch ellipsis) — so the `title` has to sit here, not on the wrapper.
      expect(sku).toHaveClass('mono-text');
      expect(sku).toHaveAttribute('title', 'SKU-001');
      // The wrapper reads as one labelled line; the label itself is body text.
      const line = sku.parentElement;
      expect(line).not.toBeNull();
      expect(line).not.toHaveClass('mono-text');
      expect(line?.textContent?.replace(/\s+/g, ' ')).toBe('SKU: SKU-001');
    });

    it('renders no EAN on the row, even for a single-variant product that has one', async () => {
      // The decided case, not a deferral: EAN lives on the variant, so a product
      // row could only ever carry one when the product resolves to a single
      // variant — which is precisely this fixture.
      const withEan = {
        ...sampleProducts,
        items: [
          {
            ...sampleProducts.items[0]!,
            variantCount: 1,
            variants: [
              {
                id: 'ol_variant_only',
                productId: 'ol_product_abc123',
                sku: 'SKU-001',
                attributes: null,
                ean: '5901234123457',
                gtin: null,
                price: 29.99,
                createdAt: '2026-01-15T10:00:00.000Z',
                updatedAt: '2026-01-15T10:00:00.000Z',
              },
            ],
          },
        ],
        total: 1,
      };
      renderWithProviders(<ProductsListPage />, {
        apiClient: identityApi({ products: { list: vi.fn().mockResolvedValue(withEan) } }),
      });

      await screen.findByText('Test Product');
      const row = rowOf('Test Product');
      expect(within(row).queryByText('5901234123457')).toBeNull();
      expect(within(row).queryByText(/EAN/i)).toBeNull();
    });

    it('renders no identifier line at all for a product with no SKU (never "SKU: -")', async () => {
      renderWithProviders(<ProductsListPage />, { apiClient: identityApi() });

      // The second fixture product has `sku: null`.
      await screen.findByText('Another Product');
      const row = rowOf('Another Product');
      expect(within(row).queryByText(/^SKU:/)).toBeNull();
      // Scoped to the name cell's sub-line: `.mono-text` is not SKU-specific —
      // `CopyableId` emits it too, so an unscoped query would pass here only
      // because this fixture happens to carry no `externalIds` and therefore no
      // Source `ConnectionCell`.
      expect(row.querySelector('.products-cell-sub .mono-text')).toBeNull();
    });

    it('renders the Source column as the shared ConnectionCell with the channel pill as its adornment', async () => {
      const { container } = renderWithProviders(<ProductsListPage />, {
        apiClient: identityApi(),
      });

      await screen.findByText('Test Product');
      const cell = await waitFor(() => {
        const found = container.querySelector('.connection-cell') as HTMLElement | null;
        expect(found).not.toBeNull();
        return found!;
      });

      // The pill is the Products adornment (Listings passes none, Shipments a
      // carrier dot) and it leads line 1 rather than replacing the name.
      const adornment = cell.querySelector('.connection-cell__adornment');
      expect(adornment).not.toBeNull();
      const pill = adornment!.querySelector('.channel-pill');
      expect(pill).toHaveAttribute('data-channel', 'prestashop');
      expect(pill).toHaveTextContent('PrestaShop');

      // Name over a shortened, copyable id — the fact the old cell dropped.
      expect(within(cell).getByRole('link', { name: 'PrestaShop Terra Store' })).toHaveAttribute(
        'href',
        '/connections/conn_presta',
      );
      expect(within(cell).getByText('conn_presta')).toBeInTheDocument();
      expect(
        within(cell).getByRole('button', {
          name: 'Copy connection ID for PrestaShop Terra Store',
        }),
      ).toBeInTheDocument();
    });

    it('resolves connections from the batched page read, never one request per row', async () => {
      // Asserted as "does not scale with row count" rather than "called exactly
      // once": the page already double-mounts the shared connections query
      // (`OfferProductPickerModal` renders only inside the loaded-items branch,
      // so its observer joins after the list settles). That is pre-existing and
      // row-count-independent, which is the property this AC is about.
      async function renderWith(
        items: PaginatedProducts['items'],
      ): Promise<{ listCalls: number; getByIdCalls: number }> {
        const connectionsList = vi
          .fn()
          .mockResolvedValue([allegroConnection, prestaConnection]);
        const getById = vi.fn();
        renderWithProviders(<ProductsListPage />, {
          apiClient: createMockApiClient({
            products: {
              list: vi.fn().mockResolvedValue({ ...sampleProducts, items, total: items.length }),
            },
            connections: { list: connectionsList, getById },
          }),
        });
        await screen.findAllByText('PrestaShop Terra Store');
        return { listCalls: connectionsList.mock.calls.length, getByIdCalls: getById.mock.calls.length };
      }

      const one = await renderWith([sampleProducts.items[0]!]);
      cleanup();
      // Three rows: two share conn_presta, the third names a connection that is
      // gone — the shapes that would each trigger their own fetch per row.
      const three = await renderWith([
        sampleProducts.items[0]!,
        {
          ...sampleProducts.items[1]!,
          externalIds: [
            { externalId: '56', platformType: 'prestashop', connectionId: 'conn_presta' },
          ],
        },
        {
          ...sampleProducts.items[0]!,
          id: 'ol_product_ghi789',
          name: 'Third Product',
          externalIds: [{ externalId: '9', platformType: 'erli', connectionId: 'conn_deleted' }],
        },
      ]);

      expect(three.listCalls).toBe(one.listCalls);
      expect(one.getByIdCalls).toBe(0);
      expect(three.getByIdCalls).toBe(0);
    });

    it('shows the connection loading state rather than Unknown on a cold load', async () => {
      // The `loading` half of ConnectionCell's caller contract: the page must
      // coalesce a map miss to `null`, so without forwarding the batched query's
      // loading state every row would read "Unknown" until it settles.
      const { container } = renderWithProviders(<ProductsListPage />, {
        apiClient: createMockApiClient({
          products: { list: vi.fn().mockResolvedValue(sampleProducts) },
          connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
        }),
      });

      await screen.findByText('Test Product');
      await waitFor(() => {
        expect(container.querySelector('.connection-cell [aria-busy="true"]')).not.toBeNull();
      });
      expect(screen.queryByText('Unknown')).toBeNull();
    });

    it('renders Unknown for a deleted source connection without falling back to a per-row fetch', async () => {
      // The `?? null` half: `Map.get()` misses with `undefined`, which the cell
      // reads as "resolve it yourself" and would turn back into one request per
      // row. Resolved-but-absent must render Unknown and fetch nothing.
      const getById = vi.fn();
      const { container } = renderWithProviders(<ProductsListPage />, {
        apiClient: createMockApiClient({
          products: { list: vi.fn().mockResolvedValue(sampleProducts) },
          connections: { list: vi.fn().mockResolvedValue([allegroConnection]), getById },
        }),
      });

      await screen.findByText('Test Product');
      const cell = await waitFor(() => {
        const found = container.querySelector('.connection-cell') as HTMLElement | null;
        expect(found).not.toBeNull();
        return found!;
      });
      await waitFor(() => {
        expect(within(cell).getByText('Unknown')).toBeInTheDocument();
      });
      expect(getById).not.toHaveBeenCalled();
      // The pill still resolves: its platformType is on the product's own
      // external-id row, not on the connection the page could not find.
      expect(cell.querySelector('.channel-pill')).toHaveTextContent('PrestaShop');
    });

    it('renders erli and woocommerce source pills through the plugin registry, not the lowercase slug', async () => {
      const erliConnection = {
        id: 'conn_erli',
        name: 'My Erli',
        status: 'active',
        platformType: 'erli',
        supportedCapabilities: ['OfferManager', 'OfferCreator'],
      } as const;
      const wooConnection = {
        id: 'conn_woo',
        name: 'My WooCommerce',
        status: 'active',
        platformType: 'woocommerce',
        supportedCapabilities: ['ProductPublisher'],
      } as const;
      const products = {
        ...sampleProducts,
        items: [
          {
            ...sampleProducts.items[0]!,
            externalIds: [
              { externalId: '1', platformType: 'erli', connectionId: 'conn_erli' },
            ],
          },
          {
            ...sampleProducts.items[1]!,
            externalIds: [
              { externalId: '2', platformType: 'woocommerce', connectionId: 'conn_woo' },
            ],
          },
        ],
        total: 2,
      };
      const { container } = renderWithProviders(<ProductsListPage />, {
        apiClient: createMockApiClient({
          products: { list: vi.fn().mockResolvedValue(products) },
          connections: { list: vi.fn().mockResolvedValue([erliConnection, wooConnection]) },
        }),
      });

      await screen.findByText('Test Product');
      const pills = await waitFor(() => {
        const found = Array.from(
          container.querySelectorAll('.connection-cell__adornment .channel-pill'),
        );
        expect(found).toHaveLength(2);
        return found;
      });
      // Brand-coloured pills (the `data-channel` hook) with registry labels.
      expect(pills[0]).toHaveAttribute('data-channel', 'erli');
      expect(pills[0]).toHaveTextContent('Erli');
      expect(pills[1]).toHaveAttribute('data-channel', 'woocommerce');
      expect(pills[1]).toHaveTextContent('WooCommerce');
      // Never the raw slug the pre-#2088 inline maps fell back to.
      expect(pills[0]?.textContent).not.toBe('erli');
      expect(pills[1]?.textContent).not.toBe('woocommerce');
    });

    it('keeps the Source column hidden below 1024px, not 768px', async () => {
      renderWithProviders(<ProductsListPage />, { apiClient: identityApi() });

      await screen.findByText('Test Product');
      const header = screen.getByRole('columnheader', { name: 'Source' });
      // `hideBelow` is a class, so the breakpoint is assertable. Lowering it to
      // 768 was rejected in #1996: it would keep the column only behind
      // horizontal scroll. The tablet relocation is #2094 (S8).
      expect(header).toHaveClass('data-table__cell--hide-below-1024');
      expect(header.className).not.toMatch(/hide-below-768/);
    });

    it('folds the connection into the Product cell so 768px does not lose it (#2094)', async () => {
      const { container } = renderWithProviders(<ProductsListPage />, {
        apiClient: identityApi(),
      });

      await screen.findByText('Test Product');

      // The fold lives INSIDE the identity cell, not beside it: a product's
      // source connection is that column's own subject.
      const fold = container.querySelector('.product-row .conn-fold');
      expect(fold).not.toBeNull();

      const foldEl = fold as HTMLElement;
      // One line: adornment + name. The pill is the same adornment the desktop
      // cell passes on this page.
      expect(foldEl.querySelector('.conn-fold__adornment .channel-pill')).not.toBeNull();
      expect(within(foldEl).getByRole('link', { name: 'PrestaShop Terra Store' })).toBeInTheDocument();

      // Deliberately NO copyable id: copying is a hover affordance and there is
      // no hover on touch, so the tablet form answers "which connection", not
      // "give me its id".
      expect(foldEl.querySelector('.copyable-id')).toBeNull();
      expect(within(foldEl).queryByRole('button')).toBeNull();

      // Which surface is visible is a CSS decision — both are in the DOM under
      // jsdom, and `display: none` is what keeps exactly one exposed (including
      // to a screen reader) at any real width.
      expect(container.querySelector('.connection-cell')).not.toBeNull();
    });

    it('carries the page-scoped table class the row-anchoring rule matches on', async () => {
      // `.products-table td { vertical-align: top }` is a DESCENDANT match on the
      // container (DataTable hardcodes the <table> class), so losing this
      // className silently reverts every cell to `middle` against the taller
      // Stock / Listings / money stacks.
      const { container } = renderWithProviders(<ProductsListPage />, {
        apiClient: identityApi(),
      });

      await screen.findByText('Test Product');
      expect(container.querySelector('.data-table__container.products-table')).not.toBeNull();
    });

    it('labels the card SKU too and keeps the card free of the shared cell', async () => {
      // The card hosts no `ConnectionCell` — the Source column does not render at
      // card width — but it DOES carry the SKU, and "never `SKU: -`" is a claim
      // about the fact rather than about one surface, so the labelled form has to
      // hold here too. Pinned separately from the desktop assertions above
      // because checking one surface and generalising is how #2090 shipped a bug.
      const viewport = mockMobileViewport();
      try {
        const { container } = renderWithProviders(<ProductsListPage />, {
          apiClient: identityApi(),
        });

        await screen.findByText('Test Product');
        expect(container.querySelector('.connection-cell')).toBeNull();
        const title = container.querySelector('.data-table__card-title') as HTMLElement;
        expect(title).not.toBeNull();
        // No `rowHref` on this table, so the card title is not wrapped in the
        // row link — the premise that would make hosting a cell here legal.
        expect(title.closest('a')).toBeNull();

        const subtitle = container.querySelector('.data-table__card-subtitle');
        expect(subtitle?.textContent).toBe('SKU: SKU-001');
        expect(subtitle?.querySelector('.mono-text')?.textContent).toBe('SKU-001');
      } finally {
        viewport.restore();
      }
    });
  });
});
