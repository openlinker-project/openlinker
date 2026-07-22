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

  it('saves a pasted signing secret and surfaces a success toast', async () => {
    const setWebhookSecret = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: {
        getWebhookStatus: vi.fn().mockResolvedValue(status({ signature: 'off' })),
        setWebhookSecret,
      },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    fireEvent.change(screen.getByLabelText('inFakt webhook signing secret'), {
      target: { value: 'whsec_pasted_value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save secret' }));

    await waitFor(() =>
      expect(setWebhookSecret).toHaveBeenCalledWith('conn-if-1', 'whsec_pasted_value'),
    );
    expect(await findToastTitle('Signing secret saved')).toBeInTheDocument();
  });

  it('disables Save while the secret field is empty', () => {
    const apiClient = createMockApiClient({
      connections: { getWebhookStatus: vi.fn().mockResolvedValue(status()) },
    });
    renderWithProviders(<InfaktWebhookConfig connection={infaktConnection} />, { apiClient });

    expect(screen.getByRole('button', { name: 'Save secret' })).toBeDisabled();
  });
});
