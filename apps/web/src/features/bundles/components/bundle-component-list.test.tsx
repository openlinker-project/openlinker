/**
 * bundle-component-list tests (#3520): the limiting component is marked and
 * an unknown stock is said, never shown as zero.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { BundleComponentList } from './bundle-component-list';
import type { BundleComponentAvailability } from '../api/bundles.types';

function component(
  over: Partial<BundleComponentAvailability> & { variantId: string }
): BundleComponentAvailability {
  return {
    productId: `p-${over.variantId}`,
    quantity: 1,
    availableToPromise: 10,
    bundlesSupported: null,
    summary: { name: over.variantId, sku: null, price: null, currency: null, imageUrl: null },
    ...over,
  };
}

describe('BundleComponentList', () => {
  it('should mark the component that limits the bundle', () => {
    renderWithProviders(
      <BundleComponentList
        bundlesAvailable={3}
        components={[
          component({ variantId: 'a', availableToPromise: 30 }),
          component({ variantId: 'b', availableToPromise: 3 }),
        ]}
      />
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveClass('is-lim');
    expect(rows[0]).not.toHaveClass('is-lim');
  });

  it('should say when a stock is unknown', () => {
    renderWithProviders(
      <BundleComponentList
        bundlesAvailable={null}
        components={[component({ variantId: 'a', availableToPromise: null })]}
      />
    );
    expect(screen.getByText(/stock unknown/i)).toBeInTheDocument();
  });
});
