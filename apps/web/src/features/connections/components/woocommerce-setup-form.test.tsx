/**
 * WoocommerceSetupForm Tests
 *
 * Coverage for the 4-step WooCommerce setup wizard: per-step validation,
 * capability selection with the InventoryMaster/OfferManager mutual-exclusion
 * guard, review content, and submission payload shape.
 */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { WoocommerceSetupForm } from './woocommerce-setup-form';

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function fillStoreDetailsStep(
  container: HTMLElement,
  values: { name: string; url: string },
): void {
  fireEvent.change(within(container).getByLabelText('Connection name'), {
    target: { value: values.name },
  });
  fireEvent.change(within(container).getByLabelText('Site URL'), {
    target: { value: values.url },
  });
}

function fillCredentialsStep(
  container: HTMLElement,
  values: { key: string; secret: string },
): void {
  fireEvent.change(within(container).getByLabelText('Consumer key'), {
    target: { value: values.key },
  });
  fireEvent.change(within(container).getByLabelText('Consumer secret'), {
    target: { value: values.secret },
  });
}

async function advanceOneStep(container: HTMLElement): Promise<void> {
  const before = container.querySelector('[aria-current="step"]')?.textContent ?? '';
  fireEvent.click(within(container).getByRole('button', { name: 'Next' }));
  await waitFor(() => {
    const after = container.querySelector('[aria-current="step"]')?.textContent ?? '';
    if (after === before) throw new Error('Step did not advance');
  });
}

async function advanceToReview(
  container: HTMLElement,
  values = {
    name: 'My Store',
    url: 'https://shop.example.com',
    key: 'ck_test1234567890',
    secret: 'cs_test1234567890',
  },
): Promise<void> {
  fillStoreDetailsStep(container, { name: values.name, url: values.url });
  await advanceOneStep(container);
  fillCredentialsStep(container, { key: values.key, secret: values.secret });
  await advanceOneStep(container);
  await advanceOneStep(container); // capabilities → review
}

describe('WoocommerceSetupForm', () => {
  afterEach(cleanup);

  it('renders the store-details step first with only its fields', () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    expect(within(view.container).getByLabelText('Connection name')).toBeInTheDocument();
    expect(within(view.container).getByLabelText('Site URL')).toBeInTheDocument();
    expect(within(view.container).queryByLabelText('Consumer key')).toBeNull();
    expect(within(view.container).queryByLabelText('Consumer secret')).toBeNull();
  });

  it('blocks advancing when the connection name is empty', async () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    fillStoreDetailsStep(view.container, { name: '', url: 'https://shop.example.com' });

    fireEvent.click(within(view.container).getByRole('button', { name: 'Next' }));

    expect((await screen.findAllByText('Connection name is required')).length).toBeGreaterThan(0);
    expect(within(view.container).queryByLabelText('Consumer key')).toBeNull();
  });

  it('blocks advancing when the site URL is not HTTPS', async () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    fillStoreDetailsStep(view.container, { name: 'My Store', url: 'http://example.com' });

    fireEvent.click(within(view.container).getByRole('button', { name: 'Next' }));

    expect((await screen.findAllByText('Site URL must use HTTPS')).length).toBeGreaterThan(0);
    expect(within(view.container).queryByLabelText('Consumer key')).toBeNull();
  });

  it('blocks advancing when the consumer key does not start with ck_', async () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    fillStoreDetailsStep(view.container, { name: 'My Store', url: 'https://shop.example.com' });
    await advanceOneStep(view.container);

    fillCredentialsStep(view.container, { key: 'invalid_key', secret: 'cs_test1234567890' });
    fireEvent.click(within(view.container).getByRole('button', { name: 'Next' }));

    expect((await screen.findAllByText('Consumer key must start with ck_')).length).toBeGreaterThan(
      0,
    );
  });

  it('blocks advancing when the consumer secret does not start with cs_', async () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    fillStoreDetailsStep(view.container, { name: 'My Store', url: 'https://shop.example.com' });
    await advanceOneStep(view.container);

    fillCredentialsStep(view.container, { key: 'ck_test1234567890', secret: 'invalid_secret' });
    fireEvent.click(within(view.container).getByRole('button', { name: 'Next' }));

    expect(
      (await screen.findAllByText('Consumer secret must start with cs_')).length,
    ).toBeGreaterThan(0);
  });

  it('pre-selects the shop-master capability defaults on the capabilities step', async () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    fillStoreDetailsStep(view.container, { name: 'My Store', url: 'https://shop.example.com' });
    await advanceOneStep(view.container);
    fillCredentialsStep(view.container, { key: 'ck_test1234567890', secret: 'cs_test1234567890' });
    await advanceOneStep(view.container);

    expect(within(view.container).getByRole('checkbox', { name: /ProductMaster/ })).toBeChecked();
    expect(within(view.container).getByRole('checkbox', { name: /InventoryMaster/ })).toBeChecked();
    expect(
      within(view.container).getByRole('checkbox', { name: /OrderProcessorManager/ }),
    ).toBeChecked();
    expect(within(view.container).getByRole('checkbox', { name: /OrderSource/ })).toBeChecked();
  });

  it('disables OfferManager while InventoryMaster is selected and re-enables it after deselection', async () => {
    const adapters = vi.fn().mockResolvedValue([
      {
        adapterKey: 'woocommerce.restapi.v3',
        platformType: 'woocommerce',
        supportedCapabilities: [
          'ProductMaster',
          'InventoryMaster',
          'OrderProcessorManager',
          'OrderSource',
          'ProductPublisher',
          'CategoryProvisioner',
          'OfferManager',
        ],
      },
    ]);
    const apiClient = createMockApiClient({ adapters: { list: adapters } });
    const view = renderWithProviders(<WoocommerceSetupForm />, { apiClient });

    fillStoreDetailsStep(view.container, { name: 'My Store', url: 'https://shop.example.com' });
    await advanceOneStep(view.container);
    fillCredentialsStep(view.container, { key: 'ck_test1234567890', secret: 'cs_test1234567890' });
    await advanceOneStep(view.container);

    const offerManager = await within(view.container).findByRole('checkbox', {
      name: /OfferManager/,
    });
    expect(offerManager).toBeDisabled();
    expect(
      within(view.container).getByText(/Unavailable while InventoryMaster is selected/),
    ).toBeInTheDocument();

    // Deselect InventoryMaster → OfferManager unlocks.
    fireEvent.click(within(view.container).getByRole('checkbox', { name: /InventoryMaster/ }));
    await waitFor(() => {
      expect(
        within(view.container).getByRole('checkbox', { name: /OfferManager/ }),
      ).toBeEnabled();
    });

    // Select OfferManager → InventoryMaster locks in the other direction.
    fireEvent.click(within(view.container).getByRole('checkbox', { name: /OfferManager/ }));
    await waitFor(() => {
      expect(
        within(view.container).getByRole('checkbox', { name: /InventoryMaster/ }),
      ).toBeDisabled();
    });
    expect(
      within(view.container).getByText(/Unavailable while OfferManager is selected/),
    ).toBeInTheDocument();
  });

  it('shows the review summary with a masked consumer key and selected capabilities', async () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    await advanceToReview(view.container);

    expect(within(view.container).getByText('My Store')).toBeInTheDocument();
    expect(within(view.container).getByText('https://shop.example.com')).toBeInTheDocument();
    // Masked: only the last 4 chars visible.
    expect(within(view.container).getByText(/•+7890$/)).toBeInTheDocument();
    expect(within(view.container).queryByText('ck_test1234567890')).toBeNull();
    expect(
      within(view.container).getByText(
        'ProductMaster, InventoryMaster, OrderProcessorManager, OrderSource',
      ),
    ).toBeInTheDocument();
  });

  it('submits exactly the user-selected capabilities and shows a success toast', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Store' });
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(
      <>
        <WoocommerceSetupForm />
        <LocationProbe />
      </>,
      { apiClient },
    );

    fillStoreDetailsStep(view.container, { name: 'My Store', url: 'https://shop.example.com' });
    await advanceOneStep(view.container);
    fillCredentialsStep(view.container, { key: 'ck_test1234567890', secret: 'cs_test1234567890' });
    await advanceOneStep(view.container);

    fireEvent.click(within(view.container).getByRole('checkbox', { name: /OrderSource/ }));
    await advanceOneStep(view.container);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'My Store',
        platformType: 'woocommerce',
        adapterKey: 'woocommerce.restapi.v3',
        credentials: {
          consumerKey: 'ck_test1234567890',
          consumerSecret: 'cs_test1234567890',
        },
        config: { siteUrl: 'https://shop.example.com' },
        enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'],
      });
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/connections');
    });
  });

  it('never submits both InventoryMaster and OfferManager together', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Store' });
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<WoocommerceSetupForm />, { apiClient });
    await advanceToReview(view.container);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalled();
    });
    const payload = create.mock.calls[0]?.[0] as { enabledCapabilities: string[] };
    const hasBoth =
      payload.enabledCapabilities.includes('InventoryMaster') &&
      payload.enabledCapabilities.includes('OfferManager');
    expect(hasBoth).toBe(false);
  });

  it('surfaces API errors in a form-level alert on the review step', async () => {
    const apiClient = createMockApiClient({
      connections: { create: vi.fn().mockRejectedValue(new Error('API create failed')) },
    });
    const view = renderWithProviders(<WoocommerceSetupForm />, { apiClient });
    await advanceToReview(view.container);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText('API create failed')).toBeInTheDocument();
  });

  it('disables the submit button during the mutation', async () => {
    const create = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ id: 'conn-1', name: 'My Store' }), 100),
          ),
      );
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<WoocommerceSetupForm />, { apiClient });
    await advanceToReview(view.container);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await waitFor(() => {
      const button = within(view.container).getByRole('button', {
        name: /Creating|Create connection/,
      });
      expect(button).toBeDisabled();
    });
  });

  it('renders the back-to-connections link inside the wizard card', () => {
    const view = renderWithProviders(<WoocommerceSetupForm />);
    const backLink = within(view.container).getByRole('link', { name: 'Connections' });
    expect(backLink).toHaveAttribute('href', '/connections/new');
    expect(backLink).toHaveClass('back-link', 'wizard-card__back');
  });
});
