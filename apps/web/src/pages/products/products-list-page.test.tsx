import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ProductsListPage } from './products-list-page';
import type { PaginatedProducts } from '../../features/products/api/products.types';

const sampleProducts: PaginatedProducts = {
  items: [
    {
      id: 'ol_product_abc123',
      name: 'Test Product',
      sku: 'SKU-001',
      price: 29.99,
      description: null,
      images: null,
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:00:00.000Z',
    },
    {
      id: 'ol_product_def456',
      name: 'Another Product',
      sku: null,
      price: null,
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
  });

  afterEach(() => {
    // Flush pending debounce timers before environment teardown to prevent
    // "window is not defined" unhandled errors from useDebouncedValue.
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    expect(screen.getByText('Loading products')).toBeInTheDocument();
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
    expect(screen.getByText('29.99')).toBeInTheDocument();
    expect(screen.getByText('Another Product')).toBeInTheDocument();
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

  it('should show empty state when no products exist', async () => {
    const mockApi = createMockApiClient({
      products: {
        list: vi.fn().mockResolvedValue({
          items: [],
          total: 0,
          limit: 20,
          offset: 0,
        }),
      },
    });

    renderWithProviders(<ProductsListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No products found')).toBeInTheDocument();
  });
});
