import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { BulkCreateWizardPage, filterProductsToSelectedVariants } from './bulk-create-wizard-page';
import type { Product, ProductVariant } from '../../features/products';

function renderPage(
  apiClient: ReturnType<typeof createMockApiClient>,
  route: string,
) {
  return renderWithProviders(
    <Routes>
      <Route path="/listings/bulk-create/wizard" element={<BulkCreateWizardPage />} />
      <Route path="/products" element={<div>PRODUCTS_SENTINEL</div>} />
    </Routes>,
    { apiClient, route },
  );
}

describe('BulkCreateWizardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });
  afterEach(cleanup);

  it('redirects to /products when productIds is missing', async () => {
    const apiClient = createMockApiClient();
    renderPage(apiClient, '/listings/bulk-create/wizard');

    expect(await screen.findByText('PRODUCTS_SENTINEL')).toBeInTheDocument();
  });

  it('redirects to /products when productIds is empty', async () => {
    const apiClient = createMockApiClient();
    renderPage(apiClient, '/listings/bulk-create/wizard?productIds=');

    expect(await screen.findByText('PRODUCTS_SENTINEL')).toBeInTheDocument();
  });

  it('redirects to /products when more than 100 productIds are passed', async () => {
    const apiClient = createMockApiClient();
    const ids = Array.from({ length: 101 }, (_, i) => `p${i.toString()}`).join(',');
    renderPage(apiClient, `/listings/bulk-create/wizard?productIds=${ids}`);

    expect(await screen.findByText('PRODUCTS_SENTINEL')).toBeInTheDocument();
  });

  it('renders the wizard once products load', async () => {
    const apiClient = createMockApiClient({
      products: {
        getById: vi.fn().mockResolvedValue({
          id: 'p_1',
          name: 'Sample product',
          sku: 'SK-1',
          price: 19.0,
          currency: 'PLN',
          description: null,
          images: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          variants: [
            {
              id: 'v_1',
              productId: 'p_1',
              sku: 'SK-1',
              attributes: null,
              ean: '0123456789012',
              gtin: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      },
    });

    renderPage(apiClient, '/listings/bulk-create/wizard?productIds=p_1');

    // The wizard's Page title is rendered once products load.
    expect(
      await screen.findByRole('heading', { name: /Bulk marketplace offer creation/ }),
    ).toBeInTheDocument();
  });
});

function makeVariant(id: string, productId: string): ProductVariant {
  return {
    id,
    productId,
    sku: id,
    attributes: null,
    ean: null,
    gtin: null,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeProduct(id: string, variantIds: string[]): Product {
  return {
    id,
    name: `Product ${id}`,
    sku: id,
    price: null,
    currency: null,
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: variantIds.map((v) => makeVariant(v, id)),
  };
}

describe('filterProductsToSelectedVariants', () => {
  it('returns products unchanged when the variant set is empty', () => {
    const products = [makeProduct('p1', ['v1', 'v2'])];
    const result = filterProductsToSelectedVariants(products, new Set());
    expect(result).toBe(products);
  });

  it('narrows a product to only its selected variants', () => {
    const products = [makeProduct('p1', ['v1', 'v2', 'v3'])];
    const result = filterProductsToSelectedVariants(products, new Set(['v2']));
    expect(result[0]!.variants?.map((v) => v.id)).toEqual(['v2']);
  });

  it('leaves a product with no matching variants unchanged (whole-product pick)', () => {
    const products = [makeProduct('p1', ['v1', 'v2']), makeProduct('p2', ['v3', 'v4'])];
    const result = filterProductsToSelectedVariants(products, new Set(['v3']));
    // p1 has no match -> unchanged (all variants); p2 -> only v3.
    expect(result[0]!.variants?.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(result[1]!.variants?.map((v) => v.id)).toEqual(['v3']);
  });
});
