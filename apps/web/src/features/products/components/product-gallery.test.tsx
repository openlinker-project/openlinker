import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ProductGallery } from './product-gallery';

describe('ProductGallery', () => {
  const createObjectURL = vi.fn(() => 'blob:proxied-0');
  beforeEach(() => {
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    createObjectURL.mockClear();
  });

  it('should read the picture through the API image proxy when a product id is given', async () => {
    const requestBlob = vi.fn().mockResolvedValue(new Blob(['x']));
    renderWithProviders(
      <ProductGallery
        images={['http://prestashop/img/1.jpg']}
        name="Drill"
        productId="ol_product_1"
      />,
      { apiClient: createMockApiClient({ requestBlob }) }
    );

    expect(requestBlob).toHaveBeenCalledWith('/products/ol_product_1/images/0');
    await waitFor(() => {
      expect(screen.getByAltText('Drill')).toHaveAttribute('src', 'blob:proxied-0');
    });
  });

  it('should show the placeholder, never the stored url, when the proxy has no picture', async () => {
    const requestBlob = vi.fn().mockRejectedValue(new Error('404'));
    const { container } = renderWithProviders(
      <ProductGallery
        images={['http://prestashop/img/1.jpg']}
        name="Mug"
        productId="ol_product_2"
      />,
      { apiClient: createMockApiClient({ requestBlob }) }
    );

    await waitFor(() => {
      expect(requestBlob).toHaveBeenCalledWith('/products/ol_product_2/images/0');
    });
    expect(screen.queryByAltText('Mug')).toBeNull();
    expect(container.querySelector('img[src="http://prestashop/img/1.jpg"]')).toBeNull();
    expect(container.querySelector('.product-gallery__placeholder')).toHaveTextContent('M');
  });

  it('should not render the stored url while the proxy is still loading', () => {
    const requestBlob = vi.fn(() => new Promise<Blob>(() => undefined));
    const { container } = renderWithProviders(
      <ProductGallery
        images={['http://prestashop/img/1.jpg', 'http://prestashop/img/2.jpg']}
        name="Lamp"
        productId="ol_product_3"
      />,
      { apiClient: createMockApiClient({ requestBlob }) }
    );

    expect(requestBlob).toHaveBeenCalledWith('/products/ol_product_3/images/0');
    expect(requestBlob).toHaveBeenCalledWith('/products/ol_product_3/images/1');
    expect(container.querySelector('img')).toBeNull();
  });

  it('should use the stored url directly without a product id', () => {
    const requestBlob = vi.fn();
    renderWithProviders(<ProductGallery images={['https://cdn.example.com/2.jpg']} name="Cup" />, {
      apiClient: createMockApiClient({ requestBlob }),
    });

    expect(screen.getByAltText('Cup')).toHaveAttribute('src', 'https://cdn.example.com/2.jpg');
    expect(requestBlob).not.toHaveBeenCalled();
  });
});
