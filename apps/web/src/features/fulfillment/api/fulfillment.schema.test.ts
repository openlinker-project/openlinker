/**
 * Fulfilment-task schema tests (#2411).
 *
 * Two properties, both of which have burned this repo before:
 *   - `.nullish()` over `.optional()` (#939) — OL serialises an absent optional
 *     as JSON `null`, and `.optional()` would drop the whole task.
 *   - no `z.enum` on a server-owned vocabulary — a value added backend-side
 *     must not make the task unparseable, because the panel would then report
 *     "no fulfilment tasks" for an order that has one.
 */
import { describe, expect, it } from 'vitest';

import { fulfillmentTaskPageSchema, fulfillmentTaskSchema } from './fulfillment.schema';

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: 'loc_1',
    deliveryMethod: 'courier',
    assignedConnectionId: 'conn_1',
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
    supportedActions: ['hold'],
    version: 3,
    ...overrides,
  };
}

describe('fulfillmentTaskSchema (#2411)', () => {
  it('should parse a task whose every nullable field arrived as null', () => {
    const parsed = fulfillmentTaskSchema.parse(
      task({
        locationId: null,
        deliveryMethod: null,
        assignedConnectionId: null,
        cancellationReason: null,
        externalWorkId: null,
        acceptedAt: null,
        cancelledAt: null,
      })
    );

    expect(parsed.id).toBe('ol_work_1');
    expect(parsed.locationId).toBeNull();
    expect(parsed.deliveryMethod).toBeNull();
  });

  it('should normalise an omitted nullable field to null rather than undefined', () => {
    const raw = task();
    delete raw.locationId;

    expect(fulfillmentTaskSchema.parse(raw).locationId).toBeNull();
  });

  it('should parse a hold whose note is null', () => {
    const parsed = fulfillmentTaskSchema.parse(
      task({
        activeHolds: [
          { id: 'h1', reason: 'stock-shortfall', note: null, placedAt: '2026-08-20T10:00:00.000Z' },
        ],
      })
    );

    expect(parsed.activeHolds).toHaveLength(1);
    expect(parsed.activeHolds[0]?.note).toBeNull();
  });

  it('should keep a status this build does not recognise instead of rejecting the task', () => {
    const parsed = fulfillmentTaskSchema.parse(
      task({ status: 'a_status_added_next_wave', requestStatus: 'also_new' })
    );

    expect(parsed.status).toBe('a_status_added_next_wave');
    expect(parsed.requestStatus).toBe('also_new');
  });

  it('should keep an action this build does not recognise', () => {
    const parsed = fulfillmentTaskSchema.parse(task({ supportedActions: ['hold', 'teleport'] }));

    expect(parsed.supportedActions).toEqual(['hold', 'teleport']);
  });

  it('should default omitted collections to empty arrays', () => {
    const raw = task();
    delete raw.lines;
    delete raw.activeHolds;
    delete raw.supportedActions;

    const parsed = fulfillmentTaskSchema.parse(raw);
    expect(parsed.lines).toEqual([]);
    expect(parsed.activeHolds).toEqual([]);
    expect(parsed.supportedActions).toEqual([]);
  });

  it('should reject a payload missing a required scalar', () => {
    const raw = task();
    delete raw.version;

    expect(() => fulfillmentTaskSchema.parse(raw)).toThrow();
  });
});

describe('fulfillmentTaskPageSchema (#2411)', () => {
  it('should parse a page of tasks', () => {
    const parsed = fulfillmentTaskPageSchema.parse({
      works: [task()],
      total: 1,
      limit: 50,
      offset: 0,
    });

    expect(parsed.works).toHaveLength(1);
    expect(parsed.total).toBe(1);
  });
});
