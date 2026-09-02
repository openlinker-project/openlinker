/**
 * ProductDetailLinks / ProductDetailFields tests
 *
 * Covers the shared quick-identity block reused by the products cockpit's
 * expandable row (`product-row-detail.tsx`) and the Analytics Top Products
 * inline-expand panel (`product-sales-table.tsx`, #2765) — links always
 * render off `productId` alone, and every field degrades to its placeholder
 * when `product` is absent or partially populated.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { ProductDetailFields, ProductDetailLinks } from './product-detail-summary';
import type { Product } from '../api/products.types';

function renderWithRouter(ui: ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const product: Product = {
  id: 'ol_product_1',
  name: 'Widget A',
  sku: 'WID-A',
  price: 42,
  currency: 'PLN',
  description: null,
  images: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  externalIds: [{ platformType: 'prestashop', externalId: '42', connectionId: 'conn-1' }],
  stockUpdatedAt: '2026-08-31T21:04:00.000Z',
};

describe('ProductDetailLinks', () => {
  it('links to the full product page and the content editor, keyed off productId alone', () => {
    renderWithRouter(<ProductDetailLinks productId="ol_product_1" />);

    expect(screen.getByRole('link', { name: /Product details/ })).toHaveAttribute(
      'href',
      '/products/ol_product_1',
    );
    expect(screen.getByRole('link', { name: /Edit content/ })).toHaveAttribute(
      'href',
      '/products/ol_product_1?view=content',
    );
  });
});

describe('ProductDetailFields', () => {
  it('renders every field from a resolved product', () => {
    renderWithRouter(<ProductDetailFields productId="ol_product_1" product={product} />);

    expect(screen.getByText('ol_product_1')).toBeInTheDocument();
    expect(screen.getByText('prestashop · 42')).toBeInTheDocument();
    expect(screen.getByText('PLN')).toBeInTheDocument();
    expect(screen.getByText(/Aug 31, 2026/)).toBeInTheDocument();
  });

  it('falls back to placeholders for every field when product is not resolved yet', () => {
    renderWithRouter(<ProductDetailFields productId="ol_product_1" />);

    // Internal ID always renders from productId, independent of resolution.
    expect(screen.getByText('ol_product_1')).toBeInTheDocument();
    expect(screen.getByText('not set by source')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2);
  });

  it('falls back per-field when the resolved product has partial data', () => {
    renderWithRouter(
      <ProductDetailFields
        productId="ol_product_1"
        product={{ ...product, currency: null, externalIds: [], stockUpdatedAt: null }}
      />,
    );

    expect(screen.getByText('not set by source')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2);
  });
});
