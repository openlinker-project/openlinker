/**
 * Packer-lane grouping (#3340).
 *
 * Four properties matter: the unassigned lane is always first and present
 * even when empty, every roster packer gets a lane even with zero tasks,
 * tasks group by `assignedToUserId` regardless of roster order, and a task
 * assigned to a user id outside the roster still surfaces rather than
 * silently disappearing.
 */
import { describe, expect, it } from 'vitest';

import { groupTasksByPacker } from './assign-packing-work-lanes';
import type { FulfillmentTask } from '../api/fulfillment.types';
import type { PackerSummary } from '../../users';

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: 'ol_work_1',
    orderId: 'ol_order_1',
    locationId: 'loc_warsaw',
    deliveryMethod: 'courier',
    assignedConnectionId: null,
    assignedToUserId: null,
    selfServeEligible: true,
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

const packerA: PackerSummary = { id: 'u_a', username: 'packer-a' };
const packerB: PackerSummary = { id: 'u_b', username: 'packer-b' };

describe('groupTasksByPacker', () => {
  it('puts the unassigned lane first even when it is empty', () => {
    const lanes = groupTasksByPacker([task({ assignedToUserId: 'u_a' })], [packerA]);

    expect(lanes[0]).toMatchObject({ id: 'unassigned', packer: null, tasks: [] });
  });

  it('renders every roster packer as its own lane even with zero tasks', () => {
    const lanes = groupTasksByPacker([], [packerA, packerB]);

    expect(lanes.map((lane) => lane.id)).toEqual(['unassigned', 'u_a', 'u_b']);
    expect(lanes[1].tasks).toEqual([]);
    expect(lanes[2].tasks).toEqual([]);
  });

  it('groups tasks by assignedToUserId regardless of roster order', () => {
    const lanes = groupTasksByPacker(
      [
        task({ id: 'a', assignedToUserId: 'u_b' }),
        task({ id: 'b', assignedToUserId: 'u_a' }),
        task({ id: 'c', assignedToUserId: null }),
      ],
      [packerA, packerB]
    );

    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    expect(byId.get('u_a')?.tasks.map((t) => t.id)).toEqual(['b']);
    expect(byId.get('u_b')?.tasks.map((t) => t.id)).toEqual(['a']);
    expect(byId.get('unassigned')?.tasks.map((t) => t.id)).toEqual(['c']);
  });

  it('surfaces a task assigned to a user outside the active roster', () => {
    const lanes = groupTasksByPacker(
      [task({ id: 'a', assignedToUserId: 'u_former' })],
      [packerA]
    );

    const offRoster = lanes.find((lane) => lane.id === 'u_former');
    expect(offRoster).toBeDefined();
    expect(offRoster?.packer).toBeNull();
    expect(offRoster?.tasks.map((t) => t.id)).toEqual(['a']);
  });
});
