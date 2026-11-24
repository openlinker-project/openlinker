import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OfferProductPickerRow } from './offer-product-picker-row';
import type { Product } from '../../products';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:pv'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const product = {
  id: 'ol_product_1',
  name: 'Kubek',
  sku: 'KUB',
  price: 10,
  currency: 'PLN',
  description: null,
  images: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [
    {
      id: 'ol_variant_1',
      productId: 'ol_product_1',
      sku: 'KUB-GRA',
      attributes: { color: 'granat' },
      ean: '5901234567890',
      gtin: null,
      price: 10,
      imageUrls: ['/products/variants/ol_variant_1/images/0'],
      imagesFromProduct: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isStale: false,
      staleAt: null,
    },
  ],
} as Product;

describe('OfferProductPickerRow variant thumbnail', () => {
  it('should fetch and show the variant first resolved picture', async () => {
    const requestBlob = vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    const getById = vi.fn().mockResolvedValue(product);
    renderWithProviders(
      <OfferProductPickerRow
        product={product}
        isExpanded
        entry={undefined}
        capBlocked={false}
        onToggleExpand={vi.fn()}
        onSelectAll={vi.fn()}
        onClear={vi.fn()}
        onToggleVariant={vi.fn()}
        onVariantsLoaded={vi.fn()}
      />,
      {
        apiClient: createMockApiClient({
          requestBlob,
          products: { getById },
        } as Parameters<typeof createMockApiClient>[0]),
      }
    );
    await waitFor(() => {
      expect(requestBlob).toHaveBeenCalledWith('/products/variants/ol_variant_1/images/0');
    });
  });
});
