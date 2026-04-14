import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router-dom';
import { PrestashopSetupForm } from './prestashop-setup-form';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

describe('PrestashopSetupForm', () => {
  afterEach(cleanup);

  it('submits a PrestaShop connection with the inferred adapter key and config', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(
      <>
        <PrestashopSetupForm />
        <LocationProbe />
      </>,
      { apiClient },
    );

    fireEvent.change(within(view.container).getByLabelText('Connection name'), {
      target: { value: 'Main store' },
    });
    fireEvent.change(within(view.container).getByLabelText('Shop URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(within(view.container).getByLabelText('Webservice key'), {
      target: { value: 'WSKEY123' },
    });
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
      enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager', 'OrderSource'],
    });
  });

  it('submits only the capabilities the user left checked', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fireEvent.change(within(view.container).getByLabelText('Connection name'), {
      target: { value: 'Dest only' },
    });
    fireEvent.change(within(view.container).getByLabelText('Shop URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(within(view.container).getByLabelText('Webservice key'), {
      target: { value: 'WSKEY123' },
    });

    // Uncheck OrderSource (this PrestaShop is order destination, not source)
    fireEvent.click(within(view.container).getByRole('checkbox', { name: /OrderSource/ }));

    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderProcessorManager'],
      }),
    );
  });

  it('includes shopId in config when provided', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fireEvent.change(within(view.container).getByLabelText('Connection name'), {
      target: { value: 'Shop 2' },
    });
    fireEvent.change(within(view.container).getByLabelText('Shop URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(within(view.container).getByLabelText('Webservice key'), {
      target: { value: 'WSKEY' },
    });
    fireEvent.change(within(view.container).getByLabelText('Shop ID (optional)'), {
      target: { value: '2' },
    });
    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    await screen.findByText('Connection created');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { baseUrl: 'https://shop.example.com', shopId: '2' },
      }),
    );
  });

  it('surfaces API errors in a form-level alert', async () => {
    const apiClient = createMockApiClient({
      connections: {
        create: vi.fn().mockRejectedValue(new Error('API create failed')),
      },
    });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

    fireEvent.change(within(view.container).getByLabelText('Connection name'), {
      target: { value: 'Shop' },
    });
    fireEvent.change(within(view.container).getByLabelText('Shop URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(within(view.container).getByLabelText('Webservice key'), {
      target: { value: 'WSKEY' },
    });
    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText('API create failed')).toBeInTheDocument();
  });

  it('rejects an invalid shop URL', async () => {
    const view = renderWithProviders(<PrestashopSetupForm />);

    fireEvent.change(within(view.container).getByLabelText('Connection name'), {
      target: { value: 'Shop' },
    });
    fireEvent.change(within(view.container).getByLabelText('Shop URL'), {
      target: { value: 'not-a-url' },
    });
    fireEvent.change(within(view.container).getByLabelText('Webservice key'), {
      target: { value: 'WSKEY' },
    });
    fireEvent.click(within(view.container).getByRole('button', { name: 'Create connection' }));

    expect(
      (await screen.findAllByText('Shop URL must be a valid URL (e.g. https://shop.example.com)'))
        .length,
    ).toBeGreaterThan(0);
  });
});
