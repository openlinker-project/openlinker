/**
 * InpostWebhookRunbook — component tests (#768)
 *
 * Covers the per-connection webhook URL rendering and the copy-email-template
 * affordance.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { InpostWebhookRunbook } from './inpost-webhook-runbook';

afterEach(cleanup);

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-inpost-1',
    platformType: 'inpost',
    name: 'InPost',
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: 'inpost.shipx.v1',
    supportedCapabilities: ['ShippingProviderManager'],
    enabledCapabilities: ['ShippingProviderManager'],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('InpostWebhookRunbook', () => {
  it('renders the per-connection webhook endpoint URL', () => {
    renderWithProviders(<InpostWebhookRunbook connection={makeConnection()} />);
    expect(
      screen.getByText(`${window.location.origin}/webhooks/inpost/conn-inpost-1`),
    ).toBeInTheDocument();
    expect(screen.getByText('integration@inpost.pl')).toBeInTheDocument();
  });

  it('copies an email template containing the endpoint URL on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithProviders(<InpostWebhookRunbook connection={makeConnection()} />);
    fireEvent.click(screen.getByText('Copy email template'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain(`${window.location.origin}/webhooks/inpost/conn-inpost-1`);
    expect(copied).toContain('Shipment.Tracking');
  });
});
