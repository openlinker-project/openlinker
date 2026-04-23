import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ProductDetailPage } from './product-detail-page';
import type { Product } from '../../features/products/api/products.types';

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

function renderDetailPage(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/products/:id" element={<ProductDetailPage />} />
    </Routes>,
    { apiClient, route: '/products/ol_product_abc123' },
  );
}

describe('ProductDetailPage', () => {
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

    expect(await screen.findByText('Test Product')).toBeInTheDocument();
    expect(screen.getAllByText('ol_product_abc123').length).toBeGreaterThan(0);
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('29.99')).toBeInTheDocument();
    expect(screen.getByText('A test product')).toBeInTheDocument();

    // Variant data
    expect(screen.getByText('SKU-001-M')).toBeInTheDocument();
    expect(screen.getByText('1234567890123')).toBeInTheDocument();
    expect(screen.getByText('size: M, color: blue')).toBeInTheDocument();

    // External IDs
    expect(screen.getByText('prestashop — 10')).toBeInTheDocument();
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
});
