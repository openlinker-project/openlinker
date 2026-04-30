import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderActivityTimeline } from './order-activity-timeline';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import {
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
  type SyncAttempt,
} from '../api/orders.types';

const SOURCE_CONNECTION_ID = 'ol_connection_src';
const DEST_CONNECTION_ID = 'ol_connection_dst';

function renderTimeline(props: React.ComponentProps<typeof OrderActivityTimeline>): void {
  const api = createMockApiClient({
    connections: {
      // Return a shell connection so ConnectionEntityLabel renders a stable name.
      getById: vi.fn().mockResolvedValue({
        id: DEST_CONNECTION_ID,
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
      syncAttempts: [],
      sourceConnectionId: SOURCE_CONNECTION_ID,
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);

    const first = within(items[0]);
    expect(first.getByText('Order received')).toBeInTheDocument();
    expect(first.getByText(/Awaiting product mapping/)).toBeInTheDocument();
    expect(items[0].querySelector('.order-activity__dot--warning')).not.toBeNull();
  });

  it('renders failure → retry → success as three rows in chronological order', () => {
    const attempts: SyncAttempt[] = [
      {
        destinationConnectionId: DEST_CONNECTION_ID,
        status: 'failed',
        attemptedAt: '2026-04-29T22:50:00.000Z',
        error: "Country with ISO2 code 'PL' is not active",
        externalOrderId: null,
        externalOrderNumber: null,
      },
      {
        destinationConnectionId: DEST_CONNECTION_ID,
        status: 'pending',
        attemptedAt: '2026-04-29T22:55:00.000Z',
        error: null,
        externalOrderId: null,
        externalOrderNumber: null,
      },
      {
        destinationConnectionId: DEST_CONNECTION_ID,
        status: 'synced',
        attemptedAt: '2026-04-29T23:15:00.000Z',
        error: null,
        externalOrderId: 'ext-1',
        externalOrderNumber: '9001',
      },
    ];

    renderTimeline({
      createdAt: '2026-04-29T22:47:00.000Z',
      recordStatus: 'ready',
      syncAttempts: attempts,
      sourceConnectionId: SOURCE_CONNECTION_ID,
    });

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);

    expect(within(items[0]).getByText('Order received')).toBeInTheDocument();
    expect(within(items[1]).getByText(/failed to sync to/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/Country with ISO2 code/)).toBeInTheDocument();
    expect(items[1].querySelector('.order-activity__dot--error')).not.toBeNull();

    expect(within(items[2]).getByText(/queued for/)).toBeInTheDocument();
    expect(items[2].querySelector('.order-activity__dot--default')).not.toBeNull();

    expect(within(items[3]).getByText(/synced to/)).toBeInTheDocument();
    expect(within(items[3]).getByText(/9001/)).toBeInTheDocument();
    expect(items[3].querySelector('.order-activity__dot--success')).not.toBeNull();
  });

  it('shows the "view all attempts" deep link only for capped destinations', () => {
    const attempts: SyncAttempt[] = Array.from(
      { length: SYNC_ATTEMPTS_PER_DESTINATION_CAP },
      (_, i) => ({
        destinationConnectionId: DEST_CONNECTION_ID,
        status: 'failed' as const,
        attemptedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        error: `attempt-${i}`,
        externalOrderId: null,
        externalOrderNumber: null,
      }),
    );

    renderTimeline({
      createdAt: '2026-01-01T00:00:00.000Z',
      recordStatus: 'ready',
      syncAttempts: attempts,
      sourceConnectionId: SOURCE_CONNECTION_ID,
    });

    const link = screen.getByRole('link', { name: /view all attempts/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe(
      `/sync/jobs?connectionId=${encodeURIComponent(SOURCE_CONNECTION_ID)}`,
    );
    // Only one link — attached to the most-recent attempt of the capped destination.
    expect(screen.getAllByRole('link', { name: /view all attempts/i })).toHaveLength(1);
  });

  it('attaches the cap link only to the capped destination when destinations are mixed', () => {
    const otherDestId = 'ol_connection_dst_other';
    const cappedAttempts: SyncAttempt[] = Array.from(
      { length: SYNC_ATTEMPTS_PER_DESTINATION_CAP },
      (_, i) => ({
        destinationConnectionId: DEST_CONNECTION_ID,
        status: 'failed' as const,
        attemptedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        error: `attempt-${i}`,
        externalOrderId: null,
        externalOrderNumber: null,
      }),
    );
    const uncappedAttempt: SyncAttempt = {
      destinationConnectionId: otherDestId,
      status: 'synced',
      attemptedAt: new Date(2026, 0, 1, 0, 1, 0).toISOString(),
      error: null,
      externalOrderId: 'ext-99',
      externalOrderNumber: '9099',
    };

    renderTimeline({
      createdAt: '2026-01-01T00:00:00.000Z',
      recordStatus: 'ready',
      syncAttempts: [...cappedAttempts, uncappedAttempt],
      sourceConnectionId: SOURCE_CONNECTION_ID,
    });

    const links = screen.getAllByRole('link', { name: /view all attempts/i });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      `/sync/jobs?connectionId=${encodeURIComponent(SOURCE_CONNECTION_ID)}`,
    );
  });

  it('does not show the cap link when below the per-destination cap', () => {
    const attempts: SyncAttempt[] = [
      {
        destinationConnectionId: DEST_CONNECTION_ID,
        status: 'synced',
        attemptedAt: '2026-04-20T12:00:00.000Z',
        error: null,
        externalOrderId: 'ext-1',
        externalOrderNumber: '9001',
      },
    ];

    renderTimeline({
      createdAt: '2026-04-20T10:00:00.000Z',
      recordStatus: 'ready',
      syncAttempts: attempts,
      sourceConnectionId: SOURCE_CONNECTION_ID,
    });

    expect(screen.queryByRole('link', { name: /view all attempts/i })).toBeNull();
  });
});
