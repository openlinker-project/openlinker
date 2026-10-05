/**
 * ShoperSetupForm Tests
 *
 * Coverage for the single-step Shoper setup wizard: validation, the create
 * payload, and the post-create "Test connection" flow.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { ShoperSetupForm } from './shoper-setup-form';

function fillValid(): void {
  fireEvent.change(screen.getByLabelText('Connection name'), {
    target: { value: 'My Shoper' },
  });
  fireEvent.change(screen.getByLabelText('Shop address'), {
    target: { value: 'https://myshop.shoparena.pl' },
  });
  fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok_123' } });
}

describe('ShoperSetupForm', () => {
  afterEach(cleanup);

  it('renders the required form fields', () => {
    renderWithProviders(<ShoperSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Shop address')).toBeInTheDocument();
    expect(screen.getByLabelText('API token')).toBeInTheDocument();
  });

  it('requires name, address and token', async () => {
    renderWithProviders(<ShoperSetupForm />);
    fireEvent.click(screen.getByRole('button', { name: /connect shoper/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
    expect(screen.getAllByText('Shop address is required')[0]).toBeInTheDocument();
    expect(screen.getAllByText('API token is required')[0]).toBeInTheDocument();
  });

  it('submits the create payload without enabledCapabilities', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    const apiClient = createMockApiClient({ connections: { create } });
    renderWithProviders(<ShoperSetupForm />, { apiClient });

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /connect shoper/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'My Shoper',
        platformType: 'shoper',
        adapterKey: 'shoper.restapi.v1',
        credentials: { token: 'tok_123' },
        config: { baseUrl: 'https://myshop.shoparena.pl' },
      });
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('shows the server error when create is rejected', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Shop address must use https'));
    const apiClient = createMockApiClient({ connections: { create } });
    renderWithProviders(<ShoperSetupForm />, { apiClient });

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /connect shoper/i }));

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText(/must use https/)).toBeInTheDocument();
  });

  it('surfaces a passing test-connection result after create', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: true, status: 200, message: 'OK', latencyMs: 42 });
    const apiClient = createMockApiClient({ connections: { create, test } });
    renderWithProviders(<ShoperSetupForm />, { apiClient });

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /connect shoper/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(test).toHaveBeenCalledWith('conn-1'));
    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
  });

  it('surfaces a failing test-connection result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 });
    const apiClient = createMockApiClient({ connections: { create, test } });
    renderWithProviders(<ShoperSetupForm />, { apiClient });

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /connect shoper/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();
  });

  it('shows "Unable to test connection" when a re-test rejects, without a stale result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    const test = vi
      .fn()
      .mockResolvedValueOnce({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 })
      .mockRejectedValueOnce(new Error('Network unreachable'));
    const apiClient = createMockApiClient({ connections: { create, test } });
    renderWithProviders(<ShoperSetupForm />, { apiClient });

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: /connect shoper/i }));
    const testButton = await screen.findByRole('button', { name: 'Test connection' });

    fireEvent.click(testButton);
    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();

    fireEvent.click(testButton);
    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });
});
