import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ProductUsedInBundles } from './product-used-in-bundles';

describe('ProductUsedInBundles (#3624)', () => {
  it('should list the bundles a product is in, with the quantity and the gift mark', async () => {
    const apiClient = createMockApiClient({
      bundles: {
        usedIn: vi.fn().mockResolvedValue([
          {
            bundleVariantId: 'v-set',
            quantity: 2,
            giftSlot: true,
            bundle: { name: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 65, currency: 'PLN' },
          },
        ]),
      },
    });
    renderWithProviders(<ProductUsedInBundles variantIds={['mug']} />, { apiClient });
    const row = await screen.findByTestId('bundle-list-used-in-ZES-PORANNY');
    expect(row).toHaveTextContent('2 x in bundle Zestaw poranny');
    expect(row).toHaveTextContent('as a gift');
  });

  it('should render nothing for a product that is in no bundle', async () => {
    const apiClient = createMockApiClient({ bundles: { usedIn: vi.fn().mockResolvedValue([]) } });
    const { container } = renderWithProviders(<ProductUsedInBundles variantIds={['mug']} />, { apiClient });
    await vi.waitFor(() => {
      expect(apiClient.bundles.usedIn).toHaveBeenCalled();
    });
    expect(container.querySelector('[data-testid="bundle-list-used-in"]')).toBeNull();
  });
});
