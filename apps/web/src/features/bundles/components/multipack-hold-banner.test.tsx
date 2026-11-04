import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../../test/test-utils';
import { MultipackHoldBanner } from './multipack-hold-banner';

const hold = {
  lineId: 'L1',
  packQuantity: 3,
  lineName: 'Kawa 3 opakowania',
  variantId: 'v-coffee',
  productName: 'Kawa ziarnista Etiopia 250 g',
  sku: 'KAW-250-ETI',
};

describe('MultipackHoldBanner (#3624)', () => {
  it('should offer to create the bundle with the quantity and product prefilled', async () => {
    renderWithProviders(<MultipackHoldBanner hold={hold} />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    expect(screen.getByTestId('order-multipack-banner')).toHaveTextContent('Held: the offer is 3 units of one product');
    const create = await screen.findByRole('link', { name: 'Create bundle 3 x Kawa ziarnista Etiopia 250 g' });
    expect(create).toHaveAttribute('href', '/products/bundles/new?component=v-coffee&quantity=3');
    expect(screen.getByTestId('order-multipack-open-products')).toHaveAttribute(
      'href',
      '/products?search=KAW-250-ETI',
    );
  });

  it('should show the action disabled with the reason for a role that cannot write', () => {
    renderWithProviders(<MultipackHoldBanner hold={hold} />, {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['orders:read'],
        analyticsConsent: true,
      }),
    });
    const create = screen.getByTestId('order-multipack-create-bundle');
    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(create).toHaveAttribute('title', expect.stringContaining('admin or operator'));
  });

  it('should still offer a way forward when the offer maps to no product', async () => {
    renderWithProviders(<MultipackHoldBanner hold={{ ...hold, variantId: null, productName: null }} />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    expect(await screen.findByRole('link', { name: 'Create a bundle' })).toHaveAttribute(
      'href',
      '/products/bundles/new',
    );
  });
});
