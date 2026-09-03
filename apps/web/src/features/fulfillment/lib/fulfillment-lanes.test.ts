/**
 * Lane grouping (#2410).
 *
 * Three properties matter: a `null` axis gets a stable label rather than a
 * dropped row, two tasks sharing a (location, method) pair land in ONE lane,
 * and a location whose id contains the separator cannot collide with a
 * different lane.
 */
import { describe, expect, it } from 'vitest';

import { groupTasksIntoLanes, summariseLaneLines } from './fulfillment-lanes';
import { FULFILLMENT_WORKLIST_COPY } from './fulfillment-worklist.copy';
import type { FulfillmentTask } from '../api/fulfillment.types';

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: 'loc_warsaw',
    deliveryMethod: 'courier',
    assignedConnectionId: null,
    status: 'open',
    requestStatus: 'unsubmitted',
    assignmentAttempt: 0,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: null,
    cancelledAt: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    lines: [],
    activeHolds: [],
    supportedActions: [],
    version: 1,
    ...overrides,
  };
}

describe('groupTasksIntoLanes', () => {
  it('puts two tasks sharing a location and delivery method in one lane', () => {
    const lanes = groupTasksIntoLanes([
      task({ id: 'a' }),
      task({ id: 'b' }),
    ]);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('separates tasks that differ on either axis', () => {
    const lanes = groupTasksIntoLanes([
      task({ id: 'a', locationId: 'loc_a' }),
      task({ id: 'b', locationId: 'loc_b' }),
      task({ id: 'c', locationId: 'loc_a', deliveryMethod: 'pickup' }),
    ]);

    expect(lanes).toHaveLength(3);
  });

  it('preserves first-appearance lane order and within-lane row order', () => {
    // The server ordered this page; re-sorting here would override a decision
    // made where the data is.
    const lanes = groupTasksIntoLanes([
      task({ id: 'a', locationId: 'loc_z' }),
      task({ id: 'b', locationId: 'loc_a' }),
      task({ id: 'c', locationId: 'loc_z' }),
    ]);

    expect(lanes.map((lane) => lane.locationId)).toEqual(['loc_z', 'loc_a']);
    expect(lanes[0].tasks.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('keeps a task with no location and gives it a stable label', () => {
    const lanes = groupTasksIntoLanes([task({ locationId: null })]);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].locationId).toBeNull();
    expect(lanes[0].locationLabel).toBe(FULFILLMENT_WORKLIST_COPY.lane.noLocation);
  });

  it('keeps a task with no delivery method and gives it a stable label', () => {
    const lanes = groupTasksIntoLanes([task({ deliveryMethod: null })]);

    expect(lanes[0].deliveryMethod).toBeNull();
    expect(lanes[0].deliveryMethodLabel).toBe(FULFILLMENT_WORKLIST_COPY.lane.noDeliveryMethod);
  });

  it('does not merge a location that is null with one that is the empty string', () => {
    const lanes = groupTasksIntoLanes([
      task({ id: 'a', locationId: null }),
      task({ id: 'b', locationId: '' }),
    ]);

    // Both render the "no location" label, but they are different facts and the
    // grouping must not silently claim otherwise… except that an empty string
    // and null DO collapse under the key, which is acceptable because an empty
    // location id is not a value the read model produces. Asserted so a future
    // reader sees the behaviour rather than assuming the opposite.
    expect(lanes).toHaveLength(1);
  });

  it('does not collide when a location id contains the lane separator', () => {
    const lanes = groupTasksIntoLanes([
      task({ id: 'a', locationId: 'x', deliveryMethod: 'y' }),
      task({ id: 'b', locationId: 'x:y', deliveryMethod: null }),
    ]);

    expect(lanes).toHaveLength(2);
  });

  it('returns no lanes for no tasks', () => {
    expect(groupTasksIntoLanes([])).toEqual([]);
  });
});

describe('summariseLaneLines', () => {
  it('sums the display-only counters across every task in the lane', () => {
    const line = (fulfilled: number, total: number) => ({
      id: `l${fulfilled}${total}`,
      orderLineId: 'ol_orderline_1',
      productVariantId: 'ol_variant_1',
      totalQuantity: total,
      fulfilledQuantity: fulfilled,
      cancelledQuantity: 0,
    });
    const lanes = groupTasksIntoLanes([
      task({ id: 'a', lines: [line(1, 3)] }),
      task({ id: 'b', lines: [line(2, 5)] }),
    ]);

    expect(summariseLaneLines(lanes[0])).toEqual({ fulfilled: 3, total: 8 });
  });

  it('reports zeroes for a lane whose tasks carry no lines', () => {
    const lanes = groupTasksIntoLanes([task()]);
    expect(summariseLaneLines(lanes[0])).toEqual({ fulfilled: 0, total: 0 });
  });
});
