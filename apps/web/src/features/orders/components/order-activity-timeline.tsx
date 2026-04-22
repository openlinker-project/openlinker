/**
 * Order Activity Timeline
 *
 * Ordered list of events derived from the order's lifecycle data — ingestion
 * (from `createdAt` + `recordStatus`) and each sync destination's attempt
 * (from `syncStatus`). Events with a real timestamp are sorted chronologically;
 * pending/syncing entries without a `syncedAt` render at the end of the list
 * with "in progress" instead of a fabricated time, so the timeline never shows
 * a misleading timestamp.
 */
import type { ReactElement } from 'react';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ConnectionEntityLabel } from '../../connections/components/ConnectionEntityLabel';
import type { OrderSyncStatus, OrderSyncStatusValue } from '../api/orders.types';

interface TimelineEvent {
  id: string;
  timestamp: string | null;
  title: ReactElement | string;
  description?: ReactElement | string;
  tone: 'default' | 'success' | 'error' | 'warning';
}

interface OrderActivityTimelineProps {
  createdAt: string;
  recordStatus: string;
  syncStatus: OrderSyncStatus[];
}

const STATUS_PAST_TENSE: Record<OrderSyncStatusValue, string> = {
  pending: 'queued for',
  syncing: 'syncing to',
  synced: 'synced to',
  failed: 'failed to sync to',
};

function buildEvents(
  createdAt: string,
  recordStatus: string,
  syncStatus: OrderSyncStatus[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  events.push({
    id: 'ingested',
    timestamp: createdAt,
    title: 'Order received',
    description:
      recordStatus === 'awaiting_mapping'
        ? 'Awaiting product mapping — some item references could not be resolved yet.'
        : 'Ingested and ready for sync.',
    tone: recordStatus === 'awaiting_mapping' ? 'warning' : 'default',
  });

  for (const status of syncStatus) {
    const verb = STATUS_PAST_TENSE[status.status] ?? status.status;

    events.push({
      id: `sync-${status.destinationConnectionId}`,
      timestamp: status.syncedAt,
      title: (
        <>
          Order {verb}{' '}
          <ConnectionEntityLabel
            connectionId={status.destinationConnectionId}
            showId={false}
          />
        </>
      ),
      description: status.error ? (
        <span className="mono-text order-activity__error">{status.error}</span>
      ) : status.externalOrderNumber ? (
        <>
          External order{' '}
          <span className="mono-text">{status.externalOrderNumber}</span>
          {status.externalOrderId ? (
            <>
              {' '}
              <span className="mono-text text-muted">({status.externalOrderId})</span>
            </>
          ) : null}
        </>
      ) : undefined,
      tone:
        status.status === 'failed'
          ? 'error'
          : status.status === 'synced'
            ? 'success'
            : 'default',
    });
  }

  events.sort((a, b) => {
    // Events with no real timestamp (pending/syncing) sink to the bottom, in insertion order.
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  return events;
}

const TONE_CLASS: Record<TimelineEvent['tone'], string> = {
  default: 'order-activity__dot--default',
  success: 'order-activity__dot--success',
  error: 'order-activity__dot--error',
  warning: 'order-activity__dot--warning',
};

export function OrderActivityTimeline({
  createdAt,
  recordStatus,
  syncStatus,
}: OrderActivityTimelineProps): ReactElement {
  const events = buildEvents(createdAt, recordStatus, syncStatus);

  if (events.length === 0) {
    return (
      <EmptyState liveRegion="off" title="No activity" message="No events recorded yet." />
    );
  }

  return (
    <ol className="order-activity" aria-label="Order activity timeline">
      {events.map((event) => (
        <li key={event.id} className="order-activity__item">
          <span className={`order-activity__dot ${TONE_CLASS[event.tone]}`} aria-hidden="true" />
          <div className="order-activity__body">
            <p className="order-activity__title">{event.title}</p>
            {event.description ? (
              <p className="order-activity__description">{event.description}</p>
            ) : null}
          </div>
          {event.timestamp ? (
            <time className="order-activity__time" dateTime={event.timestamp}>
              <TimeDisplay iso={event.timestamp} format="datetime" />
            </time>
          ) : (
            <span className="order-activity__time order-activity__time--pending">in progress</span>
          )}
        </li>
      ))}
    </ol>
  );
}
