import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VariantStockTable } from './variant-stock-table';
import type { ProductVariant } from '../../features/products/api/products.types';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:v'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function variant(overrides: Partial<ProductVariant>): ProductVariant {
  return {
    id: 'ol_variant_1',
    productId: 'ol_product_1',
    sku: 'KUB-350-GRA',
    attributes: null,
    ean: null,
    gtin: null,
    price: 49.99,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isStale: false,
    staleAt: null,
    ...overrides,
  };
}

function renderTable(variants: ProductVariant[]): ReturnType<typeof renderWithProviders> {
  const requestBlob = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  const request = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  return renderWithProviders(
    <VariantStockTable
      variants={variants}
      stockByVariant={new Map()}
      currency="PLN"
      connections={[]}
      canCreateOffers={false}
      onCreateOffers={vi.fn()}
      onListingsCount={vi.fn()}
    />,
    { apiClient: createMockApiClient({ requestBlob, request }) }
  );
}

describe('VariantStockTable photos', () => {
  it('should show a Photo column with the variant own picture undimmed', async () => {
    renderTable([
      variant({
        imageUrls: ['/products/variants/ol_variant_1/images/0'],
        imagesFromProduct: false,
      }),
    ]);
    expect(screen.getByRole('columnheader', { name: 'Photo' })).toBeInTheDocument();
    const row = screen.getByTestId('variant-row-kub-350-gra');
    await waitFor(() => {
      expect(row.querySelector('img')).toHaveAttribute('src', 'blob:v');
    });
    expect(row.querySelector('.product-thumbnail--dimmed')).toBeNull();
  });

  it('should dim the picture and label it From product when the variant has none of its own', async () => {
    renderTable([
      variant({
        id: 'ol_variant_2',
        sku: 'KUB-350-SZA',
        imageUrls: ['/products/variants/ol_variant_2/images/0'],
        imagesFromProduct: true,
      }),
    ]);
    const row = screen.getByTestId('variant-row-kub-350-sza');
    expect(row.querySelector('.product-thumbnail--dimmed')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /toggle listings for KUB-350-SZA/i }));
    expect(screen.getByText('From product')).toBeInTheDocument();
    expect(screen.getByTestId('variant-photo-source')).toHaveTextContent(/product photos are used/i);
    expect(screen.getByTestId('variant-photo-strip-kub-350-sza')).toBeInTheDocument();
  });

  it('should render a placeholder, never a broken image, when there are no pictures', () => {
    renderTable([variant({ imageUrls: [], imagesFromProduct: true })]);
    const row = screen.getByTestId('variant-row-kub-350-gra');
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('.product-thumbnail')).not.toBeNull();
  });
});
