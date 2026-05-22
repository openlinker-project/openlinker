import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { WebhookDeliveriesPage } from './webhook-deliveries-page';
import type { WebhookDeliverySummary } from '../../features/webhook-deliveries/api/webhook-deliveries.types';
import type { Connection } from '../../features/connections/api/connections.types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'PrestaShop Main',
    platformType: 'prestashop',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should render deliveries table when data loads', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [sampleDelivery], total: 1 }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
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
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('Diagnostics')).toBeInTheDocument();
  });

  it('should show empty state when no deliveries', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('No deliveries found')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load webhook deliveries')).toBeInTheDocument();
  });

  it('should resolve the connection name via ConnectionEntityLabel in the Connection column', async () => {
    const connection = makeConnection();
    const mockApi = createMockApiClient({
      webhookDeliveries: {
        list: vi.fn().mockResolvedValue({ items: [sampleDelivery], total: 1 }),
      },
      connections: {
        list: vi.fn().mockResolvedValue([connection]),
        getById: vi.fn().mockResolvedValue(connection),
      },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    // ConnectionEntityLabel resolves the name via a second async query
    // (deliveries load → render → connections query settles). Give it a
    // generous ceiling so a starved event loop under full-suite parallel CI
    // can't lapse the default 1000ms mid-chain (#808 drive-by de-flake).
    expect(await screen.findByText('PrestaShop Main', {}, { timeout: 5000 })).toBeInTheDocument();
  }, 15000);

  it('filters deliveries by the selected connection when changing the dropdown', async () => {
    const user = userEvent.setup();
    const connection = makeConnection();
    const listMock = vi.fn().mockResolvedValue({ items: [sampleDelivery], total: 1 });
    const mockApi = createMockApiClient({
      webhookDeliveries: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([connection]) },
    });

    renderWithProviders(<WebhookDeliveriesPage />, { apiClient: mockApi });

    await screen.findByRole('option', { name: 'PrestaShop Main' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /filter by connection/i }),
      connection.id,
    );

    await waitFor(() => {
      const lastCall = listMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toMatchObject({ connectionId: connection.id });
    });
  });
});
