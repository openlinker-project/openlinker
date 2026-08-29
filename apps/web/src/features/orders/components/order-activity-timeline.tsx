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
  type OrderHold,
} from '../api/orders.types';
import { holdReasonLabel } from '../lib/order-hold.types';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { ParsedOrderInvoice } from '../api/order-snapshot.schema';
import { invoicingBlockedBadge } from '../lib/order-row';

/**
 * One row on the order activity timeline.
 *
 * **Exported since #2383** so a sibling feature can map its own acts into this
 * shape without the orders timeline learning that feature's vocabulary —
 * `buildEvents` already takes fifteen positional parameters, and a sixteenth
 * would put returns concepts inside the orders builder. The type is owned here
 * because the timeline is owned here.
 */
export interface TimelineEvent {
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

/**
 * A {@link TimelineEvent} that is guaranteed to carry an instant.
 *
 * Injected events are narrowed to this rather than the code accommodating a
 * null: **an event with no timestamp has no defensible position in a
 * chronological merge**, so the type forbids it instead of the merge inventing
 * a place for it. An UNDATED AUTHORED entry is a different thing entirely and
 * stays legal — it holds an authored position that was never derived from a
 * timestamp, which is exactly why it is not a comparison key.
 */
export type DatedTimelineEvent = TimelineEvent & { timestamp: string };

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
   * Events contributed by another feature (#2383 — the returns half).
   *
   * The timeline learns nothing about where they came from: the caller maps its
   * own acts into `TimelineEvent` and this component merges them by timestamp
   * (see {@link mergeTimelineEvents}). Optional, and absent or empty leaves the
   * rendered order identical to before the prop existed.
   */
  extraEvents?: DatedTimelineEvent[];
  /**
   * Every ORDER hold this order has carried, open and released (#2341/#2342).
   * Unrelated to the sales-document hold above, which is an invoicing fact.
   *
   * DATED in both directions — `placedAt` is always persisted and `releasedAt`
   * is persisted once the hold ends — so these sort into the history rather than
   * sitting undated beside it. Detail-only and optional on the wire, so absent
   * and `null` mean the same thing.
   */
  holds?: OrderHold[] | null;
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

/**
 * Timeline entries for the order's holds (#2342) — one `held` per hold and one
 * `released` per hold that has ended.
 *
 * Extracted as a pure function so it is testable on its own, but its result is
 * pushed INSIDE `buildEvents` at the right rung rather than appended by the
 * caller: `buildEvents` sorts only `syncAttempts`, so the returned list is
 * otherwise in push order and position carries meaning. Appending at the call
 * site would render every hold entry after the entire history regardless of
 * when it happened.
 *
 * `warning` for the hold (outstanding work) and `default` for the release — a
 * release is not a failure, and it is not progress through the workflow either.
 * An unrecognised reason renders its raw value rather than vanishing: a hold the
 * operator cannot see is worse than one labelled awkwardly (the
 * `describeAmendment` precedent).
 */
/**
 * Who placed this hold, or `undefined` when the payload does not say.
 *
 * `undefined` omits the actor eyebrow entirely — `TimelineEvent.by` is optional
 * precisely so a surface can decline to name one, and matching
 * `OrderHoldPanel`'s `placedBy()` (which returns `null` in the same case) is
 * what keeps two surfaces on one page from disagreeing.
 */
function describePlacer(hold: OrderHold): string | undefined {
  if (hold.placedByService) return `system · ${hold.placedByService}`;
  if (hold.placedByUserId) return 'operator';
  return undefined;
}

/** Who released it. See {@link describePlacer} — same rule, same reason. */
function describeReleaser(hold: OrderHold): string | undefined {
  return hold.releasedByUserId ? 'operator' : undefined;
}

function buildHoldEvents(holds: OrderHold[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const hold of holds) {
    const label = holdReasonLabel(hold.reason);
    const actor = hold.placedByService ?? hold.placedByUserId;

    events.push({
      id: `hold-placed-${hold.id}`,
      timestamp: hold.placedAt,
      title: `Put on hold — ${label}`,
      // THREE ways, not two. The XOR that makes "not a service ⇒ a human" total
      // is a SQL `CHECK` this bundle cannot import (#591), so a payload carrying
      // neither placer used to render "Held by operator" — asserting a person
      // held the order, which `order-hold.types.ts`'s own docblock forbids by
      // name, and disagreeing with the panel's `placedBy()` on the same page.
      // An unreadable placer omits the eyebrow rather than naming one.
      by: describePlacer(hold),
      description: hold.note
        ? `${hold.note}${actor && !hold.placedByService ? ` (${actor})` : ''}`
        : 'OpenLinker stopped sending this order on and stopped dispatching it.',
      tone: 'warning',
    });

    if (hold.releasedAt) {
      events.push({
        id: `hold-released-${hold.id}`,
        timestamp: hold.releasedAt,
        title: 'Hold released',
        // Same rule on the release arm. `order_holds` carries no
        // `releasedByService` column, so "no releasing user" does NOT mean a
        // service did it — a service release is recorded by nobody. Claiming
        // `system` there named an actor the schema cannot identify.
        by: describeReleaser(hold),
        description: hold.releaseNote
          ? `${hold.releaseNote}${hold.releasedByUserId ? ` (${hold.releasedByUserId})` : ''}`
          : 'OpenLinker started sending this order on again.',
        tone: 'default',
      });
    }
  }

  return events;
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
  holds?: OrderHold[] | null,
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

  // #2342 — the order's own holds, dated and therefore part of the history.
  // Pushed here, after the packed entry and BEFORE the undated invoicing-block
  // row below, so the current-state row stays last.
  events.push(...buildHoldEvents(holds ?? []));

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

/**
 * Merge injected events into the authored sequence WITHOUT re-sorting it.
 *
 * `buildEvents` has never sorted: its order is an authored narrative, and it
 * deliberately includes undated entries (`timestamp: … ?? null`). A global sort
 * would silently rewrite someone else's surface, and appending would pin every
 * injected event to the bottom regardless of when it happened — the dateless
 * entry defect one level up.
 *
 * So: each authored event is emitted in its original position, and injected
 * events are flushed in front of the first DATED authored event they precede.
 * Two properties follow by construction and are pinned by tests:
 *
 * - authored events are never compared with each other, so with `extra` empty
 *   the output is the input, identical;
 * - an undated authored entry is not a comparison key, so it keeps its authored
 *   position and never floats to an end.
 *
 * A tie keeps the authored entry first — it described the order first.
 */
export function mergeTimelineEvents(
  authored: TimelineEvent[],
  extra: DatedTimelineEvent[],
): TimelineEvent[] {
  if (extra.length === 0) return authored;

  const pending = [...extra].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const merged: TimelineEvent[] = [];
  let next = 0;

  for (const event of authored) {
    if (event.timestamp !== null) {
      const at = Date.parse(event.timestamp);
      while (next < pending.length && Date.parse(pending[next].timestamp) < at) {
        merged.push(pending[next]);
        next += 1;
      }
    }
    merged.push(event);
  }

  return [...merged, ...pending.slice(next)];
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
  extraEvents,
  holds,
}: OrderActivityTimelineProps): ReactElement {
  const authored = useMemo(
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
        holds,
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
      holds,
    ],
  );

  const events = useMemo(
    () => mergeTimelineEvents(authored, extraEvents ?? []),
    [authored, extraEvents],
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
