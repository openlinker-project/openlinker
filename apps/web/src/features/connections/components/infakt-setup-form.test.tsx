/**
 * InfaktSetupForm Tests
 *
 * Coverage for the single-step inFakt setup wizard. Tests form validation,
 * submission via the generic create-connection mutation, and the post-create
 * "Test connection" flow that surfaces a ConnectionTestResult. Mirrors
 * `erli-setup-form.test.tsx`.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { InfaktSetupForm } from './infakt-setup-form';

describe('InfaktSetupForm', () => {
  afterEach(cleanup);

  it('renders the required form fields', () => {
    renderWithProviders(<InfaktSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByLabelText('Base URL (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Default payment method')).toBeInTheDocument();
  });

  it('defaults the payment method to cash', () => {
    renderWithProviders(<InfaktSetupForm />);
    expect(screen.getByLabelText('Default payment method')).toHaveValue('cash');
  });

  it('requires connection name to be non-empty', async () => {
    renderWithProviders(<InfaktSetupForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });

  it('requires the API key to be non-empty', async () => {
    renderWithProviders(<InfaktSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(screen.getAllByText('API key is required')[0]).toBeInTheDocument();
    });
  });

  it('rejects a non-HTTPS base URL override', async () => {
    renderWithProviders(<InfaktSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Base URL (optional)'), {
      target: { value: 'http://api.infakt.pl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Base URL must use HTTPS')[0]).toBeInTheDocument();
    });
  });

  it('submits the API key and a cash-default config when no base URL is given', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My inFakt Account',
          platformType: 'infakt',
          adapterKey: 'infakt.accounting.v1',
          config: { defaultPaymentMethod: 'cash' },
          credentials: { apiKey: 'sk_test_123' },
        }),
      );
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('includes baseUrl in config when supplied', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Base URL (optional)'), {
      target: { value: 'https://sandbox.infakt.pl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { defaultPaymentMethod: 'cash', baseUrl: 'https://sandbox.infakt.pl' },
        }),
      );
    });
  });

  it('submits transfer when selected in the payment method field', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Default payment method'), {
      target: { value: 'transfer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { defaultPaymentMethod: 'transfer' },
        }),
      );
    });
  });

  it('surfaces the test-connection result after a successful create', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: true, status: 200, message: 'OK', latencyMs: 42 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    // After create, the test affordance replaces the connect button.
    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(test).toHaveBeenCalledWith('conn-1');
    });
    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
  });

  it('surfaces a failing test-connection result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();
  });

  it('surfaces the "Unable to test connection" alert when the test request rejects', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const test = vi.fn().mockRejectedValue(new Error('Network unreachable'));
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.getByText(/Network unreachable/)).toBeInTheDocument();
    expect(screen.queryByText('Connection test passed')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });

  it('disables the submit button during the create mutation', async () => {
    const create = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ id: 'conn-1', name: 'My inFakt Account' }), 100),
          ),
      );
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /Connecting|Connect inFakt/ });
      expect(button).toBeDisabled();
    });
  });
});
