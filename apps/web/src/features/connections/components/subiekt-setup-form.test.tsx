/**
 * SubiektSetupForm Tests (#1199)
 *
 * Coverage for the single-step Subiekt setup wizard: field rendering, required
 * validation, create-payload mapping (bridge URL + numeric timeout coercion +
 * optional write-only bridge token), and the post-create "Test connection"
 * flow that surfaces a ConnectionTestResult.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { SubiektSetupForm } from './subiekt-setup-form';

describe('SubiektSetupForm', () => {
  afterEach(cleanup);

  it('renders the form fields', () => {
    renderWithProviders(<SubiektSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Bridge URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Request timeout (ms, optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Bridge token (optional)')).toBeInTheDocument();
  });

  it('requires connection name to be non-empty', async () => {
    renderWithProviders(<SubiektSetupForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });

  it('requires the bridge URL to be non-empty', async () => {
    renderWithProviders(<SubiektSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Bridge URL is required')[0]).toBeInTheDocument();
    });
  });

  it('rejects a bridge URL without an http(s) protocol', async () => {
    renderWithProviders(<SubiektSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'ftp://127.0.0.1:5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Bridge URL must start with http:// or https://')[0],
      ).toBeInTheDocument();
    });
  });

  it('submits an http LAN bridge URL with no credentials and no timeout', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<SubiektSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Subiekt',
          platformType: 'subiekt',
          adapterKey: 'subiekt.invoicing.v1',
          config: { bridgeBaseUrl: 'http://127.0.0.1:5000' },
        }),
      );
    });
    // No credentials object when the bridge token is blank.
    const payload = create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('credentials');
    expect(payload).not.toHaveProperty('enabledCapabilities');
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('serializes timeout as a number and includes the bridge token when supplied', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<SubiektSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'https://bridge.local:5000' },
    });
    fireEvent.change(screen.getByLabelText('Request timeout (ms, optional)'), {
      target: { value: '30000' },
    });
    fireEvent.change(screen.getByLabelText('Bridge token (optional)'), {
      target: { value: 'shared-secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { bridgeBaseUrl: 'https://bridge.local:5000', timeoutMs: 30000 },
          credentials: { bridgeToken: 'shared-secret-token' },
        }),
      );
    });
    // timeoutMs must be a number, not the raw input string.
    const payload = create.mock.calls[0][0] as { config: { timeoutMs: unknown } };
    expect(typeof payload.config.timeoutMs).toBe('number');
  });

  it('rejects a timeout below the allowed minimum', async () => {
    renderWithProviders(<SubiektSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5000' },
    });
    fireEvent.change(screen.getByLabelText('Request timeout (ms, optional)'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Request timeout must be at least 1000 ms')[0],
      ).toBeInTheDocument();
    });
  });

  it('surfaces a passing test-connection result after a successful create', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: true, status: 200, message: 'OK', latencyMs: 42 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<SubiektSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(test).toHaveBeenCalledWith('conn-1');
    });
    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
  });

  it('surfaces a failing test-connection result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: false, status: 502, message: 'Bridge unreachable', latencyMs: 10 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<SubiektSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Bridge unreachable/)).toBeInTheDocument();
  });
});
