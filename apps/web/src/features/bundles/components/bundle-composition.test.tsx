import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { BundleComposition } from './bundle-composition';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BundleDetail } from '../api/bundles.types';

const summary = { name: 'Mug', sku: 'MUG-1', price: 10, currency: 'PLN', imageUrl: null };
const detail: BundleDetail = {
  variantId: 'v-set',
  version: 1,
  productId: 'p-set',
  composedByMaster: null,
  bundle: { ...summary, name: 'Set', sku: 'SET' },
  openOrdersOnOlderComposition: 0,
  bundlesAvailable: 2,
  components: [],
  componentAvailability: [
    {
      variantId: 'v-mug',
      productId: 'p-mug',
      quantity: 2,
      summary,
      availableToPromise: 4,
      bundlesSupported: 2,
    },
    {
      variantId: 'v-card',
      productId: 'p-card',
      quantity: 1,
      giftSlot: true,
      summary: { ...summary, name: 'Card', sku: 'CARD', imageUrl: '/products/p-card/images/0' },
      availableToPromise: 9,
      bundlesSupported: 9,
    },
  ],
};

function mount(get: (variantId: string) => Promise<BundleDetail>): void {
  renderWithProviders(<BundleComposition variantId="v-set" testId="comp" />, {
    apiClient: createMockApiClient({
      bundles: { get },
      requestBlob: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' })),
    }),
  });
}

describe('BundleComposition', () => {
  it('should list each component with a link to its product, quantity and gift mark', async () => {
    mount(() => Promise.resolve(detail));
    expect(await screen.findByRole('link', { name: 'Mug' })).toHaveAttribute('href', '/products/p-mug');
    expect(screen.getByRole('link', { name: 'Card' })).toHaveAttribute('href', '/products/p-card');
    expect(screen.getByTestId('comp-line-v-mug')).toHaveTextContent('×2');
    expect(screen.getByTestId('comp-line-v-card')).toHaveTextContent('Free gift');
    expect(screen.getByRole('heading', { name: 'Bundle contents' })).toBeInTheDocument();
  });

  it('should show a loading state first', () => {
    mount(() => new Promise(() => undefined));
    expect(screen.getByText('Loading the composition...')).toBeInTheDocument();
  });

  it('should say when the composition could not be loaded', async () => {
    mount(() => Promise.reject(new Error('boom')));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
