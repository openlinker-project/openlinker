import { cleanup, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { WebhookDeliveryDetailPage } from './webhook-delivery-detail-page';
import type { WebhookDeliveryDetail } from '../../features/webhook-deliveries/api/webhook-deliveries.types';

const sampleDelivery: WebhookDeliveryDetail = {
  id: 'ol_webhook_abc',
  eventId: 'evt_42',
  provider: 'prestashop',
  connectionId: sampleConnection.id,
  objectType: 'order',
  externalId: 'ps_order_123',
  eventType: 'order.updated',
  status: 'deadlettered',
  signatureValid: true,
  dedupResult: 'first',
  publishedMessageId: null,
  downstreamJobId: null,
  downstreamJobType: null,
  rejectionReason: null,
  dlqReason: 'handler threw: timeout after 5s',
  receivedAt: '2026-04-20T10:00:00.000Z',
  payload: { orderId: 'ps_order_123', status: 'shipped' },
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
};

function renderDetail(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/webhook-deliveries/:id" element={<WebhookDeliveryDetailPage />} />
    </Routes>,
    { apiClient, route: '/webhook-deliveries/ol_webhook_abc' },
  );
}

describe('WebhookDeliveryDetailPage', () => {
  afterEach(cleanup);

  it('renders delivery metadata and the dlq / payload payload panels', async () => {
    const api = createMockApiClient({
      webhookDeliveries: { getById: vi.fn().mockResolvedValue(sampleDelivery) },
    });

    renderDetail(api);

    await screen.findByText('evt_42');
    expect(screen.getByText('prestashop')).toBeInTheDocument();
    expect(screen.getByText('ps_order_123')).toBeInTheDocument();

    expect(screen.getByText('DLQ reason')).toBeInTheDocument();
    expect(screen.getByText(/handler threw: timeout/)).toBeInTheDocument();

    expect(screen.getByText('Payload')).toBeInTheDocument();
  });

  it('resolves the connection name via ConnectionEntityLabel', async () => {
    const api = createMockApiClient({
      webhookDeliveries: { getById: vi.fn().mockResolvedValue(sampleDelivery) },
    });

    renderDetail(api);

    const links = await screen.findAllByRole('link', { name: sampleConnection.name });
    expect(links.length).toBeGreaterThan(0);
  });

  it('links the downstream job to the exact SyncJob resolved for the webhook event', async () => {
    const lookup = vi.fn().mockResolvedValue({ id: 'job-uuid-123' });
    const api = createMockApiClient({
      webhookDeliveries: {
        getById: vi.fn().mockResolvedValue({
          ...sampleDelivery,
          downstreamJobId: '1782207005442-0',
          downstreamJobType: 'marketplace.order.sync',
        }),
      },
      syncJobs: { lookupJobForWebhookEvent: lookup },
    });

    renderDetail(api);

    // The Redis Stream enqueue ID is the link *text*, but it resolves to the
    // persisted job's UUID detail route — never `/jobs-logs/<streamId>`, which
    // the UUID-only route would reject.
    const jobLink = await screen.findByRole('link', { name: '1782207005442-0' });
    expect(jobLink).toHaveAttribute('href', '/jobs-logs/job-uuid-123');

    // The FE passes the raw components (platformType from the connection,
    // connectionId, eventId) — the server assembles the key, no format here.
    expect(lookup).toHaveBeenCalledWith({
      platformType: sampleConnection.platformType,
      connectionId: sampleConnection.id,
      eventId: 'evt_42',
    });
  });

  it('falls back to the pre-filtered job list when the job is not resolvable yet', async () => {
    const api = createMockApiClient({
      webhookDeliveries: {
        getById: vi.fn().mockResolvedValue({
          ...sampleDelivery,
          downstreamJobId: '1782207005442-0',
          downstreamJobType: 'marketplace.order.sync',
        }),
      },
      // Worker hasn't created the row yet → lookup 404s.
      syncJobs: {
        lookupJobForWebhookEvent: vi.fn().mockRejectedValue(new Error('not found')),
      },
    });

    renderDetail(api);

    const jobLink = await screen.findByRole('link', { name: '1782207005442-0' });
    expect(jobLink).toHaveAttribute(
      'href',
      `/jobs-logs?connectionId=${sampleConnection.id}&jobType=marketplace.order.sync`,
    );
  });
});
