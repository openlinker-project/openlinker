import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrderActivityTimeline,
  mergeTimelineEvents,
  type TimelineEvent,
} from './order-activity-timeline';
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

  describe('sales-document block narration (#2100)', () => {
    it('narrates a no-primary block as its own last entry, with the backend detail', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
        salesDocumentBlockDetail: '2 invoicing connections, none marked primary',
      });

      expect(screen.getByText('No invoice issued')).toBeInTheDocument();
      expect(
        screen.getByText(/none is set to issue automatically/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/2 invoicing connections, none marked primary/),
      ).toBeInTheDocument();
    });

    it('narrates a manual connection without an error tone', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        salesDocumentBlockReason: 'trigger-model-manual',
      });

      const entry = screen.getByText('No invoice issued').closest('li');
      expect(entry).not.toBeNull();
      // A deliberate setting must not be dressed as a failure. The badge's
      // `neutral` tone has no timeline dot, so it degrades to `default`.
      expect(entry?.querySelector('.order-activity__dot--error')).toBeNull();
      expect(entry?.querySelector('.order-activity__dot--warning')).toBeNull();
    });

    it('renders no block entry for an unblocked order', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
      });

      expect(screen.queryByText('No invoice issued')).toBeNull();
    });
  });

  describe('source amendment (#2283)', () => {
    it('renders a dated warning entry naming the lines that changed', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        lastAmendedAt: '2026-04-21T08:15:00.000Z',
        lastAmendmentChanges: [
          { kind: 'line-removed', lineId: 'l2', sku: 'SKU-2', fromQuantity: 1 },
          { kind: 'line-quantity-changed', lineId: 'l1', sku: 'SKU-1', fromQuantity: 2, toQuantity: 1 },
        ],
      });

      const entry = screen.getByText('Order changed at the source').closest('li');
      expect(entry).not.toBeNull();
      // Dated, unlike the #2100 block entry: a real instant is persisted.
      expect(entry?.querySelector('time')?.getAttribute('dateTime')).toBe(
        '2026-04-21T08:15:00.000Z',
      );
      expect(entry?.querySelector('.order-activity__dot--warning')).not.toBeNull();
      expect(within(entry as HTMLElement).getByText(/line SKU-2 removed/)).toBeTruthy();
      expect(within(entry as HTMLElement).getByText(/line SKU-1 quantity 2 → 1/)).toBeTruthy();
    });

    it('names the address fields that changed and shows no address values', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        lastAmendedAt: '2026-04-21T08:15:00.000Z',
        lastAmendmentChanges: [
          { kind: 'shipping-address-changed', fields: ['city', 'postalCode'] },
        ],
      });

      const entry = screen.getByText('Order changed at the source').closest('li');
      expect(
        within(entry as HTMLElement).getByText(/shipping address changed \(city, postalCode\)/),
      ).toBeTruthy();
    });

    it('renders no amendment entry when the order was never amended', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        lastAmendedAt: null,
        lastAmendmentChanges: null,
      });

      expect(screen.queryByText('Order changed at the source')).toBeNull();
    });
  });

  describe('packed (#2288)', () => {
    it('renders a DATED packed entry naming the operator', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        packedAt: '2026-04-21T09:00:00.000Z',
        packedByUserId: 'user_7',
      });

      const entry = screen.getByText('Order packed').closest('li');
      expect(within(entry as HTMLElement).getByText(/Marked packed by user_7\./)).toBeTruthy();
      // A real instant is persisted, so the entry carries a <time> — unlike the
      // deliberately undated invoicing-block entry.
      expect(
        (entry as HTMLElement).querySelector('time[datetime="2026-04-21T09:00:00.000Z"]'),
      ).toBeTruthy();
    });

    it('renders no packed entry when the order was never packed', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        packedAt: null,
        packedByUserId: null,
      });

      expect(screen.queryByText('Order packed')).toBeNull();
    });

    it('places the packed entry BEFORE the undated invoicing-block entry', () => {
      renderTimeline({
        createdAt: '2026-04-20T10:00:00.000Z',
        recordStatus: 'ready',
        syncAttempts: [],
        sourceConnectionId: SOURCE_CONNECTION_ID,
        packedAt: '2026-04-21T09:00:00.000Z',
        packedByUserId: 'user_7',
        salesDocumentBlockReason: 'trigger-model-manual',
      });

      const titles = Array.from(document.querySelectorAll('.order-activity__item')).map(
        (li) => li.textContent ?? '',
      );
      const packedIndex = titles.findIndex((t) => t.includes('Order packed'));
      const blockedIndex = titles.findIndex((t) => t.includes('No invoice issued'));

      expect(packedIndex).toBeGreaterThanOrEqual(0);
      expect(blockedIndex).toBeGreaterThan(packedIndex);
    });
  });
});

describe('mergeTimelineEvents (#2383)', () => {
  const authored: TimelineEvent[] = [
    { id: 'created', timestamp: '2026-08-20T10:00:00.000Z', title: 'Order created', tone: 'default' },
    // An UNDATED authored entry, deliberately kept in the middle: `buildEvents`
    // really emits these (`timestamp: … ?? null`), and the merge must not use it
    // as a comparison key nor float it to either end.
    { id: 'undated', timestamp: null, title: 'Undated authored entry', tone: 'default' },
    { id: 'packed', timestamp: '2026-08-20T14:00:00.000Z', title: 'Packed', tone: 'success' },
  ];

  const ids = (events: TimelineEvent[]): string[] => events.map((event) => event.id);

  it('returns the authored sequence UNCHANGED when there is nothing to merge', () => {
    // The invariant that makes the prop safe: it is about ORDER, not merely
    // about the component still rendering.
    expect(ids(mergeTimelineEvents(authored, []))).toEqual(['created', 'undated', 'packed']);
    expect(mergeTimelineEvents(authored, [])).toBe(authored);
  });

  it('places an injected event by timestamp rather than appending it', () => {
    const extra: TimelineEvent[] = [
      { id: 'r1', timestamp: '2026-08-20T12:00:00.000Z', title: 'Return received', tone: 'default' },
    ];

    expect(ids(mergeTimelineEvents(authored, extra))).toEqual([
      'created',
      'undated',
      'r1',
      'packed',
    ]);
  });

  it('keeps the undated authored entry in its authored position', () => {
    const extra: TimelineEvent[] = [
      { id: 'early', timestamp: '2026-08-20T09:00:00.000Z', title: 'Return opened', tone: 'default' },
    ];

    // `early` precedes `created`, and `undated` does not move to accommodate it.
    expect(ids(mergeTimelineEvents(authored, extra))).toEqual([
      'early',
      'created',
      'undated',
      'packed',
    ]);
  });

  it('never reorders authored events relative to each other', () => {
    const extra: TimelineEvent[] = [
      { id: 'x', timestamp: '2026-08-20T23:00:00.000Z', title: 'Late', tone: 'default' },
      { id: 'y', timestamp: '2026-08-20T11:00:00.000Z', title: 'Mid', tone: 'default' },
    ];

    const merged = ids(mergeTimelineEvents(authored, extra));

    expect(merged.filter((id) => ['created', 'undated', 'packed'].includes(id))).toEqual([
      'created',
      'undated',
      'packed',
    ]);
  });

  it('keeps the authored entry first on a tie — it described the order first', () => {
    const extra: TimelineEvent[] = [
      { id: 'tie', timestamp: '2026-08-20T14:00:00.000Z', title: 'Return received', tone: 'default' },
    ];

    expect(ids(mergeTimelineEvents(authored, extra))).toEqual([
      'created',
      'undated',
      'packed',
      'tie',
    ]);
  });

  it('renders injected events in the timeline', () => {
    renderTimeline({
      createdAt: '2026-08-20T10:00:00.000Z',
      recordStatus: 'ready',
      syncAttempts: [],
      sourceConnectionId: SOURCE_CONNECTION_ID,
      extraEvents: [
        {
          id: 'return:ev1',
          timestamp: '2026-08-20T12:00:00.000Z',
          title: 'Return received',
          tone: 'default',
        },
      ],
    });

    expect(screen.getByText('Return received')).toBeInTheDocument();
  });
});
