/**
 * SubiektSetupForm Tests (#1199)
 *
 * Coverage for the single-step Subiekt setup wizard: field rendering, required
 * validation, create-payload mapping (bridge URL + numeric timeout coercion +
 * the write-only bridge token), the per-product copy that arrives on
 * `identity`, and the post-create "Test connection" flow that surfaces a
 * ConnectionTestResult.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { SubiektSetupForm } from './subiekt-setup-form';
import { SUBIEKT_GT_IDENTITY, SUBIEKT_NEXO_IDENTITY } from './subiekt-setup.schema';

describe('SubiektSetupForm', () => {
  afterEach(cleanup);

  it('renders the form fields', () => {
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Bridge URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Request timeout (ms, optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Bridge token')).toBeInTheDocument();
  });

  it('requires connection name to be non-empty', async () => {
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });

  it('requires the bridge URL to be non-empty', async () => {
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Bridge URL is required')[0]).toBeInTheDocument();
    });
  });

  it('rejects a bridge URL without an http(s) protocol', async () => {
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
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

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    // The token is REQUIRED now, so every happy-path submit has to supply one.
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Subiekt',
          platformType: 'subiekt-gt',
          adapterKey: 'subiekt.gt.v1',
          config: { bridgeBaseUrl: 'http://127.0.0.1:5056' },
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

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'https://bridge.local:5000' },
    });
    fireEvent.change(screen.getByLabelText('Request timeout (ms, optional)'), {
      target: { value: '30000' },
    });
    fireEvent.change(screen.getByLabelText('Bridge token'), {
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
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    // The token is REQUIRED now, so every happy-path submit has to supply one.
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
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

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    // The token is REQUIRED now, so every happy-path submit has to supply one.
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
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

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    // The token is REQUIRED now, so every happy-path submit has to supply one.
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Bridge unreachable/)).toBeInTheDocument();
  });

  it('surfaces the "Unable to test connection" alert when the test request rejects', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    // A rejected test request (network failure / 5xx) leaves testResult null and
    // surfaces the error via testConnection.error — distinct from a resolved
    // { success: false } result.
    const test = vi.fn().mockRejectedValue(new Error('Bridge offline'));
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    // The token is REQUIRED now, so every happy-path submit has to supply one.
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.getByText(/Bridge offline/)).toBeInTheDocument();
    // The success/fail result alert must NOT appear on the rejected path.
    expect(screen.queryByText('Connection test passed')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });

  it('clears a stale failed result when a subsequent test request rejects', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    const test = vi
      .fn()
      .mockResolvedValueOnce({ success: false, status: 502, message: 'Bridge unreachable', latencyMs: 10 })
      .mockRejectedValueOnce(new Error('Bridge offline'));
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    // The token is REQUIRED now, so every happy-path submit has to supply one.
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });

    // First test → resolved failure result shown.
    fireEvent.click(testButton);
    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();

    // Re-test → rejects. The stale failed-result alert must be cleared, leaving
    // only the "Unable to test connection" error.
    fireEvent.click(testButton);
    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });
  // --- the defects this wizard used to ship ----------------------------------

  it('refuses to submit without a bridge token', async () => {
    // Both bridges reject every /api/* request without one, so a connection
    // created without a token cannot work. The field used to say "optional"
    // and "leave blank for an unauthenticated LAN bridge" — the opposite.
    const create = vi.fn();
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(screen.getAllByText(/Bridge token is required/)[0]).toBeInTheDocument();
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('labels the token as required, not optional', () => {
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    expect(screen.getByLabelText('Bridge token')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bridge token (optional)')).not.toBeInTheDocument();
  });

  it('suggests THIS product\u2019s bridge port, not one shared wrong number', () => {
    // GT listens on 5056, nexo on 5005. The wizard used to suggest 5000 to both,
    // which is neither, so an operator who trusted the hint could reach nothing.
    const { unmount } = renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    expect(screen.getByLabelText('Bridge URL')).toHaveAttribute(
      'placeholder',
      'http://127.0.0.1:5056',
    );
    unmount();

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_NEXO_IDENTITY} />);
    expect(screen.getByLabelText('Bridge URL')).toHaveAttribute(
      'placeholder',
      'http://127.0.0.1:5005',
    );
  });

  it('names the product it is connecting, on both routes', () => {
    const { unmount } = renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    expect(screen.getByText(/Subiekt GT/)).toBeInTheDocument();
    unmount();

    // The callout used to hardcode "Subiekt GT", so a nexo operator was told to
    // run the bridge on the machine where the OTHER product is installed.
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_NEXO_IDENTITY} />);
    expect(screen.getByText(/Subiekt nexo/)).toBeInTheDocument();
    expect(screen.queryByText(/Subiekt GT/)).not.toBeInTheDocument();
  });
});
