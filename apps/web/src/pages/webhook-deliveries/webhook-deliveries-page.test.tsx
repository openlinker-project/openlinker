import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { WebhookDeliveriesPage } from './webhook-deliveries-page';
import type { WebhookDeliverySummary } from '../../features/webhook-deliveries/api/webhook-deliveries.types';

const sampleDelivery: WebhookDeliverySummary = {
  id: 'del_1',
  provider: 'prestashop',
  connectionId: 'conn_1',
  eventId: 'evt_abc',
  eventType: 'order.created',
  objectType: null,
  externalId: null,
  status: 'published',
  receivedAt: '2024-01-01T10:00:00.000Z',
  signatureValid: true,
  dedupResult: 'new',
  rejectionReason: null,
  dlqReason: null,
  publishedMessageId: null,
  downstreamJobId: null,
  downstreamJobType: null,
  createdAt: '2024-01-01T10:00:00.000Z',
  updatedAt: '2024-01-01T10:00:00.000Z',
};

describe('WebhookDeliveriesPage', () => {
  afterEach(cleanup);

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockReturnValue(new Promise(() => undefined)),
      },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should render deliveries table when data loads', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [sampleDelivery], total: 1 }),
      },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('prestashop')).toBeInTheDocument();
    expect(await screen.findByText('order.created')).toBeInTheDocument();
  });

  it('renders the Diagnostics eyebrow so the header matches the sidebar group and breadcrumb', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [sampleDelivery], total: 1 }),
      },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('Diagnostics')).toBeInTheDocument();
  });

  it('should show empty state when no deliveries', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('No deliveries found')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load webhook deliveries')).toBeInTheDocument();
  });
});
