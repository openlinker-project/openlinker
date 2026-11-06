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
import type { DatedTimelineEvent, TimelineEvent } from '../../orders';
import type { ReturnTimelineEntry } from '../api/returns.types';
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';

type TimelineCopy = ReturnType<typeof getMessages<'returns'>>['timeline'];

/**
 * Who to attribute an entry to — or nobody.
 *
 * Returns `undefined` rather than a fallback string when nothing is known: an
 * omitted eyebrow is silent, whereas a guessed one is a claim about who did
 * something. `opened` / `declined` carry no actor column at all, so they are a
 * SOURCE claim or nothing; a refund reports WHAT moved the money (ADR-056),
 * never who.
 */
/**
 * WHAT moved the money, per `RefundRecord.executedBy` (ADR-056).
 *
 * A TOTAL MAP over the values this build knows, never a default arm. The wire
 * type is `string | null` — an open string — so a ternary would send every
 * future member to whichever branch it fell through to. When a
 * `MasterRefundExecutor` writes a third value, an `executedBy`-shaped ternary
 * would render *"an operator"* against a refund a machine made: OpenLinker
 * attributing a human act that never happened, silently and on every such row.
 *
 * An unknown value therefore yields NO eyebrow, matching `resolveTitle`'s
 * `unknownKind` arm below — the title and the attribution must fail the same
 * way, and the dangerous asymmetry is a safe title beside a confident wrong
 * actor.
 */
function refundExecutedByCopy(COPY: TimelineCopy): Record<string, string> {
  return {
    refund_executor: COPY.byOpenLinker,
    operator_out_of_band: COPY.byOperator,
  };
}

function resolveBy(
  COPY: TimelineCopy,
  entry: ReturnTimelineEntry,
  sessionUserId: string | null
): string | undefined {
  if (entry.source === 'refund') {
    if (entry.refundExecutedBy === null) return undefined;
    return refundExecutedByCopy(COPY)[entry.refundExecutedBy];
  }

  if (entry.source === 'record_status') {
    // Keyed on the ACTOR'S PRESENCE, never on the kind (#2646).
    //
    // Most header columns carry no actor — `opened` and `declined` are a SOURCE
    // claim or nothing. `matched` is an operator's own act (#2372) and `returns`
    // persists who performed it. A kind ALLOW-LIST would fail closed to the
    // source claim, so the next actor-bearing column would credit an operator's
    // act to the channel — the confident false attribution
    // `refundExecutedByCopy` exists to prevent. Presence fails safe.
    if (entry.actorUserId !== null) {
      return entry.actorUserId === sessionUserId ? COPY.byYou : COPY.byAnotherOperator;
    }
    if (entry.returnOrigin === 'operator_authored') return COPY.byOperator;
    return entry.sourceConnectionName ?? COPY.byUnknownConnection;
  }

  if (entry.actorUserId === null) return undefined;
  return entry.actorUserId === sessionUserId ? COPY.byYou : COPY.byAnotherOperator;
}

function resolveTitle(COPY: TimelineCopy, entry: ReturnTimelineEntry): string {
  switch (entry.kind) {
    case 'opened':
      return COPY.opened;
    case 'authorized':
      return COPY.authorized;
    case 'declined':
      return COPY.declined;
    case 'closed':
      return COPY.closed;
    case 'matched':
      return COPY.matched;
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
      return interpolate(COPY.unknownKind, { kind: entry.kind });
  }
}

function resolveTone(entry: ReturnTimelineEntry): TimelineEvent['tone'] {
  if (entry.restockState === 'blocked' || entry.restockState === 'in_doubt') return 'warning';
  if (entry.kind === 'declined') return 'error';
  if (entry.kind === 'refund_confirmed') return 'success';
  return 'default';
}

function resolveDescription(COPY: TimelineCopy, entry: ReturnTimelineEntry): string | undefined {
  const parts: string[] = [];

  if (entry.externalReturnId !== null) {
    parts.push(interpolate(COPY.returnReference, { externalReturnId: entry.externalReturnId }));
  }
  if (entry.quantity !== null) {
    parts.push(formatPlural(entry.quantity, COPY.quantityUnits, getLocale()));
  }
  if (entry.disposition !== null) {
    parts.push(interpolate(COPY.disposedAs, { disposition: entry.disposition }));
  }
  if (entry.amount !== null && entry.currency !== null) {
    parts.push(interpolate(COPY.refundAmount, { amount: entry.amount, currency: entry.currency }));
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
): DatedTimelineEvent[] {
  const COPY = getMessages('returns').timeline;
  return entries.map((entry) => ({
    id: `return:${entry.id}`,
    timestamp: entry.occurredAt,
    title: resolveTitle(COPY, entry),
    by: resolveBy(COPY, entry, sessionUserId),
    description: resolveDescription(COPY, entry),
    tone: resolveTone(entry),
  }));
}
