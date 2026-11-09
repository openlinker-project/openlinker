import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import type { PaginatedProducts, Product } from '../../features/products/api/products.types';
import { ProductPeekById } from './product-peek-by-id';

const product: Product = {
  id: 'ol_product_drill',
  name: 'Cordless Drill',
  sku: 'DRILL-1',
  price: 499.99,
  currency: 'PLN',
  description: null,
  images: null,
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
  totalAvailable: 7,
  totalReserved: 0,
  variantCount: 1,
};

function page(items: Product[]): PaginatedProducts {
  return { items, total: items.length, limit: 1, offset: 0 } as PaginatedProducts;
}

describe('ProductPeekById', () => {
  it('should read the product by id and show its peek', async () => {
    const list = vi.fn().mockResolvedValue(page([product]));
    renderWithProviders(<ProductPeekById productId="ol_product_drill" onClose={vi.fn()} />, {
      apiClient: createMockApiClient({ products: { list } }),
    });

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Cordless Drill')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'ol_product_drill' }),
      expect.objectContaining({ limit: 1 })
    );
  });

  it('should say so when the product is gone', async () => {
    const list = vi.fn().mockResolvedValue(page([]));
    renderWithProviders(<ProductPeekById productId="ol_product_gone" onClose={vi.fn()} />, {
      apiClient: createMockApiClient({ products: { list } }),
    });

    expect(await screen.findByText('Product not found')).toBeInTheDocument();
  });

  it('should call onClose when the panel is closed', async () => {
    const onClose = vi.fn();
    renderWithProviders(<ProductPeekById productId="ol_product_drill" onClose={onClose} />, {
      apiClient: createMockApiClient({
        products: { list: vi.fn().mockResolvedValue(page([product])) },
      }),
    });

    await screen.findByText('Cordless Drill');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('should stay closed without a product id', () => {
    const list = vi.fn();
    renderWithProviders(<ProductPeekById productId={null} onClose={vi.fn()} />, {
      apiClient: createMockApiClient({ products: { list } }),
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});
