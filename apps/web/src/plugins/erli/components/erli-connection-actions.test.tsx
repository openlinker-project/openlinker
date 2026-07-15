/**
 * ErliConnectionActions Tests
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { ErliConnectionActions } from './erli-connection-actions';

const erliConnection = { ...sampleConnection, platformType: 'erli' };

const withCallbackUrl = {
  ...erliConnection,
  config: { callbackBaseUrl: 'https://ol.example.com' },
};
const withCallbackUrlConfigured = {
  ...withCallbackUrl,
  config: { ...withCallbackUrl.config, webhooksConfigured: true },
};

describe('ErliConnectionActions', () => {
  afterEach(cleanup);

  it('shows the callbackBaseUrl guard when config.callbackBaseUrl is absent', () => {
    renderWithProviders(<ErliConnectionActions connection={erliConnection} />);
    expect(screen.getByText(/before configuring webhooks/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the Configure webhooks button when callbackBaseUrl is set', () => {
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} />);
    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeInTheDocument();
    expect(screen.queryByText(/before configuring webhooks/)).not.toBeInTheDocument();
  });

  it('shows Re-configure when webhooksConfigured is true', () => {
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrlConfigured} />);
    expect(screen.getByRole('button', { name: 'Re-configure webhooks' })).toBeInTheDocument();
    expect(screen.getByText(/Currently configured/)).toBeInTheDocument();
  });

  it('shows a success toast when webhooksConfigured and testPingTriggered', async () => {
    const installWebhooks = vi
      .fn()
      .mockResolvedValue({ webhooksConfigured: true, testPingTriggered: true });
    const apiClient = createMockApiClient({ connections: { installWebhooks } });
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Configure webhooks' }));

    expect(await findToastTitle('Webhooks configured')).toBeInTheDocument();
  });

  it('shows a warning toast when webhooksConfigured but testPingTriggered is false', async () => {
    const installWebhooks = vi
      .fn()
      .mockResolvedValue({ webhooksConfigured: true, testPingTriggered: false });
    const apiClient = createMockApiClient({ connections: { installWebhooks } });
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Configure webhooks' }));

    expect(await findToastTitle('Webhooks configured (ping not received)')).toBeInTheDocument();
  });

  it('shows an error toast when the mutation rejects', async () => {
    const installWebhooks = vi.fn().mockRejectedValue(new Error('Network error'));
    const apiClient = createMockApiClient({ connections: { installWebhooks } });
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Configure webhooks' }));

    expect(await findToastTitle('Configuration push failed')).toBeInTheDocument();
  });

  it('disables the button while the mutation is pending', async () => {
    let resolve!: (v: unknown) => void;
    const installWebhooks = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const apiClient = createMockApiClient({ connections: { installWebhooks } });
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Configure webhooks' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Configuring...' })).toBeDisabled(),
    );

    resolve({ webhooksConfigured: true, testPingTriggered: true });
  });

  it('renders the Configure webhooks button disabled when readOnly is set (demo viewer, #1615)', () => {
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} readOnly />);

    expect(screen.getByRole('button', { name: 'Configure webhooks' })).toBeDisabled();
  });

  it('keeps the button enabled when readOnly is not set', () => {
    renderWithProviders(<ErliConnectionActions connection={withCallbackUrl} />);

    expect(screen.getByRole('button', { name: 'Configure webhooks' })).not.toBeDisabled();
  });
});
