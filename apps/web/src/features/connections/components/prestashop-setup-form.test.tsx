import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrestashopSetupForm } from './prestashop-setup-form';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';

describe('PrestashopSetupForm', () => {
  it('submits a PrestaShop connection with the inferred adapter key and config', async () => {
    const create = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({ connections: { create } });
    const view = renderWithProviders(<PrestashopSetupForm />, { apiClient });

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
    expect(create).toHaveBeenCalledWith({
      name: 'Main store',
      platformType: 'prestashop',
      adapterKey: 'prestashop.webservice.v1',
      credentialsRef: 'WSKEY123',
      config: { baseUrl: 'https://shop.example.com' },
    });
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
