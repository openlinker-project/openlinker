/**
 * ErliSetupForm Tests
 *
 * Coverage for the single-step Erli setup wizard. Tests form validation,
 * submission via the generic create-connection mutation, and the post-create
 * "Test connection" flow that surfaces a ConnectionTestResult.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { ErliSetupForm } from './erli-setup-form';

describe('ErliSetupForm', () => {
  afterEach(cleanup);

  it('renders the required form fields', () => {
    renderWithProviders(<ErliSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment')).toBeInTheDocument();
  });

  it('requires connection name to be non-empty', async () => {
    renderWithProviders(<ErliSetupForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });

  it('requires the API key to be non-empty', async () => {
    renderWithProviders(<ErliSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    await waitFor(() => {
      expect(screen.getAllByText('API key is required')[0]).toBeInTheDocument();
    });
  });

  it('defaults the environment select to Production', () => {
    renderWithProviders(<ErliSetupForm />);
    expect(screen.getByLabelText('Environment')).toHaveValue('production');
  });

  it('submits the API key and omits config when Production is selected', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Erli Store' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Erli Store',
          platformType: 'erli',
          adapterKey: 'erli.shopapi.v1',
          config: {},
          credentials: { apiKey: 'sk_test_123' },
        }),
      );
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('includes the sandbox baseUrl in config when Sandbox is selected', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Erli Store' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Environment'), {
      target: { value: 'sandbox' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { baseUrl: 'https://sandbox.erli.dev/svc/shop-api' },
        }),
      );
    });
  });

  it('surfaces the test-connection result after a successful create', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Erli Store' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: true, status: 200, message: 'OK', latencyMs: 42 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    // After create, the test affordance replaces the connect button.
    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(test).toHaveBeenCalledWith('conn-1');
    });
    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
  });

  it('surfaces a failing test-connection result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Erli Store' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();
  });

  it('surfaces the "Unable to test connection" alert when the test request rejects', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Erli Store' });
    // A rejected test request (network failure / 5xx) leaves testResult null and
    // surfaces the error via testConnection.error — distinct from a resolved
    // { success: false } result.
    const test = vi.fn().mockRejectedValue(new Error('Network unreachable'));
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.getByText(/Network unreachable/)).toBeInTheDocument();
    // The success/fail result alert must NOT appear on the rejected path.
    expect(screen.queryByText('Connection test passed')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });

  it('clears a stale failed result when a subsequent test request rejects', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Erli Store' });
    // First test resolves a failed result; the re-test rejects.
    const test = vi
      .fn()
      .mockResolvedValueOnce({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 })
      .mockRejectedValueOnce(new Error('Network unreachable'));
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk_test_123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });

    // First test → resolved failure result shown.
    fireEvent.click(testButton);
    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();

    // Re-test → rejects. The stale failed-result alert must be cleared, leaving
    // only the "Unable to test connection" error (PR1064-TECH-01).
    fireEvent.click(testButton);
    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });

  it('disables the submit button during the create mutation', async () => {
    const create = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ id: 'conn-1', name: 'My Erli Store' }), 100),
          ),
      );
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<ErliSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Erli Store' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Erli' }));

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /Connecting|Connect Erli/ });
      expect(button).toBeDisabled();
    });
  });
});
