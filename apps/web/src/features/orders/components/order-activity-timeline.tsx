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
import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../../shared/ui/feedback-state';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ConnectionEntityLabel } from '../../connections';
import {
  SYNC_ATTEMPTS_PER_DESTINATION_CAP,
  type OrderSyncStatusValue,
  type SyncAttempt,
  type SalesDocumentGateBlockReasonValue,
  type SalesDocumentUnresolvedReasonValue,
} from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';
import { invoicingBlockedBadge } from '../lib/order-row';

interface TimelineEvent {
  id: string;
  timestamp: string | null;
  title: ReactElement | string;
  /** Actor eyebrow (e.g. "system · ingest", "system · attempt 2"). */
  by?: string;
  description?: ReactElement | string;
  tone: 'default' | 'success' | 'error' | 'warning' | 'conflict';
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
  /**
   * Operator-facing reason item resolution failed at ingestion (#1689), set
   * alongside `recordStatus = 'awaiting_mapping' | 'source_deleted'`.
   */
  mappingFailureReason?: string | null;
  /**
   * Why OpenLinker issued no fiscal document (#2100). Narrated as its own
   * timeline entry rather than folded into "Order received" the way
   * `mappingFailureReason` is — an invoicing block is not an ingestion-time fact.
   */
  salesDocumentBlockReason?: SalesDocumentGateBlockReasonValue | null;
  /** Routing reason paired with a `'unresolved-routing'` block (ADR-041 §107). */
  salesDocumentUnresolvedReason?: SalesDocumentUnresolvedReasonValue | null;
  /** PII-free elaboration the backend supplied. */
  salesDocumentBlockDetail?: string | null;
  /**
   * The order's invoice projection, when it has one. Suppresses the block entry —
   * see the shared rule on `invoicingBlockedBadge`.
   */
  invoice?: ParsedOrderInvoice | null;
  /**
   * When the current hold started (#2248). Dates the block entry, which was
   * previously undated because no instant was persisted for it.
   */
  salesDocumentBlockedAt?: string | null;
  /**
   * When the hold ended. The release entry can only exist because of it: by the
   * time an order is released the reason is gone, so nothing else records that
   * it was ever held.
   */
  salesDocumentBlockReleasedAt?: string | null;
}

const STATUS_PAST_TENSE: Record<OrderSyncStatusValue, string> = {
  pending: 'queued for',
  syncing: 'syncing to',
  synced: 'synced to',
  failed: 'failed to sync to',
};

/**
 * Badge tone → timeline tone (#2100). The timeline's dot vocabulary is narrower
 * than `StatusBadgeTone`, so the mapping is explicit and total rather than a
 * conditional that silently widens: `neutral` / `info` / `review` all read
 * correctly as an ordinary `default` entry — a deliberate operator setting is not
 * a failure and must not borrow a failure colour.
 */
const BLOCK_TONE_FOR_BADGE: Record<StatusBadgeTone, TimelineEvent['tone']> = {
  error: 'error',
  warning: 'warning',
  success: 'success',
  conflict: 'conflict',
  neutral: 'default',
  info: 'default',
  review: 'default',
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
  mappingFailureReason?: string | null,
  salesDocumentBlockReason?: SalesDocumentGateBlockReasonValue | null,
  salesDocumentUnresolvedReason?: SalesDocumentUnresolvedReasonValue | null,
  salesDocumentBlockDetail?: string | null,
  invoice?: ParsedOrderInvoice | null,
  salesDocumentBlockedAt?: string | null,
  salesDocumentBlockReleasedAt?: string | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const ingestDescription = (): { description: string; tone: TimelineEvent['tone'] } => {
    if (recordStatus === 'source_deleted') {
      return {
        description:
          'Item deleted at the source — this order references a product that was removed at ' +
          `the master. It cannot be fulfilled until the product reappears or the line is cancelled.${
            mappingFailureReason ? ` (${mappingFailureReason})` : ''
          }`,
        tone: 'error',
      };
    }
    if (recordStatus === 'awaiting_mapping') {
      return {
        description:
          'Awaiting product mapping — some item references could not be resolved yet.' +
          (mappingFailureReason ? ` (${mappingFailureReason})` : ''),
        tone: 'warning',
      };
    }
    return { description: 'Ingested and ready for sync.', tone: 'default' };
  };
  const ingest = ingestDescription();

  events.push({
    id: 'ingested',
    timestamp: createdAt,
    title: 'Order received',
    by: 'system · ingest',
    description: ingest.description,
    tone: ingest.tone,
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

  const attemptNumberByDestination = new Map<string, number>();
  sortedAttempts.forEach((attempt, i) => {
    const verb = STATUS_PAST_TENSE[attempt.status] ?? attempt.status;
    const isLastForDestination = lastIndexByDestination.get(attempt.destinationConnectionId) === i;
    const showCapLink =
      isLastForDestination && cappedDestinations.has(attempt.destinationConnectionId);
    const attemptNumber = (attemptNumberByDestination.get(attempt.destinationConnectionId) ?? 0) + 1;
    attemptNumberByDestination.set(attempt.destinationConnectionId, attemptNumber);

    events.push({
      id: `attempt-${attempt.destinationConnectionId}-${i}`,
      timestamp: attempt.attemptedAt,
      by: `system · attempt ${attemptNumber}`,
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

  // #2100 — appended last. It used to be DELIBERATELY UNDATED, because the block
  // is a current-state fact re-decided on every transition and no instant was
  // persisted for it; dating it with `createdAt` or `updatedAt` would have
  // asserted a moment the data did not support.
  //
  // #2248 persists that instant, so the entry is dated when one exists and stays
  // undated when it does not (an order held before the columns landed). The
  // fallback is still `null` rather than a guess, for the original reason.
  // `invoice` is passed so the shared suppression rule applies here too: without
  // it this entry claimed "No invoice issued" directly under the panel showing the
  // issued invoice (#2100 review).
  const blocked = invoicingBlockedBadge(
    salesDocumentBlockReason,
    salesDocumentUnresolvedReason,
    invoice,
  );
  if (blocked) {
    events.push({
      id: 'invoicing-blocked',
      timestamp: salesDocumentBlockedAt ?? null,
      title: 'No invoice issued',
      by: 'system · invoicing',
      description: `${blocked.hint}${
        salesDocumentBlockDetail ? ` (${salesDocumentBlockDetail})` : ''
      }`,
      tone: BLOCK_TONE_FOR_BADGE[blocked.tone],
    });
  }

  // #2254 — the RELEASE entry, which can only exist because the instant is
  // persisted: by the time an order is released the reason itself is gone, so
  // nothing else records that it was ever held. It is what answers "why did this
  // suddenly issue".
  //
  // Rendered only when the hold has actually ended and nothing is blocking now -
  // a released instant alongside a live block would be describing a previous
  // episode, and the pair is cleared on each new one precisely so it cannot.
  if (!blocked && salesDocumentBlockReleasedAt) {
    events.push({
      id: 'invoicing-released',
      timestamp: salesDocumentBlockReleasedAt,
      title: 'Rates arrived, invoice released',
      by: 'system · invoicing',
      description:
        'The tax rate this order was waiting on is now known, so OpenLinker stopped holding the document.',
      tone: 'success',
    });
  }

  return events;
}

const TONE_CLASS: Record<TimelineEvent['tone'], string> = {
  default: 'order-activity__dot--default',
  success: 'order-activity__dot--success',
  error: 'order-activity__dot--error',
  warning: 'order-activity__dot--warning',
  conflict: 'order-activity__dot--conflict',
};

export function OrderActivityTimeline({
  createdAt,
  recordStatus,
  syncAttempts,
  sourceConnectionId,
  mappingFailureReason,
  salesDocumentBlockReason,
  salesDocumentUnresolvedReason,
  salesDocumentBlockDetail,
  invoice,
  salesDocumentBlockedAt,
  salesDocumentBlockReleasedAt,
}: OrderActivityTimelineProps): ReactElement {
  const events = useMemo(
    () =>
      buildEvents(
        createdAt,
        recordStatus,
        syncAttempts,
        sourceConnectionId,
        mappingFailureReason,
        salesDocumentBlockReason,
        salesDocumentUnresolvedReason,
        salesDocumentBlockDetail,
        invoice,
        salesDocumentBlockedAt,
        salesDocumentBlockReleasedAt,
      ),
    [
      createdAt,
      recordStatus,
      syncAttempts,
      sourceConnectionId,
      mappingFailureReason,
      salesDocumentBlockReason,
      salesDocumentUnresolvedReason,
      salesDocumentBlockDetail,
      invoice,
      salesDocumentBlockedAt,
      salesDocumentBlockReleasedAt,
    ],
  );

  if (events.length === 0) {
    return (
      <EmptyState liveRegion="off" title="No activity" message="No events recorded yet." />
    );
  }

  return (
    <>
    <ol className="order-activity" aria-label="Order activity timeline">
      {events.map((event) => (
        <li key={event.id} className="order-activity__item">
          <span className={`order-activity__dot ${TONE_CLASS[event.tone]}`} aria-hidden="true" />
          <div className="order-activity__body">
            <p className="order-activity__title">
              {event.title}
              {event.by ? <span className="order-activity__by">{event.by}</span> : null}
            </p>
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
    <p className="order-activity__caption">
      Showing {events.length} of {events.length} event{events.length === 1 ? '' : 's'} · attempts capped at{' '}
      {SYNC_ATTEMPTS_PER_DESTINATION_CAP} per destination.
    </p>
    </>
  );
}
