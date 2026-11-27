/**
 * deriveProgressEventsFromSnapshot tests
 *
 * @module libs/core/src/fulfillment/domain/types/__tests__
 */
import type { FulfillmentProgressSnapshot } from '../fulfillment-execution.types';
import { deriveProgressEventsFromSnapshot } from '../fulfillment-status-poll.types';
import type { FulfillmentWork, FulfillmentWorkLine } from '../fulfillment-work.types';

const NOW = new Date('2026-11-19T15:00:00Z');

function line(over: Partial<FulfillmentWorkLine> = {}): FulfillmentWorkLine {
  return {
    id: 'wl-1',
    orderLineId: 'ol-1',
    productVariantId: 'v-1',
    totalQuantity: 2,
    fulfilledQuantity: 0,
    cancelledQuantity: 0,
    ...over,
  } as FulfillmentWorkLine;
}

function work(lines: FulfillmentWorkLine[]): FulfillmentWork {
  return { id: 'w-1', orderId: 'o-1', lines } as unknown as FulfillmentWork;
}

function snapshot(
  lines: Array<{ workLineId: string; fulfilledQuantity: number; cancelledQuantity: number }>
): FulfillmentProgressSnapshot {
  return {
    work: { workId: 'w-1', connectionId: 'conn-amz' },
    externalWorkId: 'OL-abc',
    lines,
    observedAt: null,
  };
}

describe('deriveProgressEventsFromSnapshot', () => {
  it('should record nothing while the holder has not moved the work', () => {
    const events = deriveProgressEventsFromSnapshot(
      work([line()]),
      snapshot([{ workLineId: 'wl-1', fulfilledQuantity: 0, cancelledQuantity: 0 }]),
      NOW
    );
    expect(events).toEqual([]);
  });

  it('should record a partial fulfilment as picked and wait for the rest', () => {
    const events = deriveProgressEventsFromSnapshot(
      work([line()]),
      snapshot([{ workLineId: 'wl-1', fulfilledQuantity: 1, cancelledQuantity: 0 }]),
      NOW
    );
    expect(events.map((event) => event.kind)).toEqual(['picked']);
    expect(events[0]).toMatchObject({
      connectionId: 'conn-amz',
      occurredAt: NOW,
      lines: [{ orderLineId: 'ol-1', fulfilledDelta: 1, cancelledDelta: 0 }],
    });
  });

  it('should pick, ship and close a fully fulfilled work', () => {
    const events = deriveProgressEventsFromSnapshot(
      work([line({ fulfilledQuantity: 1 })]),
      snapshot([{ workLineId: 'wl-1', fulfilledQuantity: 2, cancelledQuantity: 0 }]),
      NOW
    );
    expect(events.map((event) => event.kind)).toEqual(['picked', 'shipped', 'closed']);
    expect(events[0]).toMatchObject({ lines: [{ fulfilledDelta: 1 }] });
  });

  it('should ship what was fulfilled and close the rest short once every line settled', () => {
    const events = deriveProgressEventsFromSnapshot(
      work([line()]),
      snapshot([{ workLineId: 'wl-1', fulfilledQuantity: 1, cancelledQuantity: 1 }]),
      NOW
    );
    expect(events.map((event) => event.kind)).toEqual(['picked', 'shipped', 'short_picked']);
    expect(events[2]).toMatchObject({ lines: [{ orderLineId: 'ol-1', cancelledDelta: 1 }] });
  });

  it('should not close the work short while another line is still open', () => {
    const events = deriveProgressEventsFromSnapshot(
      work([line(), line({ id: 'wl-2', orderLineId: 'ol-2' })]),
      snapshot([
        { workLineId: 'wl-1', fulfilledQuantity: 0, cancelledQuantity: 2 },
        { workLineId: 'wl-2', fulfilledQuantity: 0, cancelledQuantity: 0 },
      ]),
      NOW
    );
    expect(events).toEqual([]);
  });

  it('should clamp a holder reporting more than the line asked for', () => {
    const events = deriveProgressEventsFromSnapshot(
      work([line()]),
      snapshot([{ workLineId: 'wl-1', fulfilledQuantity: 5, cancelledQuantity: 3 }]),
      NOW
    );
    expect(events[0]).toMatchObject({ lines: [{ fulfilledDelta: 2 }] });
    expect(events.map((event) => event.kind)).toEqual(['picked', 'shipped', 'closed']);
  });

  it('should derive the same keys from the same state, so a repeat poll records nothing new', () => {
    const args = [
      work([line()]),
      snapshot([{ workLineId: 'wl-1', fulfilledQuantity: 2, cancelledQuantity: 0 }]),
      NOW,
    ] as const;
    const first = deriveProgressEventsFromSnapshot(...args).map((event) => event.idempotencyKey);
    const second = deriveProgressEventsFromSnapshot(...args).map((event) => event.idempotencyKey);
    expect(second).toEqual(first);
  });
});
