import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShopifyApi } from '../../features/shopify';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import { ShopifyConnectCallbackPage } from './shopify-connect-callback-page';

const CALLBACK_ROUTE = '/integrations/shopify/connect/callback';
const QUERY = '?code=auth_code&hmac=abc&shop=my-shop.myshopify.com&state=csrf_state&timestamp=1700000000';

/**
 * The page reads the raw redirect query from `window.location` (the API needs
 * it byte for byte for Shopify's hmac), so the address bar is set as well as
 * the router's route.
 */
function renderAt(search: string, handleCallback: ShopifyApi['handleCallback']): void {
  window.history.replaceState({}, '', `${CALLBACK_ROUTE}${search}`);
  const apiClient = createMockApiClient({ shopify: { handleCallback } });
  renderWithProviders(<ShopifyConnectCallbackPage />, {
    apiClient,
    route: `${CALLBACK_ROUTE}${search}`,
  });
}

describe('ShopifyConnectCallbackPage', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('should show the invalid-callback state when the code or state is missing', () => {
    const handleCallback = vi.fn();
    renderAt('?shop=my-shop.myshopify.com', handleCallback);

    expect(screen.getByRole('heading', { name: 'Invalid callback' })).toBeInTheDocument();
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('should forward the whole redirect query and show the loading state while pending', () => {
    const handleCallback = vi.fn().mockReturnValue(new Promise(() => {}));
    renderAt(QUERY, handleCallback);

    expect(screen.getByRole('heading', { name: 'Completing authorization' })).toBeInTheDocument();
    expect(handleCallback).toHaveBeenCalledWith(QUERY);
  });

  it('should show the connected store when the callback succeeds', async () => {
    renderAt(
      QUERY,
      vi.fn().mockResolvedValue({
        message: 'Shopify store connected.',
        connectionId: 'conn_shopify_1',
        connectionName: 'Shopify my-shop',
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Shopify store connected' })).toBeInTheDocument();
    expect(screen.getByText('Shopify my-shop')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to connection/i })).toHaveAttribute(
      'href',
      '/connections/conn_shopify_1',
    );
  });

  it('should treat an already-used state as a completed authorization', async () => {
    renderAt(
      QUERY,
      vi.fn().mockRejectedValue(
        new ApiError('Invalid or expired OAuth state parameter', 400, { code: 'OAUTH_STATE_INVALID' }),
      ),
    );

    expect(
      await screen.findByRole('heading', { name: 'Authorization already completed' }),
    ).toBeInTheDocument();
  });

  it('should say the redirect could not be verified when the API refuses its hmac or shop', async () => {
    renderAt(
      QUERY,
      vi.fn().mockRejectedValue(
        new ApiError('The Shopify redirect could not be verified', 400, {
          code: 'OAUTH_CALLBACK_UNVERIFIED',
          params: { platformType: 'shopify', reason: 'bad-hmac' },
        }),
      ),
    );

    expect(await screen.findByRole('heading', { name: 'Connection failed' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'The redirect could not be confirmed as coming from Shopify for this store. No connection was created.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start over/i })).toHaveAttribute(
      'href',
      '/connections/new/shopify',
    );
  });

  it('should show the coded copy for any other failure, never the raw server message', async () => {
    renderAt(
      QUERY,
      vi.fn().mockRejectedValue(
        new ApiError('raw upstream text', 400, {
          code: 'OAUTH_CODE_EXCHANGE_REJECTED',
          params: { platformType: 'shopify' },
        }),
      ),
    );

    expect(await screen.findByRole('heading', { name: 'Connection failed' })).toBeInTheDocument();
    expect(screen.getByText(/The platform refused the authorization\. Start it again\./)).toBeInTheDocument();
    expect(screen.queryByText(/raw upstream text/)).not.toBeInTheDocument();
  });
});
