/**
 * InfaktWebhookConnectionActions Tests (#1770)
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { WebhookStatus } from '../../../features/connections';
import { InfaktWebhookConnectionActions } from './infakt-webhook-config';

const infaktConnection = { ...sampleConnection, id: 'conn-if-1', platformType: 'infakt' };

const status: WebhookStatus = {
  activation: 'verified',
  signature: 'configured',
  lastDeliveryAt: '2026-07-22T09:14:02.000Z',
  lastDeliveryEvent: 'send_to_ksef_success',
  lastDeliveryResult: 'published',
};

describe('InfaktWebhookConnectionActions', () => {
  afterEach(cleanup);

  it('opens the config modal from the actions row', async () => {
    const apiClient = createMockApiClient({
      connections: { getWebhookStatus: vi.fn().mockResolvedValue(status) },
    });
    renderWithProviders(<InfaktWebhookConnectionActions connection={infaktConnection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configure webhooks…' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Configure webhooks')).toBeInTheDocument();
    expect(within(dialog).getByText(/\/webhooks\/infakt\/conn-if-1/)).toBeInTheDocument();
  });
});
