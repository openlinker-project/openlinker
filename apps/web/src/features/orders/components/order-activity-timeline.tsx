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
  type OrderAmendmentChange,
} from '../api/orders.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import {
  AUTOMATION_FAILURE_COPY,
  AUTOMATION_RUN_OUTCOME_COPY,
  type AutomationRun,
} from '../../automation';
import { buildAutomationTimelineEvents } from '../lib/automation-timeline';
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
   * Instant the source last amended this order after ingestion (#2283). Unlike
   * the #2100 invoicing block, a real instant IS persisted here, so the entry is
   * DATED and sorts into place with the rest of the history.
   */
  lastAmendedAt?: string | null;
  /** What changed then (#2283) — PII-free by backend contract. */
  lastAmendmentChanges?: OrderAmendmentChange[] | null;
  /**
   * Instant an operator marked this order packed (#2288). DATED, like the
   * #2283 amendment entry and unlike the #2100 invoicing block: a real instant
   * is persisted, so it belongs in the history rather than beside it.
   */
  packedAt?: string | null;
  /** OL user id of whoever marked it packed (#2288) — rendered as the actor. */
  packedByUserId?: string | null;
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
  /**
   * Automation firings against this order (#2385) — the fourth of §5.6's "four
   * readings" of one `automation_runs` row, never a second write. Optional so
   * every existing caller compiles untouched and renders no automation events.
   */
  automationRuns?: readonly AutomationRun[];
}

const STATUS_PAST_TENSE: Record<OrderSyncStatusValue, string> = {
  pending: 'queued for',
  syncing: 'syncing to',
  synced: 'synced to',
  failed: 'failed to sync to',
  skipped_cancelled: 'skipped (cancelled at source) for',
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
  // Terminal, and not a failure — a deliberate withholding reads neutral (#2284).
  skipped_cancelled: 'default',
};

/**
 * Operator-facing sentence for a change list (#2283).
 *
 * Renders only what the backend sent: an address change names the FIELDS that
 * moved and never their values, because the values are deliberately not on the
 * wire. An unrecognised `kind` from a newer backend degrades to the raw value
 * rather than vanishing — a change the operator cannot see is worse than one
 * labelled awkwardly.
 */
function describeAmendment(changes?: OrderAmendmentChange[] | null): string {
  const parts = (changes ?? []).map((change) => {
    const line = change.sku ?? change.lineId ?? 'a line';
    switch (change.kind) {
      case 'line-removed':
        return `line ${line} removed`;
      case 'line-added':
        return `line ${line} added`;
      case 'line-quantity-changed':
        return `line ${line} quantity ${change.fromQuantity} \u2192 ${change.toQuantity}`;
      case 'shipping-address-changed':
        return `shipping address changed (${(change.fields ?? []).join(', ')})`;
      default:
        return change.kind;
    }
  });

  return parts.length > 0
    ? `The source changed this order after ingestion: ${parts.join('; ')}.`
    : 'The source changed this order after ingestion.';
}

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
  lastAmendedAt?: string | null,
  lastAmendmentChanges?: OrderAmendmentChange[] | null,
  packedAt?: string | null,
  packedByUserId?: string | null,
  salesDocumentBlockedAt?: string | null,
  salesDocumentBlockReleasedAt?: string | null,
  automationRuns?: readonly AutomationRun[],
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

  // #2283 — the source amended this order after we ingested it. DATED, unlike
  // the #2100 entry below: a real instant is persisted for it, so it belongs in
  // the history rather than beside it. Pushed BEFORE that entry so the undated
  // current-state row stays last, and `warning` because it is outstanding work —
  // a shipment may already reference a line the source removed.
  if (lastAmendedAt) {
    events.push({
      id: 'source-amended',
      timestamp: lastAmendedAt,
      title: 'Order changed at the source',
      by: 'system · ingest',
      description: describeAmendment(lastAmendmentChanges),
      tone: 'warning',
    });
  }

  // #2288 — an operator marked this order packed. DATED for the same reason the
  // amendment entry above is: a real instant is persisted. `success` because it
  // is progress through the workflow, not outstanding work. Pushed BEFORE the
  // undated entry below so the current-state row stays last.
  if (packedAt) {
    events.push({
      id: 'packed',
      timestamp: packedAt,
      title: 'Order packed',
      by: 'operator',
      description: packedByUserId
        ? `Marked packed by ${packedByUserId}.`
        : 'Marked packed by an operator.',
      tone: 'success',
    });
  }

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

  // #2385 — one event per automation STEP, plus the "Skipped:" event. A
  // rendering of `automation_runs`, never a second write: see
  // `lib/automation-timeline.ts`. Firings only, so an order no rule acted on
  // contributes nothing.
  for (const event of buildAutomationTimelineEvents(automationRuns ?? [])) {
    events.push({
      id: event.id,
      timestamp: event.timestamp,
      title: event.title,
      by:
        event.runOutcome === undefined
          ? event.by
          : `${event.by} · ${(AUTOMATION_RUN_OUTCOME_COPY as Record<string, string>)[event.runOutcome] ?? event.runOutcome}`,
      description: event.description,
      tone: event.tone,
      // The rule name in `by` is text; the LINK is what makes turning the rule
      // off reachable from the order without knowing which rule to suspect (S3-8).
      //
      // `isRetry` / `handledByOperator` ride here rather than in `title` or
      // `description`: the title is the action's own verb and the description is
      // the failure's own words (never paraphrased), so a note ABOUT the firing
      // belongs beside the trigger sentence. Both were computed and read by
      // nothing, which meant a retry chain rendered as two unrelated firings the
      // operator had to correlate by timestamp, and a failure someone had
      // already handled stayed indistinguishable from one nobody had touched.
      footer: (
        <>
          <Link to={`/automations/${encodeURIComponent(event.trigger)}`}>{event.footer}</Link>
          {event.isRetry ? (
            <span className="muted-text"> · {AUTOMATION_FAILURE_COPY.isRetryOf}</span>
          ) : null}
          {event.handledByOperator ? (
            <span className="muted-text"> · {AUTOMATION_FAILURE_COPY.dismissed}</span>
          ) : null}
        </>
      ),
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
  lastAmendedAt,
  lastAmendmentChanges,
  packedAt,
  packedByUserId,
  salesDocumentBlockedAt,
  salesDocumentBlockReleasedAt,
  automationRuns,
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
        lastAmendedAt,
        lastAmendmentChanges,
        packedAt,
        packedByUserId,
        salesDocumentBlockedAt,
        salesDocumentBlockReleasedAt,
        automationRuns,
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
      lastAmendedAt,
      lastAmendmentChanges,
      packedAt,
      packedByUserId,
      salesDocumentBlockedAt,
      salesDocumentBlockReleasedAt,
      automationRuns,
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
