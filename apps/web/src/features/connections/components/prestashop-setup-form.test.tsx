import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { PrestashopSetupForm } from './prestashop-setup-form';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';

const captureDemoEvent = vi.fn();
vi.mock('../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function fillCredentialsStep(
  container: HTMLElement,
  values: { name: string; url: string; key: string; shopId?: string }
): void {
  fireEvent.change(within(container).getByLabelText('Connection name'), {
    target: { value: values.name },
  });
  fireEvent.change(within(container).getByLabelText('Shop URL'), {
    target: { value: values.url },
  });
  fireEvent.change(within(container).getByLabelText('Webservice key'), {
    target: { value: values.key },
  });
  if (values.shopId !== undefined) {
    fireEvent.change(within(container).getByLabelText('Shop ID (optional)'), {
      target: { value: values.shopId },
    });
  }
}

async function advanceOneStep(container: HTMLElement): Promise<void> {
  const before = container.querySelector('[aria-current="step"]')?.textContent ?? '';
  fireEvent.click(within(container).getByRole('button', { name: 'Next' }));
  await waitFor(() => {
    const after = container.querySelector('[aria-current="step"]')?.textContent ?? '';
    if (after === before) throw new Error('Step did not advance');
  });
}

async function advanceToStep(container: HTMLElement, targetStep: number): Promise<void> {
  for (let i = 0; i < targetStep; i++) {
    await advanceOneStep(container);
  }
}

describe('PrestashopSetupForm', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('captures demo_connection_wizard_step_advanced on each Next click (#1789)', async () => {
    const view = renderWithProviders(<PrestashopSetupForm />);

    fillCredentialsStep(view.container, {
      name: 'Main store',
      url: 'https://shop.example.com',
      key: 'WSKEY123',
    });

    await advanceOneStep(view.container);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_connection_wizard_step_advanced', {
      platform: 'prestashop',
      step: 'Credentials',
    });
  });

  it('submits a PrestaShop connection after walking through every step', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(
      <>
        <PrestashopSetupForm />
        <LocationProbe />
      </>,
      { apiClient }
    );

    fillCredentialsStep(view.container, {
      name: 'Main store',
      url: 'https://shop.example.com',
      key: 'WSKEY123',
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Connection created')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/connections');
    });
    expect(create).toHaveBeenCalledWith({
      name: 'Main store',
      platformType: 'prestashop',
      adapterKey: 'prestashop.webservice.v1',
      credentials: { webserviceApiKey: 'WSKEY123' },
      config: { baseUrl: 'https://shop.example.com' },
      enabledCapabilities: [
        'ProductMaster',
        'InventoryMaster',
        'OrderProcessorManager',
        'OrderSource',
      ],
    });
  });

  it('submits only the capabilities the user left checked', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'Dest only',
      url: 'https://shop.example.com',
      key: 'WSKEY123',
    });

    await advanceToStep(view.container, 2); // land on capabilities

    fireEvent.click(within(view.container).getByRole('checkbox', { name: /OrderSource/ }));

    // Capabilities → Review
    await advanceOneStep(view.container);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'],
      })
    );
  });

  it('includes shopId in config when provided', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'Shop 2',
      url: 'https://shop.example.com',
      key: 'WSKEY',
      shopId: '2',
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { baseUrl: 'https://shop.example.com', shopId: '2' },
      })
    );
  });

  it('persists storefrontBaseUrl in config when provided', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'Split host shop',
      url: 'https://api.shop.example.com',
      key: 'WSKEY',
    });
    fireEvent.change(within(view.container).getByLabelText('Storefront URL (optional)'), {
      target: { value: 'https://shop.example.com' },
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          baseUrl: 'https://api.shop.example.com',
          storefrontBaseUrl: 'https://shop.example.com',
        },
      })
    );
  });

  it('omits storefrontBaseUrl from config when left blank', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'Same-host shop',
      url: 'https://shop.example.com',
      key: 'WSKEY',
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    // Blank input must not persist `""` — backend falls back to baseUrl when the key is absent.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { baseUrl: 'https://shop.example.com' },
      })
    );
    const payload = create.mock.calls[0]?.[0] as { config: Record<string, unknown> };
    expect('storefrontBaseUrl' in payload.config).toBe(false);
  });

  it('blocks advancing from the credentials step when the storefront URL is invalid', async () => {
    const view = renderWithProviders(<PrestashopSetupForm />);

    fillCredentialsStep(view.container, {
      name: 'Shop',
      url: 'https://shop.example.com',
      key: 'WSKEY',
    });
    fireEvent.change(within(view.container).getByLabelText('Storefront URL (optional)'), {
      target: { value: 'not-a-url' },
    });

    fireEvent.click(within(view.container).getByRole('button', { name: 'Next' }));

    expect(
      (await screen.findAllByText('Storefront URL must be a valid URL')).length
    ).toBeGreaterThan(0);
    expect(within(view.container).getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.queryByText('Verify the credentials')).toBeNull();
  });

  it('surfaces API errors in a form-level alert on the review step', async () => {
    const apiClient = createMockApiClient({
      connections: {
        create: vi.fn().mockRejectedValue(new Error('API create failed')),
      },
    });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'Shop',
      url: 'https://shop.example.com',
      key: 'WSKEY',
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText('API create failed')).toBeInTheDocument();
  });

  it('persists currency in config when selected', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'PLN store',
      url: 'https://shop.example.com',
      key: 'WSKEY',
    });
    fireEvent.change(within(view.container).getByLabelText('Default currency (optional)'), {
      target: { value: 'PLN' },
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { baseUrl: 'https://shop.example.com', currency: 'PLN' },
      })
    );
  });

  it('omits currency from config when left unset', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fillCredentialsStep(view.container, {
      name: 'No currency',
      url: 'https://shop.example.com',
      key: 'WSKEY',
    });

    await advanceToStep(view.container, 3);

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    const payload = create.mock.calls[0]?.[0] as { config: Record<string, unknown> };
    expect('currency' in payload.config).toBe(false);
  });

  it('blocks advancing from the credentials step when the shop URL is invalid', async () => {
    const view = renderWithProviders(<PrestashopSetupForm />);

    fillCredentialsStep(view.container, {
      name: 'Shop',
      url: 'not-a-url',
      key: 'WSKEY',
    });

    fireEvent.click(within(view.container).getByRole('button', { name: 'Next' }));

    // invalid URL keeps us on the credentials step — field stays visible
    expect(
      (await screen.findAllByText('Shop URL must be a valid URL (e.g. https://shop.example.com)'))
        .length
    ).toBeGreaterThan(0);
    expect(within(view.container).getByLabelText('Connection name')).toBeInTheDocument();
    // Still on step 1 — the second step's "Verify the credentials" alert is absent
    expect(screen.queryByText('Verify the credentials')).toBeNull();
  });

  it('renders the back-to-connections link inside the wizard card', () => {
    const view = renderWithProviders(<PrestashopSetupForm />);
    const backLink = within(view.container).getByRole('link', { name: 'Connections' });
    expect(backLink).toHaveAttribute('href', '/connections/new');
    expect(backLink).toHaveClass('back-link', 'wizard-card__back');
  });

  it('live-updates the summary panel from form input', () => {
    const view = renderWithProviders(<PrestashopSetupForm />);
    const summary = view.container.querySelector('aside[aria-label="Setup summary"]');
    expect(summary).not.toBeNull();
    fireEvent.change(within(view.container).getByLabelText('Connection name'), {
      target: { value: 'Staging store' },
    });
    expect(summary).toHaveTextContent('Staging store');
  });

  it('applies mono-text to the identifier inputs (URL, storefront URL, key, shop ID)', () => {
    const view = renderWithProviders(<PrestashopSetupForm />);
    expect(within(view.container).getByLabelText('Shop URL')).toHaveClass('mono-text');
    expect(within(view.container).getByLabelText('Storefront URL (optional)')).toHaveClass(
      'mono-text'
    );
    expect(within(view.container).getByLabelText('Webservice key')).toHaveClass('mono-text');
    expect(within(view.container).getByLabelText('Shop ID (optional)')).toHaveClass('mono-text');
  });
});
