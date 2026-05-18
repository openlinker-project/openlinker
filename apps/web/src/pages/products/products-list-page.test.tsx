import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type * as ReactRouterDom from 'react-router-dom';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ProductsListPage } from './products-list-page';
import type { PaginatedProducts } from '../../features/products/api/products.types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (): Promise<typeof ReactRouterDom> => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return {
    ...actual,
    useNavigate: (): typeof navigateMock => navigateMock,
  };
});

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
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

describe('ProductsListPage', () => {
  beforeEach(() => {
    // shouldAdvanceTime allows waitFor/findBy to work while still controlling
    // timers so we can flush pending debounce timers in afterEach.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    navigateMock.mockReset();
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
    expect(screen.getByText('Network error')).toBeInTheDocument();
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

  it('should show a Clear search button that clears the search param when a query is active', async () => {
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

    expect(await screen.findByText('No products match the current search.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(await screen.findByRole('link', { name: 'Manage connections' })).toBeInTheDocument();
  });

  // ── Multi-select + BulkActionBar (#739) ────────────────────────────

  it('should not show the bulk action bar when no rows are selected', async () => {
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
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
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));

    expect(
      screen.getByRole('button', { name: 'Create Allegro offers (1)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '1 product selected' })).toBeInTheDocument();
  });

  it('header checkbox selects all visible rows; clicking again unselects them', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    const headerCheckbox = screen.getByRole('checkbox', {
      name: 'Select all visible products',
    });
    await user.click(headerCheckbox);

    expect(
      screen.getByRole('button', { name: 'Create Allegro offers (2)' }),
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
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));
    expect(
      screen.getByRole('button', { name: 'Create Allegro offers (1)' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    const bar = document.querySelector('.bulk-action-bar');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
  });

  it('CTA navigates to the wizard with selected ids in the URL', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mockApi = createMockApiClient({
      products: { list: vi.fn().mockResolvedValue(sampleProducts) },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    await screen.findByText('Test Product');
    await user.click(screen.getByRole('checkbox', { name: 'Select Test Product' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Another Product' }));

    const cta = screen.getByRole('button', { name: 'Create Allegro offers (2)' });
    await user.click(cta);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    const navArg = navigateMock.mock.calls[0]?.[0];
    expect(typeof navArg).toBe('string');
    if (typeof navArg !== 'string') return;
    expect(navArg.startsWith('/listings/bulk-create/wizard?productIds=')).toBe(true);
    expect(decodeURIComponent(navArg)).toContain('ol_product_abc123');
    expect(decodeURIComponent(navArg)).toContain('ol_product_def456');
  });
});
