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

  // The "no credentials" half of this test's original subject is gone: both
  // bridges refuse every `/api/*` route without a token, so `tokenRequired` is
  // true for both identities and there is no valid submit that omits one. What
  // it still asserts is the other two halves - a plain-http LAN address is
  // accepted, and a blank timeout emits no `timeoutMs` rather than a zero.
  it('submits an http LAN bridge URL, and omits timeoutMs when the field is blank', async () => {
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
          config: {
            bridgeBaseUrl: 'http://127.0.0.1:5056',
            // Without BOTH of these a Subiekt connection auto-issues nothing
            // and reports nothing: no document kind means the connection is
            // not a routing candidate at all, and the trigger model defaults
            // to `manual` even when it is.
            salesDocument: { documentKind: 'invoice' },
            invoicing: { triggerModel: 'manual' },
          },
        }),
      );
    });
    const payload = create.mock.calls[0][0] as Record<string, unknown>;
    // A token was supplied, so credentials ARE emitted - and `config` above
    // carries no `timeoutMs` key at all, rather than a 0 the bridge client
    // would read as "no timeout".
    expect(payload).toHaveProperty('credentials');
    expect(payload).not.toHaveProperty('enabledCapabilities');
    // `isPrimary` is a CROSS-connection tiebreaker the settings panel owns; a
    // wizard writing it would claim a precedence it cannot see.
    expect((payload.config as { invoicing: Record<string, unknown> }).invoicing).not.toHaveProperty(
      'isPrimary',
    );
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
          config: {
            bridgeBaseUrl: 'https://bridge.local:5000',
            timeoutMs: 30000,
            salesDocument: { documentKind: 'invoice' },
            invoicing: { triggerModel: 'manual' },
          },
          credentials: { bridgeToken: 'shared-secret-token' },
        }),
      );
    });
    // timeoutMs must be a number, not the raw input string.
    const payload = create.mock.calls[0][0] as { config: { timeoutMs: unknown } };
    expect(typeof payload.config.timeoutMs).toBe('number');
  });

  // The choice is RENDERED rather than assumed in either direction: silently
  // defaulting to auto would issue fiscal documents nobody asked for, and
  // offering no control at all is how a wizard-created connection ended up
  // issuing nothing, forever, with no signal.
  it('writes the trigger model the operator picked', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Subiekt' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Subiekt' },
    });
    fireEvent.change(screen.getByLabelText('Bridge URL'), {
      target: { value: 'http://127.0.0.1:5056' },
    });
    fireEvent.change(screen.getByLabelText('Bridge token'), {
      target: { value: 'a-token' },
    });
    fireEvent.change(screen.getByLabelText('Issue the invoice'), {
      target: { value: 'auto-on-paid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Subiekt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            salesDocument: { documentKind: 'invoice' },
            invoicing: { triggerModel: 'auto-on-paid' },
          }),
        }),
      );
    });
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
    // The callout names the product TWICE (once for where the bridge runs, once
    // for what OpenLinker talks to), so the `All` queries are load-bearing here:
    // `getByText` throws on a second match and `queryByText` throws too, which
    // would make a correct render read as a broken one.
    const { unmount } = renderWithProviders(<SubiektSetupForm identity={SUBIEKT_GT_IDENTITY} />);
    expect(screen.getAllByText(/Subiekt GT/).length).toBeGreaterThan(0);
    unmount();

    // The callout used to hardcode "Subiekt GT", so a nexo operator was told to
    // run the bridge on the machine where the OTHER product is installed.
    renderWithProviders(<SubiektSetupForm identity={SUBIEKT_NEXO_IDENTITY} />);
    expect(screen.getAllByText(/Subiekt nexo/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Subiekt GT/)).toHaveLength(0);
  });
});
