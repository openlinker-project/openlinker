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

import {
  groupTasksByPacker,
  laneLoadPercent,
  laneLoadTone,
  lightestLoadLaneIds,
  UNASSIGNED_LANE_ID,
  type AssignPackingWorkLane,
} from './assign-packing-work-lanes';
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

const packerA: PackerSummary = { id: 'u_a', username: 'packer-a', online: true, stationLabel: null };
const packerB: PackerSummary = { id: 'u_b', username: 'packer-b', online: true, stationLabel: null };

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

// ── #3427 — load bar + "lightest load" tag ──────────────────────────────
describe('laneLoadPercent', () => {
  it('is 20% per task, capped at 100%', () => {
    expect(laneLoadPercent(0)).toBe(0);
    expect(laneLoadPercent(2)).toBe(40);
    expect(laneLoadPercent(4)).toBe(80);
    expect(laneLoadPercent(5)).toBe(100);
    expect(laneLoadPercent(9)).toBe(100);
  });
});

describe('laneLoadTone', () => {
  it('is normal under 3, busy from 3, over from 5', () => {
    expect(laneLoadTone(0)).toBe('normal');
    expect(laneLoadTone(2)).toBe('normal');
    expect(laneLoadTone(3)).toBe('busy');
    expect(laneLoadTone(4)).toBe('busy');
    expect(laneLoadTone(5)).toBe('over');
    expect(laneLoadTone(9)).toBe('over');
  });
});

function lane(id: string, taskCount: number): AssignPackingWorkLane {
  return {
    id,
    packer:
      id === UNASSIGNED_LANE_ID ? null : { id, username: id, online: true, stationLabel: null },
    tasks: Array.from({ length: taskCount }, (_, i) => task({ id: `${id}-${String(i)}` })),
  };
}

describe('lightestLoadLaneIds', () => {
  it('tags the single packer lane with the strictly lowest count', () => {
    const lanes = [lane(UNASSIGNED_LANE_ID, 3), lane('u_a', 0), lane('u_b', 2)];
    expect(lightestLoadLaneIds(lanes)).toEqual(new Set(['u_a']));
  });

  it('tags every tied lane at the minimum, never an arbitrary one', () => {
    const lanes = [lane('u_a', 1), lane('u_b', 1), lane('u_c', 3)];
    expect(lightestLoadLaneIds(lanes)).toEqual(new Set(['u_a', 'u_b']));
  });

  it('never tags the unassigned lane, whatever its count', () => {
    const lanes = [lane(UNASSIGNED_LANE_ID, 0), lane('u_a', 1), lane('u_b', 2)];
    expect(lightestLoadLaneIds(lanes).has(UNASSIGNED_LANE_ID)).toBe(false);
  });

  it('tags nothing when every packer lane carries the same load', () => {
    const lanes = [lane('u_a', 2), lane('u_b', 2)];
    expect(lightestLoadLaneIds(lanes)).toEqual(new Set());
  });

  it('tags nothing with fewer than two packer lanes — no comparison to make', () => {
    expect(lightestLoadLaneIds([lane('u_a', 0)])).toEqual(new Set());
    expect(lightestLoadLaneIds([lane(UNASSIGNED_LANE_ID, 5), lane('u_a', 0)])).toEqual(
      new Set()
    );
    expect(lightestLoadLaneIds([])).toEqual(new Set());
  });
});
