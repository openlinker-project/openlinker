/**
 * InpostWebhookRunbook — component tests (#768, #1473)
 *
 * Covers the per-connection webhook URL (configured public API base + origin
 * fallback), the dashboard-first runbook copy, the HMAC secret-rotation step,
 * and the fallback copy-email-template affordance.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
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
  it('builds the webhook URL from the configured public OL API base URL when set', () => {
    renderWithProviders(
      <InpostWebhookRunbook
        connection={makeConnection({
          config: { openlinkerCallbackBaseUrl: 'https://api.openlinker.example' },
        })}
      />,
    );
    expect(
      screen.getByText('https://api.openlinker.example/webhooks/inpost/conn-inpost-1'),
    ).toBeInTheDocument();
    // Not the FE origin.
    expect(
      screen.queryByText(`${window.location.origin}/webhooks/inpost/conn-inpost-1`),
    ).not.toBeInTheDocument();
  });

  it('trims a trailing slash from the configured base URL', () => {
    renderWithProviders(
      <InpostWebhookRunbook
        connection={makeConnection({
          config: { openlinkerCallbackBaseUrl: 'https://api.openlinker.example/' },
        })}
      />,
    );
    expect(
      screen.getByText('https://api.openlinker.example/webhooks/inpost/conn-inpost-1'),
    ).toBeInTheDocument();
  });

  it('falls back to window.location.origin when no public API base URL is configured', () => {
    renderWithProviders(<InpostWebhookRunbook connection={makeConnection()} />);
    expect(
      screen.getByText(`${window.location.origin}/webhooks/inpost/conn-inpost-1`),
    ).toBeInTheDocument();
  });

  it('presents the InPost Manager dashboard as the primary self-service path', () => {
    renderWithProviders(<InpostWebhookRunbook connection={makeConnection()} />);
    expect(screen.getByText(/InPost Manager dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Adresy webhook/i)).toBeInTheDocument();
    // The old, false "self-service is not offered" claim must be gone.
    expect(screen.queryByText(/self-service provisioning is not offered/i)).not.toBeInTheDocument();
  });

  it('rotates the OL webhook secret and reveals it once, noting a 401 on mismatch', async () => {
    const rotateWebhookSecret = vi.fn().mockResolvedValue({
      secret: 'whsec_generated_123',
      revealedOnce: true,
      warning: 'Store it now.',
    });
    const apiClient = createMockApiClient({ connections: { rotateWebhookSecret } });

    renderWithProviders(<InpostWebhookRunbook connection={makeConnection()} />, { apiClient });

    // The runbook warns about the 401 signature failure up front.
    expect(screen.getByText(/401 Invalid webhook signature/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate webhook secret/i }));

    await waitFor(() => expect(rotateWebhookSecret).toHaveBeenCalledWith('conn-inpost-1'));
    expect(await screen.findByText('whsec_generated_123')).toBeInTheDocument();
    // Once revealed, the action offers rotation.
    expect(
      await screen.findByRole('button', { name: /rotate webhook secret/i }),
    ).toBeInTheDocument();
  });

  it('copies an email template containing the endpoint URL as a fallback path', async () => {
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
    expect(screen.getByText('integration@inpost.pl')).toBeInTheDocument();
  });
});
