import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import { getMessages } from '../../../shared/i18n';
import { createMockApiClient, findToastTitle, renderWithProviders } from '../../../test/test-utils';
import { ShopifySetupForm } from './shopify-setup-form';

const copy = getMessages('shopify').setup;
const ORIGIN = 'http://localhost:5173';

function fillCommon(name = 'Shopify my-shop', storeDomain = 'My-Shop.myshopify.com'): void {
  fireEvent.change(screen.getByLabelText(copy.connectionName), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(copy.storeDomain), { target: { value: storeDomain } });
}

function chooseMode(label: string): void {
  fireEvent.click(screen.getByRole('radio', { name: label }));
}

describe('ShopifySetupForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('should create a client-credentials connection and offer the connection test', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_1', name: 'Shopify my-shop' });
    const test = vi.fn().mockResolvedValue({ success: true, message: 'Shop: My Shop (PLN)', latencyMs: 12 });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create, test } }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 'client-secret' } });
    fireEvent.change(screen.getByLabelText(copy.locationId), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    expect(await findToastTitle(copy.createdTitle)).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith({
      name: 'Shopify my-shop',
      platformType: 'shopify',
      adapterKey: 'shopify.admin.v1',
      config: { storeDomain: 'my-shop.myshopify.com', locationId: '123' },
      credentials: { clientId: 'client-id', clientSecret: 'client-secret' },
    });

    fireEvent.click(screen.getByRole('button', { name: copy.test }));
    expect(await screen.findByText(copy.testPassed)).toBeInTheDocument();
    expect(test).toHaveBeenCalledWith('conn_shopify_1');
  });

  it('should send only the access token in access-token mode', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_2', name: 'Shopify my-shop' });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    fillCommon();
    chooseMode(copy.modeAccessToken);
    expect(screen.queryByLabelText(copy.clientSecret)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.accessToken), { target: { value: 'shpat_abc' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({
      config: { storeDomain: 'my-shop.myshopify.com' },
      credentials: { accessToken: 'shpat_abc' },
    });
  });

  it('should start the OAuth install with this page\'s callback URL and send the operator to Shopify', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { origin: ORIGIN, assign });
    const startOAuth = vi
      .fn()
      .mockResolvedValue({ authorizationUrl: 'https://my-shop.myshopify.com/admin/oauth/authorize?x=1', state: 's' });
    const create = vi.fn();
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ shopify: { startOAuth }, connections: { create } }),
    });

    fillCommon();
    chooseMode(copy.modeOauth);
    expect(
      screen.getByText(`Add this URL to the app's allowed redirection URLs: ${ORIGIN}/integrations/shopify/connect/callback`),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 'client-secret' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitOauth }));

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://my-shop.myshopify.com/admin/oauth/authorize?x=1'),
    );
    expect(startOAuth).toHaveBeenCalledWith({
      storeDomain: 'my-shop.myshopify.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: `${ORIGIN}/integrations/shopify/connect/callback`,
      connectionName: 'Shopify my-shop',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('should refuse a domain that is not a myshopify.com domain without calling the API', async () => {
    const create = vi.fn();
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    fillCommon('Shop', 'shop.example.com');
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 'client-secret' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    expect((await screen.findAllByText(copy.storeDomainInvalid)).length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('should show the coded copy for a failed create, never the raw server message', async () => {
    const create = vi.fn().mockRejectedValue(
      new ApiError('raw upstream text', 400, {
        code: 'OAUTH_CODE_EXCHANGE_REJECTED',
        params: { platformType: 'shopify' },
      }),
    );
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 'client-secret' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    expect(await screen.findByText(/The platform refused the authorization\. Start it again\./)).toBeInTheDocument();
    expect(screen.queryByText(/raw upstream text/)).not.toBeInTheDocument();
  });
});
