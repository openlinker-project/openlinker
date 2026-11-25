import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
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
  it('should confirm N x product in one click and say how many orders continue', async () => {
    const apiClient = createMockApiClient({
      bundles: {
        confirmMultipack: vi
          .fn()
          .mockResolvedValue({ variantId: 'v-coffee', packQuantity: 3, releasedOrders: 2 }),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<MultipackHoldBanner hold={hold} />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    expect(screen.getByTestId('order-multipack-banner')).toHaveTextContent(
      'Order waiting: the offer sells 3 units of this product',
    );
    expect(screen.getByTestId('order-multipack-confirm-text')).toHaveTextContent(
      'Confirm that one sale of this offer = 3 x Kawa ziarnista Etiopia 250 g. The order continues and stock drops by 3.',
    );
    await waitFor(() => {
      expect(screen.getByTestId('order-multipack-create-bundle')).toBeEnabled();
    });
    await user.click(screen.getByTestId('order-multipack-create-bundle'));
    expect(apiClient.bundles.confirmMultipack).toHaveBeenCalledWith('v-coffee', 3);
    expect(await screen.findByTestId('order-multipack-created')).toHaveTextContent('2 orders continue.');
    expect(screen.getByTestId('order-multipack-rule-link')).toHaveAttribute(
      'href',
      '/products?search=KAW-250-ETI',
    );
  });

  it('should say plainly what confirming does before the click', () => {
    renderWithProviders(<MultipackHoldBanner hold={hold} />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    expect(screen.getByTestId('order-multipack-preview')).toHaveTextContent(
      /1 sale.*3 x Kawa ziarnista Etiopia 250 g/,
    );
    expect(screen.getByTestId('order-multipack-effects').querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByTestId('order-multipack-make-bundle')).toHaveAttribute(
      'href',
      '/products/bundles/new?component=v-coffee&quantity=3',
    );
  });

  it('should enable the action for an operator, who holds bundles:write but not products:write', async () => {
    renderWithProviders(<MultipackHoldBanner hold={hold} />, {
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u',
        username: 'op',
        email: null,
        role: 'operator',
        permissions: ['orders:read', 'bundles:write'],
        analyticsConsent: true,
      }),
    });
    await waitFor(() => {
      expect(screen.getByTestId('order-multipack-create-bundle')).toBeEnabled();
    });
  });

  it('should not promise the order continues while another multipack line is still held', async () => {
    const apiClient = createMockApiClient({
      bundles: {
        confirmMultipack: vi
          .fn()
          .mockResolvedValue({ variantId: 'v-coffee', packQuantity: 3, releasedOrders: 0 }),
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<MultipackHoldBanner hold={hold} otherLinesHeld />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('order-multipack-create-bundle')).toBeEnabled();
    });
    await user.click(screen.getByTestId('order-multipack-create-bundle'));
    expect(await screen.findByTestId('order-multipack-created')).toHaveTextContent(
      'stays held until the other held lines',
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
    const button = screen.getByTestId('order-multipack-create-bundle');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('admin or operator'));
  });

  it('should not offer a confirmation the offer cannot support when it maps to no product', async () => {
    renderWithProviders(<MultipackHoldBanner hold={{ ...hold, variantId: null, productName: null }} />, {
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });
    await waitFor(() => {
      expect(screen.getByTestId('order-multipack-create-bundle')).toHaveAttribute(
        'title',
        expect.stringContaining('not linked to a product'),
      );
    });
    expect(screen.getByTestId('order-multipack-create-bundle')).toBeDisabled();
  });
});
