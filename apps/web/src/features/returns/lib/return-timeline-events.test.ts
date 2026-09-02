import { describe, expect, it } from 'vitest';
import { mapReturnEventsToTimeline } from './return-timeline-events';
import { RETURN_TIMELINE_COPY as COPY } from './return-timeline.copy';
import type { ReturnTimelineEntry } from '../api/returns.types';

const SESSION_USER = 'ol_user_me';

function entry(overrides: Partial<ReturnTimelineEntry> = {}): ReturnTimelineEntry {
  return {
    id: 'ev1',
    source: 'custody_act',
    kind: 'receive',
    occurredAt: '2026-08-20T10:00:00.000Z',
    returnId: 'ol_return_1',
    externalReturnId: null,
    returnOrigin: 'source_ingested',
    sourceConnectionName: 'Allegro PL',
    actorUserId: null,
    quantity: null,
    restockState: null,
    disposition: null,
    refundExecutedBy: null,
    amount: null,
    currency: null,
    ...overrides,
  };
}

describe('mapReturnEventsToTimeline', () => {
  it('maps every shipped kind to its own title', () => {
    const kinds = [
      ['opened', COPY.opened],
      ['declined', COPY.declined],
      ['receive', COPY.receive],
      ['dispose', COPY.dispose],
      ['stock_attestation', COPY.stock_attestation],
      ['not_returned', COPY.not_returned],
      ['refund_confirmed', COPY.refund_confirmed],
    ] as const;

    for (const [kind, title] of kinds) {
      const [event] = mapReturnEventsToTimeline([entry({ kind })], SESSION_USER);
      expect(event.title).toBe(title);
    }
  });

  it('renders an unrecognised kind rather than dropping it', () => {
    const events = mapReturnEventsToTimeline([entry({ kind: 'teleported' })], SESSION_USER);

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe(COPY.unknownKind('teleported'));
  });

  it('never drops an entry — the mapper is total', () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b', kind: 'nonsense' }), entry({ id: 'c' })];

    expect(mapReturnEventsToTimeline(entries, SESSION_USER)).toHaveLength(3);
  });

  describe('by — the honesty axis', () => {
    it('says "you" for an act this operator performed', () => {
      const [event] = mapReturnEventsToTimeline(
        [entry({ actorUserId: SESSION_USER })],
        SESSION_USER
      );

      expect(event.by).toBe(COPY.byYou);
    });

    it('says another operator for an act someone else performed', () => {
      const [event] = mapReturnEventsToTimeline(
        [entry({ actorUserId: 'ol_user_other' })],
        SESSION_USER
      );

      expect(event.by).toBe(COPY.byAnotherOperator);
    });

    it('OMITS the eyebrow when the actor is unknown, rather than guessing a side', () => {
      const [event] = mapReturnEventsToTimeline([entry({ actorUserId: null })], SESSION_USER);

      expect(event.by).toBeUndefined();
    });

    it('attributes an ingested opened event to the channel, which has no actor column', () => {
      const [event] = mapReturnEventsToTimeline(
        [
          entry({
            source: 'record_status',
            kind: 'opened',
            returnOrigin: 'source_ingested',
            sourceConnectionName: 'Allegro PL',
          }),
        ],
        SESSION_USER
      );

      expect(event.by).toBe('Allegro PL');
    });

    it('falls back to the unknown-source copy rather than rendering a connection id', () => {
      const [event] = mapReturnEventsToTimeline(
        [
          entry({
            source: 'record_status',
            kind: 'opened',
            returnOrigin: 'source_ingested',
            sourceConnectionName: null,
          }),
        ],
        SESSION_USER
      );

      expect(event.by).toBe(COPY.byUnknownConnection);
    });

    it('never claims a channel opened a return the operator authored', () => {
      const [event] = mapReturnEventsToTimeline(
        [
          entry({
            source: 'record_status',
            kind: 'opened',
            returnOrigin: 'operator_authored',
            sourceConnectionName: 'Allegro PL',
          }),
        ],
        SESSION_USER
      );

      expect(event.by).toBe(COPY.byOperator);
    });

    it('renders NO eyebrow for an executedBy this build does not know', () => {
      // The column is NOT NULL with two members today, so this is unreachable —
      // and that is the point: `refundExecutedBy` is an open string on the wire,
      // so a ternary would send a future `master_refund_executor` to "an
      // operator", attributing to a human a refund a machine made. The title
      // fails safe via `unknownKind`; the attribution must fail the same way.
      const [event] = mapReturnEventsToTimeline(
        [
          entry({
            source: 'refund',
            kind: 'refund_confirmed',
            refundExecutedBy: 'master_refund_executor',
          }),
        ],
        SESSION_USER
      );

      expect(event.by).toBeUndefined();
      // The row still renders — an unknown actor is not a reason to drop a fact.
      expect(event.title).toBe(COPY.refund_confirmed);
    });

    it('renders no eyebrow when executedBy is absent entirely', () => {
      const [event] = mapReturnEventsToTimeline(
        [entry({ source: 'refund', kind: 'refund_confirmed', refundExecutedBy: null })],
        SESSION_USER
      );

      expect(event.by).toBeUndefined();
    });

    it('reports what moved the money, never who — a refund has no actor column', () => {
      const [recorded] = mapReturnEventsToTimeline(
        [
          entry({
            source: 'refund',
            kind: 'refund_confirmed',
            refundExecutedBy: 'operator_out_of_band',
            actorUserId: SESSION_USER,
          }),
        ],
        SESSION_USER
      );
      const [executed] = mapReturnEventsToTimeline(
        [entry({ source: 'refund', kind: 'refund_confirmed', refundExecutedBy: 'refund_executor' })],
        SESSION_USER
      );

      // Even with a matching actorUserId in the payload, an out-of-band refund
      // is never attributed to "you": OpenLinker did not move that money.
      expect(recorded.by).toBe(COPY.byOperator);
      expect(recorded.description).toContain(COPY.refundRecordedOnly);
      expect(executed.by).toBe(COPY.byOpenLinker);
      expect(executed.description).toContain(COPY.refundExecuted);
    });
  });

  it('carries the timestamp through unchanged', () => {
    const [event] = mapReturnEventsToTimeline(
      [entry({ occurredAt: '2026-08-21T09:30:00.000Z' })],
      SESSION_USER
    );

    expect(event.timestamp).toBe('2026-08-21T09:30:00.000Z');
  });

  it('tones a blocked restock as a warning so it reads as outstanding work', () => {
    const [event] = mapReturnEventsToTimeline([entry({ restockState: 'blocked' })], SESSION_USER);

    expect(event.tone).toBe('warning');
    expect(event.description).toContain(COPY.restockBlocked);
  });

  it('namespaces ids so a return act cannot collide with an authored order event', () => {
    const [event] = mapReturnEventsToTimeline([entry({ id: 'created' })], SESSION_USER);

    expect(event.id).toBe('return:created');
  });
});
