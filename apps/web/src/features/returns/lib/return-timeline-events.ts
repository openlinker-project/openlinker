/**
 * Return activity → order-timeline rows (#2383)
 *
 * Pure, no I/O. The returns feature maps its OWN acts into the orders
 * timeline's row shape, rather than the orders timeline learning returns
 * vocabulary — `buildEvents` there already takes fifteen positional parameters,
 * and a sixteenth would put this feature's concepts inside that builder.
 *
 * `TimelineEvent` is imported through the orders barrel (`../../orders`), the
 * #2100 cross-feature shape and an edge this feature already has.
 *
 * **`sessionUserId` is a parameter, not something this module reaches for.** A
 * pure mapper must not read session state, and the you-vs-another-operator
 * distinction is the whole point of the `by` eyebrow.
 *
 * @module apps/web/src/features/returns/lib
 */
import type { TimelineEvent } from '../../orders';
import type { ReturnTimelineEntry } from '../api/returns.types';
import { RETURN_TIMELINE_COPY as COPY } from './return-timeline.copy';

/**
 * Who to attribute an entry to — or nobody.
 *
 * Returns `undefined` rather than a fallback string when nothing is known: an
 * omitted eyebrow is silent, whereas a guessed one is a claim about who did
 * something. `opened` / `declined` carry no actor column at all, so they are a
 * SOURCE claim or nothing; a refund reports WHAT moved the money (ADR-056),
 * never who.
 */
function resolveBy(entry: ReturnTimelineEntry, sessionUserId: string | null): string | undefined {
  if (entry.source === 'refund') {
    return entry.refundExecutedBy === 'refund_executor' ? COPY.byOpenLinker : COPY.byOperator;
  }

  if (entry.source === 'record_status') {
    if (entry.returnOrigin === 'operator_authored') return COPY.byOperator;
    return entry.sourceConnectionName ?? COPY.byUnknownConnection;
  }

  if (entry.actorUserId === null) return undefined;
  return entry.actorUserId === sessionUserId ? COPY.byYou : COPY.byAnotherOperator;
}

function resolveTitle(entry: ReturnTimelineEntry): string {
  switch (entry.kind) {
    case 'opened':
      return COPY.opened;
    case 'declined':
      return COPY.declined;
    case 'receive':
      return COPY.receive;
    case 'dispose':
      return COPY.dispose;
    case 'stock_attestation':
      return COPY.stock_attestation;
    case 'not_returned':
      return COPY.not_returned;
    case 'refund_confirmed':
      return COPY.refund_confirmed;
    default:
      // Rendered, never dropped.
      return COPY.unknownKind(entry.kind);
  }
}

function resolveTone(entry: ReturnTimelineEntry): TimelineEvent['tone'] {
  if (entry.restockState === 'blocked' || entry.restockState === 'in_doubt') return 'warning';
  if (entry.kind === 'declined') return 'error';
  if (entry.kind === 'refund_confirmed') return 'success';
  return 'default';
}

function resolveDescription(entry: ReturnTimelineEntry): string | undefined {
  const parts: string[] = [];

  if (entry.externalReturnId !== null) {
    parts.push(COPY.returnReference(entry.externalReturnId));
  }
  if (entry.quantity !== null) {
    parts.push(COPY.quantityUnits(entry.quantity));
  }
  if (entry.disposition !== null) {
    parts.push(COPY.disposedAs(entry.disposition));
  }
  if (entry.amount !== null && entry.currency !== null) {
    parts.push(COPY.refundAmount(entry.amount, entry.currency));
  }
  if (entry.source === 'refund') {
    parts.push(
      entry.refundExecutedBy === 'refund_executor' ? COPY.refundExecuted : COPY.refundRecordedOnly
    );
  }
  if (entry.restockState === 'blocked' || entry.restockState === 'in_doubt') {
    parts.push(COPY.restockBlocked);
  }

  return parts.length === 0 ? undefined : parts.join(' · ');
}

/**
 * Map every entry — nothing is filtered. A return act OpenLinker recorded but
 * this build does not recognise still reaches the operator, who can act on it.
 */
export function mapReturnEventsToTimeline(
  entries: ReturnTimelineEntry[],
  sessionUserId: string | null
): TimelineEvent[] {
  return entries.map((entry) => ({
    id: `return:${entry.id}`,
    timestamp: entry.occurredAt,
    title: resolveTitle(entry),
    by: resolveBy(entry, sessionUserId),
    description: resolveDescription(entry),
    tone: resolveTone(entry),
  }));
}
