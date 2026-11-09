import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ProductUsedInBundles } from './product-used-in-bundles';

describe('ProductUsedInBundles (#3624)', () => {
  it('should list the bundles a product is in, with the quantity and the gift mark', async () => {
    const apiClient = createMockApiClient({
      bundles: {
        usedInMany: vi.fn().mockResolvedValue([
          {
            bundleVariantId: 'v-set',
            quantity: 2,
            giftSlot: true,
            bundle: { name: 'Zestaw poranny', sku: 'ZES-PORANNY', price: 65, currency: 'PLN', imageUrl: null },
          },
        ]),
      },
    });
    renderWithProviders(<ProductUsedInBundles variantIds={['mug']} />, { apiClient });
    const row = await screen.findByTestId('bundle-list-used-in-ZES-PORANNY');
    expect(row).toHaveTextContent('2 x in bundle Zestaw poranny');
    expect(row).toHaveTextContent('as a gift');
  });

  it('should ask once for every variant and not clash on two variants in one bundle', async () => {
    const entry = { bundleVariantId: 'v-set', quantity: 1, bundle: { name: 'Set', sku: 'SET', price: 1, currency: 'PLN', imageUrl: null } };
    const usedInMany = vi.fn().mockResolvedValue([
      { ...entry, componentVariantId: 'v-a' },
      { ...entry, componentVariantId: 'v-b' },
    ]);
    const apiClient = createMockApiClient({ bundles: { usedInMany } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithProviders(<ProductUsedInBundles variantIds={['v-a', 'v-b']} />, { apiClient });
    await screen.findAllByTestId('bundle-list-used-in-SET');
    expect(usedInMany).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('same key');
    errorSpy.mockRestore();
  });

  it('should render nothing for a product that is in no bundle', async () => {
    const apiClient = createMockApiClient({ bundles: { usedInMany: vi.fn().mockResolvedValue([]) } });
    const { container } = renderWithProviders(<ProductUsedInBundles variantIds={['mug']} />, { apiClient });
    await vi.waitFor(() => {
      expect(apiClient.bundles.usedInMany).toHaveBeenCalled();
    });
    expect(container.querySelector('[data-testid="bundle-list-used-in"]')).toBeNull();
  });
});
