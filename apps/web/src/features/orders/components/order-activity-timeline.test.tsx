import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderActivityTimeline } from './order-activity-timeline';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderSyncStatus } from '../api/orders.types';

function renderTimeline(
  props: React.ComponentProps<typeof OrderActivityTimeline>,
): void {
  const api = createMockApiClient({
    connections: {
      // Return a shell connection so ConnectionEntityLabel renders a stable name.
      getById: vi.fn().mockResolvedValue({
        id: 'ol_connection_dst',
        name: 'Dest Shop',
        platformType: 'prestashop',
        status: 'active',
        config: {},
        credentialsBacked: true,
        enabledCapabilities: [],
        supportedCapabilities: [],
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-20T00:00:00.000Z',
      }),
    },
  });

  renderWithProviders(<OrderActivityTimeline {...props} />, { apiClient: api });
}

describe('OrderActivityTimeline', () => {
  afterEach(cleanup);

  it('renders the ingestion event first and a warning tone when awaiting mapping', () => {
    renderTimeline({
      createdAt: '2026-04-20T10:00:00.000Z',
      recordStatus: 'awaiting_mapping',
      syncStatus: [],
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);

    const first = within(items[0]);
    expect(first.getByText('Order received')).toBeInTheDocument();
    expect(
      first.getByText(/Awaiting product mapping/),
    ).toBeInTheDocument();
    // Warning dot class
    expect(items[0].querySelector('.order-activity__dot--warning')).not.toBeNull();
  });

  it('sorts timestamped sync events chronologically after ingestion', () => {
    const syncStatus: OrderSyncStatus[] = [
      {
        destinationConnectionId: 'ol_connection_dst',
        status: 'synced',
        syncedAt: '2026-04-20T12:00:00.000Z',
        externalOrderId: 'ext-1',
        externalOrderNumber: '9001',
        error: null,
      },
    ];

    renderTimeline({
      createdAt: '2026-04-20T10:00:00.000Z',
      recordStatus: 'ready',
      syncStatus,
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // First item is ingestion; second is the synced event
    expect(within(items[0]).getByText('Order received')).toBeInTheDocument();
    expect(within(items[1]).getByText(/synced to/)).toBeInTheDocument();
    // Success tone on the sync row
    expect(items[1].querySelector('.order-activity__dot--success')).not.toBeNull();
  });

  it('sinks pending sync events (no syncedAt) to the bottom and shows "in progress"', () => {
    const syncStatus: OrderSyncStatus[] = [
      {
        destinationConnectionId: 'ol_connection_dst',
        status: 'pending',
        syncedAt: null,
        externalOrderId: null,
        externalOrderNumber: null,
        error: null,
      },
    ];

    renderTimeline({
      createdAt: '2026-04-20T10:00:00.000Z',
      recordStatus: 'ready',
      syncStatus,
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Ingestion first, pending last
    expect(within(items[0]).getByText('Order received')).toBeInTheDocument();
    expect(within(items[1]).getByText(/queued for/)).toBeInTheDocument();
    expect(within(items[1]).getByText('in progress')).toBeInTheDocument();
  });

  it('renders a failed sync event with error tone and the error message', () => {
    const syncStatus: OrderSyncStatus[] = [
      {
        destinationConnectionId: 'ol_connection_dst',
        status: 'failed',
        syncedAt: '2026-04-20T12:00:00.000Z',
        externalOrderId: null,
        externalOrderNumber: null,
        error: 'PrestaShop returned 500',
      },
    ];

    renderTimeline({
      createdAt: '2026-04-20T10:00:00.000Z',
      recordStatus: 'ready',
      syncStatus,
    });

    const items = screen.getAllByRole('listitem');
    const failedRow = items[1];
    expect(within(failedRow).getByText(/failed to sync to/)).toBeInTheDocument();
    expect(within(failedRow).getByText('PrestaShop returned 500')).toBeInTheDocument();
    expect(failedRow.querySelector('.order-activity__dot--error')).not.toBeNull();
  });

  it('does not show "in progress" for a failed sync without syncedAt', () => {
    // Real-world failed rows have no syncedAt — only an error string. Before the
    // fix, the time pill mistakenly read "in progress" because it fell into the
    // null-timestamp branch. Now the error tone branches before the pending pill.
    const syncStatus: OrderSyncStatus[] = [
      {
        destinationConnectionId: 'ol_connection_dst',
        status: 'failed',
        syncedAt: null,
        externalOrderId: null,
        externalOrderNumber: null,
        error: 'PrestaShop country PL not active',
      },
    ];

    renderTimeline({
      createdAt: '2026-04-20T10:00:00.000Z',
      recordStatus: 'ready',
      syncStatus,
    });

    const items = screen.getAllByRole('listitem');
    const failedRow = items[1];
    expect(within(failedRow).getByText(/failed to sync to/)).toBeInTheDocument();
    expect(within(failedRow).queryByText('in progress')).toBeNull();
    expect(failedRow.querySelector('.order-activity__dot--error')).not.toBeNull();
  });
});
