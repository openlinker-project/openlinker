/**
 * Order Activity Timeline
 *
 * Ordered list of events derived from the order's lifecycle data — ingestion
 * (from `createdAt` + `recordStatus`) and each sync **attempt** against a
 * destination (from `syncAttempts`, the append-only history). Every attempt
 * has a real `attemptedAt`, so failure → retry → success renders as three
 * rows in chronological order. When a destination's history hits the cap,
 * a "view all attempts" link to `/sync/jobs?connectionId={source}` lets
 * operators dig deeper without coupling the order surface to `sync_jobs`.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ConnectionEntityLabel } from '../../connections/components/ConnectionEntityLabel';
import {
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
  type OrderSyncStatusValue,
  type SyncAttempt,
} from '../api/orders.types';

interface TimelineEvent {
  id: string;
  timestamp: string | null;
  title: ReactElement | string;
  description?: ReactElement | string;
  tone: 'default' | 'success' | 'error' | 'warning';
  /**
   * Footer rendered below the row body — used to attach the "view all
   * attempts" deep link to the **last** attempt of a capped destination.
   */
  footer?: ReactElement;
}

interface OrderActivityTimelineProps {
  createdAt: string;
  recordStatus: string;
  /**
   * Per-destination append-only history. The current state per destination
   * lives on `OrderRecord.syncStatus` and is consumed by the Sync Status
   * table — not this component.
   */
  syncAttempts: SyncAttempt[];
  /**
   * Source connection — drives the "view all attempts" deep-link target.
   * `marketplace.order.sync` jobs are scoped to the source connection, so
   * that's the right filter on `/sync/jobs`.
   */
  sourceConnectionId: string;
}

const STATUS_PAST_TENSE: Record<OrderSyncStatusValue, string> = {
  pending: 'queued for',
  syncing: 'syncing to',
  synced: 'synced to',
  failed: 'failed to sync to',
};

const TONE_FOR_STATUS: Record<OrderSyncStatusValue, TimelineEvent['tone']> = {
  pending: 'default',
  syncing: 'default',
  synced: 'success',
  failed: 'error',
};

function buildEvents(
  createdAt: string,
  recordStatus: string,
  syncAttempts: SyncAttempt[],
  sourceConnectionId: string,
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

  // Identify destinations whose history is at or above the cap so we can
  // attach the "view all attempts" link to the most-recent row of each.
  const cappedDestinations = new Set<string>();
  const destinationCounts = new Map<string, number>();
  for (const a of syncAttempts) {
    destinationCounts.set(
      a.destinationConnectionId,
      (destinationCounts.get(a.destinationConnectionId) ?? 0) + 1,
    );
  }
  for (const [destId, count] of destinationCounts) {
    if (count >= SYNC_ATTEMPTS_PER_DESTINATION_CAP) {
      cappedDestinations.add(destId);
    }
  }

  // Track the index of each destination's last attempt so the deep link
  // attaches to the most-recent row (after chronological sort below).
  const sortedAttempts = [...syncAttempts].sort(
    (a, b) => new Date(a.attemptedAt).getTime() - new Date(b.attemptedAt).getTime(),
  );
  const lastIndexByDestination = new Map<string, number>();
  sortedAttempts.forEach((a, i) => {
    lastIndexByDestination.set(a.destinationConnectionId, i);
  });

  sortedAttempts.forEach((attempt, i) => {
    const verb = STATUS_PAST_TENSE[attempt.status] ?? attempt.status;
    const isLastForDestination = lastIndexByDestination.get(attempt.destinationConnectionId) === i;
    const showCapLink =
      isLastForDestination && cappedDestinations.has(attempt.destinationConnectionId);

    events.push({
      id: `attempt-${attempt.destinationConnectionId}-${i}`,
      timestamp: attempt.attemptedAt,
      title: (
        <>
          Order {verb}{' '}
          <ConnectionEntityLabel
            connectionId={attempt.destinationConnectionId}
            showId={false}
          />
        </>
      ),
      description: attempt.error ? (
        <span className="mono-text order-activity__error">{attempt.error}</span>
      ) : attempt.externalOrderNumber ? (
        <>
          External order{' '}
          <span className="mono-text">{attempt.externalOrderNumber}</span>
          {attempt.externalOrderId ? (
            <>
              {' '}
              <span className="mono-text text-muted">({attempt.externalOrderId})</span>
            </>
          ) : null}
        </>
      ) : undefined,
      tone: TONE_FOR_STATUS[attempt.status] ?? 'default',
      footer: showCapLink ? (
        <Link
          className="order-activity__cap-link"
          to={`/sync/jobs?connectionId=${encodeURIComponent(sourceConnectionId)}`}
        >
          View all attempts
        </Link>
      ) : undefined,
    });
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
  syncAttempts,
  sourceConnectionId,
}: OrderActivityTimelineProps): ReactElement {
  const events = buildEvents(createdAt, recordStatus, syncAttempts, sourceConnectionId);

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
            {event.footer ? <p className="order-activity__footer">{event.footer}</p> : null}
          </div>
          {event.timestamp ? (
            <time className="order-activity__time" dateTime={event.timestamp}>
              <TimeDisplay iso={event.timestamp} format="datetime" />
            </time>
          ) : (
            <span className="order-activity__time" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
