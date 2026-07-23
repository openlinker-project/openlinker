/**
 * InfaktWebhookConfig Tests (#1770)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { WebhookStatus } from '../api/connections.types';
import { InfaktWebhookConfig } from './infakt-webhook-config';

const infaktConnection = { ...sampleConnection, id: 'conn-if-1', platformType: 'infakt' };

const status = (overrides: Partial<WebhookStatus> = {}): WebhookStatus => ({
  activation: 'verified',
  signature: 'configured',
  lastDeliveryAt: '2026-07-22T09:14:02.000Z',
  lastDeliveryEvent: 'send_to_ksef_success',
  lastDeliveryResult: 'published',
  ...overrides,
});

describe('InfaktWebhookConfig', () => {
  afterEach(cleanup);

  it('renders the delivery endpoint for the connection', () => {
    const apiClient = createMockApiClient({
      connections: { getWebhookStatus: vi.fn().mockResolvedValue(status()) },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    expect(screen.getByText(/\/webhooks\/infakt\/conn-if-1/)).toBeInTheDocument();
  });

  it('lists the inFakt events the operator must enable', () => {
    const apiClient = createMockApiClient({
      connections: { getWebhookStatus: vi.fn().mockResolvedValue(status()) },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    expect(screen.getByText('Faktura wysłana do KSeF')).toBeInTheDocument();
    expect(screen.getByText('Błąd wysyłki faktury do KSeF')).toBeInTheDocument();
  });

  it('shows activation + signature status once the query resolves', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(status({ signature: 'off' })),
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    expect(await screen.findByText('Active · deliveries seen')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('shows the failing badge and re-check-secret alert when activation is auth-failing (#1814)', async () => {
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(
          status({ activation: 'auth-failing', signature: 'configured' }),
        ),
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    expect(await screen.findByText('Deliveries failing · check secret')).toBeInTheDocument();
    expect(screen.getByText('inFakt deliveries are being rejected')).toBeInTheDocument();
  });

  it('shows a retry affordance when the status query fails', async () => {
    const apiClient = createMockApiClient({
      connections: { getWebhookStatus: vi.fn().mockRejectedValue(new Error('network down')) },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    expect(await screen.findByText(/Couldn.t load webhook status/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('saves a pasted signing secret and surfaces a success toast when no secret exists yet', async () => {
    const setWebhookSecret = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(status({ signature: 'off' })),
        setWebhookSecret,
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    await screen.findByText('Not configured');
    fireEvent.change(screen.getByLabelText('Signing secret'), {
      target: { value: 'whsec_pasted_value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    await waitFor(() =>
      expect(setWebhookSecret).toHaveBeenCalledWith('conn-if-1', 'whsec_pasted_value'),
    );
    expect(await findToastTitle('Signing secret saved')).toBeInTheDocument();
  });

  it('shows inline validation when the pasted secret is too short', async () => {
    const setWebhookSecret = vi.fn();
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(status({ signature: 'off' })),
        setWebhookSecret,
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    await screen.findByText('Not configured');
    fireEvent.change(screen.getByLabelText('Signing secret'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    expect(await screen.findByText('Secret must be at least 8 characters')).toBeInTheDocument();
    expect(setWebhookSecret).not.toHaveBeenCalled();
  });

  it('confirms before overwriting an existing signing secret', async () => {
    const setWebhookSecret = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(status({ signature: 'configured' })),
        setWebhookSecret,
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    await screen.findByText('Configured');
    fireEvent.change(screen.getByLabelText('Signing secret'), {
      target: { value: 'whsec_new_value_12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    // The mutation must not fire until the operator confirms the overwrite.
    expect(await screen.findByText('Replace signing secret?')).toBeInTheDocument();
    expect(setWebhookSecret).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Replace secret' }));

    await waitFor(() =>
      expect(setWebhookSecret).toHaveBeenCalledWith('conn-if-1', 'whsec_new_value_12345'),
    );
    expect(await findToastTitle('Signing secret saved')).toBeInTheDocument();
  });

  it('saves directly without the overwrite confirm when repairing an auth-failing secret (#1814)', async () => {
    // In auth-failing the stored secret is wrong (deliveries are being rejected),
    // so re-pasting the correct one is a repair - the break-warning must not fire.
    const setWebhookSecret = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi
          .fn()
          .mockResolvedValue(status({ activation: 'auth-failing', signature: 'configured' })),
        setWebhookSecret,
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    await screen.findByText('Deliveries failing · check secret');
    fireEvent.change(screen.getByLabelText('Signing secret'), {
      target: { value: 'whsec_repaired_value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    await waitFor(() =>
      expect(setWebhookSecret).toHaveBeenCalledWith('conn-if-1', 'whsec_repaired_value'),
    );
    expect(screen.queryByText('Replace signing secret?')).not.toBeInTheDocument();
    expect(await findToastTitle('Signing secret saved')).toBeInTheDocument();
  });

  it('surfaces a mutation error inline instead of as a toast', async () => {
    const setWebhookSecret = vi.fn().mockRejectedValue(new Error('inFakt rejected the secret'));
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(status({ signature: 'off' })),
        setWebhookSecret,
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    await screen.findByText('Not configured');
    fireEvent.change(screen.getByLabelText('Signing secret'), {
      target: { value: 'whsec_pasted_value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    expect(await screen.findByText('inFakt rejected the secret')).toBeInTheDocument();
    expect(screen.queryByText('Could not save the signing secret', { selector: '.toast__title' })).not.toBeInTheDocument();
  });
});
