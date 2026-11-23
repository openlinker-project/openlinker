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
      enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
      credentials: { clientId: 'client-id', clientSecret: 'client-secret' },
    });

    fireEvent.click(screen.getByRole('button', { name: copy.test }));
    expect(await screen.findByText(copy.testPassed)).toBeInTheDocument();
    expect(test).toHaveBeenCalledWith('conn_shopify_1');
  });

  it('should default the start to new orders only and send nothing for it', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_3', name: 'Shopify my-shop' });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    expect(await screen.findByRole('radio', { name: /New orders only/ })).toBeChecked();
    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect((create.mock.calls[0][0] as { orderSyncStart?: unknown }).orderSyncStart).toBeUndefined();
  });

  it('should send the chosen start date for a store that reads orders', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_4', name: 'Shopify my-shop' });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ orderSyncStart: { mode: 'all' } })),
    );
  });

  it('should send a date and newest-first when the shop declares the date start and window import', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_5', name: 'Shopify my-shop' });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        connections: { create },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shopify.admin.v1',
              platformType: 'shopify',
              supportedCapabilities: ['OrderSource'],
              orderSyncStartModes: ['now', 'from', 'all'],
              orderWindowImport: true,
            },
          ]),
        },
      }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    const fromCard = await screen.findByRole('radio', { name: /Orders since a date/ });
    await waitFor(() => expect(fromCard).not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(fromCard);
    fireEvent.change(await screen.findByLabelText('First day to import'), { target: { value: '2024-03-01' } });
    fireEvent.click(screen.getByRole('radio', { name: /Newest first/ }));
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ orderSyncStart: { mode: 'from', from: '2024-03-01', order: 'newest-first' } }),
      ),
    );
  });

  it('should not offer modes the adapter does not declare', async () => {
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shopify.admin.v1',
              platformType: 'shopify',
              supportedCapabilities: ['OrderSource'],
              orderSyncStartModes: ['now'],
            },
          ]),
        },
      }),
    });

    const fromCard = await screen.findByRole('radio', { name: /Orders since a date/ });
    const allCard = screen.getByRole('radio', { name: /Every order the shop has/ });
    expect(fromCard).toHaveAttribute('aria-disabled', 'true');
    expect(allCard).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: /New orders only/ })).toBeChecked();
  });

  it('should not show a disabled "from" card while the adapter list is still loading', () => {
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        adapters: { list: vi.fn().mockReturnValue(new Promise(() => undefined)) },
      }),
    });

    expect(screen.queryByRole('radio', { name: /Orders since a date/ })).toBeNull();
    expect(screen.getByText(getMessages('connections').orderSyncStart.loading)).toBeInTheDocument();
  });

  it('should say the start will be new orders only when the adapter list cannot be read', async () => {
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        adapters: { list: vi.fn().mockRejectedValue(new Error('network')) },
      }),
    });

    expect(await screen.findByText(getMessages('connections').orderSyncStart.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Orders since a date/ })).toBeNull();
  });

  it('should carry the start through the OAuth install so the callback can store it', async () => {
    const startOAuth = vi.fn().mockResolvedValue({ authorizationUrl: `${ORIGIN}/done`, state: 's' });
    vi.stubGlobal('location', { ...window.location, origin: ORIGIN, assign: vi.fn() });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ shopify: { startOAuth } }),
    });

    fillCommon();
    chooseMode(copy.modeOauth);
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
    fireEvent.click(screen.getByRole('button', { name: copy.submitOauth }));

    await waitFor(() =>
      expect(startOAuth).toHaveBeenCalledWith(expect.objectContaining({ orderSyncStart: { mode: 'all' } })),
    );
  });

  it('should not block a publisher submit over a start date nobody can see', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_6', name: 'Shopify my-shop' });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        connections: { create },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shopify.admin.v1',
              platformType: 'shopify',
              supportedCapabilities: ['OrderSource'],
              orderSyncStartModes: ['now', 'from', 'all'],
            },
          ]),
        },
      }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    // Pick "from" without a day, then switch to a role that never asks.
    fireEvent.click(await screen.findByRole('radio', { name: /Orders since a date/ }));
    fireEvent.click(screen.getByRole('radio', { name: copy.rolePublisher }));
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect((create.mock.calls[0][0] as { orderSyncStart?: unknown }).orderSyncStart).toBeUndefined();
  });

  it('should explain a refused start date in the error summary, not leave the submit silent', async () => {
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        connections: { create: vi.fn() },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shopify.admin.v1',
              platformType: 'shopify',
              supportedCapabilities: ['OrderSource'],
              orderSyncStartModes: ['now', 'from', 'all'],
            },
          ]),
        },
      }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Orders since a date/ }));
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    const summary = await screen.findByText(/Please correct the highlighted fields/);
    expect(summary).toBeInTheDocument();
    expect(screen.getAllByText(getMessages('connections').orderSyncStartSchema.dateRequired).length).toBeGreaterThan(1);
  });

  it('should refuse a start date in the future', async () => {
    const create = vi.fn();
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({
        connections: { create },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shopify.admin.v1',
              platformType: 'shopify',
              supportedCapabilities: ['OrderSource'],
              orderSyncStartModes: ['now', 'from', 'all'],
            },
          ]),
        },
      }),
    });

    fillCommon();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 's' } });
    const fromCard = await screen.findByRole('radio', { name: /Orders since a date/ });
    await waitFor(() => expect(fromCard).toBeEnabled());
    fireEvent.click(fromCard);
    fireEvent.change(await screen.findByLabelText('First day to import'), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(create).not.toHaveBeenCalled();
  });

  it('should ask for a start in every connect mode for a store that reads orders, and never for a publisher', async () => {
    renderWithProviders(<ShopifySetupForm />);

    expect(await screen.findByRole('radio', { name: /New orders only/ })).toBeInTheDocument();
    chooseMode(copy.modeOauth);
    expect(screen.getByRole('radio', { name: /New orders only/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: copy.rolePublisher }));
    expect(screen.queryByRole('radio', { name: /New orders only/ })).toBeNull();
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
      enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('should create a publish-only connection without the master capabilities', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn_shopify_2', name: 'Shopify my-shop' });
    renderWithProviders(<ShopifySetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    fillCommon();
    fireEvent.click(screen.getByRole('radio', { name: copy.rolePublisher }));
    expect(screen.getByText(copy.rolePublisherHint)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(copy.clientId), { target: { value: 'client-id' } });
    fireEvent.change(screen.getByLabelText(copy.clientSecret), { target: { value: 'client-secret' } });
    fireEvent.click(screen.getByRole('button', { name: copy.submitCreate }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const sent = create.mock.calls[0][0] as { enabledCapabilities: string[] };
    expect(sent.enabledCapabilities).toEqual(['ProductPublisher', 'CategoryProvisioner', 'OfferManager']);
    expect(sent.enabledCapabilities).not.toContain('ProductMaster');
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
