/**
 * Unit tests for the fulfilment dispatch enqueue derivation (#2955).
 *
 * @module libs/core/src/fulfillment/domain/types/__tests__
 */
import {
  buildFulfillmentDispatchDedupeKey,
  deriveFulfillmentDispatchEnqueueIntents,
  findUndispatchableWorkIds,
  type RoutedWorkRef,
} from '../fulfillment-dispatch-enqueue.types';

describe('buildFulfillmentDispatchDedupeKey', () => {
  it('should namespace the key by work id when building it', () => {
    expect(buildFulfillmentDispatchDedupeKey('ol_fulfillmentwork_1')).toBe(
      'fulfillment:dispatch:ol_fulfillmentwork_1'
    );
  });

  it('should never mint the handshake key when building the enqueue key', () => {
    // The handshake key is `work:{id}:{attempt}` and #2399 makes it obtainable
    // only through `claimDispatchAttempt`'s RETURNING. Re-deriving it here would
    // reintroduce exactly the shape that guarantee removes.
    const key = buildFulfillmentDispatchDedupeKey('ol_fulfillmentwork_1');
    expect(key.startsWith('work:')).toBe(false);
  });

  it('should be stable across calls so a retry re-derives the same key', () => {
    expect(buildFulfillmentDispatchDedupeKey('w-1')).toBe(buildFulfillmentDispatchDedupeKey('w-1'));
  });
});

describe('deriveFulfillmentDispatchEnqueueIntents', () => {
  const assigned: RoutedWorkRef = { workId: 'w-1', assignedConnectionId: 'conn-1' };
  const unassigned: RoutedWorkRef = { workId: 'w-2', assignedConnectionId: null };

  it('should carry the work holder as the connection when the work is assigned', () => {
    expect(deriveFulfillmentDispatchEnqueueIntents([assigned], 'ol_order_1')).toEqual([
      {
        workId: 'w-1',
        connectionId: 'conn-1',
        orderId: 'ol_order_1',
        dedupeKey: 'fulfillment:dispatch:w-1',
      },
    ]);
  });

  it('should skip the work when it carries no holder', () => {
    // `SyncJob.connectionId` is non-nullable and the handshake throws a
    // RETRYABLE error for unassigned work, so enqueueing one can only burn the
    // ladder and leave a dead row.
    expect(deriveFulfillmentDispatchEnqueueIntents([unassigned], 'ol_order_1')).toEqual([]);
  });

  it('should emit one intent per assigned work when a routing commit split the order', () => {
    const intents = deriveFulfillmentDispatchEnqueueIntents(
      [assigned, unassigned, { workId: 'w-3', assignedConnectionId: 'conn-2' }],
      'ol_order_1'
    );

    expect(intents.map((intent) => intent.workId)).toEqual(['w-1', 'w-3']);
    expect(intents.map((intent) => intent.connectionId)).toEqual(['conn-1', 'conn-2']);
  });

  it('should return nothing when the commit created no work', () => {
    expect(deriveFulfillmentDispatchEnqueueIntents([], 'ol_order_1')).toEqual([]);
  });

  it('should not mutate its arguments when deriving intents', () => {
    const works: RoutedWorkRef[] = [{ ...assigned }];
    const snapshot = JSON.stringify(works);

    deriveFulfillmentDispatchEnqueueIntents(works, 'ol_order_1');

    expect(JSON.stringify(works)).toBe(snapshot);
  });
});

describe('findUndispatchableWorkIds', () => {
  it('should name every holder-less work so the caller can warn about it', () => {
    expect(
      findUndispatchableWorkIds([
        { workId: 'w-1', assignedConnectionId: 'conn-1' },
        { workId: 'w-2', assignedConnectionId: null },
        { workId: 'w-3', assignedConnectionId: null },
      ])
    ).toEqual(['w-2', 'w-3']);
  });

  it('should report nothing when every work carries a holder', () => {
    expect(findUndispatchableWorkIds([{ workId: 'w-1', assignedConnectionId: 'c' }])).toEqual([]);
  });
});
